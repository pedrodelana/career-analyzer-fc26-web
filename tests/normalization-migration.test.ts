import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import ExcelJS from 'exceljs';
import { setup, saveFile, parsed, fixturePlayer } from './fixtures.js';
import { Store } from '../apps/api/src/store.js';
import { Catalog } from '../apps/api/src/catalog.js';
import { ROOT } from '../apps/api/src/config.js';
import { migrate } from '../apps/api/src/migrations.js';
import { createServer } from '../apps/api/src/server.js';
import { sortPlayers, compareRatings, type ParsedSave } from '../packages/shared/src/domain.js';

test('legacy SQLite migration preserves snapshots/identities/images, offsets once, and history/Excel/sorting use normalized ratings', async () => {
  const f = await setup();
  const cases = [
    ['Sebastian Herbert', 69, 69],
    ['Daniel Woolley', 68, 68],
    ['Arne Christiansen', 61, 94],
    ['Ricardo Barreto', 50, 92],
    ['Jannis Wilke', 59, 89],
    ['Min Jae Ma', 61, 84],
  ] as const;
  f.decoder.parse = async () => {
    const data = parsed();
    data.players = cases.map(([displayName, ovr, pot], i) => ({
      ...fixturePlayer,
      internalKey: `ref-${i}`,
      playerId: i,
      displayName,
      squadType: i < 2 ? 'FIRST_TEAM' : 'YOUTH',
      overall: ovr + 1,
      potential: pot + 1,
      growthMargin: pot - ovr,
      attributes: { acceleration: 70 },
      rawRatings: { overall: ovr, potential: pot, attributes: { acceleration: 69 } },
    }));
    data.integrity = {
      ...data.integrity,
      firstTeamExpected: 2,
      firstTeamResolved: 2,
      youthExpected: 4,
      youthResolved: 4,
    };
    return data;
  };
  let store: Store | undefined;
  try {
    await saveFile(f.dir, 'CmMgrA', 'a');
    await f.catalog.discover();
    const id = f.catalog.careers()[0].id;
    f.catalog.select(id);
    const first = await f.catalog.refresh(id);
    const legacy: ParsedSave = JSON.parse(f.store.snapshot(id, first.snapshotId!)!.data);
    delete legacy.normalizationVersion;
    legacy.players = legacy.players.map((p) => {
      const raw = {
        ...p,
        overall: p.rawRatings!.overall,
        potential: p.rawRatings!.potential,
        age: 99,
      };
      delete raw.attributes;
      delete raw.rawRatings;
      return raw;
    });
    legacy.issues = [
      {
        code: 'PLAYER_RECORD_AMBIGUOUS',
        message: 'Synthetic candidate',
        candidates: [
          { recordKey: 'duplicate', displayName: 'Unresolved', birthDate: null, overall: 68 },
        ],
      },
    ];
    f.store.db
      .prepare('UPDATE snapshots SET data=?,normalizer_key=? WHERE id=?')
      .run(JSON.stringify(legacy), 'legacy', first.snapshotId!);
    for (const p of legacy.players)
      f.store.db
        .prepare('UPDATE snapshot_players SET data=? WHERE snapshot_id=? AND internal_key=?')
        .run(JSON.stringify(p), first.snapshotId!, p.internalKey);
    f.store.db
      .prepare("INSERT INTO player_images VALUES(?,?,'MANUAL',NULL,'synthetic-hash',?)")
      .run(id, 'unrelated-image-key', new Date().toISOString());
    f.store.db.exec('DELETE FROM schema_migrations WHERE version=3');
    const path = join(f.dir, 'legacy.sqlite');
    f.store.db.prepare('VACUUM INTO ?').run(path);
    const backupDir = join(ROOT, 'data/backups');
    const before = await readdir(backupDir).catch(() => [] as string[]);
    store = new Store(path);
    const backups = (await readdir(backupDir)).filter((file) => !before.includes(file));
    assert.equal(backups.length, 1, 'migration backs up the pre-conversion database');
    const backup = new DatabaseSync(join(backupDir, backups[0]), { readOnly: true });
    try {
      assert.equal(
        JSON.parse((backup.prepare('SELECT data FROM snapshots').get() as { data: string }).data)
          .players[1].overall,
        68,
      );
    } finally {
      backup.close();
    }
    const upgraded = store.parsed(store.snapshot(id, first.snapshotId!)!);
    assert.equal(upgraded.players[1].overall, 69);
    assert.equal(upgraded.players[1].rawRatings?.overall, 68);
    assert.equal(upgraded.players[1].age, null);
    assert.equal(upgraded.issues[0].candidates?.[0].overall, 69);
    assert.deepEqual(
      upgraded.players.map((p) => p.internalKey),
      legacy.players.map((p) => p.internalKey),
    );
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM snapshot_players').get()?.n, 6);
    assert.equal(store.imageRow(id, 'unrelated-image-key')?.hash, 'synthetic-hash');
    migrate(store.db, path);
    assert.deepEqual(store.parsed(store.snapshot(id, first.snapshotId!)!), upgraded);
    const catalog = new Catalog(store, f.decoder);
    const current = await catalog.refresh(id);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()?.n, 2);
    assert.deepEqual(compareRatings(upgraded.players[1], current.data!.players[1]), {
      overall: 0,
      potential: 0,
    });
    assert.deepEqual(
      sortPlayers(current.data!.players, 'overall', 'desc').map((p) => p.overall),
      [70, 69, 62, 62, 60, 51],
    );
    assert.equal(current.data!.players[2].growthMargin, 33);
    const app = await createServer({ store, decoder: f.decoder, logger: false });
    const headers = { host: '127.0.0.1', 'x-fc26-client': 'local-web' };
    try {
      const history = (
        await app.inject({
          url: `/api/careers/${id}/players/ref-1?snapshotId=${current.snapshotId}`,
          headers,
        })
      ).json().history;
      assert.equal(history.length, 2);
      assert.deepEqual(history[1].change, { overall: 0, potential: 0 });
      catalog.updateCareerSettings(id, { clubName: 'Export United' });
      for (let pass = 0; pass < 2; pass++) {
        const response = await app.inject({
          url: `/api/careers/${id}/export/xlsx?snapshotId=${current.snapshotId}`,
          headers,
        });
        assert.equal(response.statusCode, 200);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(
          response.rawPayload as unknown as Parameters<typeof book.xlsx.load>[0],
        );
        assert.equal(book.getWorksheet('Summary')!.getCell('B2').value, 'Export United');
        for (const sheetName of ['First Team', 'Youth Academy']) {
          const sheet = book.getWorksheet(sheetName)!;
          const values = sheet.getRow(1).values as string[];
          assert.ok(values.includes('Date of birth'));
          assert.equal(values.includes('Contract year'), sheetName === 'First Team');
          for (const removed of ['Agreement', 'Appearances', 'Minutes', 'Avg. rating'])
            assert.equal(values.includes(removed), false);
          const expected = current.data!.players.filter(
            (p) => p.squadType === (sheetName === 'First Team' ? 'FIRST_TEAM' : 'YOUTH'),
          );
          for (const [i, p] of expected.entries()) {
            const row = sheet.getRow(i + 2);
            assert.equal(row.getCell('I').value, p.overall);
            assert.equal(row.getCell('J').value, p.potential);
            assert.equal(row.getCell('K').value, p.growthMargin);
            assert.equal(row.getCell('E').value, '—');
            assert.equal(
              (row.getCell('F').value as Date).toISOString(),
              '2006-01-01T00:00:00.000Z',
            );
            assert.equal(row.getCell('F').numFmt, 'dd/mm/yyyy');
            assert.equal(row.getCell(values.indexOf('acceleration')).value, 70);
          }
        }
      }
    } finally {
      await app.close();
    }
  } finally {
    store?.close();
    f.store.close();
  }
});
