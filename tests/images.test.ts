import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ROOT } from '../apps/api/src/config.js';
import { Store } from '../apps/api/src/store.js';
import { Images } from '../apps/api/src/images.js';
import { inside, safeFile } from '../apps/api/src/paths.js';
import { fixturePlayer } from './fixtures.js';
test('image hash cache handles new, unchanged, changed, manual precedence and career isolation', async () => {
  const store = new Store(':memory:');
  await mkdir(join(ROOT, '.tools/test-data'), { recursive: true });
  const base = await mkdtemp(join(ROOT, '.tools/test-data/images-'));
  let conversions = 0;
  const images = new Images(store, base, async (input, output) => {
    conversions++;
    const bytes = await readFile(input);
    await writeFile(output, bytes);
    await writeFile(output.replace(/\.webp$/, '.png'), bytes);
  });
  try {
    for (const id of ['a', 'b'])
      store.db.prepare('INSERT INTO careers VALUES(?,?,?)').run(id, 'CONFIRMED', '[]');
    assert.equal(await images.import('a', 'record', Buffer.from('one'), 'LIVE_EDITOR'), true);
    assert.equal(await images.import('a', 'record', Buffer.from('one'), 'LIVE_EDITOR'), false);
    assert.equal(conversions, 1);
    await images.import('a', 'record', Buffer.from('two'), 'LIVE_EDITOR');
    assert.equal(conversions, 2);
    await images.import('a', 'record', Buffer.from('manual'), 'MANUAL');
    await images.import('a', 'record', Buffer.from('three'), 'LIVE_EDITOR');
    assert.equal(store.image('a', 'record')?.source, 'MANUAL');
    assert.equal(store.image('b', 'record'), undefined);
    await images.import('b', 'record', Buffer.from('three'), 'LIVE_EDITOR');
    assert.equal(conversions, 4);
    assert.notEqual(store.image('a', 'record')?.hash, store.image('b', 'record')?.hash);
    assert.ok(inside(base, await images.file('a', 'record')));
    assert.equal(inside(base, resolve(base, '../outside')), false);
    await assert.rejects(safeFile(base, join(ROOT, 'package.json')), {
      code: 'FILE_NOT_ACCESSIBLE',
    });
    await assert.rejects(images.file('b', 'missing'), { code: 'IMAGE_NOT_FOUND' });
    const redirectedBase = await mkdtemp(join(ROOT, '.tools/test-data/redirected-images-'));
    await symlink(
      join(base, 'web'),
      join(redirectedBase, 'web'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(new Images(store, redirectedBase).file('a', 'record'), {
      code: 'INVALID_STORAGE_PATH',
    });
  } finally {
    store.close();
  }
});
test('automatic scan finds new and changed images, preserves sources and skips ambiguous links', async () => {
  const store = new Store(':memory:');
  await mkdir(join(ROOT, '.tools/test-data'), { recursive: true });
  const source = await mkdtemp(join(ROOT, '.tools/test-data/source-'));
  const base = await mkdtemp(join(ROOT, '.tools/test-data/auto-'));
  const images = new Images(store, base, async (input, output) => {
    const bytes = await readFile(input);
    await writeFile(output, bytes);
    await writeFile(output.replace(/\.webp$/, '.png'), bytes);
  });
  try {
    store.db.prepare('INSERT INTO careers VALUES(?,?,?)').run('a', 'CONFIRMED', '[]');
    store.set('config', { ...store.settings(), headDirectory: source, youthHeadDirectory: source });
    assert.equal((await images.sync('a', [fixturePlayer])).updated, 0);
    const path = join(source, 'p7.DDS');
    await writeFile(path, 'original');
    assert.equal((await images.sync('a', [fixturePlayer])).updated, 1);
    assert.equal(await readFile(path, 'utf8'), 'original');
    assert.equal((await images.sync('a', [fixturePlayer])).updated, 0);
    await writeFile(path, 'changed');
    assert.equal((await images.sync('a', [fixturePlayer])).updated, 1);
    assert.equal(
      (
        await images.sync('a', [
          { ...fixturePlayer, internalKey: 'ambiguous', imageEligible: false },
        ])
      ).updated,
      0,
    );
    assert.equal(store.image('a', 'ambiguous'), undefined);
  } finally {
    store.close();
  }
});
