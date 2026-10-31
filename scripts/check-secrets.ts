import fs from 'node:fs';
import path from 'node:path';

/**
 * Automated CI & Pre-Push Security Guard (`npm run check:secrets`)
 * Verifies:
 * 1. In all Git-trackable source/config files (outside `dist/`):
 *    No literal Google API key (`AIzaSy...`), OAuth client secret (`GOCSPX-...`),
 *    or private key (`BEGIN PRIVATE KEY`) exists, preventing GitHub Secret Scanning alerts.
 * 2. No static imports of untracked `firebase-applet-config.json` remain in `src/` or `scripts/`.
 * 3. In `dist/` (compiled browser bundle, if present):
 *    Verifies that NO server-side secrets (`BEGIN PRIVATE KEY`, `GOCSPX-...`,
 *    `FIREBASE_SERVICE_ACCOUNT_JSON`, or `QUERY_TOKEN_PEPPER`) are ever bundled into browser assets.
 *    (Note per P0-A: `VITE_FIREBASE_API_KEY` is a public browser-visible Firebase client identifier
 *    expected in `dist/` when built with `VITE_FIREBASE_API_KEY`, whereas `dist/` itself is gitignored.)
 */

const ROOT = process.cwd();
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.data',
  '.playwright-cli',
  'coverage',
  '.aistudio',
]);

const SOURCE_SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'Google API Key (AIzaSy...)', regex: /AIzaSy[0-9A-Za-z\-_]{33}/ },
  { name: 'Google OAuth Client Secret (GOCSPX-...)', regex: /GOCSPX-[0-9A-Za-z\-_]{20,}/ },
  { name: 'PEM Private Key', regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
];

const DIST_SERVER_SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'Google OAuth Client Secret (GOCSPX-...)', regex: /GOCSPX-[0-9A-Za-z\-_]{20,}/ },
  { name: 'PEM Private Key', regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  { name: 'Service Account Private Key Field', regex: /"private_key"\s*:\s*"-----BEGIN/ },
  { name: 'Server Secret Env Name (QUERY_TOKEN_PEPPER)', regex: /QUERY_TOKEN_PEPPER/ },
];

const STATIC_IMPORT_CONFIG_REGEX =
  /from\s+['"][^'"]*firebase-applet-config\.json['"]/;

function walkFiles(dir: string, out: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, out);
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
  return out;
}

let violations = 0;
const allFiles = walkFiles(ROOT);

for (const file of allFiles) {
  const rel = path.relative(ROOT, file);
  if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|webm|mp4)$/i.test(rel)) continue;

  const content = fs.readFileSync(file, 'utf-8');
  const isDistFile = rel.startsWith('dist/') || rel.startsWith('dist\\');

  if (isDistFile) {
    for (const pat of DIST_SERVER_SECRET_PATTERNS) {
      if (pat.regex.test(content)) {
        console.error(`[BUNDLE SECURITY VIOLATION] ${pat.name} leaked into browser bundle ${rel}`);
        violations++;
      }
    }
    const activePepper = (process.env.QUERY_TOKEN_PEPPER || '').trim();
    if (activePepper.length >= 16 && content.includes(activePepper)) {
      console.error(
        `[BUNDLE SECURITY VIOLATION] Active QUERY_TOKEN_PEPPER value leaked into browser bundle ${rel}`
      );
      violations++;
    }
  } else {
    for (const pat of SOURCE_SECRET_PATTERNS) {
      const match = pat.regex.exec(content);
      if (match && !match[0].includes('DummyKey') && !match[0].includes('TestFormat')) {
        console.error(`[SOURCE SECURITY VIOLATION] ${pat.name} detected in tracked/source file ${rel}`);
        violations++;
      }
    }

    if (
      (rel.startsWith('src/') || rel.startsWith('scripts/')) &&
      STATIC_IMPORT_CONFIG_REGEX.test(content)
    ) {
      console.error(
        `[BUILD ISOLATION VIOLATION] Static import of untracked firebase-applet-config.json in ${rel}`
      );
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\ncheck:secrets FAILED with ${violations} violation(s).`);
  process.exit(1);
}

console.log(
  `check:secrets PASSED (${allFiles.length} files scanned, 0 source secrets, 0 bundle server-secret leaks, 0 static untracked config imports).`
);
