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
  getServerAdminUidWhitelist,
  diagnoseAdminUidWhitelist,
} from '../server/api.ts';
import {
  IsolatedTestOrderRepository,
  OrderService,
  verifyFirebaseConfigConsistency,
  clearL1RateLimitCacheForTests,
} from '../server/order-service.ts';
import { generateClientIdempotencyKey, OrderItem } from '../utils/order-utils.ts';
import { getFirebaseServerConfig } from '../config/firebase-server.ts';

process.env.NODE_ENV = 'test';
process.env.IGNORE_LOCAL_FIREBASE_CONFIG_FILE = 'true';
process.env.FIREBASE_PROJECT_ID = 'demo-geospatial-studio-test';
process.env.VITE_FIREBASE_PROJECT_ID = 'demo-geospatial-studio-test';
process.env.FIRESTORE_DATABASE_ID = 'ai-studio-isolated-test-db';
process.env.VITE_FIREBASE_DATABASE_ID = 'ai-studio-isolated-test-db';
process.env.FIREBASE_AUTH_DOMAIN = 'demo-geospatial-studio-test.firebaseapp.com';
process.env.VITE_FIREBASE_AUTH_DOMAIN = 'demo-geospatial-studio-test.firebaseapp.com';
process.env.QUERY_TOKEN_PEPPER = crypto.randomBytes(32).toString('hex');

const ADMIN_UID = 'verified-studio-admin-uid-2026-prod-length';

const mockTokenVerifier: TokenVerifierFn = async (token: string) => {
  if (token !== 'valid-admin-jwt') {
    throw new Error('invalid token');
  }
  return {
    uid: ADMIN_UID,
    email: 'admin@example.com',
    aud: process.env.FIREBASE_PROJECT_ID,
    iss: `https://securetoken.google.com/${process.env.FIREBASE_PROJECT_ID}`,
    sub: ADMIN_UID,
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 3600,
  } as any;
};

