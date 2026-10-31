import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createApiRouter,
  TokenVerifierFn,
  getClientIp,
  resolveTrustedProxyHops,
} from '../server/api.ts';
import {
  IsolatedTestOrderRepository,
  OrderService,
  verifyFirebaseConfigConsistency,
  clearL1RateLimitCacheForTests,
  RateLimitFailureCategory,
} from '../server/order-service.ts';
import { generateClientIdempotencyKey } from '../utils/order-utils.ts';
import { validateFirebaseClientConfig } from '../config/firebase-client.ts';

/**
 * P0-B Test Isolation Guard:
 * Default `npm test` runs strictly in an isolated test environment (`NODE_ENV=test`)
 * with an isolated test project ID (`demo-geospatial-studio-test`).
 * It NEVER connects to or writes to the live production Firestore database (`gen-lang-client-0041017161`).
 */
process.env.NODE_ENV = 'test';
process.env.IGNORE_LOCAL_FIREBASE_CONFIG_FILE = 'true';
process.env.FIREBASE_PROJECT_ID = 'demo-geospatial-studio-test';
process.env.VITE_FIREBASE_PROJECT_ID = 'demo-geospatial-studio-test';
process.env.FIRESTORE_DATABASE_ID = 'ai-studio-isolated-test-db';
process.env.VITE_FIREBASE_DATABASE_ID = 'ai-studio-isolated-test-db';
process.env.FIREBASE_AUTH_DOMAIN = 'demo-geospatial-studio-test.firebaseapp.com';
process.env.VITE_FIREBASE_AUTH_DOMAIN = 'demo-geospatial-studio-test.firebaseapp.com';

const TEST_RANDOM_PEPPER = crypto.randomBytes(32).toString('hex');
process.env.QUERY_TOKEN_PEPPER = TEST_RANDOM_PEPPER;

const ADMIN_UID = 'verified-studio-admin-uid-2026-prod-length';
const NON_ADMIN_UID = 'regular-google-user-uid-8888-prod-length';

/**
 * Deterministic Mock Firebase Admin ID Token verifier (`[MOCK_AUTH_VERIFIER]`).
 * Note (P0-B.7): This tests server-side authorization logic using mocked token payloads;
 * it is explicitly distinguished from live Firebase Auth Google Sign-In verification.
 */
const mockTokenVerifier: TokenVerifierFn = async (token: string) => {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'demo-geospatial-studio-test';
  if (token === 'valid-admin-jwt') {
    return {
      uid: ADMIN_UID,
      email: 'yeston463@gmail.com',
      email_verified: true,
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      sub: ADMIN_UID,
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { identities: {}, sign_in_provider: 'google.com' },
    } as any;
  }
  if (token === 'valid-nonadmin-jwt-EvenWithAdminEmail') {
    return {
      uid: NON_ADMIN_UID,
      email: 'yeston463@gmail.com',
      email_verified: true,
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      sub: NON_ADMIN_UID,
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { identities: {}, sign_in_provider: 'google.com' },
    } as any;
  }
  if (token === 'valid-bootstrap-uid-jwt') {
    return {
      uid: 'admin-bootstrap-uid',
      email: 'yeston463@gmail.com',
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      sub: 'admin-bootstrap-uid',
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { identities: {}, sign_in_provider: 'google.com' },
    } as any;
  }
  throw new Error('Firebase ID token has invalid signature or is expired.');
};

