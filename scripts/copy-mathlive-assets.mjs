// Copies MathLive's fonts into public/ so they are served (web) and bundled (desktop).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'mathlive', 'fonts');
const dest = join(root, 'public', 'mathlive', 'fonts');

if (!existsSync(src)) {
  console.error('mathlive fonts not found; run npm install first');
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('Copied MathLive fonts to public/mathlive/fonts');
