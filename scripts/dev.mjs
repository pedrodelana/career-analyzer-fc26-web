import { spawn } from 'node:child_process';
import { root } from './python-runtime.mjs';
import { join } from 'node:path';
const children = [
  spawn(
    process.execPath,
    [join(root, 'node_modules/tsx/dist/cli.mjs'), 'watch', 'apps/api/src/index.ts'],
    { cwd: root, stdio: 'inherit' },
  ),
  spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], {
    cwd: join(root, 'apps/web'),
    stdio: 'inherit',
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', (e) => {
    console.error(e);
    stop(1);
  });
  child.on('exit', (code) => stop(code ?? 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
