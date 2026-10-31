import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin, loadEnv } from 'vite';
import { createApiRouter } from './src/server/api.ts';
import { readOptionalLocalFirebaseConfigFile } from './src/config/firebase-server.ts';
import { installProcessSafetyHandlers } from './src/server/process-safety.ts';

installProcessSafetyHandlers();

/**
 * If running in an AI Studio workspace where `firebase-applet-config.json` exists locally on disk
 * and `VITE_FIREBASE_*` env vars are not explicitly overridden, hydrate `process.env.VITE_FIREBASE_*`
 * so client and server share the exact same Firebase project configuration without static JSON imports.
 * In a clean GitHub clone where `firebase-applet-config.json` does not exist, this is a safe no-op.
 */
function hydrateClientEnvFromOptionalLocalConfig(): void {
  const localCfg = readOptionalLocalFirebaseConfigFile();
  if (!localCfg) return;

  if (!process.env.VITE_FIREBASE_PROJECT_ID && localCfg.projectId) {
    process.env.VITE_FIREBASE_PROJECT_ID = localCfg.projectId;
  }
  if (!process.env.VITE_FIREBASE_API_KEY && localCfg.apiKey) {
    process.env.VITE_FIREBASE_API_KEY = localCfg.apiKey;
  }
  if (!process.env.VITE_FIREBASE_APP_ID && localCfg.appId) {
    process.env.VITE_FIREBASE_APP_ID = localCfg.appId;
  }
  if (!process.env.VITE_FIREBASE_AUTH_DOMAIN && localCfg.authDomain) {
    process.env.VITE_FIREBASE_AUTH_DOMAIN = localCfg.authDomain;
  }
  if (!process.env.VITE_FIREBASE_DATABASE_ID && localCfg.firestoreDatabaseId) {
    process.env.VITE_FIREBASE_DATABASE_ID = localCfg.firestoreDatabaseId;
  }
}

function mountApiMiddleware(middlewares: { use: (path: string, handler: any) => void }): void {
  middlewares.use('/api', createApiRouter() as any);
  middlewares.use('/api', (_req: any, res: any) => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        success: false,
        code: 'NOT_FOUND',
        message: 'API endpoint not found.',
      })
    );
  });
}

function apiServerPlugin(): Plugin {
  return {
    name: 'api-server-plugin',
    configureServer(server) {
      mountApiMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      mountApiMiddleware(server.middlewares);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Vite only exposes .env values as import.meta.env to the browser; the API
  // router runs in Node and must see the same values through process.env.
  const loadedEnv = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(loadedEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  hydrateClientEnvFromOptionalLocalConfig();

  return {
    plugins: [react(), tailwindcss(), apiServerPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      allowedHosts: true as const,
    },
  };
});
