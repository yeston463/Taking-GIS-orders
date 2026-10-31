import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createApiRouter } from './src/server/api.ts';
import { installProcessSafetyHandlers } from './src/server/process-safety.ts';

dotenv.config({ quiet: true });
installProcessSafetyHandlers();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// The API router owns its JSON parser so malformed payloads receive the
// structured API error response instead of Express' default HTML error page.
app.use('/api', createApiRouter());
app.use('/api', (_req, res) => {
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: 'API endpoint not found.',
  });
});

// Serve production static files if dist exists
const distPath = path.resolve(__dirname, 'dist');
app.use(express.static(distPath));

// Fallback to index.html for client-side routing
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error('[UnhandledRequestError]', err?.stack || err);
    if (req.path.startsWith('/api')) {
      res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        message: '服务器处理请求时发生异常，请稍后重试。',
      });
      return;
    }
    next(err);
  }
);

app.listen(PORT, () => {
  console.log(`GeoSpatial Studio server running on port ${PORT}`);
});
