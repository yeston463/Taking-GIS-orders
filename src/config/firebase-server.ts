import fs from 'node:fs';
import path from 'node:path';
import {
  initializeApp,
  getApps,
  cert,
  applicationDefault,
  App as AdminApp,
} from 'firebase-admin/app';
import { getFirebaseClientConfig, isPlaceholderValue } from './firebase-client.ts';

/**
 * Unified Server-Side Firebase & Security Configuration (`src/config/firebase-server.ts`)
 *
 * SECURITY & ARCHITECTURE NOTES:
 * 1. No Duplicate Client/Server Input:
 *    Reads `VITE_FIREBASE_PROJECT_ID` (or `FIREBASE_PROJECT_ID` / `GOOGLE_CLOUD_PROJECT`),
 *    `VITE_FIREBASE_DATABASE_ID` (or `FIRESTORE_DATABASE_ID`), and `VITE_FIREBASE_AUTH_DOMAIN`
 *    (or `FIREBASE_AUTH_DOMAIN`, auto-derived as `${projectId}.firebaseapp.com` when omitted).
 *    You only configure Project ID and Database ID once.
 *
 * 2. Clean Git Clone & AI Studio Compatibility:
 *    Never statically imports untracked `firebase-applet-config.json`.
 *    In AI Studio preview environments where `firebase-applet-config.json` exists locally on disk,
 *    it is read dynamically as a fallback when environment variables are not set.
 *
 * 3. ADC Priority (Zero Frontend Service Account Keys):
 *    `getFirebaseAdminApp()` uses Google Cloud Application Default Credentials (`applicationDefault()`)
 *    by default (ideal for Cloud Run with `roles/datastore.user` and `roles/firebaseauth.viewer`).
 *    Service account private keys are never required on Cloud Run and are strictly forbidden in client code.
 *
 * 4. Server-Only Secrets & Access Control:
 *    Centralizes `QUERY_TOKEN_PEPPER` (HMAC-SHA256 secret pepper), `ADMIN_UIDS` (verified Firebase Auth
 *    UID allowlist), and `TRUST_PROXY` hop resolution in one server module.
 */

export interface FirebaseServerConfig {
  projectId: string;
  firestoreDatabaseId: string;
  authDomain: string;
  credentialSource: 'adc' | 'service_account_env';
  configSource: 'env' | 'local_file' | 'unconfigured';
}

export interface FirebaseConsistencyReport {
  consistent: boolean;
  clientProjectId: string;
  adminProjectId: string;
  authDomainProjectId: string;
  firestoreDatabaseId: string;
  authDomain: string;
  credentialSource: 'adc' | 'service_account_env';
  configSource: 'env' | 'local_file' | 'unconfigured';
  runtimeEnvironment: 'cloud_run' | 'ai_studio_or_local' | 'test';
  crossProjectAdcWarning?: string;
  mismatchReason?: string;
}

export class ServerConfigError extends Error {
  public readonly statusCode = 503;
  public readonly code: string;
  constructor(message: string, code = 'CONFIG_ERROR') {
    super(message);
    this.name = 'ServerConfigError';
    this.code = code;
  }
}

interface LocalAppletConfigJson {
  projectId?: string;
  firestoreDatabaseId?: string;
  authDomain?: string;
  apiKey?: string;
  appId?: string;
}

/**
 * Dynamically reads `firebase-applet-config.json` from workspace root ONLY if present
 * and not disabled via `IGNORE_LOCAL_FIREBASE_CONFIG_FILE=true` or `NODE_ENV=test`.
 */
