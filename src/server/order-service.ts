import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getFirestore, Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  getFirebaseServerConfig,
  getFirebaseAdminApp,
  verifyFirebaseConfigConsistency,
  getRequiredQueryTokenPepper,
  ServerConfigError,
  type FirebaseConsistencyReport,
} from '../config/firebase-server.ts';
import {
  OrderItem,
  OrderInputPayload,
  AdminOrderUpdateInput,
  SAFE_ALPHABET,
  PRIVACY_POLICY_VERSION,
  generateOrderId,
  generateOrderNumber,
  generateQueryToken,
  normalizeQueryToken,
  validateOrderInput,
  validateAdminOrderUpdate,
  cleanOrderForFirestore,
  toPublicOrderView,
  PublicOrderView,
} from '../utils/order-utils.ts';
import { notifyNewOrder } from './notifier.ts';

export {
  getFirebaseServerConfig,
  getFirebaseAdminApp,
  verifyFirebaseConfigConsistency,
  getRequiredQueryTokenPepper,
  type FirebaseConsistencyReport,
};

export class DatabaseUnavailableError extends Error {
  public readonly statusCode = 503;
  public readonly code: string;
  public readonly retryable = true;
  public readonly internalDiagnostic?: string;
  constructor(
    message: string,
    code = 'DATABASE_UNAVAILABLE',
    internalDiagnostic?: string
  ) {
    super(message);
    this.name = 'DatabaseUnavailableError';
    this.code = code;
    this.internalDiagnostic = internalDiagnostic;
  }
}

export const ConfigurationError = ServerConfigError;
export type ConfigurationError = ServerConfigError;

export type RateLimitFailureCategory =
  | 'TIMEOUT'
  | 'PERMISSION_DENIED'
  | 'NETWORK_UNAVAILABLE'
  | 'TRANSACTION_CONFLICT'
  | 'UNKNOWN';

export type RateLimitScope =
  | 'order_create'
  | 'order_lookup_ip'
  | 'order_lookup_target';

export class RateLimitServiceUnavailableError extends Error {
  public readonly statusCode = 503;
  public readonly code = 'RATE_LIMIT_BACKEND_UNAVAILABLE';
  public readonly retryable = true;
  public readonly failureCategory: RateLimitFailureCategory;
  public readonly scope: RateLimitScope;
  constructor(
    failureCategory: RateLimitFailureCategory,
    scope: RateLimitScope,
    message = '安全限流校验服务暂时繁忙或不可用，为保障工单安全已暂停本次请求，请稍后重试。'
  ) {
    super(message);
    this.name = 'RateLimitServiceUnavailableError';
    this.failureCategory = failureCategory;
    this.scope = scope;
  }
}

export class OrderValidationError extends Error {
  public readonly statusCode = 400;
  public readonly errors?: Record<string, string>;
  constructor(message: string, errors?: Record<string, string>) {
    super(message);
    this.name = 'OrderValidationError';
    this.errors = errors;
  }
}

export class OrderNotFoundError extends Error {
  public readonly statusCode = 404;
  constructor(message = '未找到指定工单') {
    super(message);
    this.name = 'OrderNotFoundError';
  }
}

export class DuplicateOrderConflictError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'DUPLICATE_SUBMISSION_REQUIRES_MANUAL_RECOVERY';
  public readonly orderNumber: string;
  public readonly order: PublicOrderView;
  public readonly recoveryInstructions: string;
  constructor(order: OrderItem) {
    const publicView = toPublicOrderView(order);
    const instructions =
      '系统检测到您在短时间内已提交过完全相同的需求（工单号：' +
      order.orderNumber +
      '）。为保护客户隐私，数据库不保存明文查询凭证；因当前请求缺少首次提交会话的幂等恢复标识（例如已关闭重新打开页面），系统无法直接回显原查询凭证。若您未保存首次生成的查询凭证，请通过提交时预留的联系方式（' +
      publicView.maskedContact +
      '）联系工程师进行人工核验并重新签发查询凭证；若您确实需要发起另一笔独立新委托，请点击“确认创建新工单”。';
    super(instructions);
    this.name = 'DuplicateOrderConflictError';
    this.orderNumber = order.orderNumber;
    this.order = publicView;
    this.recoveryInstructions = instructions;
  }
}

/**
 * Compute HMAC-SHA256 hash of queryToken bound to orderNumber.
 * Plaintext queryToken is NEVER stored in the database.
 */
export function hashQueryToken(
  orderNumber: string,
  queryToken: string,
  overridePepper?: string
): string {
  const pepper = getRequiredQueryTokenPepper(overridePepper);
  const normalizedOrder = String(orderNumber || '').trim().toUpperCase();
  const normalizedToken = normalizeQueryToken(queryToken);
  return crypto
    .createHmac('sha256', pepper)
    .update(`${normalizedOrder}:${normalizedToken}`)
    .digest('hex');
}

/**
 * Constant-time verification of queryToken against stored queryTokenHash.
 */
