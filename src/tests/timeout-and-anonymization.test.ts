import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApiRouter, TokenVerifierFn } from '../server/api.ts';
import {
  DatabaseUnavailableError,
  IsolatedTestOrderRepository,
  OrderService,
  clearL1RateLimitCacheForTests,
  hashQueryToken,
  withTimeout,
} from '../server/order-service.ts';
import {
  ROTATION_HISTORY_LIMIT,
  generateClientIdempotencyKey,
} from '../utils/order-utils.ts';

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

async function createOrder(baseUrl: string, title: string, adminNotes?: string) {
  const res = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': generateClientIdempotencyKey(),
    },
    body: JSON.stringify({
      serviceType: 'thematic_map',
      title,
      description: '验证超时结果未知与匿名化并发保护的测试需求描述。',
      studyArea: '测试研究区',
      budgetRange: '200-500',
      contactMethod: 'email',
      contactValue: 'timeout_customer@example.com',
      agreePrivacy: true,
    }),
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  if (adminNotes !== undefined) {
    const patch = await fetch(`${baseUrl}/api/admin/orders/${data.orderNumber}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-admin-jwt',
      },
      body: JSON.stringify({ status: 'pending_review', adminNotes }),
    });
    assert.equal(patch.status, 200);
  }
  return data;
}

test('[Timeout] a late commit is reported as unknown outcome, not as a rollback', async () => {
  const savedTimeout = process.env.FIRESTORE_OPERATION_TIMEOUT_MS;
  process.env.FIRESTORE_OPERATION_TIMEOUT_MS = '30';

  try {
    let lateState = 'pending';
    const lateCommit = new Promise<string>((resolve) => {
      setTimeout(() => {
        lateState = 'committed';
        resolve('committed');
      }, 80);
    });

    await assert.rejects(
      withTimeout(lateCommit, 'test-write-op', 'write'),
      (err: any) =>
        err instanceof DatabaseUnavailableError &&
        err.code === 'DATABASE_TIMEOUT_OUTCOME_UNKNOWN' &&
        err.outcomeUnknown === true &&
        !/未保存|未写入/.test(err.message),
      'a timed-out write must not claim the data was discarded'
    );

    // The underlying operation still runs to completion: the deadline only bounds
    // the caller's wait, it never cancels or rolls back the transaction.
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(lateState, 'committed');

    let readLate = 'pending';
    const lateRead = new Promise<string>((resolve) => {
      setTimeout(() => {
        readLate = 'done';
        resolve('done');
      }, 80);
    });
    await assert.rejects(
      withTimeout(lateRead, 'test-read-op', 'read'),
      (err: any) =>
        err.code === 'DATABASE_TIMEOUT' && err.outcomeUnknown === false,
      'reads keep the plain timeout code'
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(readLate, 'done');
  } finally {
    if (savedTimeout === undefined) delete process.env.FIRESTORE_OPERATION_TIMEOUT_MS;
    else process.env.FIRESTORE_OPERATION_TIMEOUT_MS = savedTimeout;
  }
});

test('[Rotation] the same rotation key replays one result instead of rotating twice', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-rotate-idem-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);

  try {
    const created = await createOrder(srv.baseUrl, '凭证轮换幂等测试工单');
    const rotationKey = generateClientIdempotencyKey();

    const first = await fetch(
      `${srv.baseUrl}/api/admin/orders/${created.orderNumber}/rotate-token`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-admin-jwt',
          'X-Idempotency-Key': rotationKey,
        },
      }
    );
    assert.equal(first.status, 200);
    const firstData = await first.json();
    assert.equal(firstData.rotationStatus, 'ROTATED');
    assert.match(firstData.newQueryToken, /^QK-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    assert.notEqual(firstData.newQueryToken, created.queryToken);

    const hashAfterFirst = (await srv.repo.getOrderByNumber(created.orderNumber))?.queryTokenHash;

    const retry = await fetch(
      `${srv.baseUrl}/api/admin/orders/${created.orderNumber}/rotate-token`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-admin-jwt',
          'X-Idempotency-Key': rotationKey,
        },
      }
    );
    assert.equal(retry.status, 200);
    const retryData = await retry.json();
    assert.equal(retryData.rotationStatus, 'IDEMPOTENT_REPLAY');
    assert.equal(
      retryData.newQueryToken,
      firstData.newQueryToken,
      'retrying the same rotation key must recover the exact same token'
    );
    assert.equal(
      (await srv.repo.getOrderByNumber(created.orderNumber))?.queryTokenHash,
      hashAfterFirst,
      'the replay must not rotate a second time'
    );

    const recoveredLookup = await fetch(`${srv.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: created.orderNumber,
        queryToken: retryData.newQueryToken,
      }),
    });
    assert.equal(recoveredLookup.status, 200);

    const staleTokenLookup = await fetch(`${srv.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNumber: created.orderNumber, queryToken: created.queryToken }),
    });
    assert.equal(staleTokenLookup.status, 404);

    const otherKey = await fetch(
      `${srv.baseUrl}/api/admin/orders/${created.orderNumber}/rotate-token`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-admin-jwt',
          'X-Idempotency-Key': generateClientIdempotencyKey(),
        },
      }
    );
    assert.equal(otherKey.status, 200);
    const otherKeyData = await otherKey.json();
    assert.equal(otherKeyData.rotationStatus, 'ROTATED');
    assert.notEqual(otherKeyData.newQueryToken, firstData.newQueryToken);
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[Rotation] a committed-but-lost rotation is recovered by retrying the same key', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-rotate-lost-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);

  try {
    const created = await createOrder(srv.baseUrl, '响应丢失后的凭证恢复测试工单');
    const rotationKey = generateClientIdempotencyKey();

    // Model the real failure: the write commits, but the caller only sees a timeout.
    srv.repo.setSimulateOutcomeUnknownOnce(true);
    const lost = await fetch(
      `${srv.baseUrl}/api/admin/orders/${created.orderNumber}/rotate-token`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-admin-jwt',
          'X-Idempotency-Key': rotationKey,
        },
      }
    );
    assert.equal(lost.status, 503);
    const lostData = await lost.json();
    assert.equal(lostData.code, 'DATABASE_TIMEOUT_OUTCOME_UNKNOWN');
    assert.equal(lostData.outcomeUnknown, true);
    assert.equal(lostData.retryable, true);

    const committed = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.ok(committed?.queryTokenHash, 'the rotation actually committed despite the error');

    const staleLookup = await fetch(`${srv.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNumber: created.orderNumber, queryToken: created.queryToken }),
    });
    assert.equal(staleLookup.status, 404, 'the old token is already invalid');

    const retry = await fetch(
      `${srv.baseUrl}/api/admin/orders/${created.orderNumber}/rotate-token`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-admin-jwt',
          'X-Idempotency-Key': rotationKey,
        },
      }
    );
    assert.equal(retry.status, 200);
    const retryData = await retry.json();
    assert.equal(retryData.rotationStatus, 'IDEMPOTENT_REPLAY');
    assert.equal(
      (await srv.repo.getOrderByNumber(created.orderNumber))?.queryTokenHash,
      committed?.queryTokenHash,
      'recovery must not rotate again'
    );

    const lookup = await fetch(`${srv.baseUrl}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: created.orderNumber,
        queryToken: retryData.newQueryToken,
      }),
    });
    assert.equal(lookup.status, 200, 'the recovered token must work for the customer');
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[Anonymization] a stale admin update cannot restore cleared customer data', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-anon-stale-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);
  const staleNotes = '内部备注：客户手机 13800000000，微信 gis_client_88';

  try {
    const created = await createOrder(srv.baseUrl, '匿名化并发测试工单', staleNotes);
    const rawBefore = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(rawBefore?.adminNotes, staleNotes);

    const anonymize = await fetch(
      `${srv.baseUrl}/api/admin/orders/${created.orderNumber}/anonymize`,
      { method: 'POST', headers: { Authorization: 'Bearer valid-admin-jwt' } }
    );
    assert.equal(anonymize.status, 200);
    const anonymizeData = await anonymize.json();
    assert.equal(anonymizeData.success, true);
    assert.equal(anonymizeData.alreadyAnonymized, false);

    // A PATCH that was opened before anonymization and lands afterwards.
    const stalePatch = await fetch(
      `${srv.baseUrl}/api/admin/orders/${created.orderNumber}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-admin-jwt',
        },
        body: JSON.stringify({ status: 'pending_review', adminNotes: staleNotes }),
      }
    );
    assert.equal(stalePatch.status, 400);
    const stalePatchData = await stalePatch.json();
    assert.equal(stalePatchData.code, 'INVALID_ORDER_UPDATE');
    assert.match(stalePatchData.message, /已匿名化/);

    const rawAfter = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(rawAfter?.adminNotes, '', 'the cleared internal note must stay cleared');
    assert.equal(rawAfter?.contactValue, '***');
    assert.equal(rawAfter?.title, '已匿名化工单');
    assert.ok(rawAfter?.anonymizedAt);
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[Anonymization] retrying anonymize is idempotent and blocks later token rotation', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-anon-retry-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);

  try {
    const created = await createOrder(srv.baseUrl, '匿名化重试测试工单', '待清除的内部备注');

    const first = await fetch(
      `${srv.baseUrl}/api/admin/orders/${created.orderNumber}/anonymize`,
      { method: 'POST', headers: { Authorization: 'Bearer valid-admin-jwt' } }
    );
    assert.equal(first.status, 200);
    assert.equal((await first.json()).alreadyAnonymized, false);

    const updatedAtAfterFirst = (await srv.repo.getOrderByNumber(created.orderNumber))?.updatedAt;

    const retry = await fetch(
      `${srv.baseUrl}/api/admin/orders/${created.orderNumber}/anonymize`,
      { method: 'POST', headers: { Authorization: 'Bearer valid-admin-jwt' } }
    );
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).alreadyAnonymized, true);
    assert.equal(
      (await srv.repo.getOrderByNumber(created.orderNumber))?.updatedAt,
      updatedAtAfterFirst,
      'the retry must not rewrite the anonymized record'
    );

    const rotate = await fetch(
      `${srv.baseUrl}/api/admin/orders/${created.orderNumber}/rotate-token`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-admin-jwt',
          'X-Idempotency-Key': generateClientIdempotencyKey(),
        },
      }
    );
    assert.equal(rotate.status, 400);
    const rotateData = await rotate.json();
    assert.equal(rotateData.code, 'ROTATE_NOT_ALLOWED');
    assert.match(rotateData.message, /已匿名化/);
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

