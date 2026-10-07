import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setup, saveFile } from './fixtures.js';
import { Store } from '../apps/api/src/store.js';
import { Catalog } from '../apps/api/src/catalog.js';
import { createServer } from '../apps/api/src/server.js';
import { ageAt, formatBirthDate } from '../packages/shared/src/domain.js';

test('recovered custom names override manual fallback, persist by career, export and preserve history', async () => {
  const f = await setup();
  const baseMetadata = f.decoder.metadata;
  const baseParse = f.decoder.parse;
  let recovered = false;
  f.decoder.metadata = async (path) => {
    const meta = await baseMetadata(path);
    return recovered
      ? {
          ...meta,
          clubName: path.endsWith('CmMgrA') ? 'River City FC' : 'Mountain United',
          clubNameSource: 'SAVE',
          clubNameMethod: 'CUSTOM_METADATA',
          clubNameEvidence: ['Verified mrsu fixture'],
        }
      : meta;
  };
  f.decoder.parse = async (path) => ({
    ...(await baseParse(path)),
    metadata: await f.decoder.metadata(path),
  });
  try {
    const aPath = await saveFile(f.dir, 'CmMgrA', 'a', 'Create Club Team');
    const bPath = await saveFile(f.dir, 'CmMgrB', 'b', 'Create Club Team');
    await f.catalog.discover();
    const a = f.catalog.careers().find((c) => c.latestSave.fileName === 'CmMgrA')!;
    const b = f.catalog.careers().find((c) => c.latestSave.fileName === 'CmMgrB')!;
    f.catalog.updateCareerSettings(a.id, { clubName: 'Old manual label' });
    f.catalog.select(a.id);
    const old = await f.catalog.refresh(a.id);
    recovered = true;
    // Only synthetic saves are rewritten, simulating a subsequent game save.
    await writeFile(aPath, JSON.stringify(['a', 'Create Club Team'], null, 2));
    await writeFile(bPath, JSON.stringify(['b', 'Create Club Team'], null, 2));
    const current = await f.catalog.refresh(a.id);
    assert.equal(current.data?.metadata.clubName, 'River City FC');
    assert.equal(current.data?.metadata.clubNameSource, 'SAVE');
    assert.deepEqual(current.data?.players, old.data?.players);
    assert.equal(f.catalog.careers().find((c) => c.id === b.id)?.clubName, 'Mountain United');
    assert.equal(f.catalog.careerSettings(a.id).teamId, f.catalog.careerSettings(b.id).teamId);
    assert.equal(f.catalog.careerSettings(a.id).automaticClubName, true);
    assert.throws(() => f.catalog.updateCareerSettings(a.id, { clubName: 'Override' }), {
      code: 'CLUB_NAME_FROM_SAVE',
    });
    assert.equal((await f.catalog.refresh(a.id)).snapshotId, current.snapshotId);
    assert.equal(
      f.store.parsed(f.store.snapshot(a.id, old.snapshotId!)!).metadata.clubName,
      'Old manual label',
    );
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()?.n, 2);
    const app = await createServer({ store: f.store, decoder: f.decoder, logger: false });
    try {
      const response = await app.inject({
        url: `/api/careers/${a.id}/export/xlsx`,
        headers: { host: '127.0.0.1' },
      });
      assert.equal(response.statusCode, 200);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(response.rawPayload as unknown as Parameters<typeof book.xlsx.load>[0]);
      const fields = new Map<string, unknown>();
      book
        .getWorksheet('Summary')!
        .eachRow((row) => fields.set(String(row.getCell(1).value), row.getCell(2).value));
      assert.equal(fields.get('Club'), 'River City FC');
      assert.equal(fields.get('Club name source'), 'SAVE');
    } finally {
      await app.close();
    }
    const dbPath = join(f.dir, 'recovered.sqlite');
    f.store.db.prepare('VACUUM INTO ?').run(dbPath);
    const reopened = new Store(dbPath);
    try {
      const catalog = new Catalog(reopened, f.decoder);
      await catalog.discover();
      assert.equal(catalog.careerSettings(a.id).clubName, 'River City FC');
      assert.equal(catalog.careerSettings(b.id).clubName, 'Mountain United');
      assert.equal(catalog.current(a.id).data?.metadata.clubNameMethod, 'CUSTOM_METADATA');
    } finally {
      reopened.close();
    }
    recovered = false;
    await writeFile(aPath, JSON.stringify(['a', 'Create Club Team'], null, 4));
    assert.equal((await f.catalog.refresh(a.id)).data?.metadata.clubName, 'Old manual label');
    assert.equal(f.catalog.careerSettings(a.id).automaticClubName, false);
  } finally {
    f.store.close();
  }
});

