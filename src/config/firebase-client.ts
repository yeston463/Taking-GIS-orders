/**
 * Unified Client-Side Firebase Configuration (`src/config/firebase-client.ts`)
 *
 * SECURITY & ARCHITECTURE NOTES:
 * 1. Public Browser Identifiers (NOT Server Secrets):
 *    `VITE_FIREBASE_*` values are bundled into client-side JavaScript by Vite so the browser
 *    can initialize Firebase Authentication (Google Sign-In on `/#admin`).
 *    They are visible in compiled browser assets and must NEVER be treated as non-disclosable secrets.
 *    Real security is enforced by:
 *      - Google Cloud Console API Key restrictions (HTTP Referrer allowlist + restricting API scope
 *        strictly to `Identity Toolkit API` and `Token Service API`),
 *      - Server-side Firebase Admin SDK ID Token verification + `ADMIN_UIDS` allowlist (`src/config/firebase-server.ts`),
 *      - Zero-trust `firestore.rules` (`allow read, write: if false;` on `/orders`, `/rateLimits`, `/idempotencyKeys`).
 *
 * 2. Minimal Surface (No Unused Services):
 *    GeoSpatial Studio only uses Firebase Authentication on the client and Firestore via Admin SDK on the server.
 *    Unused services (Storage, Cloud Messaging, Analytics) are intentionally excluded so you do not need
 *    to configure `storageBucket`, `messagingSenderId`, or `measurementId`.
 *
 * 3. Shared Single-Input Consistency:
 *    `projectId`, `authDomain` (auto-derived as `${projectId}.firebaseapp.com` when omitted), and
 *    `firestoreDatabaseId` (defaults to `(default)` when omitted) are shared with `src/config/firebase-server.ts`
 *    so you never have to enter them twice for client and server.
 */

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  firestoreDatabaseId: string;
}

export interface FirebaseClientValidationResult {
  valid: boolean;
  missingFields: string[];
  config: FirebaseClientConfig;
}

function readStaticViteEnv(key: string): string {
  try {
    switch (key) {
      case 'VITE_FIREBASE_PROJECT_ID':
        return String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim();
      case 'VITE_FIREBASE_API_KEY':
        return String(import.meta.env.VITE_FIREBASE_API_KEY || '').trim();
      case 'VITE_FIREBASE_APP_ID':
        return String(import.meta.env.VITE_FIREBASE_APP_ID || '').trim();
      case 'VITE_FIREBASE_AUTH_DOMAIN':
        return String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
      case 'VITE_FIREBASE_DATABASE_ID':
        return String(import.meta.env.VITE_FIREBASE_DATABASE_ID || '').trim();
      default:
        return '';
    }
  } catch {
    return '';
  }
}

function readEnvString(key: string): string {
  // In Node test environment, allow runtime process.env overrides to take precedence
  try {
    if (
      typeof process !== 'undefined' &&
      process.env &&
      process.env.NODE_ENV === 'test' &&
      typeof process.env[key] === 'string' &&
      process.env[key]!.trim() !== ''
    ) {
      return process.env[key]!.trim();
    }
  } catch {
    // Ignore in browser runtimes
  }

  // Static property access ensures Vite replaces `import.meta.env.VITE_*` in both dev and production builds
  const staticVal = readStaticViteEnv(key);
  if (staticVal !== '') {
    return staticVal;
  }

  try {
    const metaEnv = (import.meta as any).env;
    if (metaEnv && typeof metaEnv[key] === 'string' && metaEnv[key].trim() !== '') {
      return metaEnv[key].trim();
    }
  } catch {
    // Ignore when running outside Vite
  }

  try {
    if (
      typeof process !== 'undefined' &&
      process.env &&
      typeof process.env[key] === 'string' &&
      process.env[key]!.trim() !== ''
    ) {
      return process.env[key]!.trim();
    }
  } catch {
    // Ignore in browser runtimes without process.env
  }

  return '';
}

const PLACEHOLDER_VALUES = new Set([
  'your-firebase-project-id',
  'your-firebase-project-id.firebaseapp.com',
  'replace_with_restricted_firebase_web_api_key',
  '1:000000000000:web:0000000000000000000000',
  'your-firestore-database-id',
  'my_firebase_api_key',
]);

export function isPlaceholderValue(val: string): boolean {
  const trimmed = (val || '').trim();
  if (!trimmed) return true;
  return PLACEHOLDER_VALUES.has(trimmed.toLowerCase());
}

/**
 * Resolves the Firebase Web App configuration from `VITE_FIREBASE_*` environment variables
 * (with automatic fallback to `FIREBASE_PROJECT_ID` / `FIRESTORE_DATABASE_ID` in Node test/SSR contexts
 * and automatic derivation of `authDomain` from `projectId`).
 */
export function getFirebaseClientConfig(): FirebaseClientConfig {
  const projectId =
    readEnvString('VITE_FIREBASE_PROJECT_ID') ||
    readEnvString('FIREBASE_PROJECT_ID');

  const explicitAuthDomain =
    readEnvString('VITE_FIREBASE_AUTH_DOMAIN') ||
    readEnvString('FIREBASE_AUTH_DOMAIN');

  const authDomain =
    explicitAuthDomain ||
    (projectId && !isPlaceholderValue(projectId) ? `${projectId}.firebaseapp.com` : '');

  const firestoreDatabaseId =
    readEnvString('VITE_FIREBASE_DATABASE_ID') ||
    readEnvString('FIRESTORE_DATABASE_ID') ||
    '(default)';

  return {
    apiKey: readEnvString('VITE_FIREBASE_API_KEY'),
    projectId,
    authDomain,
    appId: readEnvString('VITE_FIREBASE_APP_ID'),
    firestoreDatabaseId,
  };
}

/**
 * Validates whether the required public Firebase Web App fields are present and non-placeholder.
 * Only 3 fields are required from the user (`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_APP_ID`),
 * because `authDomain` is automatically derived from `VITE_FIREBASE_PROJECT_ID` when not explicitly overridden.
 */
export function validateFirebaseClientConfig(
  config: FirebaseClientConfig = getFirebaseClientConfig()
): FirebaseClientValidationResult {
  const missingFields: string[] = [];

  if (isPlaceholderValue(config.projectId)) {
    missingFields.push('VITE_FIREBASE_PROJECT_ID');
  }
  if (isPlaceholderValue(config.apiKey)) {
    missingFields.push('VITE_FIREBASE_API_KEY');
  }
  if (isPlaceholderValue(config.appId)) {
    missingFields.push('VITE_FIREBASE_APP_ID');
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
    config,
  };
}