async function rotateToken(
  baseUrl: string,
  orderNumber: string,
  rotationKey?: string
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${baseUrl}/api/admin/orders/${orderNumber}/rotate-token`, {
    method: 'POST',
    headers: {
      ...(rotationKey ? { 'X-Idempotency-Key': rotationKey } : {}),
      Authorization: 'Bearer valid-admin-jwt',
    },
  });
  return { status: res.status, data: await res.json() };
}

async function lookupStatus(
  baseUrl: string,
  orderNumber: string,
  queryToken: string
): Promise<number> {
  const res = await fetch(`${baseUrl}/api/orders/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderNumber, queryToken }),
  });
  return res.status;
}

test('[Rotation] A → retry A: same credential, order state untouched', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-rotate-replay-a-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);

  try {
    const created = await createOrder(srv.baseUrl, '轮换重放A测试工单');
    const keyA = generateClientIdempotencyKey();

    const first = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(first.status, 200);
    assert.equal(first.data.rotationStatus, 'ROTATED');
    assert.equal(first.data.rotationVersion, 1);

    const afterFirst = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(afterFirst?.rotationVersion, 1);
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, first.data.newQueryToken), 200);

    const retry = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.rotationStatus, 'IDEMPOTENT_REPLAY');
    assert.equal(retry.data.rotationVersion, 1, 'a replay must not open a new rotation version');
    assert.equal(
      retry.data.newQueryToken,
      first.data.newQueryToken,
      'a replay must recover the exact credential it already issued'
    );

    const afterRetry = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(afterRetry?.queryTokenHash, afterFirst?.queryTokenHash);
    assert.equal(afterRetry?.rotationVersion, afterFirst?.rotationVersion);
    assert.deepEqual(afterRetry?.rotationHistory, afterFirst?.rotationHistory);
    assert.equal(
      afterRetry?.updatedAt,
      afterFirst?.updatedAt,
      'a replay must not change the order update time'
    );
    assert.equal(
      afterRetry?.queryTokenUpdatedAt,
      afterFirst?.queryTokenUpdatedAt,
      'a replay must not change the credential issue time'
    );
    assert.notEqual(afterRetry?.queryTokenHash, undefined);
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, retry.data.newQueryToken), 200);
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[Rotation] A → B → retry A: refused, B stays valid and A stays revoked', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-rotate-superseded-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);

  try {
    const created = await createOrder(srv.baseUrl, '轮换被取代测试工单');
    const keyA = generateClientIdempotencyKey();
    const keyB = generateClientIdempotencyKey();

    const a = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(a.status, 200);
    assert.equal(a.data.rotationStatus, 'ROTATED');

    const b = await rotateToken(srv.baseUrl, created.orderNumber, keyB);
    assert.equal(b.status, 200);
    assert.equal(b.data.rotationStatus, 'ROTATED');
    assert.notEqual(b.data.newQueryToken, a.data.newQueryToken);
    assert.equal(b.data.rotationVersion, 2);

    const stateAfterB = await srv.repo.getOrderByNumber(created.orderNumber);

    const replayA = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(replayA.status, 409, 'a superseded rotation key must be refused, not replayed');
    assert.equal(replayA.data.code, 'ROTATION_SUPERSEDED');
    assert.equal(replayA.data.rotationStatus, 'SUPERSEDED');
    assert.equal(replayA.data.success, false);
    assert.ok(
      !('newQueryToken' in replayA.data),
      'a refused rotation must not deliver any credential'
    );
    assert.match(replayA.data.message, /取代/);

    const stateAfterRefusal = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(
      stateAfterRefusal?.queryTokenHash,
      stateAfterB?.queryTokenHash,
      'the refusal must not rewrite the current credential'
    );
    assert.equal(stateAfterRefusal?.rotationVersion, 2, 'the refusal must not open a version');
    assert.equal(stateAfterRefusal?.updatedAt, stateAfterB?.updatedAt);

    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, b.data.newQueryToken), 200);
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, a.data.newQueryToken), 404);
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, created.queryToken), 404);

    // The refused attempt leaves the rotation ledger usable for a new operation.
    const c = await rotateToken(srv.baseUrl, created.orderNumber, generateClientIdempotencyKey());
    assert.equal(c.status, 200);
    assert.equal(c.data.rotationStatus, 'ROTATED');
    assert.equal(c.data.rotationVersion, 3);
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, c.data.newQueryToken), 200);

    // Repeating the refusal is stable and never becomes a replay.
    const replayAAgain = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(replayAAgain.status, 409);
    assert.equal(replayAAgain.data.rotationStatus, 'SUPERSEDED');
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[Rotation] A committed but lost, then B: retrying A must not overwrite B', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-rotate-lost-then-b-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);

  try {
    const created = await createOrder(srv.baseUrl, '丢失响应后被取代测试工单');
    const keyA = generateClientIdempotencyKey();
    const keyB = generateClientIdempotencyKey();

    srv.repo.setSimulateOutcomeUnknownOnce(true);
    const lostA = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(lostA.status, 503);
    assert.equal(lostA.data.code, 'DATABASE_TIMEOUT_OUTCOME_UNKNOWN');
    assert.equal(lostA.data.outcomeUnknown, true);

    const committedA = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(committedA?.rotationVersion, 1, 'A really committed behind the lost response');

    const b = await rotateToken(srv.baseUrl, created.orderNumber, keyB);
    assert.equal(b.status, 200);
    assert.equal(b.data.rotationStatus, 'ROTATED');
    assert.equal(b.data.rotationVersion, 2);
    const stateAfterB = await srv.repo.getOrderByNumber(created.orderNumber);

    // The admin now retries the timed-out request A, which must never win over B.
    const retryA = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(retryA.status, 409);
    assert.equal(retryA.data.code, 'ROTATION_SUPERSEDED');
    assert.ok(!('newQueryToken' in retryA.data));

    const stateAfterRetryA = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(
      stateAfterRetryA?.queryTokenHash,
      stateAfterB?.queryTokenHash,
      'the delayed A retry must not overwrite B'
    );
    assert.equal(stateAfterRetryA?.rotationVersion, 2);
    assert.equal(stateAfterRetryA?.updatedAt, stateAfterB?.updatedAt);
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, b.data.newQueryToken), 200);
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[Rotation] concurrent retries of one key perform exactly one effective rotation', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-rotate-concurrent-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);

  try {
    const created = await createOrder(srv.baseUrl, '轮换并发测试工单');
    const keyA = generateClientIdempotencyKey();

    const results = await Promise.all([
      rotateToken(srv.baseUrl, created.orderNumber, keyA),
      rotateToken(srv.baseUrl, created.orderNumber, keyA),
      rotateToken(srv.baseUrl, created.orderNumber, keyA),
    ]);

    for (const r of results) assert.equal(r.status, 200);
    const statuses = results.map((r) => r.data.rotationStatus).sort();
    assert.deepEqual(statuses, [
      'IDEMPOTENT_REPLAY',
      'IDEMPOTENT_REPLAY',
      'ROTATED',
    ]);

    const tokens = new Set(results.map((r) => r.data.newQueryToken));
    assert.equal(tokens.size, 1, 'concurrent retries of one key must share one credential');

    const versions = new Set(results.map((r) => r.data.rotationVersion));
    assert.deepEqual([...versions], [1], 'exactly one rotation version was created');

    const state = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(state?.rotationVersion, 1);
    assert.equal(
      state?.rotationHistory?.length,
      1,
      'only the token replaced by the single effective rotation is archived'
    );
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, [...tokens][0]), 200);
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, created.queryToken), 404);
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[Rotation] a superseded key stays refused after its hash leaves the bounded history', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-rotate-history-evicted-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);

  try {
    const created = await createOrder(srv.baseUrl, '轮换记录留痕测试工单');
    const keyA = generateClientIdempotencyKey();

    const a = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(a.status, 200);

    // Push key A's hash out of the order's revoked-hash window, so only the durable
    // rotation record can still prove that A was superseded.
    let last = a;
    for (let i = 0; i < ROTATION_HISTORY_LIMIT + 2; i++) {
      last = await rotateToken(srv.baseUrl, created.orderNumber, generateClientIdempotencyKey());
      assert.equal(last.status, 200);
      assert.equal(last.data.rotationStatus, 'ROTATED');
    }

    const state = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(state?.rotationHistory?.length, ROTATION_HISTORY_LIMIT);
    const hashA = hashQueryToken(created.orderNumber, a.data.newQueryToken, process.env.QUERY_TOKEN_PEPPER!);
    assert.ok(
      !(state?.rotationHistory || []).includes(hashA),
      'the test must exercise the evicted-history path'
    );

    const replayA = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(replayA.status, 409);
    assert.equal(replayA.data.code, 'ROTATION_SUPERSEDED');
    assert.ok(!('newQueryToken' in replayA.data));

    const stateAfter = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(stateAfter?.queryTokenHash, state?.queryTokenHash);
    assert.equal(stateAfter?.rotationVersion, state?.rotationVersion);
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, a.data.newQueryToken), 404);
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, last.data.newQueryToken), 200);
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[Rotation] a rotation record that no longer matches the key config fails closed', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-rotate-pepper-mismatch-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);
  const savedPepper = process.env.QUERY_TOKEN_PEPPER;

  try {
    const created = await createOrder(srv.baseUrl, '轮换记录密钥不一致测试工单');
    const keyA = generateClientIdempotencyKey();

    const a = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(a.status, 200);
    const stateBefore = await srv.repo.getOrderByNumber(created.orderNumber);

    // Model a pepper change after the record was written: the derived credential no
    // longer matches the stored hash, so the server must refuse instead of guessing.
    process.env.QUERY_TOKEN_PEPPER = crypto.randomBytes(32).toString('hex');

    const mismatch = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(mismatch.status, 503);
    assert.equal(mismatch.data.code, 'ROTATION_RECORD_MISMATCH');
    assert.ok(!('newQueryToken' in mismatch.data), 'no credential may be delivered');

    const stateAfter = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(stateAfter?.queryTokenHash, stateBefore?.queryTokenHash);
    assert.equal(stateAfter?.rotationVersion, stateBefore?.rotationVersion);
    assert.equal(stateAfter?.updatedAt, stateBefore?.updatedAt);

    // Back to the key config that issued the current credential: it is still intact.
    process.env.QUERY_TOKEN_PEPPER = savedPepper;
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, a.data.newQueryToken), 200);
  } finally {
    process.env.QUERY_TOKEN_PEPPER = savedPepper;
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[Rotation] retrying an old rotation key after anonymization never delivers a credential', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-rotate-after-anon-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);

  try {
    const created = await createOrder(srv.baseUrl, '匿名化后轮换重试工单');
    const keyA = generateClientIdempotencyKey();

    const a = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(a.status, 200);
    assert.equal(a.data.rotationStatus, 'ROTATED');

    const anonymize = await fetch(
      `${srv.baseUrl}/api/admin/orders/${created.orderNumber}/anonymize`,
      { method: 'POST', headers: { Authorization: 'Bearer valid-admin-jwt' } }
    );
    assert.equal(anonymize.status, 200);

    const stateAfterAnon = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.ok(stateAfterAnon?.anonymizedAt);

    // The admin's client still holds the key from the delivered rotation A and retries it.
    const retryA = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(retryA.status, 400, 'an anonymized order cannot be re-credentialed');
    assert.equal(retryA.data.code, 'ROTATE_NOT_ALLOWED');
    assert.ok(!('newQueryToken' in retryA.data), 'no credential may be returned');
    assert.match(retryA.data.message, /已匿名化/);

    const retryFreshKey = await rotateToken(
      srv.baseUrl,
      created.orderNumber,
      generateClientIdempotencyKey()
    );
    assert.equal(retryFreshKey.status, 400);
    assert.equal(retryFreshKey.data.code, 'ROTATE_NOT_ALLOWED');

    const stateAfterRetries = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(stateAfterRetries?.queryTokenHash, stateAfterAnon?.queryTokenHash);
    assert.equal(stateAfterRetries?.rotationVersion, stateAfterAnon?.rotationVersion);
    assert.equal(
      stateAfterRetries?.updatedAt,
      stateAfterAnon?.updatedAt,
      'a rejected rotation must not touch the anonymized record'
    );
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, a.data.newQueryToken), 404);
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('[Rotation] TTL deleted record + history eviction + retry old key: refused as superseded, never resurrects old token', async () => {
  const tmpFile = path.join(os.tmpdir(), `geo-test-rotate-ttl-evicted-${Date.now()}.json`);
  const srv = await startTestServer(tmpFile);

  try {
    const created = await createOrder(srv.baseUrl, 'TTL删除与淘汰后重试旧键工单');
    const keyA = generateClientIdempotencyKey();

    // 1. Rotate with key A -> issues token A (version 1)
    const a = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(a.status, 200);
    assert.equal(a.data.rotationStatus, 'ROTATED');
    assert.equal(a.data.rotationVersion, 1);
    const tokenA = a.data.newQueryToken;

    // 2. Perform ROTATION_HISTORY_LIMIT + 2 rotations to evict key A's hash from rotationHistory
    let last = a;
    for (let i = 0; i < ROTATION_HISTORY_LIMIT + 2; i++) {
      last = await rotateToken(srv.baseUrl, created.orderNumber, generateClientIdempotencyKey());
      assert.equal(last.status, 200);
      assert.equal(last.data.rotationStatus, 'ROTATED');
    }

    const state = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(state?.rotationHistory?.length, ROTATION_HISTORY_LIMIT);
    const hashA = hashQueryToken(created.orderNumber, tokenA, process.env.QUERY_TOKEN_PEPPER!);
    assert.ok(
      !(state?.rotationHistory || []).includes(hashA),
      'token A hash must have been evicted from the bounded rotationHistory'
    );

    // 3. Simulate TTL deletion of key A's record from tokenRotations
    srv.repo.deleteRotationRecordForTests(created.orderNumber, keyA);

    // 4. Retry old key A: must be refused as superseded, must NOT return ROTATED,
    // must NOT resurrect token A, and must NOT invalidate latest credential.
    const retryA = await rotateToken(srv.baseUrl, created.orderNumber, keyA);
    assert.equal(retryA.status, 409, 'retrying old key after TTL + eviction must return 409');
    assert.equal(retryA.data.code, 'ROTATION_SUPERSEDED');
    assert.equal(retryA.data.rotationStatus, 'SUPERSEDED');
    assert.ok(!('newQueryToken' in retryA.data), 'must not deliver any credential');

    const stateAfterRetry = await srv.repo.getOrderByNumber(created.orderNumber);
    assert.equal(
      stateAfterRetry?.queryTokenHash,
      state?.queryTokenHash,
      'the retry must not touch the current queryTokenHash'
    );
    assert.equal(
      stateAfterRetry?.rotationVersion,
      state?.rotationVersion,
      'the retry must not increment rotationVersion'
    );
    assert.equal(
      stateAfterRetry?.updatedAt,
      state?.updatedAt,
      'the retry must not modify order updatedAt'
    );

    // Latest token remains valid, old token A remains revoked!
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, last.data.newQueryToken), 200);
    assert.equal(await lookupStatus(srv.baseUrl, created.orderNumber, tokenA), 404);
  } finally {
    await srv.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