export function verifyQueryToken(
  orderNumber: string,
  candidateToken: string,
  storedHash?: string,
  overridePepper?: string
): boolean {
  const pepper = getRequiredQueryTokenPepper(overridePepper);
  if (!storedHash || typeof storedHash !== 'string' || storedHash.length !== 64) {
    return false;
  }
  const candidateHash = hashQueryToken(orderNumber, candidateToken, pepper);
  try {
    const bufA = Buffer.from(candidateHash, 'hex');
    const bufB = Buffer.from(storedHash, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function isValidExplicitIdempotencyKey(key?: string): key is string {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  return trimmed.length >= 16 && trimmed.length <= 128 && /^[A-Za-z0-9_\-:]+$/.test(trimmed);
}

/**
 * Deterministically derives a 60-bit query token (QK-XXXX-XXXX-XXXX) for an explicit
 * client idempotency session key + orderNumber + contactValue + server secret pepper.
 *
 * Security properties (P1-A):
 * 1. Plaintext queryToken is NEVER stored in Firestore (only `queryTokenHash` is stored).
 * 2. If the HTTP response is lost due to a network drop and the client retries with the
 *    exact same high-entropy `X-Idempotency-Key` and payload within the idempotency window,
 *    the server can recompute this token in memory, verify it against `order.queryTokenHash`,
 *    and return the valid token idempotently.
 * 3. Without BOTH the server's `QUERY_TOKEN_PEPPER` and the client's 128-bit `X-Idempotency-Key`,
 *    no third party knowing only `orderNumber` can ever derive the token.
 * 4. Once an admin rotates the order's query token (`rotateOrderQueryTokenByAdmin`),
 *    `order.queryTokenHash` changes to a random token hash, immediately invalidating replay.
 */
export function deriveSessionQueryToken(
  orderNumber: string,
  explicitIdempotencyKey: string,
  contactValue: string,
  overridePepper?: string
): string {
  const pepper = getRequiredQueryTokenPepper(overridePepper);
  const digest = crypto
    .createHmac('sha256', pepper)
    .update(
      [
        'qk_session_v3',
        orderNumber.trim().toUpperCase(),
        explicitIdempotencyKey.trim(),
        contactValue.trim().toLowerCase(),
      ].join('|')
    )
    .digest();

  // 32 divides 256 evenly (256 = 8 * 32), so digest[i] & 31 is completely unbiased
  const chars: string[] = [];
  for (let i = 0; i < 12; i++) {
    chars.push(SAFE_ALPHABET.charAt(digest[i] & 31));
  }
  return `QK-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars
    .slice(8, 12)
    .join('')}`;
}

export const IDEMPOTENCY_EXPLICIT_TTL_MS = 15 * 60 * 1000; // 15 minutes for explicit key retries
export const IDEMPOTENCY_CONTENT_WINDOW_MS = 60 * 1000; // 60 seconds for accidental tab-reopen duplicate submit

const FIRESTORE_OPERATION_TIMEOUT_MS = 8000;

function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new DatabaseUnavailableError(
          '订单数据库响应超时，请稍后重试。系统未保存任何半成品数据。',
          'DATABASE_TIMEOUT',
          `[FirestoreAdminOrderRepository] op=${label} timeoutMs=${FIRESTORE_OPERATION_TIMEOUT_MS}`
        )
      );
    }, FIRESTORE_OPERATION_TIMEOUT_MS);
    timer.unref?.();

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Computes the payload content & contact fingerprint so two different customers
 * or two different order descriptions never collide even if an idempotency key is reused.
 */
export function computeOrderContentDigest(payload: OrderInputPayload): string {
  const raw = [
    payload.serviceType,
    payload.title?.trim(),
    payload.description?.trim(),
    payload.studyArea?.trim() || '',
    payload.dataFormats?.trim() || '',
    payload.budgetRange || '',
    payload.expectedDeliveryDate || '',
    payload.contactMethod,
    payload.contactValue?.trim().toLowerCase(),
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Compute a deterministic idempotency storage key:
 * - When `explicitKey` is provided: scoped to `explicitKey + contactValue + contentDigest`
 *   so it never merges orders across different customers or modified form payloads.
 * - When `explicitKey` is absent: scoped to a 60-second time bucket + contactValue + contentDigest.
 */
export function computeSubmissionIdempotencyKey(
  _ip: string,
  payload: OrderInputPayload,
  explicitKey?: string
): string {
  const contentDigest = computeOrderContentDigest(payload);
  const contactNorm = `${payload.contactMethod}:${payload.contactValue.trim().toLowerCase()}`;

  if (isValidExplicitIdempotencyKey(explicitKey)) {
    return crypto
      .createHash('sha256')
      .update(`explicit_v3|${explicitKey.trim()}|${contactNorm}|${contentDigest}`)
      .digest('hex')
      .slice(0, 40);
  }

  const timeBucket = Math.floor(Date.now() / IDEMPOTENCY_CONTENT_WINDOW_MS);
  return crypto
    .createHash('sha256')
    .update(`content_v3|${timeBucket}|${contactNorm}|${contentDigest}`)
    .digest('hex')
    .slice(0, 40);
}

export interface IdempotencyRecord {
  orderNumber: string;
  mode: 'explicit_key' | 'content_fingerprint';
  contentDigest: string;
  createdAt: string;
  expiresAt: number;
  /** Firestore TTL policy target; numeric expiresAt remains for application logic. */
  ttlAt?: Timestamp;
}

export interface RateLimitDetail {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  source: 'authoritative-store' | 'l1-precheck-reject';
}

export interface OrderRepository {
  readonly driverName: string;
  createOrderAtomic(
    buildOrder: (orderNumber: string) => OrderItem,
    idempotencyKey: string,
    idempotencyMeta?: {
      mode: 'explicit_key' | 'content_fingerprint';
      contentDigest: string;
      ttlMs: number;
      bypassExisting?: boolean;
    }
  ): Promise<{
    order: OrderItem;
    duplicate: boolean;
    matchedMode?: 'explicit_key' | 'content_fingerprint';
  }>;
  getOrderByNumber(orderNumber: string): Promise<OrderItem | null>;
  getOrderByIdOrNumber(idOrNumber: string): Promise<OrderItem | null>;
  listOrders(): Promise<OrderItem[]>;
  updateOrderAtomic(
    idOrNumber: string,
    updater: (existing: OrderItem) => OrderItem
  ): Promise<OrderItem>;
  importOrderAtomic(
    order: OrderItem,
    policy?: 'if-newer'
  ): Promise<'created' | 'updated' | 'skipped'>;
  checkRateLimit(
    key: string,
    limit: number,
    windowMs: number,
    scope?: RateLimitScope
  ): Promise<boolean>;
  checkRateLimitDetailed?(
    key: string,
    limit: number,
    windowMs: number,
    scope?: RateLimitScope
  ): Promise<RateLimitDetail>;
}

/**
 * Lightweight in-process L1 pre-check (Reject-Only):
 * - If a single instance ALREADY knows a key has exceeded `limit` in the current window,
 *   it rejects immediately without spending Firestore read/write quota (Denial-of-Wallet protection).
 * - L1 NEVER approves a request on its own: any request not rejected by L1 MUST still pass
 *   the authoritative multi-instance store (`FirestoreAdminOrderRepository` or `IsolatedTestOrderRepository`).
 */
interface L1Bucket {
  count: number;
  windowStart: number;
}
const l1RejectBuckets = new Map<string, L1Bucket>();

function precheckL1RejectOnly(
  safeKey: string,
  limit: number,
  windowMs: number,
  now: number
): { rejected: boolean; retryAfterSeconds: number } {
  const existing = l1RejectBuckets.get(safeKey);
  if (!existing || now - existing.windowStart >= windowMs) {
    return { rejected: false, retryAfterSeconds: 0 };
  }
  if (existing.count >= limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.windowStart + windowMs - now) / 1000)
    );
    return { rejected: true, retryAfterSeconds };
  }
  return { rejected: false, retryAfterSeconds: 0 };
}

