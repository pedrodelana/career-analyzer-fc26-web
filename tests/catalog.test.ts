import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setup, saveFile } from './fixtures.js';
test('empty library, complete case-insensitive discovery, errors preserved, cache reused, no automatic selection', async () => {
  const f = await setup();
  try {
    assert.equal((await f.catalog.discover()).files, 0);
    await saveFile(f.dir, 'CmMgrA', 'a');
    await saveFile(f.dir, 'cMmGrB', 'b');
    await writeFile(join(f.dir, 'CmMgrBad'), 'broken');
    await writeFile(join(f.dir, 'PersonalOther'), 'ignored');
    await mkdir(join(f.dir, 'CmMgrDirectory'));
    const result = await f.catalog.discover();
    assert.equal(result.files, 3);
    assert.equal(result.errors, 1);
    assert.equal(f.catalog.careers().length, 3);
    assert.equal(f.store.selection(), null);
    await f.catalog.discover();
    assert.equal(f.reads(), 4);
  } finally {
    f.store.close();
  }
});
test('same club in independent careers stays separate; a career can change club; unconfirmed saves stay separate', async () => {
  const f = await setup();
  try {
    await saveFile(f.dir, 'CmMgrA', 'a');
    await saveFile(f.dir, 'CmMgrB', 'b');
    await saveFile(f.dir, 'CmMgrC', 'a', 'New Club', '2026-02-01T00:00:00Z');
    await saveFile(f.dir, 'CmMgrU1', null);
    await saveFile(f.dir, 'CmMgrU2', null);
    await f.catalog.discover();
    assert.equal(f.catalog.careers().length, 4);
    const a = f.catalog.careers().find((c) => c.saveCount === 2)!;
    assert.equal(a.clubName, 'New Club');
    assert.equal(a.latestSave.fileName, 'CmMgrC');
    assert.equal(f.catalog.select(a.id).saveId, a.latestSave.id);
  } finally {
    f.store.close();
  }
});
test('ties deterministic, pinned save is retained, latest follows only its career, snapshots idempotent', async () => {
  const f = await setup();
  try {
    await saveFile(f.dir, 'CmMgrB', 'a');
    await saveFile(f.dir, 'CmMgrA', 'a');
    await saveFile(f.dir, 'CmMgrOther', 'b', 'Other', '2026-12-01T00:00:00Z');
    await f.catalog.discover();
    const career = f.catalog.careers().find((c) => c.saveCount === 2)!;
    assert.equal(career.latestSave.fileName, 'CmMgrA');
    const older = f.store.saves(career.id).find((s) => s.file_name === 'CmMgrB')!;
    f.catalog.select(career.id, older.id);
    const first = await f.catalog.refresh(career.id);
    const second = await f.catalog.refresh(career.id);
    assert.equal(first.snapshotId, second.snapshotId);
    await saveFile(f.dir, 'CmMgrNewest', 'a', 'New Club', '2026-06-01T00:00:00Z');
    assert.equal((await f.catalog.refresh(career.id)).save.id, older.id);
    await f.catalog.discover();
    assert.equal(f.store.selection()?.saveId, older.id);
    f.catalog.select(career.id);
    assert.equal((await f.catalog.refresh(career.id)).save.fileName, 'CmMgrNewest');
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()?.n, 2);
  } finally {
    f.store.close();
  }
});
test('missing selected saves require explicit choice and leave snapshots intact', async () => {
  const f = await setup();
  try {
    const path = await saveFile(f.dir, 'CmMgrA', 'a');
    await f.catalog.discover();
    const career = f.catalog.careers()[0];
    f.catalog.select(career.id);
    await f.catalog.refresh(career.id);
    await rename(path, join(f.dir, 'MovedAway'));
    const absent = await f.catalog.discover();
    assert.deepEqual(absent.careers, [], 'careers without available saves leave the library');
    assert.deepEqual(f.catalog.careers(), []);
    assert.equal(f.store.save(career.latestSave.id)?.missing, 1);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()?.n, 1);
    await saveFile(f.dir, 'CmMgrNew', 'a');
    await assert.rejects(f.catalog.refresh(career.id), { code: 'SELECTED_SAVE_MISSING' });
    assert.equal(f.catalog.careers().length, 1);
    assert.equal(f.catalog.careers()[0].saveCount, 1);
    assert.equal(f.catalog.careers()[0].latestSave.fileName, 'CmMgrNew');
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()?.n, 1);
    assert.equal(f.store.selection()?.saveId, career.latestSave.id);
    await rename(join(f.dir, 'MovedAway'), path);
    await f.catalog.discover();
    assert.equal(f.catalog.careers()[0].id, career.id);
    assert.equal(f.catalog.careers()[0].saveCount, 2);
    assert.equal(f.store.save(career.latestSave.id)?.missing, 0);
  } finally {
    f.store.close();
  }
});
test('changed unconfirmed save cannot inherit player identity or manual associations', async () => {
  const f = await setup();
  try {
    const path = await saveFile(f.dir, 'CmMgrA', null, 'One');
    await f.catalog.discover();
    const career = f.catalog.careers()[0];
    f.catalog.select(career.id);
    const first = await f.catalog.refresh(career.id);
    await writeFile(path, JSON.stringify([null, 'Another']));
    const second = await f.catalog.refresh(career.id);
    assert.notEqual(first.data?.players[0].internalKey, second.data?.players[0].internalKey);
    assert.notEqual(first.snapshotId, second.snapshotId);
  } finally {
    f.store.close();
  }
});
