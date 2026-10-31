import crypto from 'node:crypto';
import type { Request, Response, NextFunction, Router } from 'express';
import express from 'express';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import {
  exportOrdersToCSV,
  generateOrderId,
  generateQueryToken,
  generateClientIdempotencyKey,
} from '../utils/order-utils.ts';
import {
  getFirebaseServerConfig,
  getFirebaseAdminApp,
  verifyFirebaseConfigConsistency,
  getRequiredQueryTokenPepper,
  FORBIDDEN_DEMO_UIDS,
  getServerAdminUidWhitelist,
  diagnoseAdminUidWhitelist,
  resolveTrustedProxyHops,
} from '../config/firebase-server.ts';
import {
  OrderService,
  OrderRepository,
  createDefaultOrderService,
  DatabaseUnavailableError,
  ConfigurationError,
  RateLimitServiceUnavailableError,
  DuplicateOrderConflictError,
  OrderValidationError,
  OrderNotFoundError,
  hashQueryToken,
} from './order-service.ts';

export {
  getServerAdminUidWhitelist,
  diagnoseAdminUidWhitelist,
  resolveTrustedProxyHops,
};

export interface VerifiedAdminIdentity {
  uid: string;
  email: string;
  role: 'superadmin';
  authSource: 'uid_whitelist' | 'custom_claim';
}

export type TokenVerifierFn = (idToken: string) => Promise<DecodedIdToken>;

export interface ApiRouterOptions {
  orderService?: OrderService;
  orderRepository?: OrderRepository;
  tokenVerifier?: TokenVerifierFn;
  adminUidWhitelist?: string[];
  trustProxy?: boolean | number;
  orderRateLimitMax?: number;
  lookupRateLimitMax?: number;
}

const MAX_BODY_BYTES = 32 * 1024; // 32 KB strict request body limit