function recordL1Observation(
  safeKey: string,
  count: number,
  windowStart: number
): void {
  if (l1RejectBuckets.size > 5000) {
    l1RejectBuckets.clear();
  }
  l1RejectBuckets.set(safeKey, { count, windowStart });
}

export function clearL1RateLimitCacheForTests(): void {
  l1RejectBuckets.clear();
}

function classifyFirestoreRateLimitError(err: any): RateLimitFailureCategory {
  const code = err?.code;
  const msg = String(err?.message || err || '').toUpperCase();
  if (code === 4 || msg.includes('DEADLINE_EXCEEDED') || msg.includes('TIMEOUT')) {
    return 'TIMEOUT';
  }
  if (code === 7 || msg.includes('PERMISSION_DENIED')) {
    return 'PERMISSION_DENIED';
  }
  if (code === 10 || msg.includes('ABORTED') || msg.includes('TRANSACTION')) {
    return 'TRANSACTION_CONFLICT';
  }
  if (code === 14 || msg.includes('UNAVAILABLE') || msg.includes('NETWORK')) {
    return 'NETWORK_UNAVAILABLE';
  }
  return 'UNKNOWN';
}

/**
 * Authoritative Production Order Repository backed exclusively by Firebase Admin SDK Firestore.
 * Uses Application Default Credentials (ADC) and never silently falls back to memory or local files.
 */
export class FirestoreAdminOrderRepository implements OrderRepository {
  public readonly driverName = 'firestore-admin';
  private readonly db: Firestore;
  private readonly ordersCollection: string;
  private readonly idempotencyCollection: string;
  private readonly rateLimitCollection: string;

  constructor(collectionPrefix = '') {
    const serverCfg = getFirebaseServerConfig();
    const app = getFirebaseAdminApp(serverCfg);
    this.db = getFirestore(app, serverCfg.firestoreDatabaseId);
    this.ordersCollection = collectionPrefix ? `${collectionPrefix}_orders` : 'orders';
    this.idempotencyCollection = collectionPrefix
      ? `${collectionPrefix}_idempotencyKeys`
      : 'idempotencyKeys';
    this.rateLimitCollection = collectionPrefix ? `${collectionPrefix}_rateLimits` : 'rateLimits';
  }

  private wrapFirestoreError(err: any, operation: string): never {
    const code = err?.code;
    const msg = err?.message || String(err);
    const serverCfg = getFirebaseServerConfig();
    const internalDiag = `[FirestoreAdminOrderRepository] op=${operation} code=${code} project=${serverCfg.projectId} db=${serverCfg.firestoreDatabaseId} msg=${msg}`;
    console.error(internalDiag);

    if (code === 7 || String(msg).includes('PERMISSION_DENIED')) {
      throw new DatabaseUnavailableError(
        '订单存储服务当前缺少云端数据库访问授权，系统已安全拒绝写入以防止数据静默丢失，请稍后重试或联系管理员。',
        'FIRESTORE_IAM_PERMISSION_DENIED',
        internalDiag
      );
    }
    throw new DatabaseUnavailableError(
      '订单数据库暂时不可用，请稍后重试。系统未保存任何半成品数据。',
      'FIRESTORE_OPERATION_FAILED',
      internalDiag
    );
  }

