import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  {
    files: ['scripts/smoke.mjs'],
    languageOptions: { globals: { document: 'readonly', window: 'readonly' } },
  },
  { ignores: ['**/dist/**', '.tools/**', 'node_modules/**', 'storage/**', 'data/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