test('official names resolve; created clubs require a name, isolate same Team ID, survive refresh/restart and can be edited', async () => {
  const f = await setup();
  try {
    const path = await saveFile(f.dir, 'CmMgrCustomA', null, 'Create Club Team');
    await saveFile(f.dir, 'CmMgrCustomB', null, 'Create Club Team');
    await saveFile(f.dir, 'CmMgrOfficial', 'official', 'Harrogate Town');
    const original = await readFile(path);
    await f.catalog.discover();
    const a = f.catalog.careers().find((c) => c.latestSave.fileName === 'CmMgrCustomA')!;
    const b = f.catalog.careers().find((c) => c.latestSave.fileName === 'CmMgrCustomB')!;
    const official = f.catalog.careers().find((c) => c.clubName === 'Harrogate Town')!;
    assert.equal(official.latestSave.metadata.clubNameSource, 'SAVE');
    f.catalog.select(official.id);
    assert.equal(a.clubName, 'Unnamed club');
    assert.throws(() => f.catalog.select(a.id), { code: 'CLUB_NAME_REQUIRED' });
    assert.throws(() => f.catalog.updateCareerSettings(a.id, { clubName: 'Create Club Team' }), {
      code: 'INVALID_CLUB_NAME',
    });
    assert.throws(
      () =>
        f.catalog.updateCareerSettings(a.id, { saveId: b.latestSave.id, clubName: 'Wrong career' }),
      { code: 'CAREER_NOT_FOUND' },
    );
    f.catalog.updateCareerSettings(a.id, { clubName: 'Northbridge FC' });
    f.catalog.updateCareerSettings(b.id, { clubName: 'Southbridge United' });
    assert.equal(f.catalog.careerSettings(a.id).teamId, f.catalog.careerSettings(b.id).teamId);
    f.catalog.select(a.id);
    const first = await f.catalog.refresh(a.id);
    assert.equal(first.data?.metadata.clubName, 'Northbridge FC');
    assert.equal(first.data?.metadata.clubNameSource, 'USER');
    assert.equal((await f.catalog.refresh(a.id)).snapshotId, first.snapshotId);
    assert.deepEqual(await readFile(path), original, 'analyzer never changes saves');
    // Simulate the game updating the same file, keeping its internal career entry.
    await writeFile(path, JSON.stringify([null, 'Create Club Team'], null, 2));
    const next = await f.catalog.refresh(a.id);
    assert.notEqual(next.snapshotId, first.snapshotId);
    assert.equal(next.data?.metadata.clubName, 'Northbridge FC');
    f.catalog.updateCareerSettings(a.id, { clubName: 'Northbridge Athletic' });
    assert.equal(f.catalog.current(a.id).data?.metadata.clubName, 'Northbridge Athletic');
    assert.equal(f.catalog.careerSettings(b.id).clubName, 'Southbridge United');
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()?.n, 2);
    const dbPath = join(f.dir, 'persist.sqlite');
    f.store.db.prepare('VACUUM INTO ?').run(dbPath);
    const reopened = new Store(dbPath);
    try {
      const catalog = new Catalog(reopened, f.decoder);
      await catalog.discover();
      assert.equal(catalog.careerSettings(a.id).clubName, 'Northbridge Athletic');
      assert.equal(catalog.careerSettings(b.id).clubName, 'Southbridge United');
      assert.equal(catalog.current(a.id).data?.metadata.clubNameSource, 'USER');
    } finally {
      reopened.close();
    }
  } finally {
    f.store.close();
  }
});

