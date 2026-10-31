import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { App, cert, applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  OrderItem,
  OrderInputPayload,
  AdminOrderUpdateInput,
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

export class DatabaseUnavailableError extends Error {
  public readonly statusCode = 503;
  public readonly code: string;
  constructor(message: string, code = 'DATABASE_UNAVAILABLE') {
    super(message);
    this.name = 'DatabaseUnavailableError';
    this.code = code;
  }
}

export class ConfigurationError extends Error {
  public readonly statusCode = 503;
  public readonly code: string;
  constructor(message: string, code = 'CONFIGURATION_ERROR') {
    super(message);
    this.name = 'ConfigurationError';
    this.code = code;
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

const FORBIDDEN_PEPPER_PLACEHOLDERS = new Set([
  'my_query_token_pepper',
  'replace-with-32-byte-random-secret-in-production',
  'geospatial-studio-v2-token-pepper',
  'your-secret-pepper',
  'changeme',
  'default',
]);

/**
 * Reads and validates QUERY_TOKEN_PEPPER strictly from server-side environment/Secrets.
 * Never falls back to a hardcoded default pepper (Requirement 5).
 */
export function getRequiredQueryTokenPepper(overridePepper?: string): string {
  const raw = (
    overridePepper !== undefined ? overridePepper : process.env.QUERY_TOKEN_PEPPER || ''
  ).trim();

  if (!raw) {
    throw new ConfigurationError(
      '服务端缺少必需的安全密钥配置 QUERY_TOKEN_PEPPER。请在 AI Studio Secrets 或环境变量中配置至少 16 字符（推荐 32 字节 hex）的随机密钥，严禁使用硬编码默认值。',
      'CONFIG_MISSING_QUERY_TOKEN_PEPPER'
    );
  }

  if (FORBIDDEN_PEPPER_PLACEHOLDERS.has(raw.toLowerCase()) || raw.length < 16) {
    throw new ConfigurationError(
      '服务端 QUERY_TOKEN_PEPPER 配置不安全（长度不足 16 字符或使用了示例占位符）。请使用安全随机值（如 openssl rand -hex 32）。',
      'CONFIG_WEAK_QUERY_TOKEN_PEPPER'
    );
  }

  return raw;
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
  // Always validate that QUERY_TOKEN_PEPPER is configured before attempting verification
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

/**
 * Compute a deterministic idempotency key for a submission within a time bucket (60s)
 */
export function computeSubmissionIdempotencyKey(
  ip: string,
  payload: OrderInputPayload,
  explicitKey?: string
): string {
  if (explicitKey && typeof explicitKey === 'string' && explicitKey.trim().length >= 8) {
    return crypto
      .createHash('sha256')
      .update(`explicit:${ip}:${explicitKey.trim().slice(0, 128)}`)
      .digest('hex')
      .slice(0, 40);
  }
  const timeBucket = Math.floor(Date.now() / 60000); // 60-second deduplication window
  const raw = [
    ip,
    timeBucket,
    payload.serviceType,
    payload.title?.trim(),
    payload.description?.trim(),
    payload.contactMethod,
    payload.contactValue?.trim().toLowerCase(),
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

export interface OrderRepository {
  readonly driverName: string;
  createOrderAtomic(
    buildOrder: (orderNumber: string) => OrderItem,
    idempotencyKey: string
  ): Promise<{ order: OrderItem; duplicate: boolean }>;
  getOrderByNumber(orderNumber: string): Promise<OrderItem | null>;
  getOrderByIdOrNumber(idOrNumber: string): Promise<OrderItem | null>;
  listOrders(): Promise<OrderItem[]>;
  updateOrderAtomic(
    idOrNumber: string,
    updater: (existing: OrderItem) => OrderItem
  ): Promise<OrderItem>;
  checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean>;
}

let sharedAdminApp: App | null = null;
let activeCredentialSource: 'adc' | 'service_account_env' = 'adc';

/**
 * Initializes Firebase Admin SDK prioritizing Google Cloud Application Default Credentials (ADC).
 * - On Cloud Run (in project gen-lang-client-0041017161), ADC works natively via the metadata server
 *   without exporting or uploading any private key JSON.
 * - Minimal IAM roles required for the Cloud Run service account:
 *   1. roles/datastore.user (Cloud Firestore read/write/transaction access)
 *   2. roles/firebaseauth.viewer (Firebase Auth token & metadata verification)
 */
export function getFirebaseAdminApp(): App {
  if (sharedAdminApp) return sharedAdminApp;
  const existing = getApps().find((a) => a.name === 'geospatial-admin');
  if (existing) {
    sharedAdminApp = existing;
    return existing;
  }

  // Priority 1 (Standard & Recommended): Google Cloud Application Default Credentials (ADC)
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!saJson) {
    activeCredentialSource = 'adc';
    sharedAdminApp = initializeApp(
      {
        credential: applicationDefault(),
        projectId: firebaseConfig.projectId,
      },
      'geospatial-admin'
    );
    return sharedAdminApp;
  }

  // Priority 2 (Optional fallback only if explicitly provided in external non-GCP environments)
  try {
    const parsed = JSON.parse(saJson);
    if (parsed.project_id && parsed.project_id !== firebaseConfig.projectId) {
      throw new ConfigurationError(
        `FIREBASE_SERVICE_ACCOUNT_JSON 中的 project_id (${parsed.project_id}) 与应用配置的 projectId (${firebaseConfig.projectId}) 不一致。`,
        'CONFIG_PROJECT_ID_MISMATCH'
      );
    }
    activeCredentialSource = 'service_account_env';
    sharedAdminApp = initializeApp(
      {
        credential: cert(parsed),
        projectId: firebaseConfig.projectId,
      },
      'geospatial-admin'
    );
    return sharedAdminApp;
  } catch (err: any) {
    if (err instanceof ConfigurationError) throw err;
    throw new ConfigurationError(
      '提供的 FIREBASE_SERVICE_ACCOUNT_JSON 格式无效。推荐清空此变量以直接使用 Google Cloud 默认凭证 (ADC)。',
      'CONFIG_INVALID_SERVICE_ACCOUNT_JSON'
    );
  }
}

export interface FirebaseConsistencyReport {
  consistent: boolean;
  clientProjectId: string;
  adminProjectId: string;
  authDomainProjectId: string;
  firestoreDatabaseId: string;
  credentialSource: 'adc' | 'service_account_env';
  runtimeEnvironment: 'cloud_run' | 'ai_studio_preview_sandbox' | 'local_or_custom';
  adcServiceAccountEmail: string | null;
  crossProjectAdcWarning: string | null;
}

/**
 * Verifies consistency across Firebase Admin SDK, Client Config, Auth Project ID, and Firestore Database ID (Requirement 8).
 */
export function verifyFirebaseConfigConsistency(): FirebaseConsistencyReport {
  const app = getFirebaseAdminApp();
  const clientProjectId = firebaseConfig.projectId;
  const adminProjectId = app.options.projectId || '';
  const authDomainProjectId = (firebaseConfig.authDomain || '').split('.')[0] || '';
  const firestoreDatabaseId = firebaseConfig.firestoreDatabaseId;

  const isCloudRun = Boolean(process.env.K_SERVICE);
  const adcEmail = process.env.AUTHORIZED_SERVICE_ACCOUNT_EMAIL || null;
  const isAiStudioSandbox =
    Boolean(adcEmail && adcEmail.includes('ais-sandbox@')) ||
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.includes('ais-shim'));

  const runtimeEnvironment = isCloudRun
    ? 'cloud_run'
    : isAiStudioSandbox
    ? 'ai_studio_preview_sandbox'
    : 'local_or_custom';

  const consistent =
    Boolean(clientProjectId) &&
    clientProjectId === adminProjectId &&
    clientProjectId === authDomainProjectId &&
    Boolean(firestoreDatabaseId) &&
    firestoreDatabaseId.startsWith('ai-studio-');

  let crossProjectAdcWarning: string | null = null;
  if (
    activeCredentialSource === 'adc' &&
    adcEmail &&
    !adcEmail.endsWith(`@${clientProjectId}.iam.gserviceaccount.com`) &&
    !adcEmail.includes(clientProjectId)
  ) {
    crossProjectAdcWarning = `当前运行容器的 ADC 默认服务账号 (${adcEmail}) 属于宿主沙箱项目，而非目标 Firebase 项目 (${clientProjectId})。Firebase Auth ID Token 公钥验签可正常工作，但直接读写 Firestore 需将应用部署至目标项目 (${clientProjectId}) 的 Cloud Run，或在 IAM 中为该账号授予 roles/datastore.user。`;
  }

  return {
    consistent,
    clientProjectId,
    adminProjectId,
    authDomainProjectId,
    firestoreDatabaseId,
    credentialSource: activeCredentialSource,
    runtimeEnvironment,
    adcServiceAccountEmail: adcEmail,
    crossProjectAdcWarning,
  };
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
    const app = getFirebaseAdminApp();
    this.db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    this.ordersCollection = collectionPrefix ? `${collectionPrefix}_orders` : 'orders';
    this.idempotencyCollection = collectionPrefix
      ? `${collectionPrefix}_idempotencyKeys`
      : 'idempotencyKeys';
    this.rateLimitCollection = collectionPrefix ? `${collectionPrefix}_rateLimits` : 'rateLimits';
  }

  private wrapFirestoreError(err: any, operation: string): never {
    const code = err?.code;
    const msg = err?.message || String(err);
    console.error(`[FirestoreAdminOrderRepository] ${operation} failed (code=${code}): ${msg}`);
    if (code === 7 || msg.includes('PERMISSION_DENIED')) {
      const adcEmail = process.env.AUTHORIZED_SERVICE_ACCOUNT_EMAIL || '当前容器默认服务账号';
      throw new DatabaseUnavailableError(
        `Firestore 权威数据库访问被拒绝 (PERMISSION_DENIED)：当前环境使用 Google Cloud 默认凭证 (ADC: ${adcEmail}) 访问项目 ${firebaseConfig.projectId} 的数据库 ${firebaseConfig.firestoreDatabaseId} 时缺少 IAM 权限。在 Cloud Run 部署时请确保运行服务账号具备最小权限 roles/datastore.user；在 AI Studio 预览沙箱中因跨项目隔离限制，系统已安全拒绝写入以防数据静默丢失。`,
        'FIRESTORE_IAM_PERMISSION_DENIED'
      );
    }
    throw new DatabaseUnavailableError(
      '订单数据库暂时不可用，请稍后重试。系统未保存任何半成品数据。',
      'FIRESTORE_OPERATION_FAILED'
    );
  }

  async createOrderAtomic(
    buildOrder: (orderNumber: string) => OrderItem,
    idempotencyKey: string
  ): Promise<{ order: OrderItem; duplicate: boolean }> {
    try {
      return await this.db.runTransaction(async (tx) => {
        const idemRef = this.db.collection(this.idempotencyCollection).doc(idempotencyKey);
        const idemSnap = await tx.get(idemRef);
        if (idemSnap.exists) {
          const prevOrderNumber = idemSnap.data()?.orderNumber as string | undefined;
          if (prevOrderNumber) {
            const prevOrderSnap = await tx.get(
              this.db.collection(this.ordersCollection).doc(prevOrderNumber)
            );
            if (prevOrderSnap.exists) {
              return { order: prevOrderSnap.data() as OrderItem, duplicate: true };
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
          createdAt: candidateOrder.createdAt,
          expiresAt: Date.now() + 10 * 60 * 1000,
        });

        return { order: candidateOrder, duplicate: false };
      });
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
      const snap = await this.db.collection(this.ordersCollection).doc(normalized).get();
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
      const directSnap = await this.db
        .collection(this.ordersCollection)
        .doc(trimmed.toUpperCase())
        .get();
      if (directSnap.exists) {
        return directSnap.data() as OrderItem;
      }
      const qSnap = await this.db
        .collection(this.ordersCollection)
        .where('id', '==', trimmed)
        .limit(1)
        .get();
      if (qSnap.empty) return null;
      return qSnap.docs[0].data() as OrderItem;
    } catch (err: any) {
      this.wrapFirestoreError(err, 'getOrderByIdOrNumber');
    }
  }

  async listOrders(): Promise<OrderItem[]> {
    try {
      const snap = await this.db
        .collection(this.ordersCollection)
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get();
      return snap.docs.map((d) => d.data() as OrderItem);
    } catch (err: any) {
      this.wrapFirestoreError(err, 'listOrders');
    }
  }

  async updateOrderAtomic(
    idOrNumber: string,
    updater: (existing: OrderItem) => OrderItem
  ): Promise<OrderItem> {
    try {
      return await this.db.runTransaction(async (tx) => {
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
      });
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

  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const safeKey = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
    const now = Date.now();
    try {
      return await this.db.runTransaction(async (tx) => {
        const ref = this.db.collection(this.rateLimitCollection).doc(safeKey);
        const snap = await tx.get(ref);
        const rawTimestamps: number[] =
          snap.exists && Array.isArray(snap.data()?.timestamps) ? snap.data()!.timestamps : [];
        const valid = rawTimestamps.filter((t) => typeof t === 'number' && now - t < windowMs);
        if (valid.length >= limit) {
          return false;
        }
        valid.push(now);
        tx.set(ref, { timestamps: valid, updatedAt: now });
        return true;
      });
    } catch {
      return checkLocalFallbackRateLimit(safeKey, limit, windowMs);
    }
  }
}

const localRateLimitMap = new Map<string, number[]>();

function checkLocalFallbackRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = localRateLimitMap.get(key) || [];
  const valid = timestamps.filter((t) => now - t < windowMs);
  if (valid.length >= limit) {
    return false;
  }
  valid.push(now);
  localRateLimitMap.set(key, valid);
  return true;
}

/**
 * Isolated Transactional Test Repository for automated integration & restart tests
 * ONLY allowed when NODE_ENV === 'test' or ORDER_DB_DRIVER === 'test_isolated'.
 * Strictly forbidden in production.
 */
export class IsolatedTestOrderRepository implements OrderRepository {
  public readonly driverName = 'test-isolated-transactional';
  private readonly storageFilePath: string;
  private simulateFailure = false;
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
    idempotency: Record<string, string>;
    rateLimits: Record<string, number[]>;
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
    idempotency: Record<string, string>;
    rateLimits: Record<string, number[]>;
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
    idempotencyKey: string
  ): Promise<{ order: OrderItem; duplicate: boolean }> {
    return this.withLock(() => {
      const state = this.readState();
      const existingOrderNo = state.idempotency[idempotencyKey];
      if (existingOrderNo && state.orders[existingOrderNo]) {
        return { order: state.orders[existingOrderNo], duplicate: true };
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
      state.idempotency[idempotencyKey] = candidate.orderNumber;
      this.writeState(state);
      return { order: candidate, duplicate: false };
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

  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    return this.withLock(() => {
      const state = this.readState();
      const now = Date.now();
      const list = (state.rateLimits[key] || []).filter((t) => now - t < windowMs);
      if (list.length >= limit) {
        return false;
      }
      list.push(now);
      state.rateLimits[key] = list;
      this.writeState(state);
      return true;
    });
  }
}

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
   * Public Order Creation with validation, idempotency, token generation & hashing, and atomic persistence
   */
  async createCustomerOrder(
    rawPayload: unknown,
    clientIp: string,
    explicitIdempotencyKey?: string
  ): Promise<{
    orderNumber: string;
    queryToken: string;
    duplicate: boolean;
    order: PublicOrderView;
  }> {
    // Validate QUERY_TOKEN_PEPPER is present before creating order
    const pepper = getRequiredQueryTokenPepper();

    const validation = validateOrderInput(rawPayload);
    if (!validation.valid) {
      throw new OrderValidationError('表单校验未通过，请检查所填内容。', validation.errors);
    }

    const payload = rawPayload as OrderInputPayload;
    const idempotencyKey = computeSubmissionIdempotencyKey(
      clientIp,
      payload,
      explicitIdempotencyKey
    );

    let generatedToken = '';
    const now = new Date().toISOString();

    const { order, duplicate } = await this.repo.createOrderAtomic((orderNumber: string) => {
      generatedToken = generateQueryToken();
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
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      };
    }, idempotencyKey);

    return {
      orderNumber: order.orderNumber,
      queryToken: duplicate
        ? '（重复提交请求已拦截，请使用首次返回的查询凭证）'
        : generatedToken,
      duplicate,
      order: toPublicOrderView(order),
    };
  }

  /**
   * Public Customer Order Lookup verified strictly by high-entropy queryToken hash
   */
  async lookupCustomerOrder(
    orderNumberInput: unknown,
    queryTokenInput: unknown
  ): Promise<PublicOrderView> {
    // Validate QUERY_TOKEN_PEPPER is present before lookup
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
