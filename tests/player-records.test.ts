import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { join } from 'node:path';
import { Store } from '../apps/api/src/store.js';
import { Catalog } from '../apps/api/src/catalog.js';
import { createServer } from '../apps/api/src/server.js';
import { setup, saveFile, fixturePlayer, parsed } from './fixtures.js';
import type { Current } from '../packages/shared/src/domain.js';

const headers = { host: '127.0.0.1', 'x-fc26-client': 'local-web' };
test('manual record selection is reversible, persisted and scoped; exports and history use the chosen identity', async () => {
  const f = await setup();
  f.decoder.parse = async (path) => {
    const data = parsed(await f.decoder.metadata(path));
    data.players = [];
    data.integrity = {
      firstTeamExpected: 0,
      firstTeamResolved: 0,
      youthExpected: 1,
      youthResolved: 0,
      ambiguousCount: 1,
      unresolvedCount: 0,
    };
    data.issues = [
      {
        code: 'PLAYER_RECORD_AMBIGUOUS',
        message: 'Duplicate record',
        playerId: 7,
        squadType: 'YOUTH',
        candidates: ['Costa', 'Young'].map((name, index) => {
          const player = {
            ...fixturePlayer,
            internalKey: `record-${name}`,
            displayName: name,
            squadType: 'YOUTH' as const,
            overall: index ? 49 : 54,
            imageEligible: false,
          };
          return {
            recordKey: `record-${name}`,
            displayName: name,
            birthDate: player.birthDate,
            overall: player.overall,
            player,
          };
        }),
      },
    ];
    return data;
  };
  const app = await createServer({ store: f.store, decoder: f.decoder, logger: false });
  try {
    const path = await saveFile(f.dir, 'CmMgrA', null);
    await saveFile(f.dir, 'CmMgrB', 'b');
    const original = await readFile(path);
    await f.catalog.discover();
    const career = f.catalog.careers().find((c) => c.latestSave.fileName === 'CmMgrA')!;
    const other = f.catalog.careers().find((c) => c.id !== career.id)!;
    f.catalog.select(career.id, career.latestSave.id);
    const current = await f.catalog.refresh(career.id);
    const choose = (
      recordKey: string | null,
      snapshotId = current.snapshotId!,
      careerId = career.id,
    ) =>
      app.inject({
        method: 'PUT',
        url: `/api/careers/${careerId}/player-record`,
        headers,
        payload: { snapshotId, playerId: 7, squadType: 'YOUTH', recordKey },
      });
    assert.equal((await choose('invented')).statusCode, 409);
    assert.equal((await choose('record-Young', current.snapshotId!, other.id)).statusCode, 409);
    const response = await choose('record-Young');
    assert.equal(response.statusCode, 200, response.body);
    const selected = response.json<Current>();
    assert.equal(selected.data!.players[0].displayName, 'Young');
    assert.notEqual(selected.data!.players[0].internalKey, 'record-Young');
    assert.equal(selected.data!.integrity.youthResolved, 1);
    assert.equal(selected.data!.integrity.ambiguousCount, 0);
    for (const key of ['appearances', 'minutes', 'averageRating', 'weeklyWage'] as const)
      assert.equal(selected.data!.players[0][key], null);
    assert.equal(selected.data!.players[0].imageEligible, false);
    assert.equal(selected.data!.issues[0].selectedRecordKey, 'record-Young');
    const persistedPath = join(f.dir, 'restart.sqlite');
    f.store.db.prepare('VACUUM INTO ?').run(persistedPath);
    const reopened = new Store(persistedPath);
    try {
      const restored = new Catalog(reopened, f.decoder).current(career.id);
      assert.equal(restored.data!.players[0].displayName, 'Young');
      assert.equal(restored.data!.issues[0].selectedRecordKey, 'record-Young');
    } finally {
      reopened.close();
    }
    assert.equal((await choose('record-Young')).statusCode, 200);
    assert.equal(f.catalog.current(career.id).data!.players.length, 1);
    const refreshed = await f.catalog.refresh(career.id);
    assert.equal(refreshed.snapshotId, current.snapshotId);
    assert.equal(refreshed.data!.players[0].displayName, 'Young');
    const history = await app.inject({
      url: `/api/careers/${career.id}/players/${selected.data!.players[0].internalKey}`,
      headers,
    });
    assert.equal(history.json().history[0].data.displayName, 'Young');
    const exported = await app.inject({ url: `/api/careers/${career.id}/export/xlsx`, headers });
    assert.equal(exported.statusCode, 200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(exported.rawPayload as never);
    assert.equal(book.getWorksheet('Youth Academy')!.getRow(2).getCell(2).value, 'Young');
    assert.equal((await choose('record-Costa')).statusCode, 200);
    assert.equal(f.catalog.current(career.id).data!.players[0].displayName, 'Costa');
    assert.equal((await choose(null)).statusCode, 200);
    assert.equal((await choose(null)).statusCode, 200);
    const undone = f.catalog.current(career.id);
    assert.equal(undone.data!.players.length, 0);
    assert.equal(undone.data!.integrity.youthResolved, 0);
    assert.equal(undone.data!.integrity.ambiguousCount, 1);
    assert.equal(
      f.store.db
        .prepare('SELECT COUNT(*) AS n FROM snapshot_players WHERE snapshot_id=?')
        .get(current.snapshotId!)!.n,
      0,
    );
    await choose('record-Young');
    assert.deepEqual(await readFile(path), original);
    await writeFile(path, JSON.stringify([null, 'Same Club'], null, 2));
    const changed = await f.catalog.refresh(career.id);
    assert.notEqual(changed.snapshotId, current.snapshotId);
    assert.equal(changed.data!.players.length, 0);
    assert.equal((await choose('record-Young')).statusCode, 409);
    assert.equal(
      f.store.parsed(f.store.snapshot(career.id, current.snapshotId!)!).players[0].displayName,
      'Young',
    );
  } finally {
    await app.close();
    f.store.close();
  }
});
