import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, PYTHON } from './config.js';
import { AppError } from './errors.js';
export async function runPython<T>(
  action: 'metadata' | 'parse' | 'image' | 'names' | 'doctor',
  input?: string,
  output?: string,
): Promise<T> {
  const args = [join(ROOT, 'parser/src/main.py'), action];
  if (input) args.push('--input', input);
  if (output) args.push('--output', output);
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, {
      cwd: ROOT,
      shell: false,
      windowsHide: true,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    let stdout = '',
      stderr = '',
      settled = false;
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    };
    const timer = setTimeout(
      () => {
        child.kill();
        fail(
          new AppError('PARSER_TIMEOUT', 'The parser took too long. Check the local logs.', 504),
        );
      },
      action === 'names' ? 600000 : 120000,
    );
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 32 * 1024 * 1024) {
        child.kill();
        fail(new AppError('PARSER_OUTPUT_LIMIT', 'Parser output exceeded the supported size.'));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-12000);
    });
    child.on('error', () =>
      fail(
        new AppError('PYTHON_NOT_AVAILABLE', 'Python could not start. Run npm run doctor.', 503),
      ),
    );
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      try {
        if (code !== 0) {
          console.error(JSON.stringify({ code: 'PYTHON_FAILED', action, detail: stderr }));
          throw new AppError(
            action === 'image' ? 'IMAGE_CONVERSION_ERROR' : 'SAVE_PARSE_ERROR',
            action === 'image'
              ? 'The image could not be decoded. Use a valid DDS, PNG, JPEG or WEBP.'
              : 'The save could not be analyzed. Check the parser and local logs.',
          );
        }
        const parsed = JSON.parse(stdout);
        settled = true;
        resolve(parsed as T);
      } catch (error) {
        fail(
          error instanceof AppError
            ? error
            : new AppError('INVALID_PARSER_OUTPUT', 'The parser returned invalid data.'),
        );
      }
    });
  });
}
