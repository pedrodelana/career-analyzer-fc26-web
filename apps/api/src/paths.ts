import { lstat, realpath, stat, mkdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { AppError } from './errors.js';
import { ROOT } from './config.js';
export function expandPath(input: string): string {
  return resolve(
    input.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? `%${name}%`),
  );
}
export function inside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
export async function directory(input: string): Promise<string> {
  if (!input || input.includes('\0') || input.startsWith('\\\\') || input.startsWith('//'))
    throw new AppError('INVALID_PATH', 'Choose a local folder. Network shares are not supported.');
  const path = expandPath(input);
  try {
    if (!(await stat(path)).isDirectory()) throw new Error();
    return await realpath(path);
  } catch {
    throw new AppError(
      'DIRECTORY_NOT_FOUND',
      'The configured folder does not exist or is not accessible.',
    );
  }
}
export async function safeFile(base: string, target: string): Promise<string> {
  try {
    const root = await realpath(base);
    const info = await lstat(target);
    const actual = await realpath(target);
    if (info.isSymbolicLink() || !info.isFile() || !inside(root, actual)) throw new Error();
    return actual;
  } catch {
    throw new AppError(
      'FILE_NOT_ACCESSIBLE',
      'The selected file is missing or outside its configured folder.',
      404,
    );
  }
}
export async function internalDirectory(target: string): Promise<string> {
  const full = resolve(target);
  if (!inside(ROOT, full))
    throw new AppError('INVALID_STORAGE_PATH', 'Storage must remain inside the project.');
  const workspace = await realpath(ROOT);
  let current = ROOT;
  for (const part of relative(ROOT, full).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if ((await lstat(current)).isSymbolicLink() || !inside(workspace, await realpath(current)))
      throw new AppError(
        'INVALID_STORAGE_PATH',
        'Storage folders cannot redirect outside the project.',
      );
  }
  return current;
}
export async function checkOutputFile(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile())
      throw new AppError('INVALID_STORAGE_PATH', 'The output file is not a regular project file.');
    await safeFile(ROOT, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