  async createOrderAtomic(
    buildOrder: (orderNumber: string) => OrderItem,
    idempotencyKey: string,
    idempotencyMeta?: {
      mode: 'explicit_key' | 'content_fingerprint';
      contentDigest: string;
      ttlMs: number;
      bypassExisting?: boolean;
    }
  ): Promise<{
    order: OrderItem;
    duplicate: boolean;
    matchedMode?: 'explicit_key' | 'content_fingerprint';
  }> {
    const nowMs = Date.now();
    const metaMode = idempotencyMeta?.mode || 'content_fingerprint';
    const ttlMs = idempotencyMeta?.ttlMs || IDEMPOTENCY_EXPLICIT_TTL_MS;

    try {
      return await withTimeout(
        this.db.runTransaction(async (tx) => {
        const idemRef = this.db.collection(this.idempotencyCollection).doc(idempotencyKey);
        if (!idempotencyMeta?.bypassExisting) {
          const idemSnap = await tx.get(idemRef);
          if (idemSnap.exists) {
            const idemData = idemSnap.data() as Partial<IdempotencyRecord> | undefined;
            const expiresAt = typeof idemData?.expiresAt === 'number' ? idemData.expiresAt : 0;
            const prevOrderNumber = idemData?.orderNumber;
            if (prevOrderNumber && nowMs <= expiresAt) {
              const prevOrderSnap = await tx.get(
                this.db.collection(this.ordersCollection).doc(prevOrderNumber)
              );
              if (prevOrderSnap.exists) {
                return {
                  order: prevOrderSnap.data() as OrderItem,
                  duplicate: true,
                  matchedMode: idemData?.mode || metaMode,
                };
              }
            }
          }
        }

        let candidateOrder: OrderItem | null = null;
        let orderRef: FirebaseFirestore.DocumentReference | null = null;

        for (let attempt = 0; attempt < 5; attempt++) {
          const ordNo = generateOrderNumber();
          const ref = this.db.collection(this.ordersCollection).doc(ordNo);
          const existingSnap = await tx.get(ref);
          if (!existingSnap.exists) {
            candidateOrder = buildOrder(ordNo);
            orderRef = ref;
            break;
          }
        }

        if (!candidateOrder || !orderRef) {
          throw new Error('无法生成唯一工单号，请重试');
        }

        const cleaned = cleanOrderForFirestore(candidateOrder);
        tx.set(orderRef, cleaned);
        tx.set(idemRef, {
          orderNumber: candidateOrder.orderNumber,
          mode: metaMode,
          contentDigest: idempotencyMeta?.contentDigest || '',
          createdAt: candidateOrder.createdAt,
          expiresAt: nowMs + ttlMs,
          ttlAt: Timestamp.fromMillis(nowMs + ttlMs),
        } satisfies IdempotencyRecord);

        return { order: candidateOrder, duplicate: false, matchedMode: metaMode };
        }),
        'createOrderAtomic'
      );
    } catch (err: any) {
      if (
        err instanceof DatabaseUnavailableError ||
        err instanceof ConfigurationError ||
        err instanceof OrderValidationError
      ) {
        throw err;
      }
      this.wrapFirestoreError(err, 'createOrderAtomic');
    }
  }

  async getOrderByNumber(orderNumber: string): Promise<OrderItem | null> {
    const normalized = String(orderNumber || '').trim().toUpperCase();
    if (!normalized) return null;
    try {
      const snap = await withTimeout(
        this.db.collection(this.ordersCollection).doc(normalized).get(),
        'getOrderByNumber'
      );
      if (!snap.exists) return null;
      return snap.data() as OrderItem;
    } catch (err: any) {
      this.wrapFirestoreError(err, 'getOrderByNumber');
    }
  }

  async getOrderByIdOrNumber(idOrNumber: string): Promise<OrderItem | null> {
    const trimmed = String(idOrNumber || '').trim();
    if (!trimmed) return null;
    try {
      const directSnap = await withTimeout(
        this.db.collection(this.ordersCollection).doc(trimmed.toUpperCase()).get(),
        'getOrderByIdOrNumber'
      );
      if (directSnap.exists) {
        return directSnap.data() as OrderItem;
      }
      const qSnap = await withTimeout(
        this.db
          .collection(this.ordersCollection)
          .where('id', '==', trimmed)
          .limit(1)
          .get(),
        'getOrderByIdOrNumber'
      );
      if (qSnap.empty) return null;
      return qSnap.docs[0].data() as OrderItem;
    } catch (err: any) {
      this.wrapFirestoreError(err, 'getOrderByIdOrNumber');
    }
  }

  async listOrders(): Promise<OrderItem[]> {
    const pageSize = 500;
    const maxOrders = 10000;
    const results: OrderItem[] = [];
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    try {
      while (results.length < maxOrders) {
        let query: FirebaseFirestore.Query = this.db
          .collection(this.ordersCollection)
          .orderBy('createdAt', 'desc')
          .limit(Math.min(pageSize, maxOrders - results.length));
        if (lastDoc) {
          query = query.startAfter(lastDoc);
        }
        const snap = await withTimeout(query.get(), 'listOrders');
        results.push(...snap.docs.map((d) => d.data() as OrderItem));
        if (snap.empty || snap.size < pageSize) break;
        const last = snap.docs[snap.docs.length - 1];
        if (!last) break;
        lastDoc = last;
      }
      if (results.length >= maxOrders) {
        console.warn(
          `[FirestoreAdminOrderRepository] listOrders reached safety cap ${maxOrders}; older orders are not returned.`
        );
      }
      return results;
    } catch (err: any) {
      this.wrapFirestoreError(err, 'listOrders');
    }
  }

  async updateOrderAtomic(
    idOrNumber: string,
    updater: (existing: OrderItem) => OrderItem
  ): Promise<OrderItem> {
    try {
      return await withTimeout(
        this.db.runTransaction(async (tx) => {
        const trimmed = String(idOrNumber || '').trim();
        let docRef = this.db.collection(this.ordersCollection).doc(trimmed.toUpperCase());
        let snap = await tx.get(docRef);

        if (!snap.exists) {
          const qSnap = await tx.get(
            this.db.collection(this.ordersCollection).where('id', '==', trimmed).limit(1)
          );
          if (qSnap.empty) {
            throw new OrderNotFoundError();
          }
          docRef = qSnap.docs[0].ref;
          snap = qSnap.docs[0];
        }

        const existing = snap.data() as OrderItem;
        const updated = updater(existing);
        tx.set(docRef, cleanOrderForFirestore(updated));
        return updated;
        }),
        'updateOrderAtomic'
      );
    } catch (err: any) {
      if (
        err instanceof OrderNotFoundError ||
        err instanceof OrderValidationError ||
        err instanceof ConfigurationError ||
        err instanceof DatabaseUnavailableError
      ) {
        throw err;
      }
      this.wrapFirestoreError(err, 'updateOrderAtomic');
    }
  }