async function startTestServer(storageFile: string) {
  clearL1RateLimitCacheForTests();
  const repo = new IsolatedTestOrderRepository(storageFile);
  const service = new OrderService(repo);
  const app = express();
  app.use(
    '/api',
    createApiRouter({
      orderService: service,
      tokenVerifier: mockTokenVerifier,
      adminUidWhitelist: [ADMIN_UID],
      orderRateLimitMax: 100,
      lookupRateLimitMax: 100,
    })
  );
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    repo,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('[P0] Empty JSON body and malformed JSON return structured errors without hanging', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-body-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);

  try {
    const emptyBody = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(emptyBody.status, 400);
    const emptyData = await emptyBody.json();
    assert.equal(emptyData.code, 'VALIDATION_FAILED');

    const malformed = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(malformed.status, 400);
    assert.match(malformed.headers.get('content-type') || '', /application\/json/);
    const malformedData = await malformed.json();
    assert.equal(malformedData.code, 'INVALID_JSON');
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[P1] Admin anonymization clears customer text/contact and invalidates the token', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-anonymize-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);

  try {
    const createRes = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': generateClientIdempotencyKey(),
      },
      body: JSON.stringify({
        serviceType: 'remote_sensing',
        title: '客户要求日后匿名化的测试工单',
        description: '这是一条包含客户研究区与联系方式的需求详述。',
        studyArea: '某敏感研究区',
        dataFormats: 'GeoTIFF',
        budgetRange: '500-1500',
        contactMethod: 'email',
        contactValue: 'privacy_customer@example.com',
        agreePrivacy: true,
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    const rawBefore = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.ok(rawBefore);
    assert.ok(rawBefore.privacyConsentAt);
    assert.ok(rawBefore.privacyConsentVersion);

    const anonymizeRes = await fetch(
      `${srv.baseUrl}/api/admin/orders/${created.orderNumber}/anonymize`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-admin-jwt' },
      }
    );
    assert.equal(anonymizeRes.status, 200);
    const anonymizeData = await anonymizeRes.json();
    assert.equal(anonymizeData.success, true);

    const rawAfter = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.ok(rawAfter);
    assert.equal(rawAfter.contactValue, '***');
    assert.equal(rawAfter.title, '已匿名化工单');
    assert.equal(rawAfter.studyArea, '未指定特定区域');
    assert.equal(rawAfter.adminNotes, '');
    assert.equal(rawAfter.queryTokenHash, undefined);

    const oldLookup = await fetch(`${srv.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: created.orderNumber,
        queryToken: created.queryToken,
      }),
    });
    assert.equal(oldLookup.status, 404);
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[P1] ADMIN_UIDS has no hardcoded fallback and diagnostics report rejected entries', () => {
  const saved = process.env.ADMIN_UIDS;
  try {
    process.env.ADMIN_UIDS = '';
    assert.equal(getServerAdminUidWhitelist().size, 0);
    const emptyDiag = diagnoseAdminUidWhitelist();
    assert.ok(emptyDiag.warnings.some((w) => w.includes('尚未配置')));

    process.env.ADMIN_UIDS = 'yeston463';
    assert.equal(getServerAdminUidWhitelist().size, 0);
    const badDiag = diagnoseAdminUidWhitelist();
    assert.ok(badDiag.warnings.some((w) => w.includes('未被接受')));

    process.env.ADMIN_UIDS = ADMIN_UID;
    assert.deepEqual([...getServerAdminUidWhitelist()], [ADMIN_UID]);
  } finally {
    if (saved === undefined) delete process.env.ADMIN_UIDS;
    else process.env.ADMIN_UIDS = saved;
  }
});

test('[P1] Production requires an explicit Firestore database ID and custom auth domains are accepted', () => {
  const keys = [
    'NODE_ENV',
    'FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_PROJECT_ID',
    'FIRESTORE_DATABASE_ID',
    'VITE_FIREBASE_DATABASE_ID',
    'FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_AUTH_DOMAIN',
  ] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.FIRESTORE_DATABASE_ID;
    delete process.env.VITE_FIREBASE_DATABASE_ID;
    assert.throws(
      () => getFirebaseServerConfig(),
      (err: any) => err?.code === 'CONFIG_MISSING_FIRESTORE_DATABASE_ID'
    );

    process.env.NODE_ENV = 'test';
    process.env.FIREBASE_PROJECT_ID = 'demo-geospatial-studio-test';
    process.env.VITE_FIREBASE_PROJECT_ID = 'demo-geospatial-studio-test';
    process.env.FIRESTORE_DATABASE_ID = 'ai-studio-isolated-test-db';
    process.env.VITE_FIREBASE_DATABASE_ID = 'ai-studio-isolated-test-db';
    process.env.FIREBASE_AUTH_DOMAIN = 'auth.example.com';
    process.env.VITE_FIREBASE_AUTH_DOMAIN = 'auth.example.com';
    assert.equal(verifyFirebaseConfigConsistency().consistent, true);

    process.env.FIREBASE_AUTH_DOMAIN = 'other-project.firebaseapp.com';
    process.env.VITE_FIREBASE_AUTH_DOMAIN = 'other-project.firebaseapp.com';
    const mismatched = verifyFirebaseConfigConsistency();
    assert.equal(mismatched.consistent, false);
    assert.match(mismatched.mismatchReason || '', /does not match projectId/);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test('[P1] importOrderAtomic is create/skip/update idempotent for migration', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-import-${Date.now()}.json`);
  const repo = new IsolatedTestOrderRepository(tmpFile);
  const base: OrderItem = {
    id: 'ord-migration-1',
    orderNumber: 'GEO-20261031-MIGR01',
    serviceType: 'thematic_map',
    title: '迁移样例',
    description: '迁移样例描述文本',
    studyArea: '测试区',
    dataFormats: 'SHP',
    budgetRange: '200-500',
    expectedDeliveryDate: '2026-12-01',
    contactMethod: 'email',
    contactValue: 'migrate@example.com',
    status: 'pending_review',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
  };

  try {
    assert.equal(await repo.importOrderAtomic(base), 'created');
    assert.equal(await repo.importOrderAtomic({ ...base, title: '旧版本' }), 'skipped');
    assert.equal(
      await repo.importOrderAtomic({
        ...base,
        title: '新版本',
        updatedAt: '2026-10-30T00:00:00.000Z',
      }),
      'updated'
    );
    const stored = await repo.getOrderByNumber(base.orderNumber);
    assert.equal(stored?.title, '新版本');
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[P2] New order notification posts a masked payload to the webhook', async () => {
  let resolveNotification!: () => void;
  const received = new Promise<void>((resolve) => {
    resolveNotification = resolve;
  });
  let payload: any = null;

  const hook = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        payload = JSON.parse(body);
      } catch {
        payload = null;
      }
      res.statusCode = 204;
      res.end();
      resolveNotification();
    });
  });
  await new Promise<void>((resolve) => hook.listen(0, '127.0.0.1', resolve));
  const hookPort = (hook.address() as { port: number }).port;

  const savedUrl = process.env.ORDER_NOTIFICATION_WEBHOOK_URL;
  process.env.ORDER_NOTIFICATION_WEBHOOK_URL = `http://127.0.0.1:${hookPort}/notify`;

  const tmpFile = path.join(os.tmpdir(), `geo-test-notify-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);

  try {
    const res = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': generateClientIdempotencyKey(),
      },
      body: JSON.stringify({
        serviceType: 'thematic_map',
        title: '通知测试工单',
        description: '验证新工单 webhook 通知携带脱敏联系方式。',
        contactMethod: 'email',
        contactValue: 'notify_customer@example.com',
        agreePrivacy: true,
      }),
    });
    assert.equal(res.status, 201);

    await Promise.race([
      received,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('webhook was not called')), 3000)
      ),
    ]);
    assert.equal(payload.event, 'order.created');
    assert.equal(payload.maskedContact, 'n***r@example.com');
    assert.equal(payload.contactValue, undefined);
  } finally {
    if (savedUrl === undefined) delete process.env.ORDER_NOTIFICATION_WEBHOOK_URL;
    else process.env.ORDER_NOTIFICATION_WEBHOOK_URL = savedUrl;
    await srv.close();
    await new Promise<void>((resolve) => hook.close(() => resolve()));
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
