import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
let candidate = resolve(fileURLToPath(new URL('.', import.meta.url)));
while (
  !existsSync(join(candidate, 'package.json')) ||
  !existsSync(join(candidate, 'apps/api/package.json')) ||
  !existsSync(join(candidate, 'parser/src/main.py'))
) {
  const parent = resolve(candidate, '..');
  if (parent === candidate) throw new Error('Project root not found');
  candidate = parent;
}
export const ROOT = candidate;
if (existsSync(join(ROOT, '.env'))) loadEnvFile(join(ROOT, '.env'));
export const PYTHON =
  process.env.PYTHON_PATH ||
  [
    join(ROOT, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    join(ROOT, '.tools/python/python.exe'),
  ].find(existsSync) ||
  (process.platform === 'win32' ? 'python' : 'python3');
export const PORT = Number(process.env.API_PORT || 3001);
export const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://127.0.0.1:5173';
