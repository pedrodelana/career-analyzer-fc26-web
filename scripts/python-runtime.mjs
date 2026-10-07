import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
export const root = fileURLToPath(new URL('../', import.meta.url));
if (existsSync(join(root, '.env'))) loadEnvFile(join(root, '.env'));
export const python =
  process.env.PYTHON_PATH ||
  [
    join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    join(root, '.tools/python/python.exe'),
  ].find(existsSync) ||
  (process.platform === 'win32' ? 'python' : 'python3');
