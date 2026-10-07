import type { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, PYTHON } from './config.js';
import type { ParsedSave } from '../../../packages/shared/src/domain.js';

export function migrate(db: DatabaseSync, databasePath: string) {
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get()) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE career_club_names(career_id TEXT NOT NULL REFERENCES careers(id),team_id INTEGER NOT NULL,name TEXT,name_source TEXT NOT NULL CHECK(name_source IN ('SAVE','USER','UNRESOLVED')),updated_at TEXT NOT NULL,PRIMARY KEY(career_id,team_id));
      CREATE TABLE save_dates(career_id TEXT NOT NULL REFERENCES careers(id),save_id TEXT NOT NULL REFERENCES saves(id),file_hash TEXT NOT NULL,in_game_date TEXT NOT NULL,source TEXT NOT NULL CHECK(source='USER'),PRIMARY KEY(career_id,save_id,file_hash));
      INSERT INTO schema_migrations VALUES(2,datetime('now')); COMMIT;`);
  }
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=3').get()) return;
  const rows = db.prepare('SELECT id,data FROM snapshots').all() as { id: string; data: string }[];
  const legacy = rows.filter(
    (row) => (JSON.parse(row.data) as ParsedSave).normalizationVersion !== 2,
  );
  let converted: { id: string; data: ParsedSave }[] = [];
  if (legacy.length) {
    if (databasePath !== ':memory:') {
      const folder = join(ROOT, 'data/backups');
      mkdirSync(folder, { recursive: true });
      db.prepare('VACUUM INTO ?').run(join(folder, `before-ratings-v2-${randomUUID()}.sqlite`));
    }
    const result = spawnSync(PYTHON, [join(ROOT, 'parser/src/upgrade_snapshots.py')], {
      input: JSON.stringify(legacy.map((row) => ({ id: row.id, data: JSON.parse(row.data) }))),
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      cwd: ROOT,
      timeout: 120000,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      throw new Error(
        `Snapshot normalization migration failed: ${result.error?.message ?? result.stderr}`,
      );
    converted = JSON.parse(result.stdout);
    if (
      converted.length !== legacy.length ||
      converted.some(
        (row, index) => row.id !== legacy[index].id || row.data.normalizationVersion !== 2,
      )
    )
      throw new Error('Invalid snapshot migration output');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of converted) {
      db.prepare('UPDATE snapshots SET data=? WHERE id=?').run(JSON.stringify(row.data), row.id);
      for (const player of row.data.players)
        db.prepare('UPDATE snapshot_players SET data=? WHERE snapshot_id=? AND internal_key=?').run(
          JSON.stringify(player),
          row.id,
          player.internalKey,
        );
    }
    db.prepare("INSERT INTO schema_migrations VALUES(3,datetime('now'))").run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
