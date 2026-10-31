import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import { createApiRouter } from './src/server/api.ts';
import { readOptionalLocalFirebaseConfigFile } from './src/config/firebase-server.ts';

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

function apiServerPlugin(): Plugin {
  return {
    name: 'api-server-plugin',
    configureServer(server) {
      server.middlewares.use('/api', createApiRouter() as any);
    },
  };
}

export default defineConfig(() => {
  hydrateClientEnvFromOptionalLocalConfig();

  return {
    plugins: [react(), tailwindcss(), apiServerPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      allowedHosts: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      allowedHosts: true,
    },
  };
});