  async importOrderAtomic(
    order: OrderItem,
    policy: 'if-newer' = 'if-newer'
  ): Promise<'created' | 'updated' | 'skipped'> {
    const normalizedNumber = String(order.orderNumber || '').trim().toUpperCase();
    if (!normalizedNumber) {
      throw new OrderValidationError('迁移工单缺少合法工单号');
    }
    const sourceTime = new Date(order.updatedAt).getTime();
    if (!Number.isFinite(sourceTime)) {
      throw new OrderValidationError('迁移工单 updatedAt 不是合法时间');
    }

    try {
      return await withTimeout(
        this.db.runTransaction(async (tx) => {
          const ref = this.db.collection(this.ordersCollection).doc(normalizedNumber);
          const snap = await tx.get(ref);
          if (snap.exists) {
            const existing = snap.data() as OrderItem;
            const existingTime = new Date(existing.updatedAt).getTime();
            if (
              policy === 'if-newer' &&
              Number.isFinite(existingTime) &&
              existingTime >= sourceTime
            ) {
              return 'skipped';
            }
          }
          tx.set(
            ref,
            cleanOrderForFirestore({ ...order, orderNumber: normalizedNumber })
          );
          return snap.exists ? 'updated' : 'created';
        }),
        'importOrderAtomic'
      );
    } catch (err: any) {
      if (err instanceof DatabaseUnavailableError || err instanceof OrderValidationError) {
        throw err;
      }
      this.wrapFirestoreError(err, 'importOrderAtomic');
    }
  }

  async checkRateLimitDetailed(
    key: string,
    limit: number,
    windowMs: number,
    scope: RateLimitScope = 'order_create'
  ): Promise<RateLimitDetail> {
    const safeKey = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
    const now = Date.now();

    // Step 1: L1 reject-only pre-check (saves Firestore reads/writes when single instance already saturated)
    const l1 = precheckL1RejectOnly(safeKey, limit, windowMs, now);
    if (l1.rejected) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: l1.retryAfterSeconds,
        source: 'l1-precheck-reject',
      };
    }

    // Step 2: Authoritative Firestore fixed-window transaction with transient conflict retry
    const maxAttempts = 3;
    let lastErr: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await withTimeout(
          this.db.runTransaction(async (tx) => {
          const ref = this.db.collection(this.rateLimitCollection).doc(safeKey);
          const snap = await tx.get(ref);
          const currentNow = Date.now();

          let count = 0;
          let windowStart = currentNow;

          if (snap.exists) {
            const data = snap.data() || {};
            if (
              typeof data.windowStart === 'number' &&
              typeof data.count === 'number' &&
              currentNow - data.windowStart < windowMs
            ) {
              windowStart = data.windowStart;
              count = data.count;
            }
          }

          if (count >= limit) {
            const retryAfterSeconds = Math.max(
              1,
              Math.ceil((windowStart + windowMs - currentNow) / 1000)
            );
            return {
              allowed: false,
              count,
              windowStart,
              remaining: 0,
              retryAfterSeconds,
            };
          }

          const nextCount = count + 1;
          tx.set(ref, {
            count: nextCount,
            windowStart,
            expiresAt: windowStart + windowMs,
            updatedAt: currentNow,
            ttlAt: Timestamp.fromMillis(windowStart + windowMs),
          });

          return {
            allowed: true,
            count: nextCount,
            windowStart,
            remaining: Math.max(0, limit - nextCount),
            retryAfterSeconds: 0,
          };
          }),
          'checkRateLimitDetailed'
        );

        recordL1Observation(safeKey, result.count, result.windowStart);
        return {
          allowed: result.allowed,
          remaining: result.remaining,
          retryAfterSeconds: result.retryAfterSeconds,
          source: 'authoritative-store',
        };
      } catch (err: any) {
        lastErr = err;
        const category =
          err instanceof DatabaseUnavailableError && err.code === 'DATABASE_TIMEOUT'
            ? 'TIMEOUT'
            : classifyFirestoreRateLimitError(err);
        if (category === 'TRANSACTION_CONFLICT' && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 20 * attempt));
          continue;
        }
        break;
      }
    }

    const category =
      lastErr instanceof DatabaseUnavailableError && lastErr.code === 'DATABASE_TIMEOUT'
        ? 'TIMEOUT'
        : classifyFirestoreRateLimitError(lastErr);
    console.error(
      `[RateLimitFailure] scope=${scope} category=${category} msg=${lastErr?.message || lastErr}`
    );
    // P1-B: Never silently degrade to local memory rate limiting when Firestore fails!
    throw new RateLimitServiceUnavailableError(category, scope);
  }

  async checkRateLimit(
    key: string,
    limit: number,
    windowMs: number,
    scope: RateLimitScope = 'order_create'
  ): Promise<boolean> {
    const res = await this.checkRateLimitDetailed(key, limit, windowMs, scope);
    return res.allowed;
  }
}

/**
 * Isolated Transactional Test Repository for automated integration & restart tests.
 * ONLY allowed when NODE_ENV === 'test' or ORDER_DB_DRIVER === 'test_isolated'.
 * Strictly forbidden in production.
 * NOTE (P0-B.8): This file-backed repository verifies application-layer state persistence
 * across Express server restarts and process instances sharing a transactional store;
 * it does NOT replace live Cloud Firestore network/IAM verification.
 */
export class IsolatedTestOrderRepository implements OrderRepository {
  public readonly driverName = 'test-isolated-transactional';
  private readonly storageFilePath: string;
  private simulateFailure = false;
  private simulateRateLimitFailureCategory: RateLimitFailureCategory | null = null;
  private mutex: Promise<void> = Promise.resolve();

