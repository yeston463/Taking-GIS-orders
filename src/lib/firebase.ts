import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  type Auth,
  type User,
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
googleProvider.setCustomParameters({ prompt: 'select_account' });

export interface FormattedAuthError extends Error {
  code?: string;
}

export function formatFirebaseAuthError(err: any): FormattedAuthError {
  const code = typeof err?.code === 'string' ? err.code : '';
  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
  let message = err?.message || 'Google 登录未完成或被取消';

  if (code === 'auth/popup-blocked') {
    message =
      '浏览器拦截了 Google 登录弹窗（或当前处于内嵌预览窗口限制中）。请点击浏览器地址栏右侧的“允许弹窗”图标后重试，或点击下方按钮在独立新标签页中打开管理后台登录。';
  } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    message = 'Google 登录窗口已关闭，登录未完成。请重新点击登录按钮。';
  } else if (code === 'auth/unauthorized-domain') {
    message = `当前访问域名 (${currentHost}) 尚未加入 Firebase Authentication 授权域名列表。请前往 Firebase Console → Authentication → Settings → Authorized domains 添加 "${currentHost}"。`;
  }

  const formatted: FormattedAuthError = new Error(message);
  formatted.code = code;
  return formatted;
}

export async function signInAdminWithGoogle(): Promise<User> {
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
    throw formatFirebaseAuthError(err);
  }
}

export async function signInAdminWithGoogleRedirect(): Promise<void> {
  const check = validateFirebaseClientConfig();
  const currentAuth = getFirebaseAuth();
  if (!currentAuth) {
    throw new Error(
      `尚未完整配置前端 Firebase 客户端参数（缺少: ${check.missingFields.join(', ')}）。`
    );
  }
  try {
    await signInWithRedirect(currentAuth, googleProvider);
  } catch (err: any) {
    throw formatFirebaseAuthError(err);
  }
}

export async function resolveGoogleRedirectResult(): Promise<User | null> {
  const currentAuth = getFirebaseAuth();
  if (!currentAuth) return null;
  try {
    const result = await getRedirectResult(currentAuth);
    return result?.user ?? null;
  } catch (err: any) {
    throw formatFirebaseAuthError(err);
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
