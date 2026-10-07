import assert from 'node:assert/strict';
import { test } from 'node:test';
import en from '../apps/web/src/locales/en.json';
import es from '../apps/web/src/locales/es.json';
import pt from '../apps/web/src/locales/pt-BR.json';
import {
  formatCalendarDate,
  formatDate,
  isLocale,
  localizeMessage,
  translate,
} from '../apps/web/src/i18n';

test('all languages cover the same messages and preserve interpolation parameters', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(([key]) => key).sort();
  for (const catalog of [es, pt]) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      assert.ok(catalog[key].trim(), `Empty translation: ${key}`);
      assert.deepEqual(placeholders(catalog[key]), placeholders(en[key]), key);
    }
  }
});

test('only supported language preferences are accepted', () => {
  for (const locale of ['en', 'es', 'pt-BR']) assert.equal(isLocale(locale), true);
  for (const locale of [null, undefined, '', 'pt', 'fr', '__proto__'])
    assert.equal(isLocale(locale), false);
});

test('translations interpolate data without interpreting it as replacement syntax', () => {
  assert.equal(
    translate('pt-BR', 'Library updated. {count} saves found.', { count: 3 }),
    'Biblioteca atualizada. 3 saves encontrados.',
  );
  assert.equal(translate('es', 'Use {player}', { player: '$& {count}' }), 'Usar $& {count}');
  assert.equal(translate('en', 'Settings'), 'Settings');
});

test('calendar dates retain their saved day and timestamps use the selected locale', () => {
  for (const locale of ['en', 'es', 'pt-BR'] as const) {
    assert.equal(formatCalendarDate('2006-03-15', locale), '15/03/2006');
    assert.equal(formatCalendarDate(null, locale), 'N/A');
    assert.equal(formatCalendarDate('invalid', locale), 'N/A');
    assert.equal(formatCalendarDate('2026-02-30', locale), 'N/A');
    assert.equal(formatDate('invalid', locale), 'N/A');
  }
  assert.match(formatDate('2026-03-15T12:00:00Z', 'pt-BR'), /2026/);
  assert.notEqual(
    formatDate('2026-03-15T12:00:00Z', 'pt-BR'),
    formatDate('2026-03-15T12:00:00Z', 'en'),
  );
});

test('known backend errors are localized while unknown diagnostics retain their details', () => {
  assert.equal(localizeMessage('es', 'The operation failed.'), 'La operación falló.');
  assert.equal(
    localizeMessage('pt-BR', 'Error: The operation failed.'),
    'Error: A operação falhou.',
  );
  assert.equal(localizeMessage('pt-BR', 'Parser detail: file.bin'), 'Parser detail: file.bin');
});