export function readOptionalLocalFirebaseConfigFile(): LocalAppletConfigJson | null {
  if (
    process.env.IGNORE_LOCAL_FIREBASE_CONFIG_FILE === 'true' ||
    process.env.NODE_ENV === 'test'
  ) {
    return null;
  }

  try {
    const filePath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as LocalAppletConfigJson;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function cleanConfigValue(val?: string): string {
  const trimmed = (val || '').trim();
  if (!trimmed || isPlaceholderValue(trimmed)) return '';
  return trimmed;
}

export function getFirebaseServerConfig(): FirebaseServerConfig {
  const envProjectId = cleanConfigValue(
    process.env.FIREBASE_PROJECT_ID ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT
  );

  const envDatabaseId = cleanConfigValue(
    process.env.FIRESTORE_DATABASE_ID || process.env.VITE_FIREBASE_DATABASE_ID
  );

  const envAuthDomain = cleanConfigValue(
    process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN
  );

  const localJson = readOptionalLocalFirebaseConfigFile();
  const localProjectId = cleanConfigValue(localJson?.projectId);
  const localDatabaseId = cleanConfigValue(localJson?.firestoreDatabaseId);
  const localAuthDomain = cleanConfigValue(localJson?.authDomain);

  const projectId = envProjectId || localProjectId;
  const explicitDatabaseId = envDatabaseId || localDatabaseId;
  const isProductionLike =
    process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
  if (isProductionLike && !explicitDatabaseId) {
    throw new ServerConfigError(
      '服务端缺少 Firestore Database ID 配置：请在 Cloud Run 设置 FIRESTORE_DATABASE_ID（若确实使用默认库，请显式填写 "(default)"）。',
      'CONFIG_MISSING_FIRESTORE_DATABASE_ID'
    );
  }
  const firestoreDatabaseId = explicitDatabaseId || '(default)';
  const authDomain =
    envAuthDomain ||
    localAuthDomain ||
    (projectId ? `${projectId}.firebaseapp.com` : '');

  const hasServiceAccountJson = Boolean(
    (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim()
  );

  let configSource: 'env' | 'local_file' | 'unconfigured' = 'unconfigured';
  if (envProjectId) {
    configSource = 'env';
  } else if (localProjectId) {
    configSource = 'local_file';
  }

  return {
    projectId,
    firestoreDatabaseId,
    authDomain,
    credentialSource: hasServiceAccountJson ? 'service_account_env' : 'adc',
    configSource,
  };
}

let cachedAdminApp: AdminApp | null = null;
let cachedAdminProjectId: string | null = null;

/**
 * Initializes or returns the Firebase Admin SDK instance.
 * Prioritizes Google Cloud Application Default Credentials (ADC).
 */
export function getFirebaseAdminApp(
  cfg: FirebaseServerConfig = getFirebaseServerConfig()
): AdminApp {
  if (!cfg.projectId) {
    throw new ServerConfigError(
      '服务端缺少 Firebase 项目配置：请设置环境变量 VITE_FIREBASE_PROJECT_ID（或 FIREBASE_PROJECT_ID）。',
      'CONFIG_MISSING_FIREBASE_PROJECT_ID'
    );
  }

  if (cachedAdminApp && cachedAdminProjectId === cfg.projectId) {
    return cachedAdminApp;
  }

  const existingApps = getApps();
  if (existingApps.length > 0) {
    const matching = existingApps.find((a) => a.options.projectId === cfg.projectId);
    if (matching) {
      cachedAdminApp = matching;
      cachedAdminProjectId = cfg.projectId;
      return cachedAdminApp;
    }
  }

  const saJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const appName = existingApps.length === 0 ? undefined : `admin-${cfg.projectId}`;

  if (saJson) {
    let parsedSa: Record<string, any>;
    try {
      parsedSa = JSON.parse(saJson);
    } catch {
      throw new ServerConfigError(
        '环境变量 FIREBASE_SERVICE_ACCOUNT_JSON 不是合法的 JSON 格式。在 Cloud Run 上请移除此变量并优先使用默认 ADC 凭证。',
        'CONFIG_INVALID_SERVICE_ACCOUNT_JSON'
      );
    }

    if (parsedSa.project_id && parsedSa.project_id !== cfg.projectId) {
      throw new ServerConfigError(
        `FIREBASE_SERVICE_ACCOUNT_JSON 中的 project_id (${parsedSa.project_id}) 与当前配置的 Project ID (${cfg.projectId}) 不一致！`,
        'CONFIG_PROJECT_ID_MISMATCH'
      );
    }

    cachedAdminApp = initializeApp(
      {
        credential: cert(parsedSa),
        projectId: cfg.projectId,
      },
      appName
    );
    cachedAdminProjectId = cfg.projectId;
    return cachedAdminApp;
  }

  cachedAdminApp = initializeApp(
    {
      credential: applicationDefault(),
      projectId: cfg.projectId,
    },
    appName
  );
  cachedAdminProjectId = cfg.projectId;
  return cachedAdminApp;
}

/**
 * Verifies consistency between Client and Server Firebase configurations
 * (Project ID, Auth Domain, and Firestore Database ID).
 */
export function verifyFirebaseConfigConsistency(): FirebaseConsistencyReport {
  const serverCfg = getFirebaseServerConfig();
  const clientCfg = getFirebaseClientConfig();

  const clientProjectId = clientCfg.projectId || serverCfg.projectId;
  const adminProjectId = serverCfg.projectId;
  const firestoreDatabaseId =
    serverCfg.firestoreDatabaseId || clientCfg.firestoreDatabaseId || '(default)';
  const authDomain = clientCfg.authDomain || serverCfg.authDomain;
  const authDomainProjectId = authDomain
    .replace(/\.firebaseapp\.com$/i, '')
    .replace(/\.web\.app$/i, '');

  const normalizedAuthDomain = authDomain.toLowerCase();
  const knownFirebaseAuthHosts = adminProjectId
    ? [
        `${adminProjectId.toLowerCase()}.firebaseapp.com`,
        `${adminProjectId.toLowerCase()}.web.app`,
      ]
    : [];
  const isOtherFirebaseHost =
    /\.(firebaseapp\.com|web\.app)$/i.test(normalizedAuthDomain) &&
    !knownFirebaseAuthHosts.includes(normalizedAuthDomain);
  const runtimeEnvironment: 'cloud_run' | 'ai_studio_or_local' | 'test' =
    process.env.NODE_ENV === 'test'
      ? 'test'
      : process.env.K_SERVICE
        ? 'cloud_run'
        : 'ai_studio_or_local';

  let consistent = true;
  let mismatchReason: string | undefined;

  if (!adminProjectId) {
    consistent = false;
    mismatchReason =
      'Missing Firebase Project ID (set VITE_FIREBASE_PROJECT_ID or FIREBASE_PROJECT_ID)';
  } else if (!firestoreDatabaseId) {
    consistent = false;
    mismatchReason =
      'Missing Firestore Database ID (set VITE_FIREBASE_DATABASE_ID or FIRESTORE_DATABASE_ID)';
  } else if (clientCfg.projectId && clientCfg.projectId !== adminProjectId) {
    consistent = false;
    mismatchReason = `Client projectId (${clientCfg.projectId}) !== Admin projectId (${adminProjectId})`;
  } else if (isOtherFirebaseHost) {
    consistent = false;
    mismatchReason = `authDomain (${authDomain}) does not match projectId (${adminProjectId})`;
  } else if (
    clientCfg.firestoreDatabaseId &&
    clientCfg.firestoreDatabaseId !== '(default)' &&
    serverCfg.firestoreDatabaseId &&
    clientCfg.firestoreDatabaseId !== serverCfg.firestoreDatabaseId
  ) {
    consistent = false;
    mismatchReason = `Client databaseId (${clientCfg.firestoreDatabaseId}) !== Server databaseId (${serverCfg.firestoreDatabaseId})`;
  }

  return {
    consistent,
    clientProjectId,
    adminProjectId,
    authDomainProjectId,
    firestoreDatabaseId,
    authDomain,
    credentialSource: serverCfg.credentialSource,
    configSource: serverCfg.configSource,
    runtimeEnvironment,
    mismatchReason,
  };
}

// ============================================================================
// Server-Only Security Secrets & Admin Authorization Whitelist
// ============================================================================

const FORBIDDEN_PEPPER_PLACEHOLDERS = new Set([
  'my_query_token_pepper',
  'replace-with-32-byte-random-secret-in-production',
  'geospatial-studio-v2-token-pepper',
  'your-secret-pepper',
  'changeme',
  'default',
]);

/**
 * Reads and validates `QUERY_TOKEN_PEPPER` strictly from server-side environment/Secrets.
 * Never exposed to client builds and never falls back to a hardcoded default pepper.
 */
export function getRequiredQueryTokenPepper(overridePepper?: string): string {
  const raw = (
    overridePepper !== undefined ? overridePepper : process.env.QUERY_TOKEN_PEPPER || ''
  ).trim();

  if (!raw) {
    throw new ServerConfigError(
      '服务端缺少必需的安全密钥配置 (QUERY_TOKEN_PEPPER)。',
      'CONFIG_MISSING_QUERY_TOKEN_PEPPER'
    );
  }

  if (FORBIDDEN_PEPPER_PLACEHOLDERS.has(raw.toLowerCase()) || raw.length < 16) {
    throw new ServerConfigError(
      '服务端安全密钥配置强度不足或使用了示例占位符。',
      'CONFIG_WEAK_QUERY_TOKEN_PEPPER'
    );
  }

  return raw;
}

export const FORBIDDEN_DEMO_UIDS = new Set([
  'admin-bootstrap-uid',
  'demo-admin',
  'test-admin',
  'anonymous',
  'admin',
  'root',
]);

/**
 * Reads the raw server-side `ADMIN_UIDS` entries. Entries are never echoed back
 * to clients by the diagnostics endpoint.
 */
function readAdminUidEntries(): string[] {
  return (process.env.ADMIN_UIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAcceptableAdminUid(uid: string): boolean {
  return (
    typeof uid === 'string' &&
    uid.length >= 20 &&
    !FORBIDDEN_DEMO_UIDS.has(uid.toLowerCase()) &&
    !uid.includes('@')
  );
}

/**
 * Returns the server-side configured `ADMIN_UIDS` set.
 * Never accepts email addresses, short email prefixes, or demo UIDs.
 * There is no hardcoded bootstrap UID: administrators must be configured
 * explicitly through `ADMIN_UIDS` or a verified `admin` custom claim.
 */
export function getServerAdminUidWhitelist(overrideList?: string[]): Set<string> {
  const rawList = overrideList !== undefined ? overrideList : readAdminUidEntries();
  return new Set(rawList.filter(isAcceptableAdminUid));
}

/**
 * Inspects `ADMIN_UIDS` configuration and returns non-sensitive diagnostics.
 * Never echoes raw `ADMIN_UIDS` entries in the output.
 */
export function diagnoseAdminUidWhitelist(overrideList?: string[]): {
  configuredCount: number;
  warnings: string[];
} {
  const rawList = overrideList !== undefined ? overrideList : readAdminUidEntries();
  const whitelist = getServerAdminUidWhitelist(rawList);
  const warnings: string[] = [];
  const rejectedCount = rawList.filter((uid) => !isAcceptableAdminUid(uid)).length;

  if (rawList.length === 0) {
    warnings.push(
      'ADMIN_UIDS 尚未配置。请先在 /#admin 页面使用 Google 账号登录，复制界面显示的真实 Firebase UID 填入 ADMIN_UIDS。'
    );
  } else if (rejectedCount > 0) {
    warnings.push(
      `ADMIN_UIDS 中有 ${rejectedCount} 个条目未被接受（长度不足 20 字符、包含 @、或属于保留的演示 UID），请填写真实的 Firebase Auth UID。`
    );
  }

  if (whitelist.size === 0 && rawList.length > 0) {
    warnings.push(
      '当前没有任何有效的 ADMIN_UIDS 条目；除 admin Custom Claim 外，管理后台将拒绝所有账号。'
    );
  }

  return {
    configuredCount: whitelist.size,
    warnings,
  };
}

/**
 * Resolves the exact number of trusted reverse-proxy hops (`TRUST_PROXY`).
 * - Never unconditionally trusts X-Forwarded-For.
 * - Defaults to 1 hop ONLY when running on Cloud Run (`K_SERVICE`) behind Google Cloud Front End (GFE),
 *   or when `TRUST_PROXY` is explicitly configured ("1", "true", "cloudrun").
 * - Defaults to 0 hops (`X-Forwarded-For` ignored) in direct/local environments.
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

  return process.env.K_SERVICE ? 1 : 0;
}
