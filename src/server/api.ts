import type { Request, Response, NextFunction, Router } from 'express';
import express from 'express';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  exportOrdersToCSV,
  generateOrderId,
  generateQueryToken,
} from '../utils/order-utils.ts';
import {
  OrderService,
  OrderRepository,
  createDefaultOrderService,
  getFirebaseAdminApp,
  verifyFirebaseConfigConsistency,
  getRequiredQueryTokenPepper,
  DatabaseUnavailableError,
  ConfigurationError,
  OrderValidationError,
  OrderNotFoundError,
  hashQueryToken,
} from './order-service.ts';

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

const FORBIDDEN_DEMO_UIDS = new Set([
  'admin-bootstrap-uid',
  'demo-admin',
  'test-admin',
  'anonymous',
  'root',
]);

/**
 * Returns the server-side configured ADMIN_UIDS set.
 * Never accepts email addresses or hardcoded demo UIDs.
 */
export function getServerAdminUidWhitelist(overrideList?: string[]): Set<string> {
  const rawList =
    overrideList !== undefined
      ? overrideList
      : (process.env.ADMIN_UIDS || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

  const safeSet = new Set<string>();
  for (const uid of rawList) {
    if (uid && !FORBIDDEN_DEMO_UIDS.has(uid.toLowerCase()) && !uid.includes('@')) {
      safeSet.add(uid);
    }
  }
  return safeSet;
}

/**
 * Inspects ADMIN_UIDS configuration and returns non-sensitive diagnostics
 * (e.g., warning if ADMIN_UIDS is empty or appears to contain an email prefix instead of a 28-char Firebase UID).
 */
export function diagnoseAdminUidWhitelist(overrideList?: string[]): {
  configuredCount: number;
  warnings: string[];
} {
  const whitelist = getServerAdminUidWhitelist(overrideList);
  const warnings: string[] = [];

  if (whitelist.size === 0) {
    warnings.push(
      'ADMIN_UIDS 尚未配置。请先在 /#admin 页面使用 Google 账号登录，复制界面显示的真实 Firebase UID 填入 ADMIN_UIDS。'
    );
  } else {
    for (const uid of whitelist) {
      if (uid.length < 20) {
        warnings.push(
          `ADMIN_UIDS 中的条目 "${uid}" 长度较短 (${uid.length} 字符)，可能为邮箱前缀而非真实的 28 位 Firebase Auth UID。若登录报 403，请以 /#admin 登录页回显的真实 UID 为准。`
        );
      }
    }
  }

  return {
    configuredCount: whitelist.size,
    warnings,
  };
}

/**
 * Resolves the exact number of trusted reverse-proxy hops (Requirement 6).
 * - Never unconditionally trusts X-Forwarded-For.
 * - Defaults to 1 hop ONLY when running on Cloud Run (K_SERVICE) behind Google Cloud Front End (GFE),
 *   or when TRUST_PROXY is explicitly configured ("1", "true", "cloudrun").
 * - Defaults to 0 hops (X-Forwarded-For ignored) in direct/local environments.
 */
export function resolveTrustedProxyHops(trustProxyOption?: boolean | number): number {
  if (typeof trustProxyOption === 'number') {
    return Number.isInteger(trustProxyOption) && trustProxyOption > 0 ? trustProxyOption : 0;
  }
  if (typeof trustProxyOption === 'boolean') {
    return trustProxyOption ? 1 : 0;
  }

  const rawEnv = (process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (rawEnv === 'false' || rawEnv === '0' || rawEnv === 'off') {
    return 0;
  }
  if (/^\d+$/.test(rawEnv)) {
    return Math.min(Math.max(parseInt(rawEnv, 10), 0), 10);
  }
  if (rawEnv === 'true' || rawEnv === 'cloudrun') {
    return 1;
  }

  // Auto-detect Cloud Run GFE (1 hop) via K_SERVICE; otherwise 0 hops
  return process.env.K_SERVICE ? 1 : 0;
}

/**
 * Safely extracts client IP according to trusted reverse proxy hop count (Requirement 6).
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
 * Returns non-sensitive runtime configuration diagnostics (Requirements 7 & 8).
 */
export function getRuntimeConfigDiagnostics(options?: ApiRouterOptions) {
  const firebaseConsistency = verifyFirebaseConfigConsistency();
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
    firebaseConsistency,
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
      trustProxyEnv: process.env.TRUST_PROXY || null,
      cloudRunService: process.env.K_SERVICE || null,
    },
  };
}