async function startTestServer(options: {
  storageFile: string;
  simulateDbFailure?: boolean;
  simulateRateLimitFailure?: RateLimitFailureCategory | null;
  orderRateLimitMax?: number;
  lookupRateLimitMax?: number;
}) {
  clearL1RateLimitCacheForTests();
  const repo = new IsolatedTestOrderRepository(options.storageFile);

  if (options.simulateDbFailure) {
    repo.setSimulateFailure(true);
  }
  if (options.simulateRateLimitFailure) {
    repo.setSimulateRateLimitFailure(options.simulateRateLimitFailure);
  }

  const service = new OrderService(repo);
  const app = express();
  app.use(
    '/api',
    createApiRouter({
      orderService: service,
      tokenVerifier: mockTokenVerifier,
      adminUidWhitelist: [ADMIN_UID],
      orderRateLimitMax: options.orderRateLimitMax ?? 100,
      lookupRateLimitMax: options.lookupRateLimitMax ?? 100,
    })
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    repo,
    service,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('[P0-A & P0-B] Clean-Clone Config Independence & Production DB Isolation Guard', async () => {
  assert.notEqual(
    process.env.FIREBASE_PROJECT_ID,
    'gen-lang-client-0041017161',
    'Automated tests must NEVER target the production Firebase project ID'
  );

  const consistency = verifyFirebaseConfigConsistency();
  assert.equal(consistency.consistent, true);
  assert.equal(consistency.clientProjectId, 'demo-geospatial-studio-test');
  assert.equal(consistency.adminProjectId, 'demo-geospatial-studio-test');
  assert.equal(consistency.configSource, 'env');

  // Verify client config validator explicitly reports only the 3 required public VITE_FIREBASE_* fields
  // (and does NOT require storageBucket, messagingSenderId, measurementId, or explicit authDomain)
  const clientValidationEmpty = validateFirebaseClientConfig({
    apiKey: '',
    projectId: '',
    authDomain: '',
    appId: '',
    firestoreDatabaseId: '(default)',
  });
  assert.equal(clientValidationEmpty.valid, false);
  assert.deepEqual(clientValidationEmpty.missingFields.sort(), [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_PROJECT_ID',
  ]);

  const clientValidationComplete = validateFirebaseClientConfig({
    apiKey: 'AIzaSyTestFormatDummyKeyForUnitValidation00',
    projectId: 'demo-geospatial-studio-test',
    authDomain: 'demo-geospatial-studio-test.firebaseapp.com',
    appId: '1:000000000000:web:test000000',
    firestoreDatabaseId: 'ai-studio-isolated-test-db',
  });
  assert.equal(clientValidationComplete.valid, true);
  assert.equal(clientValidationComplete.missingFields.length, 0);
});

test('[MOCK_AUTH_VERIFIER] Cases 1-5: Admin Authentication & Adversarial Bypass Rejection', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-auth-${Date.now()}.json`);
  const srv = await startTestServer({ storageFile: tmpFile });

  try {
    // Case 1: Unauthenticated access to /api/admin/orders -> 401
    const res1 = await fetch(`${srv.baseUrl}/api/admin/orders`);
    assert.equal(res1.status, 401);

    // Case 2: Forged x-admin-email header -> 401
    const res2 = await fetch(`${srv.baseUrl}/api/admin/orders`, {
      headers: {
        'x-admin-email': 'yeston463@gmail.com',
      },
    });
    assert.equal(res2.status, 401);

    // Case 3: Forged x-admin-uid: admin-bootstrap-uid (header, query, body, and inside token) -> 401
    const res3Header = await fetch(
      `${srv.baseUrl}/api/admin/orders?uid=admin-bootstrap-uid&email=yeston463@gmail.com`,
      {
        headers: {
          'x-admin-uid': 'admin-bootstrap-uid',
          'x-admin-email': 'yeston463@gmail.com',
        },
      }
    );
    assert.equal(res3Header.status, 401);

    const res3VerifyBody = await fetch(`${srv.baseUrl}/api/admin/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-uid': 'admin-bootstrap-uid',
        'x-admin-email': 'yeston463@gmail.com',
      },
      body: JSON.stringify({ uid: 'admin-bootstrap-uid', email: 'yeston463@gmail.com' }),
    });
    assert.equal(res3VerifyBody.status, 401);

    const res3ForbiddenDemoToken = await fetch(`${srv.baseUrl}/api/admin/orders`, {
      headers: {
        Authorization: 'Bearer valid-bootstrap-uid-jwt',
      },
    });
    assert.equal(res3ForbiddenDemoToken.status, 401);

    // Case 4: Non-admin valid Google user token (even if email is yeston463@gmail.com, UID not in ADMIN_UIDS) -> 403
    const res4 = await fetch(`${srv.baseUrl}/api/admin/orders`, {
      headers: {
        Authorization: 'Bearer valid-nonadmin-jwt-EvenWithAdminEmail',
      },
    });
    assert.equal(res4.status, 403);
    const body4 = await res4.json();
    assert.equal(body4.code, 'FORBIDDEN_NOT_ADMIN');
    assert.equal(body4.uid, NON_ADMIN_UID);

    // Case 5: Valid whitelisted Admin UID Bearer Token -> 200
    const res5 = await fetch(`${srv.baseUrl}/api/admin/orders`, {
      headers: {
        Authorization: 'Bearer valid-admin-jwt',
      },
    });
    assert.equal(res5.status, 200);
    const body5 = await res5.json();
    assert.equal(body5.success, true);
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[P1-A] All 6 Duplicate Submission, Idempotent Token Recovery, Multi-User Same Content, and Manual Rotation Scenarios', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-p1a-${Date.now()}.json`);
  const srv = await startTestServer({ storageFile: tmpFile });

  try {
    const sessionKeyA = generateClientIdempotencyKey();
    const orderPayloadA = {
      serviceType: 'thematic_map',
      title: '长三角流域水系生态敏感区专题制图',
      description: '使用DEM与水系矢量制作标准300DPI出版级专题图，包含比例尺与指北针。',
      studyArea: '太湖流域',
      dataFormats: 'SHP / GeoTIFF',
      budgetRange: '200-500',
      expectedDeliveryDate: '2026-11-15',
      contactMethod: 'email',
      contactValue: 'customer_a@university.edu.cn',
      agreePrivacy: true,
    };

    // Scenario 1: First submission succeeds -> HTTP 201, duplicate: false, submissionStatus: CREATED
    const resFirst = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': sessionKeyA,
      },
      body: JSON.stringify(orderPayloadA),
    });
    assert.equal(resFirst.status, 201);
    const dataFirst = await resFirst.json();
    assert.equal(dataFirst.success, true);
    assert.equal(dataFirst.duplicate, false);
    assert.equal(dataFirst.submissionStatus, 'CREATED');
    assert.match(dataFirst.orderNumber, /^GEO-\d{8}-[2-9A-HJ-NP-Z]{6}$/);
    assert.match(
      dataFirst.queryToken,
      /^QK-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/
    );

    // Verify database does NOT store plaintext queryToken anywhere
    const rawSavedOrder = await srv.repo.getOrderByNumber(dataFirst.orderNumber);
    assert.ok(rawSavedOrder);
    assert.equal('queryToken' in (rawSavedOrder as any), false, 'Plaintext queryToken must NEVER be stored in DB');
    assert.equal(typeof rawSavedOrder.queryTokenHash, 'string');
    assert.equal(rawSavedOrder.queryTokenHash?.length, 64);

    // Scenario 2: Network response lost -> client retries with SAME X-Idempotency-Key -> HTTP 200, IDEMPOTENT_REPLAY, recovers exact valid queryToken!
    const resRetry = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': sessionKeyA,
      },
      body: JSON.stringify(orderPayloadA),
    });
    assert.equal(resRetry.status, 200);
    const dataRetry = await resRetry.json();
    assert.equal(dataRetry.success, true);
    assert.equal(dataRetry.duplicate, true);
    assert.equal(dataRetry.submissionStatus, 'IDEMPOTENT_REPLAY');
    assert.equal(dataRetry.orderNumber, dataFirst.orderNumber);
    assert.equal(
      dataRetry.queryToken,
      dataFirst.queryToken,
      'Retry with same session X-Idempotency-Key must safely recover the exact valid queryToken'
    );

    // Verify the recovered queryToken actually works for order lookup
    const lookupWithRecovered = await fetch(`${srv.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: dataRetry.orderNumber,
        queryToken: dataRetry.queryToken,
      }),
    });
    assert.equal(lookupWithRecovered.status, 200);

    // Scenario 3: Double-click concurrent submission with same X-Idempotency-Key -> only 1 order created, both get valid queryToken
    const doubleClickKey = generateClientIdempotencyKey();
    const doubleClickPayload = {
      ...orderPayloadA,
      title: '双击并发幂等测试专题制图委托',
    };
    const [dc1, dc2] = await Promise.all([
      fetch(`${srv.baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': doubleClickKey,
        },
        body: JSON.stringify(doubleClickPayload),
      }).then(async (r) => ({ status: r.status, body: await r.json() })),
      fetch(`${srv.baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': doubleClickKey,
        },
        body: JSON.stringify(doubleClickPayload),
      }).then(async (r) => ({ status: r.status, body: await r.json() })),
    ]);
    assert.equal(dc1.body.orderNumber, dc2.body.orderNumber);
    assert.equal(dc1.body.queryToken, dc2.body.queryToken);
    assert.match(
      dc2.body.queryToken,
      /^QK-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/
    );

    // Scenario 4: Customer closes tab & reopens (submits identical content without X-Idempotency-Key within 60s)
    // First submission without explicit key creates order; second within 60s returns HTTP 409 Conflict (never HTTP 201 and never a fake token!)
    const tabPayload = {
      ...orderPayloadA,
      title: '关闭标签页后重开重复提交测试',
      contactValue: 'tab_reopen_user@example.com',
    };
    const resTab1 = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tabPayload),
    });
    assert.equal(resTab1.status, 201);
    const dataTab1 = await resTab1.json();

    const resTab2 = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tabPayload),
    });
    assert.equal(
      resTab2.status,
      409,
      'Unrecoverable duplicate submission without session key MUST return HTTP 409 Conflict, never 201'
    );
    const dataTab2 = await resTab2.json();
    assert.equal(dataTab2.success, false);
    assert.equal(dataTab2.duplicate, true);
    assert.equal(dataTab2.code, 'DUPLICATE_SUBMISSION_REQUIRES_MANUAL_RECOVERY');
    assert.equal(dataTab2.orderNumber, dataTab1.orderNumber);
    assert.equal(dataTab2.queryToken, null, 'Must never return a fake placeholder queryToken string');

    // If customer explicitly confirms forceNewOrder: true, a separate new order is created -> HTTP 201
    const resTabForceNew = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...tabPayload, forceNewOrder: true }),
    });
    assert.equal(resTabForceNew.status, 201);
    const dataTabForceNew = await resTabForceNew.json();
    assert.notEqual(dataTabForceNew.orderNumber, dataTab1.orderNumber);

    // Scenario 5: Different users submit the exact same title & description from the same IP -> NEVER merged!
    const resUserB = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Even if someone maliciously reused sessionKeyA with a different contactValue!
        'X-Idempotency-Key': sessionKeyA,
      },
      body: JSON.stringify({
        ...orderPayloadA,
        contactValue: 'customer_b_different@university.edu.cn',
      }),
    });
    assert.equal(resUserB.status, 201);
    const dataUserB = await resUserB.json();
    assert.equal(dataUserB.duplicate, false);
    assert.notEqual(
      dataUserB.orderNumber,
      dataFirst.orderNumber,
      'Different users submitting identical descriptions must NEVER be merged into the same order'
    );
    assert.notEqual(dataUserB.queryToken, dataFirst.queryToken);

    // Scenario 6: Token lost & manual recovery by Admin -> rotates token, invalidates old token AND invalidates old idempotency replay
    const rotateRes = await fetch(
      `${srv.baseUrl}/api/admin/orders/${dataFirst.orderNumber}/rotate-token`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-admin-jwt' },
      }
    );
    assert.equal(rotateRes.status, 200);
    const rotateData = await rotateRes.json();
    assert.notEqual(rotateData.newQueryToken, dataFirst.queryToken);

    // Old token lookup must fail with 404
    const oldLookup = await fetch(`${srv.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: dataFirst.orderNumber,
        queryToken: dataFirst.queryToken,
      }),
    });
    assert.equal(oldLookup.status, 404);

    // Replaying old sessionKeyA after admin rotated token must now return 409 (cannot replay invalidated token)
    const replayAfterRotate = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': sessionKeyA,
      },
      body: JSON.stringify(orderPayloadA),
    });
    assert.equal(replayAfterRotate.status, 409);

    // New rotated token lookup succeeds with 200
    const newLookup = await fetch(`${srv.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: dataFirst.orderNumber,
        queryToken: rotateData.newQueryToken,
      }),
    });
    assert.equal(newLookup.status, 200);
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[P1-B] Rate Limit Failure Fail-Closed Policy (Fault Injection) & Cross-Instance Rate Limit Enforcement', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-p1b-${Date.now()}.json`);
  const srv = await startTestServer({
    storageFile: tmpFile,
    orderRateLimitMax: 3,
    lookupRateLimitMax: 4,
  });

  try {
    // 1. Fault Injection: verify TIMEOUT, PERMISSION_DENIED, NETWORK_UNAVAILABLE, TRANSACTION_CONFLICT all fail-closed with 503 (never silently fall back to memory)
    const categories: RateLimitFailureCategory[] = [
      'TIMEOUT',
      'PERMISSION_DENIED',
      'NETWORK_UNAVAILABLE',
      'TRANSACTION_CONFLICT',
    ];

    for (const category of categories) {
      srv.repo.setSimulateRateLimitFailure(category);

      const createFailRes = await fetch(`${srv.baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceType: 'script_dev',
          title: '限流故障关闭测试',
          description: '当限流后端异常时必须返回503，绝不静默降级为单机内存限流。',
          contactMethod: 'email',
          contactValue: 'ratelimit_failclosed@example.com',
          agreePrivacy: true,
        }),
      });
      assert.equal(
        createFailRes.status,
        503,
        `Rate limit failure (${category}) on order creation must fail-closed with 503`
      );
      const createFailData = await createFailRes.json();
      assert.equal(createFailData.code, 'RATE_LIMIT_BACKEND_UNAVAILABLE');
      assert.equal(createFailData.failureCategory, category);
      assert.equal(createFailData.retryable, true);
    }

    // Restore rate limit backend
    srv.repo.setSimulateRateLimitFailure(null);

    // 2. Cross-instance rate limit enforcement across two Express instances sharing the authoritative repository
    const sharedRateFile = path.join(os.tmpdir(), `geo-test-crossrate-${Date.now()}.json`);
    const inst1 = await startTestServer({ storageFile: sharedRateFile, orderRateLimitMax: 2 });
    const inst2 = await startTestServer({ storageFile: sharedRateFile, orderRateLimitMax: 2 });

    try {
      const makeOrderBody = (idx: number) =>
        JSON.stringify({
          serviceType: 'thematic_map',
          title: `跨实例限流测试工单 #${idx}`,
          description: '测试跨实例共享限流配额，防止单机内存限流被多实例绕过。',
          contactMethod: 'email',
          contactValue: `cross_rate_${idx}@example.com`,
          agreePrivacy: true,
        });

      // Request 1 on Instance 1 -> 201 (count = 1/2)
      clearL1RateLimitCacheForTests();
      const r1 = await fetch(`${inst1.baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: makeOrderBody(1),
      });
      assert.equal(r1.status, 201);

      // Request 2 on Instance 2 -> 201 (count = 2/2 in shared authoritative store)
      clearL1RateLimitCacheForTests();
      const r2 = await fetch(`${inst2.baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: makeOrderBody(2),
      });
      assert.equal(r2.status, 201);

      // Request 3 on Instance 1 (even with L1 cache cleared) -> 429 Too Many Requests from authoritative store!
      clearL1RateLimitCacheForTests();
      const r3 = await fetch(`${inst1.baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: makeOrderBody(3),
      });
      assert.equal(r3.status, 429);
      assert.ok(r3.headers.get('retry-after'));
      const r3Body = await r3.json();
      assert.equal(r3Body.code, 'RATE_LIMITED');
      assert.equal(typeof r3Body.retryAfterSeconds, 'number');
    } finally {
      await inst1.close();
      await inst2.close();
      if (fs.existsSync(sharedRateFile)) fs.unlinkSync(sharedRateFile);
    }
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[P1-C] Public Health Check Redaction, Authenticated Admin Diagnostics, and Error Sanitization', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-p1c-${Date.now()}.json`);
  const srv = await startTestServer({ storageFile: tmpFile });

  try {
    // 1. Public GET /api/health returns ONLY minimal status & timestamp
    const healthRes = await fetch(`${srv.baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, 'ok');
    assert.equal(healthData.service, 'geospatial-studio');
    assert.equal('projectId' in healthData, false, 'Public /api/health must NOT expose projectId');
    assert.equal(
      'firestoreDatabaseId' in healthData,
      false,
      'Public /api/health must NOT expose firestoreDatabaseId'
    );
    assert.equal(
      'repositoryDriver' in healthData,
      false,
      'Public /api/health must NOT expose repositoryDriver'
    );
    assert.equal(
      'diagnostics' in healthData,
      false,
      'Public /api/health must NOT expose internal diagnostics'
    );

    // 2. GET /api/admin/diagnostics requires verified Admin Auth
    const unauthDiag = await fetch(`${srv.baseUrl}/api/admin/diagnostics`);
    assert.equal(unauthDiag.status, 401);

    const nonAdminDiag = await fetch(`${srv.baseUrl}/api/admin/diagnostics`, {
      headers: { Authorization: 'Bearer valid-nonadmin-jwt-EvenWithAdminEmail' },
    });
    assert.equal(nonAdminDiag.status, 403);

    const adminDiagRes = await fetch(`${srv.baseUrl}/api/admin/diagnostics`, {
      headers: { Authorization: 'Bearer valid-admin-jwt' },
    });
    assert.equal(adminDiagRes.status, 200);
    const adminDiagData = await adminDiagRes.json();
    assert.equal(adminDiagData.success, true);
    assert.equal(adminDiagData.repositoryDriver, 'test-isolated-transactional');
    assert.ok(adminDiagData.diagnostics);
    assert.equal(
      'adcServiceAccountEmail' in adminDiagData.diagnostics.firebaseConsistency,
      false,
      'Admin diagnostics must not expose raw service account email'
    );
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[P3 & Cases 9-16] End-to-End 15-Step Order Lifecycle, DB Failure 503, File-Backed Restart Simulation, Quote/State Validation, and CSV Sanitization', async () => {
  const sharedStorageFile = path.join(os.tmpdir(), `geo-test-e2e-${Date.now()}.json`);

  // Step 1-3: Anonymous customer submits GIS requirement -> saved & returns orderNumber + queryToken
  const instanceA = await startTestServer({ storageFile: sharedStorageFile, orderRateLimitMax: 500 });
  let orderNumber = '';
  let queryToken = '';

  try {
    const createRes = await fetch(`${instanceA.baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': generateClientIdempotencyKey(),
      },
      body: JSON.stringify({
        serviceType: 'remote_sensing',
        title: '高分二号与哨兵二号湿地植被变化遥感反演 (=1+1)',
        description: '计算近三年湿地NDVI时序变化并导出300DPI专题图与面积转移矩阵。',
        studyArea: '+鄱阳湖保护区',
        dataFormats: 'GeoTIFF / Shapefile',
        budgetRange: '500-1500',
        expectedDeliveryDate: '2026-11-25',
        contactMethod: 'email',
        contactValue: 'wetland_researcher@institute.cn',
        agreePrivacy: true,
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    orderNumber = created.orderNumber;
    queryToken = created.queryToken;

    // Step 4: Customer queries order using orderNumber + queryToken
    const lookup1 = await fetch(`${instanceA.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNumber, queryToken }),
    });
    assert.equal(lookup1.status, 200);
    const lookup1Data = await lookup1.json();
    assert.equal(lookup1Data.order.status, 'pending_review');
    assert.equal(lookup1Data.order.maskedContact, 'w***r@institute.cn');
    assert.equal('contactValue' in lookup1Data.order, false);

    // Step 5: Unauthorized user cannot read customer orders or lookup with wrong token
    const badLookup = await fetch(`${instanceA.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNumber, queryToken: 'QK-2222-3333-4444' }),
    });
    assert.equal(badLookup.status, 404);
  } finally {
    await instanceA.close();
  }

  // Step 13 (File-backed repository restart simulation): Start Instance B after Instance A closed
  const instanceB = await startTestServer({ storageFile: sharedStorageFile, orderRateLimitMax: 500 });

  try {
    // Step 6-8: Admin verifies token, reads order list, transitions to pending_quote and then pending_payment with manualQuote
    const verifyRes = await fetch(`${instanceB.baseUrl}/api/admin/verify`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-admin-jwt' },
    });
    assert.equal(verifyRes.status, 200);

    const listRes = await fetch(`${instanceB.baseUrl}/api/admin/orders`, {
      headers: { Authorization: 'Bearer valid-admin-jwt' },
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    const adminOrder = listData.orders.find((o: any) => o.orderNumber === orderNumber);
    assert.ok(adminOrder);
    assert.equal(adminOrder.contactValue, 'wetland_researcher@institute.cn');

    // Transition to pending_quote
    const patchQuoteState = await fetch(`${instanceB.baseUrl}/api/admin/orders/${orderNumber}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-admin-jwt',
      },
      body: JSON.stringify({
        status: 'pending_quote',
        adminNotes: '已核对哨兵二号无云景数',
      }),
    });
    assert.equal(patchQuoteState.status, 200);

    // Transition to pending_payment with manualQuote = 880
    const patchQuotePrice = await fetch(`${instanceB.baseUrl}/api/admin/orders/${orderNumber}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-admin-jwt',
      },
      body: JSON.stringify({
        status: 'pending_payment',
        manualQuote: 880,
        clientNotes: '已完成波段评估，人工确认报价为 880 元。',
      }),
    });
    assert.equal(patchQuotePrice.status, 200);

    // Step 9: Customer sees updated manualQuote (880)
    const lookup2 = await fetch(`${instanceB.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNumber, queryToken }),
    });
    assert.equal(lookup2.status, 200);
    const lookup2Data = await lookup2.json();
    assert.equal(lookup2Data.order.status, 'pending_payment');
    assert.equal(lookup2Data.order.manualQuote, 880);

    // Step 10-11: Admin updates status to in_progress -> customer sees in_progress
    const patchInProgress = await fetch(`${instanceB.baseUrl}/api/admin/orders/${orderNumber}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-admin-jwt',
      },
      body: JSON.stringify({
        status: 'in_progress',
        clientNotes: '已启动影像大气校正与NDVI提取。',
      }),
    });
    assert.equal(patchInProgress.status, 200);

    const lookup3 = await fetch(`${instanceB.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNumber, queryToken }),
    });
    assert.equal(lookup3.status, 200);
    assert.equal((await lookup3.json()).order.status, 'in_progress');

    // Step 12: Rotate queryToken -> old token invalidated, new token works
    const rotateRes = await fetch(
      `${instanceB.baseUrl}/api/admin/orders/${orderNumber}/rotate-token`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-admin-jwt' },
      }
    );
    assert.equal(rotateRes.status, 200);
    const { newQueryToken } = await rotateRes.json();

    const oldLookup = await fetch(`${instanceB.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNumber, queryToken }),
    });
    assert.equal(oldLookup.status, 404);

    const newLookup = await fetch(`${instanceB.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNumber, queryToken: newQueryToken }),
    });
    assert.equal(newLookup.status, 200);

    // Verify CSV export formula injection protection
    const csvRes = await fetch(`${instanceB.baseUrl}/api/admin/export-csv`, {
      headers: { Authorization: 'Bearer valid-admin-jwt' },
    });
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('"\'+鄱阳湖保护区"'));

    // Step 14: Database disconnected / failure -> explicit HTTP 503 (never returns fake 201 success)
    instanceB.repo.setSimulateFailure(true);
    const dbFailRes = await fetch(`${instanceB.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceType: 'thematic_map',
        title: '数据库断开测试',
        description: '验证数据库断开时返回503，绝不返回假成功。',
        contactMethod: 'email',
        contactValue: 'dbfail@example.com',
        agreePrivacy: true,
      }),
    });
    assert.equal(dbFailRes.status, 503);
  } finally {
    await instanceB.close();
    if (fs.existsSync(sharedStorageFile)) fs.unlinkSync(sharedStorageFile);
  }
});

