import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  getFirebaseClientConfig,
  validateFirebaseClientConfig,
} from '../config/firebase-client.ts';

export const clientConfigValidation = validateFirebaseClientConfig();
export const effectiveFirebaseConfig = clientConfigValidation.config;
export const isFirebaseClientConfigured = clientConfigValidation.valid;

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;

export function getFirebaseAuth(): Auth | null {
  const check = validateFirebaseClientConfig();
  if (!check.valid) {
    return null;
  }
  if (!appInstance) {
    appInstance = initializeApp(check.config);
  }
  if (!authInstance) {
    authInstance = getAuth(appInstance);
  }
  return authInstance;
}

export const auth = getFirebaseAuth();
export const googleProvider = new GoogleAuthProvider();

export async function signInAdminWithGoogle() {
  const check = validateFirebaseClientConfig();
  const currentAuth = getFirebaseAuth();
  if (!currentAuth) {
    throw new Error(
      `尚未完整配置前端 Firebase 客户端参数（缺少: ${check.missingFields.join(', ')}）。请在环境变量中配置 VITE_FIREBASE_API_KEY、VITE_FIREBASE_PROJECT_ID、VITE_FIREBASE_AUTH_DOMAIN 与 VITE_FIREBASE_APP_ID 后再使用 Google 登录。`
    );
  }
  try {
    const result = await signInWithPopup(currentAuth, googleProvider);
    return result.user;
  } catch (err: any) {
    console.error('Google Sign In failed:', err?.code || err?.message);
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