  constructor(storageFilePath?: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL: IsolatedTestOrderRepository is strictly forbidden in production.');
    }
    this.storageFilePath =
      storageFilePath ||
      process.env.TEST_ORDER_STORAGE_FILE ||
      path.resolve(process.cwd(), '.data', 'test-isolated-orders.json');
  }

  public setSimulateFailure(fail: boolean) {
    this.simulateFailure = fail;
  }

  public setSimulateRateLimitFailure(category: RateLimitFailureCategory | null) {
    this.simulateRateLimitFailureCategory = category;
  }

  private async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.simulateFailure) {
      throw new DatabaseUnavailableError(
        '订单数据库写入失败（模拟故障注入）：事务已中止，未写入任何数据。',
        'SIMULATED_DB_FAILURE'
      );
    }
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.mutex;
    this.mutex = next;
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private readState(): {
    orders: Record<string, OrderItem>;
    idempotency: Record<string, IdempotencyRecord | string>;
    rateLimits: Record<string, { count: number; windowStart: number } | number[]>;
  } {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          orders: parsed.orders || {},
          idempotency: parsed.idempotency || {},
          rateLimits: parsed.rateLimits || {},
        };
      }
    } catch {
      // start fresh if corrupted
    }
    return { orders: {}, idempotency: {}, rateLimits: {} };
  }

  private writeState(state: {
    orders: Record<string, OrderItem>;
    idempotency: Record<string, IdempotencyRecord | string>;
    rateLimits: Record<string, { count: number; windowStart: number } | number[]>;
  }) {
    const dir = path.dirname(this.storageFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpFile = `${this.storageFilePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpFile, this.storageFilePath);
  }

  async createOrderAtomic(
    buildOrder: (orderNumber: string) => OrderItem,
    idempotencyKey: string,
    idempotencyMeta?: {
      mode: 'explicit_key' | 'content_fingerprint';
      contentDigest: string;
      ttlMs: number;
      bypassExisting?: boolean;
    }
  ): Promise<{
    order: OrderItem;
    duplicate: boolean;
    matchedMode?: 'explicit_key' | 'content_fingerprint';
  }> {
    return this.withLock(() => {
      const state = this.readState();
      const nowMs = Date.now();
      const metaMode = idempotencyMeta?.mode || 'content_fingerprint';
      const ttlMs = idempotencyMeta?.ttlMs || IDEMPOTENCY_EXPLICIT_TTL_MS;

      if (!idempotencyMeta?.bypassExisting) {
        const rawEntry = state.idempotency[idempotencyKey];
        if (rawEntry) {
          const entryObj: IdempotencyRecord =
            typeof rawEntry === 'string'
              ? {
                  orderNumber: rawEntry,
                  mode: 'content_fingerprint',
                  contentDigest: '',
                  createdAt: new Date(nowMs).toISOString(),
                  expiresAt: nowMs + ttlMs,
                }
              : rawEntry;

          if (nowMs <= entryObj.expiresAt && state.orders[entryObj.orderNumber]) {
            return {
              order: state.orders[entryObj.orderNumber],
              duplicate: true,
              matchedMode: entryObj.mode,
            };
          }
        }
      }

      let candidate: OrderItem | null = null;
      for (let i = 0; i < 10; i++) {
        const ordNo = generateOrderNumber();
        if (!state.orders[ordNo]) {
          candidate = buildOrder(ordNo);
          break;
        }
      }
      if (!candidate) {
        throw new DatabaseUnavailableError('工单号分配冲突，请重试');
      }

      state.orders[candidate.orderNumber] = cleanOrderForFirestore(candidate) as OrderItem;
      state.idempotency[idempotencyKey] = {
        orderNumber: candidate.orderNumber,
        mode: metaMode,
        contentDigest: idempotencyMeta?.contentDigest || '',
        createdAt: candidate.createdAt,
        expiresAt: nowMs + ttlMs,
      };
      this.writeState(state);
      return { order: candidate, duplicate: false, matchedMode: metaMode };
    });
  }

  async getOrderByNumber(orderNumber: string): Promise<OrderItem | null> {
    return this.withLock(() => {
      const state = this.readState();
      const norm = String(orderNumber || '').trim().toUpperCase();
      return state.orders[norm] || null;
    });
  }

  async getOrderByIdOrNumber(idOrNumber: string): Promise<OrderItem | null> {
    return this.withLock(() => {
      const state = this.readState();
      const trimmed = String(idOrNumber || '').trim();
      const upper = trimmed.toUpperCase();
      if (state.orders[upper]) return state.orders[upper];
      return Object.values(state.orders).find((o) => o.id === trimmed) || null;
    });
  }

  async listOrders(): Promise<OrderItem[]> {
    return this.withLock(() => {
      const state = this.readState();
      return Object.values(state.orders).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
  }

  async updateOrderAtomic(
    idOrNumber: string,
    updater: (existing: OrderItem) => OrderItem
  ): Promise<OrderItem> {
    return this.withLock(() => {
      const state = this.readState();
      const trimmed = String(idOrNumber || '').trim();
      const upper = trimmed.toUpperCase();
      let existing = state.orders[upper];
      if (!existing) {
        existing = Object.values(state.orders).find((o) => o.id === trimmed)!;
      }
      if (!existing) {
        throw new OrderNotFoundError();
      }
      const updated = updater(existing);
      state.orders[updated.orderNumber] = cleanOrderForFirestore(updated) as OrderItem;
      this.writeState(state);
      return updated;
    });
  }

  async importOrderAtomic(
    order: OrderItem,
    policy: 'if-newer' = 'if-newer'
  ): Promise<'created' | 'updated' | 'skipped'> {
    return this.withLock(() => {
      const state = this.readState();
      const normalizedNumber = String(order.orderNumber || '').trim().toUpperCase();
      if (!normalizedNumber) {
        throw new OrderValidationError('迁移工单缺少合法工单号');
      }
      const sourceTime = new Date(order.updatedAt).getTime();
      if (!Number.isFinite(sourceTime)) {
        throw new OrderValidationError('迁移工单 updatedAt 不是合法时间');
      }

      const existing = state.orders[normalizedNumber];
      if (existing) {
        const existingTime = new Date(existing.updatedAt).getTime();
        if (
          policy === 'if-newer' &&
          Number.isFinite(existingTime) &&
          existingTime >= sourceTime
        ) {
          return 'skipped';
        }
      }

      state.orders[normalizedNumber] = cleanOrderForFirestore({
        ...order,
        orderNumber: normalizedNumber,
      }) as OrderItem;
      this.writeState(state);
      return existing ? 'updated' : 'created';
    });
  }

  async checkRateLimitDetailed(
    key: string,
    limit: number,
    windowMs: number,
    scope: RateLimitScope = 'order_create'
  ): Promise<RateLimitDetail> {
    if (this.simulateRateLimitFailureCategory) {
      throw new RateLimitServiceUnavailableError(
        this.simulateRateLimitFailureCategory,
        scope
      );
    }

    const safeKey = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
    const now = Date.now();

    const l1 = precheckL1RejectOnly(safeKey, limit, windowMs, now);
    if (l1.rejected) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: l1.retryAfterSeconds,
        source: 'l1-precheck-reject',
      };
    }

    return this.withLock(() => {
      const state = this.readState();
      const currentNow = Date.now();
      const existing = state.rateLimits[safeKey];

      let count = 0;
      let windowStart = currentNow;

      if (
        existing &&
        !Array.isArray(existing) &&
        typeof existing.windowStart === 'number' &&
        typeof existing.count === 'number' &&
        currentNow - existing.windowStart < windowMs
      ) {
        windowStart = existing.windowStart;
        count = existing.count;
      }

      if (count >= limit) {
        recordL1Observation(safeKey, count, windowStart);
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((windowStart + windowMs - currentNow) / 1000)
        );
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds,
          source: 'authoritative-store' as const,
        };
      }

      const nextCount = count + 1;
      state.rateLimits[safeKey] = { count: nextCount, windowStart };
      this.writeState(state);
      recordL1Observation(safeKey, nextCount, windowStart);

      return {
        allowed: true,
        remaining: Math.max(0, limit - nextCount),
        retryAfterSeconds: 0,
        source: 'authoritative-store' as const,
      };
    });
  }

  async checkRateLimit(
    key: string,
    limit: number,
    windowMs: number,
    scope: RateLimitScope = 'order_create'
  ): Promise<boolean> {
    const res = await this.checkRateLimitDetailed(key, limit, windowMs, scope);
    return res.allowed;
  }
}

export type OrderSubmissionStatus = 'CREATED' | 'IDEMPOTENT_REPLAY';

/**
 * Controlled Order Service Layer wrapping the single authoritative OrderRepository
 */
export class OrderService {
  private readonly repo: OrderRepository;

  constructor(repo: OrderRepository) {
    this.repo = repo;
  }

  public getRepositoryDriverName(): string {
    return this.repo.driverName;
  }

  public getRepository(): OrderRepository {
    return this.repo;
  }

  /**
   * Public Order Creation with validation, idempotency, token generation & hashing, and atomic persistence (P1-A)
   */
  async createCustomerOrder(
    rawPayload: unknown,
    clientIp: string,
    explicitIdempotencyKey?: string
  ): Promise<{
    orderNumber: string;
    queryToken: string;
    duplicate: boolean;
    submissionStatus: OrderSubmissionStatus;
    order: PublicOrderView;
  }> {
    const pepper = getRequiredQueryTokenPepper();

    const validation = validateOrderInput(rawPayload);
    if (!validation.valid) {
      throw new OrderValidationError('表单校验未通过，请检查所填内容。', validation.errors);
    }

    const payload = rawPayload as OrderInputPayload;
    const hasExplicitKey = isValidExplicitIdempotencyKey(explicitIdempotencyKey);
    const contentDigest = computeOrderContentDigest(payload);
    const idempotencyKey = computeSubmissionIdempotencyKey(
      clientIp,
      payload,
      explicitIdempotencyKey
    );

    let generatedToken = '';
    const now = new Date().toISOString();

    const { order, duplicate, matchedMode } = await this.repo.createOrderAtomic(
      (orderNumber: string) => {
        generatedToken = hasExplicitKey
          ? deriveSessionQueryToken(
              orderNumber,
              explicitIdempotencyKey!,
              payload.contactValue,
              pepper
            )
          : generateQueryToken();

        const tokenHash = hashQueryToken(orderNumber, generatedToken, pepper);
        return {
          id: generateOrderId(),
          orderNumber,
          serviceType: payload.serviceType as any,
          title: payload.title.trim(),
          description: payload.description.trim(),
          studyArea: payload.studyArea?.trim() || '未指定特定区域',
          dataFormats: payload.dataFormats?.trim() || '待沟通确定',
          budgetRange: payload.budgetRange || '待评估',
          expectedDeliveryDate: payload.expectedDeliveryDate || '',
          contactMethod: payload.contactMethod,
          contactValue: payload.contactValue.trim(),
          status: 'pending_review',
          adminNotes: '',
          clientNotes: '需求已成功登记，工作室工程师正在查阅技术细节与数据要求。',
          queryTokenHash: tokenHash,
          queryTokenUpdatedAt: now,
          privacyConsentAt: now,
          privacyConsentVersion: PRIVACY_POLICY_VERSION,
          isDemo: false,
          createdAt: now,
          updatedAt: now,
        };
      },
      idempotencyKey,
      {
        mode: hasExplicitKey ? 'explicit_key' : 'content_fingerprint',
        contentDigest,
        ttlMs: hasExplicitKey ? IDEMPOTENCY_EXPLICIT_TTL_MS : IDEMPOTENCY_CONTENT_WINDOW_MS,
        bypassExisting: payload.forceNewOrder === true,
      }
    );

    if (!duplicate) {
      await notifyNewOrder(order);
      return {
        orderNumber: order.orderNumber,
        queryToken: generatedToken,
        duplicate: false,
        submissionStatus: 'CREATED',
        order: toPublicOrderView(order),
      };
    }

    // Duplicate detected! Check if we can safely & cryptographically recover the session token (P1-A)
    if (hasExplicitKey && matchedMode === 'explicit_key') {
      const recoveredToken = deriveSessionQueryToken(
        order.orderNumber,
        explicitIdempotencyKey!,
        payload.contactValue,
        pepper
      );
      const tokenMatches = verifyQueryToken(
        order.orderNumber,
        recoveredToken,
        order.queryTokenHash,
        pepper
      );

      if (tokenMatches) {
        return {
          orderNumber: order.orderNumber,
          queryToken: recoveredToken,
          duplicate: true,
          submissionStatus: 'IDEMPOTENT_REPLAY',
          order: toPublicOrderView(order),
        };
      }
    }

    // Cannot safely recover plaintext queryToken (e.g. tab closed & reopened without session key, or token already rotated by admin)
    // P1-A.6: Never return HTTP 201 or a fake queryToken string! Throw explicit 409 Conflict with recovery instructions.
    throw new DuplicateOrderConflictError(order);
  }

  /**
   * Public Customer Order Lookup verified strictly by high-entropy queryToken hash
   */
  async lookupCustomerOrder(
    orderNumberInput: unknown,
    queryTokenInput: unknown
  ): Promise<PublicOrderView> {
    const pepper = getRequiredQueryTokenPepper();

    if (
      typeof orderNumberInput !== 'string' ||
      typeof queryTokenInput !== 'string' ||
      !orderNumberInput.trim() ||
      !queryTokenInput.trim()
    ) {
      throw new OrderValidationError(
        '请同时输入工单编号与专属查询凭证（格式如 QK-XXXX-XXXX-XXXX）。'
      );
    }

    const normalizedOrderNo = orderNumberInput.trim().toUpperCase();
    const candidateToken = normalizeQueryToken(queryTokenInput);

    if (!/^GEO-\d{8}-[A-Z0-9]{4,8}$/.test(normalizedOrderNo) || candidateToken.length < 8) {
      throw new OrderNotFoundError('工单编号或查询凭证无效，请核对后重试。');
    }

    const matched = await this.repo.getOrderByNumber(normalizedOrderNo);

    if (!matched || !matched.queryTokenHash) {
      verifyQueryToken(normalizedOrderNo, candidateToken, '0'.repeat(64), pepper);
      throw new OrderNotFoundError('工单编号或查询凭证无效，请核对后重试。');
    }

    const isValid = verifyQueryToken(
      matched.orderNumber,
      candidateToken,
      matched.queryTokenHash,
      pepper
    );
    if (!isValid) {
      throw new OrderNotFoundError('工单编号或查询凭证无效，请核对后重试。');
    }

    return toPublicOrderView(matched);
  }

  async listOrdersForAdmin(): Promise<OrderItem[]> {
    return this.repo.listOrders();
  }

  async updateOrderByAdmin(
    idOrNumber: string,
    input: AdminOrderUpdateInput
  ): Promise<OrderItem> {
    return this.repo.updateOrderAtomic(idOrNumber, (existing) => {
      const targetStatus = input.status !== undefined ? input.status : existing.status;
      const check = validateAdminOrderUpdate(
        {
          status: targetStatus,
          manualQuote: input.manualQuote,
          adminNotes: input.adminNotes,
          clientNotes: input.clientNotes,
        },
        existing.manualQuote,
        existing.status
      );

      if (!check.valid) {
        throw new OrderValidationError(check.error || '工单更新校验未通过');
      }

      return {
        ...existing,
        status: targetStatus as any,
        manualQuote: check.parsedQuote,
        adminNotes:
          input.adminNotes !== undefined
            ? String(input.adminNotes).slice(0, 2000)
            : existing.adminNotes,
        clientNotes:
          input.clientNotes !== undefined
            ? String(input.clientNotes).slice(0, 1000)
            : existing.clientNotes,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  async anonymizeOrderByAdmin(idOrNumber: string): Promise<OrderItem> {
    return this.repo.updateOrderAtomic(idOrNumber, (existing) => {
      const now = new Date().toISOString();
      return {
        ...existing,
        title: '已匿名化工单',
        description: '客户已请求删除或匿名化本条工单正文。',
        studyArea: '',
        dataFormats: '',
        budgetRange: '',
        expectedDeliveryDate: '',
        contactValue: '***',
        adminNotes: '',
        clientNotes: '该工单已按客户要求匿名化。',
        queryTokenHash: undefined,
        queryTokenUpdatedAt: now,
        updatedAt: now,
      };
    });
  }

  async rotateOrderQueryTokenByAdmin(
    idOrNumber: string
  ): Promise<{ orderNumber: string; newQueryToken: string; updatedAt: string }> {
    const pepper = getRequiredQueryTokenPepper();
    let newQueryToken = '';
    const updated = await this.repo.updateOrderAtomic(idOrNumber, (existing) => {
      newQueryToken = generateQueryToken();
      const now = new Date().toISOString();
      return {
        ...existing,
        queryTokenHash: hashQueryToken(existing.orderNumber, newQueryToken, pepper),
        queryTokenUpdatedAt: now,
        updatedAt: now,
      };
    });

    return {
      orderNumber: updated.orderNumber,
      newQueryToken,
      updatedAt: updated.updatedAt,
    };
  }
}

export function createDefaultOrderService(customRepo?: OrderRepository): OrderService {
  if (customRepo) {
    return new OrderService(customRepo);
  }
  if (
    process.env.NODE_ENV !== 'production' &&
    (process.env.NODE_ENV === 'test' || process.env.ORDER_DB_DRIVER === 'test_isolated')
  ) {
    return new OrderService(new IsolatedTestOrderRepository());
  }
  return new OrderService(new FirestoreAdminOrderRepository());
}