test('Environment & Config Hardening: Missing QUERY_TOKEN_PEPPER Diagnostic and TRUST_PROXY Hop Parsing', async () => {
  // 1. Verify TRUST_PROXY hop parsing never trusts spoofed leftmost X-Forwarded-For
  const mockReq = {
    headers: {
      'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.88',
    },
    socket: {
      remoteAddress: '10.0.0.5',
    },
  } as any;

  assert.equal(resolveTrustedProxyHops(false), 0);
  assert.equal(getClientIp(mockReq, false), '10.0.0.5', 'When trustProxy=0, X-Forwarded-For must be ignored');
  assert.equal(getClientIp(mockReq, 1), '203.0.113.88', 'When trustProxy=1 (e.g. Cloud Run GFE), must read rightmost proxy-appended IP, ignoring spoofed 1.1.1.1');
  assert.equal(getClientIp(mockReq, 2), '2.2.2.2');

  // 2. Verify missing or placeholder QUERY_TOKEN_PEPPER fails explicitly with 503
  const tmpFile = path.join(os.tmpdir(), `geo-test-pepper-${Date.now()}.json`);
  const srv = await startTestServer({ storageFile: tmpFile });
  const savedPepper = process.env.QUERY_TOKEN_PEPPER;

  try {
    for (const badPepper of ['', 'geospatial-studio-v2-token-pepper', 'replace-with-32-byte-random-secret-in-production', 'short123']) {
      process.env.QUERY_TOKEN_PEPPER = badPepper;
      const res = await fetch(`${srv.baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceType: 'thematic_map',
          title: '测试缺少Pepper时显式报错',
          description: '验证绝不使用硬编码默认Pepper',
          contactMethod: 'email',
          contactValue: 'pepper_test@example.com',
          agreePrivacy: true,
        }),
      });
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.ok(
        data.code === 'CONFIG_MISSING_QUERY_TOKEN_PEPPER' ||
          data.code === 'CONFIG_WEAK_QUERY_TOKEN_PEPPER'
      );
    }
  } finally {
    process.env.QUERY_TOKEN_PEPPER = savedPepper;
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