// Universal response helper that works in both Express and Vite Connect middleware
function sendJson(res: any, status: number, data: any) {
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

  // Express JSON middleware with 32KB limit
  router.use(
    express.json({
      limit: '32kb',
      strict: true,
    })
  );

  // Handle Express body-parser errors (413 Payload Too Large / 400 Bad JSON)
  router.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      sendJson(res, 413, {
        success: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: '请求体超过最大允许长度 (32KB)。',
      });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      sendJson(res, 400, {
        success: false,
        code: 'INVALID_JSON',
        message: '请求体 JSON 格式非法。',
      });
      return;
    }
    next(err);
  });

  /**
   * Unified Admin Authentication & Authorization Middleware (P0-A & Requirement 7)
   * Never falls back to insecure header/email checks even when ADMIN_UIDS is unconfigured.
   */
  const requireAdminAuth = async (req: Request, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    if (!token) {
      sendJson(res, 401, {
        success: false,
        isAdmin: false,
        code: 'UNAUTHENTICATED',
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

  // Health & non-sensitive configuration diagnostics check
  router.get('/health', (_req: Request, res: Response) => {
    const diagnostics = getRuntimeConfigDiagnostics(options);
    sendJson(res, 200, {
      status: 'ok',
      firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
      projectId: firebaseConfig.projectId,
      repositoryDriver: orderService.getRepositoryDriverName(),
      diagnostics,
      serverTime: new Date().toISOString(),
    });
  });

  // Public order submission with rate limiting, validation, idempotency, and authoritative DB transaction
  router.post('/orders', async (req: Request, res: Response) => {
    try {
      const ip = getClientIp(req, options?.trustProxy);
      const maxOrdersPerWindow = options?.orderRateLimitMax ?? 10;
      const allowed = await orderService
        .getRepository()
        .checkRateLimit(`create:${ip}`, maxOrdersPerWindow, 10 * 60 * 1000);

      if (!allowed) {
        sendJson(res, 429, {
          success: false,
          code: 'RATE_LIMITED',
          message: '提交过于频繁，请稍后再试或直接通过邮箱与我们联系。',
        });
        return;
      }

      const payload = await parseBody(req);
      const explicitIdemKey =
        typeof req.headers['x-idempotency-key'] === 'string'
          ? req.headers['x-idempotency-key']
          : undefined;

      const result = await orderService.createCustomerOrder(payload, ip, explicitIdemKey);

      sendJson(res, 201, {
        success: true,
        orderNumber: result.orderNumber,
        queryToken: result.queryToken,
        duplicate: result.duplicate,
        message:
          '需求已成功提交！系统已生成唯一工单编号与专属查询凭证（仅显示一次），请立即复制保存。工程师将在 12 小时内完成技术可行性评估并与您取得联系。',
        order: result.order,
      });
    } catch (err: any) {
      if (err instanceof PayloadTooLargeError || err instanceof InvalidJsonPayloadError) {
        sendJson(res, err.statusCode, {
          success: false,
          message: err.message,
        });
        return;
      }
      if (err instanceof OrderValidationError) {
        sendJson(res, 400, {
          success: false,
          code: 'VALIDATION_FAILED',
          message: err.message,
          errors: err.errors,
        });
        return;
      }
      if (err instanceof ConfigurationError || err instanceof DatabaseUnavailableError) {
        sendJson(res, 503, {
          success: false,
          code: err.code,
          message: err.message,
        });
        return;
      }
      console.error('[POST /api/orders] Unexpected error:', err?.message || err);
      sendJson(res, 500, {
        success: false,
        code: 'INTERNAL_ERROR',
        message: '服务器处理工单时发生异常，请稍后重试。',
      });
    }
  });

  // Public customer order status lookup (strictly requires orderNumber + high-entropy queryToken)
  router.post('/orders/lookup', async (req: Request, res: Response) => {
    try {
      const ip = getClientIp(req, options?.trustProxy);
      const maxLookupPerWindow = options?.lookupRateLimitMax ?? 20;
      const ipAllowed = await orderService
        .getRepository()
        .checkRateLimit(`lookup_ip:${ip}`, maxLookupPerWindow, 10 * 60 * 1000);

      if (!ipAllowed) {
        sendJson(res, 429, {
          success: false,
          code: 'RATE_LIMITED',
          message: '查询请求过于频繁，请稍后再试。',
        });
        return;
      }

      const body = await parseBody(req);
      const { orderNumber, queryToken } = body || {};

      if (!orderNumber || !queryToken) {
        sendJson(res, 400, {
          success: false,
          code: 'MISSING_LOOKUP_CREDENTIALS',
          message:
            '请同时提供工单编号（如 GEO-20261029-XXXXXX）与专属查询凭证（如 QK-XXXX-XXXX-XXXX）。',
        });
        return;
      }

      // Per-order brute-force protection
      const normalizedOrderNo = String(orderNumber).trim().toUpperCase().slice(0, 32);
      const orderAllowed = await orderService
        .getRepository()
        .checkRateLimit(`lookup_ord:${normalizedOrderNo}`, 10, 10 * 60 * 1000);
      if (!orderAllowed) {
        sendJson(res, 429, {
          success: false,
          code: 'ORDER_LOOKUP_LOCKED',
          message: '该工单短时间内验证次数过多，已触发安全锁定，请 10 分钟后再试。',
        });
        return;
      }

      const publicOrder = await orderService.lookupCustomerOrder(orderNumber, queryToken);

      sendJson(res, 200, {
        success: true,
        order: publicOrder,
      });
    } catch (err: any) {
      if (err instanceof PayloadTooLargeError || err instanceof InvalidJsonPayloadError) {
        sendJson(res, err.statusCode, {
          success: false,
          message: err.message,
        });
        return;
      }
      if (err instanceof OrderValidationError) {
        sendJson(res, 400, {
          success: false,
          code: 'VALIDATION_FAILED',
          message: err.message,
        });
        return;
      }
      if (err instanceof OrderNotFoundError) {
        sendJson(res, 404, {
          success: false,
          code: 'LOOKUP_FAILED',
          message: '工单编号或查询凭证无效，请核对后重试。',
        });
        return;
      }
      if (err instanceof ConfigurationError || err instanceof DatabaseUnavailableError) {
        sendJson(res, 503, {
          success: false,
          code: err.code,
          message: err.message,
        });
        return;
      }
      console.error('[POST /api/orders/lookup] Unexpected error:', err?.message || err);
      sendJson(res, 500, {
        success: false,
        code: 'INTERNAL_ERROR',
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
  router.get('/admin/orders', requireAdminAuth, async (_req: Request, res: Response) => {
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
          message: err.message,
        });
        return;
      }
      sendJson(res, 500, {
        success: false,
        message: '读取工单列表失败，请检查数据库连接状态。',
      });
    }
  });

  // Admin: Update order status, manualQuote, adminNotes, or clientNotes
  router.patch('/admin/orders/:id', requireAdminAuth, async (req: Request, res: Response) => {
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
          message: err.message,
        });
        return;
      }
      if (err instanceof OrderValidationError) {
        sendJson(res, 400, {
          success: false,
          code: 'INVALID_ORDER_UPDATE',
          message: err.message,
        });
        return;
      }
      if (err instanceof OrderNotFoundError) {
        sendJson(res, 404, {
          success: false,
          code: 'ORDER_NOT_FOUND',
          message: err.message,
        });
        return;
      }
      if (err instanceof ConfigurationError || err instanceof DatabaseUnavailableError) {
        sendJson(res, 503, {
          success: false,
          code: err.code,
          message: err.message,
        });
        return;
      }
      sendJson(res, 500, {
        success: false,
        message: '更新工单时发生服务器错误。',
      });
    }
  });

  // Admin: Rotate / Re-issue customer queryToken after manual identity verification
  router.post(
    '/admin/orders/:id/rotate-token',
    requireAdminAuth,
    async (req: Request, res: Response) => {
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
            message: err.message,
          });
          return;
        }
        if (err instanceof ConfigurationError || err instanceof DatabaseUnavailableError) {
          sendJson(res, 503, {
            success: false,
            code: err.code,
            message: err.message,
          });
          return;
        }
        sendJson(res, 500, {
          success: false,
          message: '重置查询凭证失败。',
        });
      }
    }
  );

  // Admin: Export formula-sanitized CSV from authoritative repository
  router.get('/admin/export-csv', requireAdminAuth, async (_req: Request, res: Response) => {
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
          message: err.message,
        });
        return;
      }
      sendJson(res, 500, {
        success: false,
        message: '导出 CSV 失败。',
      });
    }
  });

  // Admin: Seed demo order (strictly disabled in production per P0-B.12)
  router.post('/admin/seed-demo', requireAdminAuth, async (_req: Request, res: Response) => {
    if (process.env.NODE_ENV === 'production') {
      sendJson(res, 403, {
        success: false,
        code: 'DEMO_SEED_DISABLED_IN_PROD',
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
        }, `seed-demo-${Date.now()}-${Math.random()}`);

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
          message: err.message,
        });
        return;
      }
      sendJson(res, 500, {
        success: false,
        message: '生成演示工单失败。',
      });
    }
  });

  return router;
}