function generateRequestId(): string {
  return `req-${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Safely extracts client IP according to trusted reverse proxy hop count.
 * - When trustedHops === 0: completely ignores X-Forwarded-For and uses socket remoteAddress.
 * - When trustedHops >= 1: selects the IP appended by the trusted proxy from the RIGHT side
 *   of X-Forwarded-For (`parts[parts.length - trustedHops]`), preventing client spoofing of leftmost IPs.
 */
export function getClientIp(req: Request, trustProxyOption?: boolean | number): string {
  const trustedHops = resolveTrustedProxyHops(trustProxyOption);

  if (trustedHops > 0) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim().length > 0) {
      const parts = xff
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        const index = Math.max(0, parts.length - trustedHops);
        return parts[index].slice(0, 64);
      }
    }
  }
  return (req.socket?.remoteAddress || '127.0.0.1').slice(0, 64);
}

/**
 * Returns runtime configuration diagnostics for authenticated administrators ONLY (P1-C).
 * Sanitizes service account emails and never exposes raw secret values or raw whitelist UIDs.
 */
export function getRuntimeConfigDiagnostics(options?: ApiRouterOptions) {
  const rawConsistency = verifyFirebaseConfigConsistency();
  const adminDiagnostics = diagnoseAdminUidWhitelist(options?.adminUidWhitelist);
  const trustedProxyHops = resolveTrustedProxyHops(options?.trustProxy);

  let pepperConfigured = false;
  let pepperDiagnostic = 'OK';
  try {
    getRequiredQueryTokenPepper();
    pepperConfigured = true;
  } catch (err: any) {
    pepperConfigured = false;
    pepperDiagnostic = err?.message || 'QUERY_TOKEN_PEPPER 未配置';
  }

  return {
    firebaseConsistency: {
      consistent: rawConsistency.consistent,
      clientProjectId: rawConsistency.clientProjectId,
      adminProjectId: rawConsistency.adminProjectId,
      authDomainProjectId: rawConsistency.authDomainProjectId,
      firestoreDatabaseId: rawConsistency.firestoreDatabaseId,
      configSource: rawConsistency.configSource,
      credentialSource: rawConsistency.credentialSource,
      runtimeEnvironment: rawConsistency.runtimeEnvironment,
      hasCrossProjectAdcWarning: Boolean(rawConsistency.crossProjectAdcWarning),
    },
    queryTokenPepper: {
      configured: pepperConfigured,
      diagnostic: pepperDiagnostic,
    },
    adminAuth: {
      mode: 'firebase-admin-verifyIdToken-only',
      configuredUidCount: adminDiagnostics.configuredCount,
      warnings: adminDiagnostics.warnings,
    },
    proxyConfig: {
      trustedProxyHops,
      trustProxyConfigured: Boolean(process.env.TRUST_PROXY),
      isCloudRun: Boolean(process.env.K_SERVICE),
    },
  };
}

// Universal response helper that works in both Express and Vite Connect middleware
function sendJson(res: any, status: number, data: any, extraHeaders: Record<string, string> = {}) {
  Object.entries(extraHeaders).forEach(([k, v]) => {
    if (typeof res.setHeader === 'function') {
      res.setHeader(k, v);
    }
  });
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status).json(data);
  } else {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
  }
}

function sendText(res: any, status: number, text: string, headers: Record<string, string> = {}) {
  res.statusCode = status;
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  if (typeof res.send === 'function') {
    res.send(text);
  } else {
    res.end(text);
  }
}

class PayloadTooLargeError extends Error {
  public readonly statusCode = 413;
  constructor(message = '请求体超过最大允许长度 (32KB)') {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

class InvalidJsonPayloadError extends Error {
  public readonly statusCode = 400;
  constructor(message = '请求体 JSON 格式非法') {
    super(message);
    this.name = 'InvalidJsonPayloadError';
  }
}

// Body parsing helper with strict 32KB size limit for both Express and Connect middleware
async function parseBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    const serializedLen = Buffer.byteLength(JSON.stringify(req.body), 'utf8');
    if (serializedLen > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    return req.body;
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytesRead = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer | string) => {
      if (aborted) return;
      const chunkLen = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, 'utf8');
      bytesRead += chunkLen;
      if (bytesRead > MAX_BODY_BYTES) {
        aborted = true;
        reject(new PayloadTooLargeError());
        return;
      }
      raw += chunk.toString();
    });

    req.on('end', () => {
      if (aborted) return;
      if (!raw || !raw.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new InvalidJsonPayloadError('请求体必须为 JSON 对象'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new InvalidJsonPayloadError());
      }
    });

    req.on('error', (err: any) => {
      if (!aborted) reject(err);
    });
  });
}

/**
 * Extracts Bearer token strictly from Authorization header.
 * Ignores x-admin-uid, x-admin-email, query parameters, and request body fields.
 * Never logs the raw token string (P1-C).
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }
  const match = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/i.exec(authHeader.trim());
  if (!match || !match[1]) {
    return null;
  }
  return match[1];
}

export function createApiRouter(options?: ApiRouterOptions): Router {
  const router = express.Router();
  const orderService =
    options?.orderService || createDefaultOrderService(options?.orderRepository);

  const defaultTokenVerifier: TokenVerifierFn = async (idToken: string) => {
    const adminApp = getFirebaseAdminApp();
    return getAuth(adminApp).verifyIdToken(idToken, false);
  };

  const verifyIdTokenFn = options?.tokenVerifier || defaultTokenVerifier;

  // Attach a correlation requestId to every request for safe internal log tracing (P1-C)
  router.use((req: Request, res: Response, next: NextFunction) => {
    const reqId = generateRequestId();
    (req as any).requestId = reqId;
    if (typeof res.setHeader === 'function') {
      res.setHeader('X-Request-Id', reqId);
    }
    next();
  });

  // Express JSON middleware with 32KB limit
  router.use(
    express.json({
      limit: '32kb',
      strict: true,
    })
  );

  // Handle Express body-parser errors (413 Payload Too Large / 400 Bad JSON)
  router.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId || generateRequestId();
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      sendJson(res, 413, {
        success: false,
        code: 'PAYLOAD_TOO_LARGE',
        requestId,
        message: '请求体超过最大允许长度 (32KB)。',
      });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      sendJson(res, 400, {
        success: false,
        code: 'INVALID_JSON',
        requestId,
        message: '请求体 JSON 格式非法。',
      });
      return;
    }
    next(err);
  });

  /**
   * Unified Admin Authentication & Authorization Middleware (P0-A)
   * Never falls back to insecure header/email checks even when ADMIN_UIDS is unconfigured.
   */
  const requireAdminAuth = async (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId || generateRequestId();
    const token = extractBearerToken(req);
    if (!token) {
      sendJson(res, 401, {
        success: false,
        isAdmin: false,
        code: 'UNAUTHENTICATED',
        requestId,
        message:
          '未提供有效的身份认证凭证 (Authorization: Bearer <ID_TOKEN>)，请先使用 Google 账号登录。',
      });
      return;
    }

    let decoded: DecodedIdToken;
    try {
      decoded = await verifyIdTokenFn(token);
    } catch {
      sendJson(res, 401, {
        success: false,
        isAdmin: false,
        code: 'INVALID_TOKEN',
        requestId,
        message: 'Firebase ID Token 验证失败、已过期或签名不合法，请重新登录。',
      });
      return;
    }

    const uid = decoded?.uid;
    if (!uid || typeof uid !== 'string' || FORBIDDEN_DEMO_UIDS.has(uid.toLowerCase())) {
      sendJson(res, 401, {
        success: false,
        isAdmin: false,
        code: 'INVALID_UID',
        requestId,
        message: 'Token 中缺少有效用户 UID。',
      });
      return;
    }

    const hasCustomClaim = decoded.admin === true || decoded.role === 'superadmin';
    const whitelist = getServerAdminUidWhitelist(options?.adminUidWhitelist);
    const isWhitelistedUid = whitelist.has(uid);

    if (!hasCustomClaim && !isWhitelistedUid) {
      const adminDiag = diagnoseAdminUidWhitelist(options?.adminUidWhitelist);
      const extraHint =
        adminDiag.warnings.length > 0 ? ` 诊断提示：${adminDiag.warnings[0]}` : '';
      sendJson(res, 403, {
        success: false,
        isAdmin: false,
        code: 'FORBIDDEN_NOT_ADMIN',
        requestId,
        uid,
        email: decoded.email || '',
        message: `当前已认证账号 (UID: ${uid}) 未获管理员权限。请在服务端环境变量 ADMIN_UIDS 中配置该真实 Firebase UID，或为账号授予 admin Custom Claim。${extraHint}`,
      });
      return;
    }

    (req as any).adminIdentity = {
      uid,
      email: decoded.email || '',
      role: 'superadmin',
      authSource: hasCustomClaim ? 'custom_claim' : 'uid_whitelist',
    } satisfies VerifiedAdminIdentity;

    next();
  };

  /**
   * Public Health Check (P1-C):
   * Returns ONLY minimal service availability status and server timestamp.
   * Never exposes Firebase project ID, Firestore database ID, repository driver,
   * proxy configuration, service account emails, or admin diagnostics.
   */
  router.get('/health', (_req: Request, res: Response) => {
    sendJson(res, 200, {
      status: 'ok',
      service: 'geospatial-studio',
      serverTime: new Date().toISOString(),
    });
  });

  /**
   * Authenticated Admin Diagnostics Endpoint (P1-C):
   * Requires verified Firebase ID Token + Admin authorization.
   */
  router.get('/admin/diagnostics', requireAdminAuth, (_req: Request, res: Response) => {
    const serverCfg = getFirebaseServerConfig();
    const diagnostics = getRuntimeConfigDiagnostics(options);
    sendJson(res, 200, {
      success: true,
      status: 'ok',
      repositoryDriver: orderService.getRepositoryDriverName(),
      projectId: serverCfg.projectId || null,
      firestoreDatabaseId: serverCfg.firestoreDatabaseId || null,
      diagnostics,
      serverTime: new Date().toISOString(),
    });
  });

  // Public order submission with fail-closed rate limiting, validation, idempotency, and authoritative DB transaction
  router.post('/orders', async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || generateRequestId();
    try {
      const ip = getClientIp(req, options?.trustProxy);
      const maxOrdersPerWindow = options?.orderRateLimitMax ?? 10;
      const repo = orderService.getRepository();

      const rateCheck = repo.checkRateLimitDetailed
        ? await repo.checkRateLimitDetailed(
            `create:${ip}`,
            maxOrdersPerWindow,
            10 * 60 * 1000,
            'order_create'
          )
        : {
            allowed: await repo.checkRateLimit(
              `create:${ip}`,
              maxOrdersPerWindow,
              10 * 60 * 1000,
              'order_create'
            ),
            remaining: 0,
            retryAfterSeconds: 60,
            source: 'authoritative-store' as const,
          };

      if (!rateCheck.allowed) {
        sendJson(
          res,
          429,
          {
            success: false,
            code: 'RATE_LIMITED',
            retryable: true,
            retryAfterSeconds: rateCheck.retryAfterSeconds,
            requestId,
            message: '提交过于频繁，请稍后再试或直接通过邮箱与我们联系。',
          },
          { 'Retry-After': String(rateCheck.retryAfterSeconds) }
        );
        return;
      }

      const payload = await parseBody(req);
      const explicitIdemKey =
        typeof req.headers['x-idempotency-key'] === 'string'
          ? req.headers['x-idempotency-key']
          : undefined;

      const result = await orderService.createCustomerOrder(payload, ip, explicitIdemKey);

      const isReplay = result.submissionStatus === 'IDEMPOTENT_REPLAY';
      const httpStatus = isReplay ? 200 : 201;

      sendJson(res, httpStatus, {
        success: true,
        orderNumber: result.orderNumber,
        queryToken: result.queryToken,
        duplicate: result.duplicate,
        submissionStatus: result.submissionStatus,
        requestId,
        message: isReplay
          ? '已识别为同一会话的重试提交（未重复创建新工单），已为您安全恢复该工单编号与专属查询凭证，请立即复制保存。'
          : '需求已成功提交！系统已生成唯一工单编号与专属查询凭证（仅显示一次），请立即复制保存。工程师将在 12 小时内完成技术可行性评估并与您取得联系。',
        order: result.order,
      });
    } catch (err: any) {
      if (err instanceof PayloadTooLargeError || err instanceof InvalidJsonPayloadError) {
        sendJson(res, err.statusCode, {
          success: false,
          requestId,
          message: err.message,
        });
        return;
      }
      if (err instanceof OrderValidationError) {
        sendJson(res, 400, {
          success: false,
          code: 'VALIDATION_FAILED',
          requestId,
          message: err.message,
          errors: err.errors,
        });
        return;
      }
      if (err instanceof DuplicateOrderConflictError) {
        // P1-A.6: Never return HTTP 201 or a fake queryToken when original token cannot be safely recovered
        sendJson(res, 409, {
          success: false,
          code: err.code,
          duplicate: true,
          submissionStatus: 'DUPLICATE_CONFLICT_NO_TOKEN',
          orderNumber: err.orderNumber,
          queryToken: null,
          order: err.order,
          requestId,
          message: err.recoveryInstructions,
        });
        return;
      }
      if (err instanceof RateLimitServiceUnavailableError) {
        // P1-B: Fail-closed when rate limit backend fails
        sendJson(
          res,
          503,
          {
            success: false,
            code: err.code,
            retryable: true,
            failureCategory: err.failureCategory,
            requestId,
            message: err.message,
          },
          { 'Retry-After': '15' }
        );
        return;
      }
      if (err instanceof ConfigurationError || err instanceof DatabaseUnavailableError) {
        console.error(
          `[POST /api/orders] [${requestId}] Service unavailable (${err.code}):`,
          (err as any).internalDiagnostic || err.message
        );
        sendJson(res, 503, {
          success: false,
          code: err.code,
          retryable: true,
          requestId,
          message: err.message,
        });
        return;
      }
      console.error(`[POST /api/orders] [${requestId}] Unexpected error:`, err?.message || err);
      sendJson(res, 500, {
        success: false,
        code: 'INTERNAL_ERROR',
        requestId,
        message: '服务器处理工单时发生异常，请稍后重试。',
      });
    }
  });

  // Public customer order status lookup (strictly requires orderNumber + high-entropy queryToken)
  router.post('/orders/lookup', async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || generateRequestId();
    try {
      const ip = getClientIp(req, options?.trustProxy);
      const maxLookupPerWindow = options?.lookupRateLimitMax ?? 30;
      const repo = orderService.getRepository();

      const ipRate = repo.checkRateLimitDetailed
        ? await repo.checkRateLimitDetailed(
            `lookup_ip:${ip}`,
            maxLookupPerWindow,
            10 * 60 * 1000,
            'order_lookup_ip'
          )
        : {
            allowed: await repo.checkRateLimit(
              `lookup_ip:${ip}`,
              maxLookupPerWindow,
              10 * 60 * 1000,
              'order_lookup_ip'
            ),
            remaining: 0,
            retryAfterSeconds: 60,
            source: 'authoritative-store' as const,
          };

      if (!ipRate.allowed) {
        sendJson(
          res,
          429,
          {
            success: false,
            code: 'RATE_LIMITED',
            retryable: true,
            retryAfterSeconds: ipRate.retryAfterSeconds,
            requestId,
            message: '查询请求过于频繁，请稍后再试。',
          },
          { 'Retry-After': String(ipRate.retryAfterSeconds) }
        );
        return;
      }

      const body = await parseBody(req);
      const { orderNumber, queryToken } = body || {};

      if (!orderNumber || !queryToken) {
        sendJson(res, 400, {
          success: false,
          code: 'MISSING_LOOKUP_CREDENTIALS',
          requestId,
          message:
            '请同时提供工单编号（如 GEO-20261029-XXXXXX）与专属查询凭证（如 QK-XXXX-XXXX-XXXX）。',
        });
        return;
      }

      // Per-order brute-force protection
      const normalizedOrderNo = String(orderNumber).trim().toUpperCase().slice(0, 32);
      const orderRate = repo.checkRateLimitDetailed
        ? await repo.checkRateLimitDetailed(
            `lookup_ord:${normalizedOrderNo}`,
            15,
            10 * 60 * 1000,
            'order_lookup_target'
          )
        : {
            allowed: await repo.checkRateLimit(
              `lookup_ord:${normalizedOrderNo}`,
              15,
              10 * 60 * 1000,
              'order_lookup_target'
            ),
            remaining: 0,
            retryAfterSeconds: 60,
            source: 'authoritative-store' as const,
          };

      if (!orderRate.allowed) {
        sendJson(
          res,
          429,
          {
            success: false,
            code: 'ORDER_LOOKUP_LOCKED',
            retryable: true,
            retryAfterSeconds: orderRate.retryAfterSeconds,
            requestId,
            message: '该工单短时间内验证次数过多，已触发安全锁定，请稍后再试。',
          },
          { 'Retry-After': String(orderRate.retryAfterSeconds) }
        );
        return;
      }

      const publicOrder = await orderService.lookupCustomerOrder(orderNumber, queryToken);

      sendJson(res, 200, {
        success: true,
        requestId,
        order: publicOrder,
      });
    } catch (err: any) {
      if (err instanceof PayloadTooLargeError || err instanceof InvalidJsonPayloadError) {
        sendJson(res, err.statusCode, {
          success: false,
          requestId,
          message: err.message,
        });
        return;
      }
      if (err instanceof OrderValidationError) {
        sendJson(res, 400, {
          success: false,
          code: 'VALIDATION_FAILED',
          requestId,
          message: err.message,
        });
        return;
      }
      if (err instanceof OrderNotFoundError) {
        sendJson(res, 404, {
          success: false,
          code: 'LOOKUP_FAILED',
          requestId,
          message: '工单编号或查询凭证无效，请核对后重试。',
        });
        return;
      }
      if (err instanceof RateLimitServiceUnavailableError) {
        sendJson(
          res,
          503,
          {
            success: false,
            code: err.code,
            retryable: true,
            failureCategory: err.failureCategory,
            requestId,
            message: err.message,
          },
          { 'Retry-After': '15' }
        );
        return;
      }
      if (err instanceof ConfigurationError || err instanceof DatabaseUnavailableError) {
        console.error(
          `[POST /api/orders/lookup] [${requestId}] Service unavailable (${err.code}):`,
          (err as any).internalDiagnostic || err.message
        );
        sendJson(res, 503, {
          success: false,
          code: err.code,
          retryable: true,
          requestId,
          message: err.message,
        });
        return;
      }
      console.error(
        `[POST /api/orders/lookup] [${requestId}] Unexpected error:`,
        err?.message || err
      );
      sendJson(res, 500, {
        success: false,
        code: 'INTERNAL_ERROR',
        requestId,
        message: '查询服务暂时不可用，请稍后重试。',
      });
    }
  });

  // Admin: Verify Firebase ID Token & Admin UID Whitelist / Custom Claim
  router.post('/admin/verify', requireAdminAuth, (req: Request, res: Response) => {
    const adminIdentity = (req as any).adminIdentity as VerifiedAdminIdentity;
    sendJson(res, 200, {
      success: true,
      isAdmin: true,
      uid: adminIdentity.uid,
      email: adminIdentity.email,
      role: adminIdentity.role,
      authSource: adminIdentity.authSource,
    });
  });

  // Admin: Get all orders from authoritative repository
  router.get('/admin/orders', requireAdminAuth, async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || generateRequestId();
    try {
      const orders = await orderService.listOrdersForAdmin();
      sendJson(res, 200, {
        success: true,
        orders,
      });
    } catch (err: any) {
      if (err instanceof ConfigurationError || err instanceof DatabaseUnavailableError) {
        sendJson(res, 503, {
          success: false,
          code: err.code,
          requestId,
          message: err.message,
        });
        return;
      }
      sendJson(res, 500, {
        success: false,
        requestId,
        message: '读取工单列表失败，请检查数据库连接状态。',
      });
    }
  });

  // Admin: Update order status, manualQuote, adminNotes, or clientNotes
  router.patch('/admin/orders/:id', requireAdminAuth, async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || generateRequestId();
    try {
      const { id } = req.params;
      const body = await parseBody(req);
      const updated = await orderService.updateOrderByAdmin(id, {
        status: body.status,
        manualQuote: body.manualQuote,
        adminNotes: body.adminNotes,
        clientNotes: body.clientNotes,
      });

      sendJson(res, 200, {
        success: true,
        message: '工单已成功更新并持久化。',
        order: updated,
      });
    } catch (err: any) {
      if (err instanceof PayloadTooLargeError || err instanceof InvalidJsonPayloadError) {
        sendJson(res, err.statusCode, {
          success: false,
          requestId,
          message: err.message,
        });
        return;
      }
      if (err instanceof OrderValidationError) {
        sendJson(res, 400, {
          success: false,
          code: 'INVALID_ORDER_UPDATE',
          requestId,
          message: err.message,
        });
        return;
      }
      if (err instanceof OrderNotFoundError) {
        sendJson(res, 404, {
          success: false,
          code: 'ORDER_NOT_FOUND',
          requestId,
          message: err.message,
        });
        return;
      }
      if (err instanceof ConfigurationError || err instanceof DatabaseUnavailableError) {
        sendJson(res, 503, {
          success: false,
          code: err.code,
          requestId,
          message: err.message,
        });
        return;
      }
      sendJson(res, 500, {
        success: false,
        requestId,
        message: '更新工单时发生服务器错误。',
      });
    }
  });

  // Admin: Rotate / Re-issue customer queryToken after manual identity verification
  router.post(
    '/admin/orders/:id/rotate-token',
    requireAdminAuth,
    async (req: Request, res: Response) => {
      const requestId = (req as any).requestId || generateRequestId();
      try {
        const { id } = req.params;
        const rotated = await orderService.rotateOrderQueryTokenByAdmin(id);
        sendJson(res, 200, {
          success: true,
          orderNumber: rotated.orderNumber,
          newQueryToken: rotated.newQueryToken,
          updatedAt: rotated.updatedAt,
          message:
            '已成功重置并签发新的专属查询凭证，旧凭证已立即失效。请通过人工核实的客户预留渠道发送给客户。',
        });
      } catch (err: any) {
        if (err instanceof OrderNotFoundError) {
          sendJson(res, 404, {
            success: false,
            code: 'ORDER_NOT_FOUND',
            requestId,
            message: err.message,
          });
          return;
        }
        if (err instanceof ConfigurationError || err instanceof DatabaseUnavailableError) {
          sendJson(res, 503, {
            success: false,
            code: err.code,
            requestId,
            message: err.message,
          });
          return;
        }
        sendJson(res, 500, {
          success: false,
          requestId,
          message: '重置查询凭证失败。',
        });
      }
    }
  );

  // Admin: Export formula-sanitized CSV from authoritative repository
  router.get('/admin/export-csv', requireAdminAuth, async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || generateRequestId();
    try {
      const orders = await orderService.listOrdersForAdmin();
      const csvData = exportOrdersToCSV(orders);
      sendText(res, 200, csvData, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="geospatial-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
      });
    } catch (err: any) {
      if (err instanceof ConfigurationError || err instanceof DatabaseUnavailableError) {
        sendJson(res, 503, {
          success: false,
          code: err.code,
          requestId,
          message: err.message,
        });
        return;
      }
      sendJson(res, 500, {
        success: false,
        requestId,
        message: '导出 CSV 失败。',
      });
    }
  });

  // Admin: Seed demo order (strictly disabled in production per P0-B.12)
  router.post('/admin/seed-demo', requireAdminAuth, async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || generateRequestId();
    if (process.env.NODE_ENV === 'production') {
      sendJson(res, 403, {
        success: false,
        code: 'DEMO_SEED_DISABLED_IN_PROD',
        requestId,
        message: '生产环境已禁止注入演示工单。',
      });
      return;
    }

    try {
      const pepper = getRequiredQueryTokenPepper();
      const now = new Date().toISOString();
      let demoToken = '';
      const { order } = await orderService
        .getRepository()
        .createOrderAtomic((orderNumber) => {
          demoToken = generateQueryToken();
          return {
            id: generateOrderId(),
            orderNumber,
            serviceType: 'remote_sensing',
            title: '【Demo 演示工单】高分二号与哨兵二号近三年湿地植被变化反演分析',
            description:
              '对比2023-2026年同一季节湿地水体衰退与植被覆盖度演变，提取植被指数并输出图斑转移矩阵报表。',
            studyArea: '鄱阳湖国家级自然保护区核心监测区',
            dataFormats: 'Sentinel-2 L2A 多光谱数据',
            budgetRange: '1500+',
            expectedDeliveryDate: '2026-11-15',
            contactMethod: 'wechat',
            contactValue: 'demo_wetland_lab',
            status: 'pending_review',
            adminNotes: '【演示记录】多光谱波段校正与云掩膜处理量大，需预先确认质量评估指标。',
            clientNotes: '已录入待审阅列表，正由遥感工程师进行数据可获取性评估。',
            queryTokenHash: hashQueryToken(orderNumber, demoToken, pepper),
            queryTokenUpdatedAt: now,
            isDemo: true,
            createdAt: now,
            updatedAt: now,
          };
        }, `seed-demo-${Date.now()}-${generateClientIdempotencyKey()}`);

      sendJson(res, 201, {
        success: true,
        message: '已成功生成演示测试工单',
        order,
        demoQueryToken: demoToken,
      });
    } catch (err: any) {
      if (err instanceof ConfigurationError || err instanceof DatabaseUnavailableError) {
        sendJson(res, 503, {
          success: false,
          code: err.code,
          requestId,
          message: err.message,
        });
        return;
      }
      sendJson(res, 500, {
        success: false,
        requestId,
        message: '生成演示工单失败。',
      });
    }
  });

  return router;
}
