import { spawn } from 'node:child_process';
import { python, root } from './python-runtime.mjs';
const child = spawn(python, process.argv.slice(2), { stdio: 'inherit', cwd: root, shell: false });
child.on('error', (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
