import fs from 'node:fs';

for (const target of ['dist', 'server.js']) {
  fs.rmSync(target, { recursive: true, force: true });
}