test('automatic match dates recalculate ages per snapshot and ignore legacy manual dates', async () => {
  const f = await setup();
  let reference: string | null = '2026-03-14';
  const originalDecoder = f.decoder.parse;
  f.decoder.parse = async (path) => {
    const data = await originalDecoder(path);
    data.players = data.players.map((p) => ({ ...p, birthDate: '2006-03-15' }));
    data.careerDateInfo = {
      lastMatchDate: reference,
      nextMatchDate: '2026-03-17',
      referenceDate: reference,
      referenceDateSource: reference ? 'SAVE_LAST_MATCH' : 'UNAVAILABLE',
    };
    return data;
  };
  try {
    const path = await saveFile(f.dir, 'CmMgrA', 'a');
    await f.catalog.discover();
    const id = f.catalog.careers()[0].id;
    f.catalog.select(id);
    const first = await f.catalog.refresh(id);
    assert.equal(first.data?.players[0].age, 19);
    assert.equal(first.data?.careerDateInfo?.referenceDate, '2026-03-14');
    assert.equal(first.data?.metadata.inGameDate, null);
    f.store.db
      .prepare("INSERT INTO save_dates VALUES(?,?,?,?,'USER')")
      .run(id, first.save.id, first.save.hash!, '2050-12-31');
    assert.equal(f.catalog.current(id).data?.players[0].age, 19);
    const app = await createServer({ store: f.store, decoder: f.decoder, logger: false });
    try {
      const headers = { host: '127.0.0.1', 'x-fc26-client': 'local-web' };
      const response = await app.inject({
        url: `/api/careers/${id}/export/xlsx?snapshotId=${first.snapshotId}`,
        headers,
      });
      assert.equal(response.statusCode, 200);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(response.rawPayload as unknown as Parameters<typeof book.xlsx.load>[0]);
      assert.equal(book.getWorksheet('First Team')!.getCell('E2').value, 19);
      const summary = book.getWorksheet('Summary')!;
      const fields = new Map<string, unknown>();
      summary.eachRow((row) => fields.set(String(row.getCell(1).value), row.getCell(2).value));
      assert.equal(fields.get('Age reference date'), '14/03/2026');
      assert.equal(fields.get('Next match'), '17/03/2026');
      assert.equal(fields.get('Age reference source'), 'SAVE_LAST_MATCH');
      assert.equal(
        (
          await app.inject({
            url: `/api/careers/${id}/settings`,
            method: 'PUT',
            headers,
            payload: { inGameDate: '2050-01-01' },
          })
        ).statusCode,
        400,
      );
    } finally {
      await app.close();
    }
    assert.equal((await f.catalog.refresh(id)).snapshotId, first.snapshotId);
    reference = '2026-03-15';
    await writeFile(path, JSON.stringify(['a', 'Same Club'], null, 2));
    const changed = await f.catalog.refresh(id);
    assert.equal(changed.data?.players[0].age, 20);
    assert.equal(changed.data?.players[0].birthDate, '2006-03-15');
    assert.equal(f.store.parsed(f.store.snapshot(id, first.snapshotId!)!).players[0].age, 19);
    reference = null;
    await writeFile(path, JSON.stringify(['a', 'Same Club'], null, 4));
    const unavailable = await f.catalog.refresh(id);
    assert.equal(unavailable.data?.players[0].age, null);
    assert.equal(unavailable.data?.careerDateInfo?.nextMatchDate, '2026-03-17');
    assert.equal(unavailable.data?.players[0].overall, first.data?.players[0].overall);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()?.n, 3);
  } finally {
    f.store.close();
  }
});

test('birthday formatting and age boundary use valid calendar dates only', () => {
  assert.equal(formatBirthDate('2006-07-12'), '12/07/2006');
  assert.equal(formatBirthDate('2006-02-30'), '—');
  assert.equal(ageAt('2006-07-12', null), null);
  assert.equal(ageAt('2006-07-12', '2026-07-11'), 19);
  assert.equal(ageAt('2006-07-12', '2026-07-12'), 20);
  assert.equal(ageAt('2006-07-12', '2026-02-30'), null);
  assert.equal(ageAt('2006-07-12', '2000-01-01'), null);
});

test('career settings API allows naming before selection and rejects invalid/cross-career updates', async () => {
  const f = await setup();
  const app = await createServer({ store: f.store, decoder: f.decoder, logger: false });
  const headers = { host: '127.0.0.1', 'x-fc26-client': 'local-web' };
  try {
    await saveFile(f.dir, 'CmMgrA', null, 'Create Club Team');
    await f.catalog.discover();
    const id = f.catalog.careers()[0].id;
    const url = `/api/careers/${id}/settings`;
    assert.equal((await app.inject({ url, headers })).json().clubNameSource, 'UNRESOLVED');
    assert.equal(
      (await app.inject({ url: `/api/careers/${id}/select`, method: 'POST', headers, payload: {} }))
        .statusCode,
      409,
    );
    assert.equal(
      (await app.inject({ url, method: 'PUT', headers, payload: { clubName: 'Placeholder' } }))
        .statusCode,
      400,
    );
    const result = await app.inject({
      url,
      method: 'PUT',
      headers,
      payload: { clubName: 'Custom United' },
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().clubNameSource, 'USER');
    assert.equal(
      (await app.inject({ url: `/api/careers/${id}/select`, method: 'POST', headers, payload: {} }))
        .statusCode,
      200,
    );
  } finally {
    await app.close();
    f.store.close();
  }
});
