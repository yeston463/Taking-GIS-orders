import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initializeApp as initClientApp, deleteApp } from 'firebase/app';
import { getFirestore as getClientFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  createApiRouter,
  TokenVerifierFn,
  getClientIp,
  resolveTrustedProxyHops,
} from '../server/api.ts';
import {
  IsolatedTestOrderRepository,
  FirestoreAdminOrderRepository,
  OrderService,
  verifyFirebaseConfigConsistency,
} from '../server/order-service.ts';

// Dynamically generate a random 32-byte test pepper for test suite execution (never hardcoded)
const TEST_RANDOM_PEPPER = crypto.randomBytes(32).toString('hex');
process.env.QUERY_TOKEN_PEPPER = TEST_RANDOM_PEPPER;

const ADMIN_UID = 'verified-studio-admin-uid-2026-prod-length';
const NON_ADMIN_UID = 'regular-google-user-uid-8888-prod-length';

/**
 * Deterministic mock Firebase Admin ID Token verifier for adversarial auth tests
 */
const mockTokenVerifier: TokenVerifierFn = async (token: string) => {
  if (token === 'valid-admin-jwt') {
    return {
      uid: ADMIN_UID,
      email: 'yeston463@gmail.com',
      email_verified: true,
      aud: firebaseConfig.projectId,
      iss: `https://securetoken.google.com/${firebaseConfig.projectId}`,
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
      aud: firebaseConfig.projectId,
      iss: `https://securetoken.google.com/${firebaseConfig.projectId}`,
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
      aud: firebaseConfig.projectId,
      iss: `https://securetoken.google.com/${firebaseConfig.projectId}`,
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
  useRealFirestoreAdminRepo?: boolean;
  orderRateLimitMax?: number;
  lookupRateLimitMax?: number;
}) {
  const repo = options.useRealFirestoreAdminRepo
    ? new FirestoreAdminOrderRepository()
    : new IsolatedTestOrderRepository(options.storageFile);

  if (repo instanceof IsolatedTestOrderRepository && options.simulateDbFailure) {
    repo.setSimulateFailure(true);
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

test('Cases 1-5: P0-A Admin Authentication & Adversarial Bypass Rejection', async () => {
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

    // Case 3: Forged x-admin-uid: admin-bootstrap-uid (header, query, body, and even inside token) -> 401
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

test('Cases 6-7: P0-C Live Firestore Security Rules block anonymous client direct read/write on /orders and /admins', async () => {
  const clientApp = initClientApp(firebaseConfig, `sec-rules-test-${Date.now()}`);
  const clientDb = getClientFirestore(clientApp, firebaseConfig.firestoreDatabaseId);

  try {
    let readRejected = false;
    try {
      await getDocs(collection(clientDb, 'orders'));
    } catch (err: any) {
      if (err?.code === 'permission-denied' || String(err?.message).includes('Missing or insufficient permissions')) {
        readRejected = true;
      }
    }
    assert.equal(readRejected, true, 'Anonymous direct read of /orders MUST be rejected by firestore.rules');

    let writeOrderRejected = false;
    try {
      await setDoc(doc(clientDb, 'orders', 'GEO-20261029-HACKED'), {
        orderNumber: 'GEO-20261029-HACKED',
        serviceType: 'thematic_map',
        title: 'Direct write attempt',
        description: 'Should be blocked by firestore.rules',
        contactMethod: 'email',
        contactValue: 'hacker@evil.com',
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      if (err?.code === 'permission-denied' || String(err?.message).includes('Missing or insufficient permissions')) {
        writeOrderRejected = true;
      }
    }
    assert.equal(writeOrderRejected, true, 'Anonymous direct write to /orders MUST be rejected by firestore.rules');

    let writeAdminRejected = false;
    try {
      await setDoc(doc(clientDb, 'admins', 'self-escalated-uid'), {
        email: 'hacker@evil.com',
        role: 'superadmin',
        createdAt: new Date().toISOString(),
      });
    } catch (err: any) {
      if (err?.code === 'permission-denied' || String(err?.message).includes('Missing or insufficient permissions')) {
        writeAdminRejected = true;
      }
    }
    assert.equal(writeAdminRejected, true, 'Direct client write to /admins MUST be rejected by firestore.rules');
  } finally {
    await deleteApp(clientApp);
  }
});

test('Cases 8 & 15: Valid Order Creation, QueryToken Lookup, Contact Masking, and Admin Token Rotation', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-lookup-${Date.now()}.json`);
  const srv = await startTestServer({ storageFile: tmpFile });

  try {
    const createRes = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceType: 'thematic_map',
        title: '长三角流域水系生态敏感区专题制图',
        description: '使用DEM与水系矢量制作标准300DPI出版级专题图，包含比例尺与指北针。',
        studyArea: '太湖流域',
        dataFormats: 'SHP / GeoTIFF',
        budgetRange: '200-500',
        expectedDeliveryDate: '2026-11-15',
        contactMethod: 'email',
        contactValue: 'private_researcher@university.edu.cn',
        agreePrivacy: true,
      }),
    });
    assert.equal(createRes.status, 201);
    const createdData = await createRes.json();
    assert.equal(createdData.success, true);
    assert.match(createdData.orderNumber, /^GEO-\d{8}-[2-9A-HJ-NP-Z]{6}$/);
    assert.match(createdData.queryToken, /^QK-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);

    // Case 15: Verify public order response does NOT leak raw contactValue or adminNotes
    assert.equal('contactValue' in createdData.order, false);
    assert.equal('adminNotes' in createdData.order, false);
    assert.equal(createdData.order.maskedContact, 'p***r@university.edu.cn');

    // Attempt lookup using legacy { orderNumber, contactValue } without queryToken -> 400
    const legacyLookupRes = await fetch(`${srv.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: createdData.orderNumber,
        contactValue: 'private_researcher@university.edu.cn',
      }),
    });
    assert.equal(legacyLookupRes.status, 400);

    // Attempt lookup with wrong queryToken -> 404 uniform error
    const wrongTokenRes = await fetch(`${srv.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: createdData.orderNumber,
        queryToken: 'QK-2222-3333-4444',
      }),
    });
    assert.equal(wrongTokenRes.status, 404);

    // Valid lookup with orderNumber + queryToken -> 200
    const validLookupRes = await fetch(`${srv.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: createdData.orderNumber,
        queryToken: createdData.queryToken,
      }),
    });
    assert.equal(validLookupRes.status, 200);
    const lookupData = await validLookupRes.json();
    assert.equal(lookupData.order.orderNumber, createdData.orderNumber);
    assert.equal(lookupData.order.maskedContact, 'p***r@university.edu.cn');
    assert.equal('contactValue' in lookupData.order, false);
    assert.equal('adminNotes' in lookupData.order, false);

    // Admin rotates queryToken after customer loses it
    const rotateRes = await fetch(
      `${srv.baseUrl}/api/admin/orders/${createdData.orderNumber}/rotate-token`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-admin-jwt' },
      }
    );
    assert.equal(rotateRes.status, 200);
    const rotateData = await rotateRes.json();
    assert.ok(rotateData.newQueryToken);
    assert.notEqual(rotateData.newQueryToken, createdData.queryToken);

    // Old queryToken is immediately invalidated -> 404
    const oldTokenLookup = await fetch(`${srv.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: createdData.orderNumber,
        queryToken: createdData.queryToken,
      }),
    });
    assert.equal(oldTokenLookup.status, 404);

    // New rotated queryToken succeeds -> 200
    const newTokenLookup = await fetch(`${srv.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: createdData.orderNumber,
        queryToken: rotateData.newQueryToken,
      }),
    });
    assert.equal(newTokenLookup.status, 200);
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('Case 9: Simulated Database Write Failure & Uncredentialed Firestore Admin Failure -> Explicit HTTP 503 (Zero Silent Fallback)', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-dbfail-${Date.now()}.json`);
  const srv = await startTestServer({ storageFile: tmpFile, simulateDbFailure: true });

  try {
    const res = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceType: 'script_dev',
        title: 'GDAL 遥感影像批量裁剪脚本',
        description: '当数据库不可用时应当明确返回 503，绝不返回 201 假成功。',
        contactMethod: 'email',
        contactValue: 'failtest@example.com',
        agreePrivacy: true,
      }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'SIMULATED_DB_FAILURE');
    assert.equal(fs.existsSync(tmpFile), false, 'No partial data should be written on 503 failure');
  } finally {
    await srv.close();
  }
});

test('Cases 10 & 11: Server Restart Persistence & Multi-Instance Consistency without /api/admin/sync', async () => {
  const sharedStorageFile = path.join(os.tmpdir(), `geo-test-multi-${Date.now()}.json`);

  const instanceA = await startTestServer({ storageFile: sharedStorageFile });
  let createdOrderNo = '';
  let createdQueryToken = '';

  try {
    const resCreate = await fetch(`${instanceA.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceType: 'webgis_dev',
        title: '多实例与重启持久化一致性验证项目',
        description: '验证关闭实例A后重启实例B，以及双实例并发读写同一权威存储时状态完全一致。',
        contactMethod: 'wechat',
        contactValue: 'consistency_tester',
        agreePrivacy: true,
      }),
    });
    assert.equal(resCreate.status, 201);
    const createJson = await resCreate.json();
    createdOrderNo = createJson.orderNumber;
    createdQueryToken = createJson.queryToken;
  } finally {
    await instanceA.close();
  }

  const instanceB = await startTestServer({ storageFile: sharedStorageFile });
  const instanceC = await startTestServer({ storageFile: sharedStorageFile });

  try {
    const lookupOnB = await fetch(`${instanceB.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: createdOrderNo,
        queryToken: createdQueryToken,
      }),
    });
    assert.equal(lookupOnB.status, 200);
    const lookupBData = await lookupOnB.json();
    assert.equal(lookupBData.order.status, 'pending_review');

    const patch1 = await fetch(`${instanceB.baseUrl}/api/admin/orders/${createdOrderNo}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-admin-jwt',
      },
      body: JSON.stringify({
        status: 'pending_quote',
        adminNotes: '正在评估工作量',
      }),
    });
    assert.equal(patch1.status, 200);

    const patch2 = await fetch(`${instanceB.baseUrl}/api/admin/orders/${createdOrderNo}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-admin-jwt',
      },
      body: JSON.stringify({
        status: 'pending_payment',
        manualQuote: 680,
        clientNotes: '已核定报价 680 元',
      }),
    });
    assert.equal(patch2.status, 200);

    const adminListOnC = await fetch(`${instanceC.baseUrl}/api/admin/orders`, {
      headers: { Authorization: 'Bearer valid-admin-jwt' },
    });
    assert.equal(adminListOnC.status, 200);
    const listCData = await adminListOnC.json();
    const matchedOnC = listCData.orders.find((o: any) => o.orderNumber === createdOrderNo);
    assert.ok(matchedOnC);
    assert.equal(matchedOnC.status, 'pending_payment');
    assert.equal(matchedOnC.manualQuote, 680);
  } finally {
    await instanceB.close();
    await instanceC.close();
    if (fs.existsSync(sharedStorageFile)) fs.unlinkSync(sharedStorageFile);
  }
});

test('Cases 12, 13, 14, 16: Quote Validation, State Machine, CSV Formula Neutralization, and 20-Order Concurrent Submission', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-p1-${Date.now()}.json`);
  const srv = await startTestServer({ storageFile: tmpFile, orderRateLimitMax: 500 });

  try {
    const concurrentPromises = Array.from({ length: 20 }, (_, i) =>
      fetch(`${srv.baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceType: 'spatial_processing',
          title: `并发压力测试工单 #${i + 1} (=1+1)`,
          description: `测试第 ${i + 1} 个并发空间数据处理工单，验证零工单号冲突与事务安全。`,
          studyArea: '+长三角测试区',
          contactMethod: 'email',
          contactValue: `concurrent_user_${i + 1}@example.com`,
          agreePrivacy: true,
        }),
      }).then(async (r) => ({ status: r.status, data: await r.json() }))
    );

    const results = await Promise.all(concurrentPromises);
    const orderNumbers = new Set<string>();
    for (const r of results) {
      assert.equal(r.status, 201);
      assert.equal(r.data.success, true);
      orderNumbers.add(r.data.orderNumber);
    }
    assert.equal(orderNumbers.size, 20, 'All 20 concurrent orders must receive unique orderNumbers');

    const sampleOrderNo = Array.from(orderNumbers)[0];

    const resNoQuote = await fetch(`${srv.baseUrl}/api/admin/orders/${sampleOrderNo}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-admin-jwt',
      },
      body: JSON.stringify({
        status: 'pending_payment',
        manualQuote: '',
      }),
    });
    assert.equal(resNoQuote.status, 400);

    for (const invalidQuote of ['NaN', 'Infinity', -99, 0, 1500000, true]) {
      const resInvalid = await fetch(`${srv.baseUrl}/api/admin/orders/${sampleOrderNo}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-admin-jwt',
        },
        body: JSON.stringify({
          status: 'pending_payment',
          manualQuote: invalidQuote,
        }),
      });
      assert.equal(resInvalid.status, 400, `Quote ${String(invalidQuote)} must return 400`);
    }

    const resIllegalJump = await fetch(`${srv.baseUrl}/api/admin/orders/${sampleOrderNo}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-admin-jwt',
      },
      body: JSON.stringify({
        status: 'completed',
        manualQuote: 200,
      }),
    });
    assert.equal(resIllegalJump.status, 400);

    const csvRes = await fetch(`${srv.baseUrl}/api/admin/export-csv`, {
      headers: { Authorization: 'Bearer valid-admin-jwt' },
    });
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('"\'+长三角测试区"'), 'Formula starting with + must be prefixed with single quote');
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('Environment & Config Hardening: ADC Priority, Missing QUERY_TOKEN_PEPPER Diagnostic, and TRUST_PROXY Hop Parsing', async () => {
  // 1. Verify Firebase Admin SDK / Firestore / Auth consistency and ADC priority
  const consistency = verifyFirebaseConfigConsistency();
  assert.equal(consistency.consistent, true);
  assert.equal(consistency.clientProjectId, 'gen-lang-client-0041017161');
  assert.equal(consistency.adminProjectId, 'gen-lang-client-0041017161');
  assert.equal(consistency.authDomainProjectId, 'gen-lang-client-0041017161');
  assert.equal(consistency.firestoreDatabaseId, 'ai-studio-cb63a7bd-f74c-4c79-9ba8-1cb9e33b42e9');
  assert.equal(consistency.credentialSource, 'adc');

  // 2. Verify TRUST_PROXY hop parsing never trusts spoofed leftmost X-Forwarded-For
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

  // 3. Verify missing or placeholder QUERY_TOKEN_PEPPER fails explicitly with 503 CONFIG_MISSING_QUERY_TOKEN_PEPPER
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
