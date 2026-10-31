import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  getDocs,
  doc,
  setDoc,
} from 'firebase/firestore';

const ISOLATED_EMULATOR_PROJECT_ID = 'demo-geospatial-studio-test';
const FORBIDDEN_PROD_PROJECT_ID = 'gen-lang-client-0041017161';

/**
 * Verifies that a genuine Firebase Firestore Emulator is listening at host:port.
 * (Note: In some container environments port 8080 is used by an non-Firebase proxy,
 * whereas the real Firestore Emulator responds to HTTP GET / with "Ok".)
 */
async function isFirestoreEmulatorRunning(host: string, port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`http://${host}:${port}/`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const text = (await res.text()).trim();
    return text === 'Ok' || text.includes('firestore');
  } catch {
    return false;
  }
}

test('P0-B Static Policy Check: firestore.rules enforces zero-trust server-only access on /orders, /rateLimits, /idempotencyKeys', () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  assert.equal(fs.existsSync(rulesPath), true, 'firestore.rules must exist in repository root');
  const rulesText = fs.readFileSync(rulesPath, 'utf-8');

  assert.match(rulesText, /rules_version\s*=\s*'2';/);
  assert.match(
    rulesText,
    /match\s+\/orders\/\{\w+\}\s*\{[\s\S]*?allow\s+read,\s*write:\s*if\s+false;/
  );
  assert.match(
    rulesText,
    /match\s+\/rateLimits\/\{\w+\}\s*\{[\s\S]*?allow\s+read,\s*write:\s*if\s+false;/
  );
  assert.match(
    rulesText,
    /match\s+\/idempotencyKeys\/\{\w+\}\s*\{[\s\S]*?allow\s+read,\s*write:\s*if\s+false;/
  );
  assert.match(
    rulesText,
    /match\s+\/admins\/\{\w+\}\s*\{[\s\S]*?allow\s+create,\s*update,\s*delete:\s*if\s+false;/
  );
});

test('P0-B Isolated Firestore Emulator Security Rules Verification (Never connects to production Firestore)', async (t) => {
  const activeProjectId = process.env.FIREBASE_PROJECT_ID || ISOLATED_EMULATOR_PROJECT_ID;
  assert.notEqual(
    activeProjectId,
    FORBIDDEN_PROD_PROJECT_ID,
    'CRITICAL: Security rules test is strictly forbidden from targeting production project gen-lang-client-0041017161'
  );

  const emulatorHostEnv = (process.env.FIRESTORE_EMULATOR_HOST || '').trim();
  const [host, portStr] = (emulatorHostEnv || '127.0.0.1:8080').split(':');
  const port = parseInt(portStr || '8080', 10);

  const emulatorActive = emulatorHostEnv
    ? await isFirestoreEmulatorRunning(host, port)
    : false;

  if (!emulatorActive) {
    // Requirement P0-B.5: When Emulator is unavailable, explicitly mark BLOCKED and NEVER fall back to live production database!
    t.diagnostic(
      `BLOCKED: Firebase Firestore Emulator is not active (FIRESTORE_EMULATOR_HOST=${
        emulatorHostEnv || 'unset'
      }). Per P0-B.5, refusing to fall back to production Firestore project (${FORBIDDEN_PROD_PROJECT_ID}). Run with: npx firebase emulators:exec --only firestore "FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:rules"`
    );
    return;
  }

  const app = initializeApp(
    {
      projectId: ISOLATED_EMULATOR_PROJECT_ID,
      apiKey: 'AIzaSyDummyKeyForLocalEmulatorTestingOnly00',
    },
    `emulator-rules-test-${Date.now()}`
  );
  const db = getFirestore(app);
  connectFirestoreEmulator(db, host, port);

  try {
    let readRejected = false;
    try {
      await getDocs(collection(db, 'orders'));
    } catch (err: any) {
      if (
        err?.code === 'permission-denied' ||
        String(err?.message).includes('Missing or insufficient permissions') ||
        String(err?.message).includes('PERMISSION_DENIED')
      ) {
        readRejected = true;
      }
    }
    assert.equal(readRejected, true, 'Anonymous read of /orders on Emulator must be rejected');

    let writeOrderRejected = false;
    try {
      await setDoc(doc(db, 'orders', 'GEO-20261030-EMULTR'), {
        orderNumber: 'GEO-20261030-EMULTR',
        status: 'completed',
      });
    } catch (err: any) {
      if (
        err?.code === 'permission-denied' ||
        String(err?.message).includes('Missing or insufficient permissions') ||
        String(err?.message).includes('PERMISSION_DENIED')
      ) {
        writeOrderRejected = true;
      }
    }
    assert.equal(writeOrderRejected, true, 'Anonymous write to /orders on Emulator must be rejected');

    let writeAdminRejected = false;
    try {
      await setDoc(doc(db, 'admins', 'emulator-escalated-uid'), {
        role: 'superadmin',
      });
    } catch (err: any) {
      if (
        err?.code === 'permission-denied' ||
        String(err?.message).includes('Missing or insufficient permissions') ||
        String(err?.message).includes('PERMISSION_DENIED')
      ) {
        writeAdminRejected = true;
      }
    }
    assert.equal(writeAdminRejected, true, 'Client write to /admins on Emulator must be rejected');
  } finally {
    await deleteApp(app);
  }
});
