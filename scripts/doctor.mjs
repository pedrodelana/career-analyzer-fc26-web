import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { root, python } from './python-runtime.mjs';
console.log(
  `Node: ${process.version} (${Number(process.versions.node.split('.')[0]) >= 24 ? 'OK' : 'REQUIRES 24+'})`,
);
console.log(
  `Node dependencies: ${existsSync(join(root, 'node_modules/fastify')) ? 'OK' : 'Run npm.cmd install'}`,
);
console.log(`Python executable: ${python}`);
const result = spawnSync(python, [join(root, 'parser/src/main.py'), 'doctor'], {
  encoding: 'utf8',
  cwd: root,
  windowsHide: true,
});
if (result.status === 0) {
  const status = JSON.parse(result.stdout);
  for (const [name, ok] of Object.entries(status)) console.log(`${name}: ${ok ? 'OK' : 'MISSING'}`);
  if (!status.pillow || !status.parser) process.exitCode = 1;
} else {
  console.log('Python: unavailable');
  process.exitCode = 1;
}
console.log(
  `Global names: ${existsSync(join(root, 'data/global_names.json')) ? 'OK' : 'Generate in Settings using your local FC26 installation'}`,
);
console.log('Backend: http://127.0.0.1:3001 | Frontend: http://127.0.0.1:5173');
