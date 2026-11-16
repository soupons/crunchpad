// Runs the Vite dev server and opens it in Electron with hot reload.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronPath = require('electron'); // resolves to the Electron binary in Node

const server = await createServer({ server: { port: 5173, strictPort: false } });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
console.log(`Vite dev server at ${url}`);

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, CRUNCHPAD_DEV_URL: url },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
