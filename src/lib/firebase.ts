import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, type Auth } from 'firebase/auth';
import rawFirebaseConfig from '../../firebase-applet-config.json';

// Read Firebase Web API Key from VITE_FIREBASE_API_KEY environment variable first
// so firebase-applet-config.json never needs to store a literal "AIza..." key in Git.
const env = (import.meta as any).env || {};
export const effectiveFirebaseConfig = {
  ...rawFirebaseConfig,
  apiKey: (env.VITE_FIREBASE_API_KEY || rawFirebaseConfig.apiKey || '').trim(),
  projectId: env.VITE_FIREBASE_PROJECT_ID || rawFirebaseConfig.projectId,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || rawFirebaseConfig.authDomain,
  firestoreDatabaseId:
    env.VITE_FIREBASE_DATABASE_ID || rawFirebaseConfig.firestoreDatabaseId,
  appId: env.VITE_FIREBASE_APP_ID || rawFirebaseConfig.appId,
};

export const isFirebaseClientConfigured = Boolean(
  effectiveFirebaseConfig.apiKey &&
    effectiveFirebaseConfig.apiKey.startsWith('AIza')
);

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;

export function getFirebaseAuth(): Auth | null {
  if (!isFirebaseClientConfigured) {
    return null;
  }
  if (!appInstance) {
    appInstance = initializeApp(effectiveFirebaseConfig);
  }
  if (!authInstance) {
    authInstance = getAuth(appInstance);
  }
  return authInstance;
}

export const auth = getFirebaseAuth();
export const googleProvider = new GoogleAuthProvider();

export async function signInAdminWithGoogle() {
  const currentAuth = getFirebaseAuth();
  if (!currentAuth) {
    throw new Error(
      '尚未配置前端 Firebase Web API Key（VITE_FIREBASE_API_KEY）。为防止 GitHub 扫描告警，仓库已移除明文 AIza 密钥，请在环境变量中设置 VITE_FIREBASE_API_KEY 后再使用 Google 登录。'
    );
  }
  try {
    const result = await signInWithPopup(currentAuth, googleProvider);
    return result.user;
  } catch (err: any) {
    console.error('Google Sign In failed:', err);
    throw err;
  }
}

export async function logoutAdmin() {
  const currentAuth = getFirebaseAuth();
  if (!currentAuth) return;
  return signOut(currentAuth);
}

/**
 * Retrieves the current authenticated user's Firebase ID Token (JWT)
 * to be sent in `Authorization: Bearer <idToken>` to the backend API.
 */
export async function getAdminBearerToken(forceRefresh = false): Promise<string | null> {
  const currentAuth = getFirebaseAuth();
  if (!currentAuth || !currentAuth.currentUser) {
    return null;
  }
  return currentAuth.currentUser.getIdToken(forceRefresh);
}
