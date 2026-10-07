import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './config.js';
import { migrate } from './migrations.js';
import {
  ageAt,
  validClubName,
  unavailableCareerDate,
} from '../../../packages/shared/src/domain.js';
import type {
  Settings,
  Selection,
  Metadata,
  SaveEntry,
  ParsedSave,
  PlayerImage,
} from '../../../packages/shared/src/domain.js';

export type SaveRow = {
  id: string;
  career_id: string;
  path: string;
  file_name: string;
  size: number;
  mtime: string;
  metadata: string;
  error: string | null;
  missing: number;
  hash: string | null;
  imported_hash: string | null;
};
export type SnapshotRow = {
  id: string;
  career_id: string;
  save_id: string;
  hash: string;
  created_at: string;
  data: string;
  normalizer_key: string;
};
export type ImageRow = {
  career_id: string;
  internal_key: string;
  source: 'MANUAL' | 'LIVE_EDITOR';
  source_path: string | null;
  hash: string;
  updated_at: string;
};
export class Store {
  db: DatabaseSync;
  constructor(path = join(ROOT, 'data/career.sqlite')) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS careers(id TEXT PRIMARY KEY,identity_status TEXT NOT NULL,evidence TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS saves(id TEXT PRIMARY KEY,career_id TEXT NOT NULL REFERENCES careers(id),path TEXT NOT NULL UNIQUE,file_name TEXT NOT NULL,size INTEGER NOT NULL,mtime TEXT NOT NULL,metadata TEXT NOT NULL,error TEXT,missing INTEGER NOT NULL DEFAULT 0,hash TEXT,imported_hash TEXT);
      CREATE INDEX IF NOT EXISTS saves_career ON saves(career_id,mtime DESC);
      CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,career_id TEXT NOT NULL REFERENCES careers(id),save_id TEXT NOT NULL REFERENCES saves(id),hash TEXT NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL,normalizer_key TEXT NOT NULL,UNIQUE(career_id,save_id,hash,normalizer_key));
      CREATE TABLE IF NOT EXISTS snapshot_players(snapshot_id TEXT NOT NULL REFERENCES snapshots(id),career_id TEXT NOT NULL,internal_key TEXT NOT NULL,player_id INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(snapshot_id,internal_key));
      CREATE INDEX IF NOT EXISTS players_history ON snapshot_players(career_id,internal_key);
      CREATE TABLE IF NOT EXISTS player_images(career_id TEXT NOT NULL REFERENCES careers(id),internal_key TEXT NOT NULL,source TEXT NOT NULL,source_path TEXT,hash TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(career_id,internal_key,source));
      INSERT OR IGNORE INTO schema_migrations VALUES(1,datetime('now'));`);
    migrate(this.db, path);
  }
  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
      { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : fallback;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
  settings(): Settings {
    return this.get<Settings>('config', {
      saveDirectory: process.env.FC26_SAVES || '%LOCALAPPDATA%\\EA SPORTS FC 26\\settings',
      headDirectory: 'C:\\FC 26 Live Editor\\mods\\legacy\\data\\ui\\imgAssets\\heads',
      youthHeadDirectory: 'C:\\FC 26 Live Editor\\mods\\legacy\\data\\ui\\imgAssets\\youthheads',
      autoImages: true,
      gameDirectory: '',
    });
  }
  selection(): Selection | null {
    return this.get<Selection | null>('selection', null);
  }
  save(id: string) {
    return this.db.prepare('SELECT * FROM saves WHERE id=?').get(id) as SaveRow | undefined;
  }
  saves(careerId?: string): SaveRow[] {
    return (
      careerId
        ? this.db
            .prepare(
              'SELECT * FROM saves WHERE career_id=? ORDER BY mtime DESC,file_name ASC,path ASC',
            )
            .all(careerId)
        : this.db.prepare('SELECT * FROM saves ORDER BY mtime DESC,file_name ASC,path ASC').all()
    ) as SaveRow[];
  }
  dto(row: SaveRow): SaveEntry {
    return {
      id: row.id,
      careerId: row.career_id,
      fileName: row.file_name,
      modifiedAt: row.mtime,
      size: row.size,
      metadata: this.displayMetadata(row.career_id, JSON.parse(row.metadata) as Metadata),
      error: row.error,
      missing: !!row.missing,
      hash: row.hash,
      changed: !row.imported_hash || !row.hash || row.hash !== row.imported_hash,
    };
  }
  snapshot(careerId: string, snapshotId: string) {
    return this.db
      .prepare('SELECT * FROM snapshots WHERE career_id=? AND id=?')
      .get(careerId, snapshotId) as SnapshotRow | undefined;
  }
  parsed(snapshot: SnapshotRow): ParsedSave {
    const parsed = JSON.parse(snapshot.data) as ParsedSave;
    if (parsed.normalizationVersion !== 2)
      throw new Error('Snapshot requires rating normalization migration');
    parsed.metadata = this.displayMetadata(snapshot.career_id, parsed.metadata);
    // Keep legacy manual entries in SQLite for provenance, but never use them
    // to calculate age or relabel a completed-match date as the current day.
    parsed.metadata.inGameDate = null;
    parsed.metadata.inGameDateSource = null;
    parsed.metadata.warnings = parsed.metadata.warnings.filter(
      (w) => !w.startsWith('Age requires a user-provided'),
    );
    if (!parsed.careerDateInfo)
      parsed.metadata.warnings.push(
        'This older snapshot has no automatic age reference. Refresh its original save to extract match dates.',
      );
    parsed.careerDateInfo ??= unavailableCareerDate();
    parsed.players = parsed.players.map((player) => ({
      ...player,
      age: ageAt(player.birthDate, parsed.careerDateInfo!.referenceDate),
      image: this.image(snapshot.career_id, player.internalKey),
    }));
    return parsed;
  }
  rememberClub(careerId: string, metadata: Metadata) {
    if (metadata.clubId == null) return;
    const resolved = validClubName(metadata.clubName) && metadata.clubNameSource !== 'UNRESOLVED';
    this.db
      .prepare(
        `INSERT INTO career_club_names VALUES(?,?,?,?,?) ON CONFLICT(career_id,team_id) DO UPDATE SET name=excluded.name,name_source=excluded.name_source,updated_at=excluded.updated_at WHERE career_club_names.name_source!='USER'`,
      )
      .run(
        careerId,
        metadata.clubId,
        resolved ? metadata.clubName : null,
        resolved ? 'SAVE' : 'UNRESOLVED',
        new Date().toISOString(),
      );
  }
  displayMetadata(careerId: string, metadata: Metadata): Metadata {
    // Verified custom metadata wins over legacy manual labels. Keep the manual
    // row intact as a fallback for snapshots whose metadata cannot be decoded.
    if (
      metadata.clubNameMethod === 'CUSTOM_METADATA' &&
      metadata.clubNameSource === 'SAVE' &&
      validClubName(metadata.clubName)
    )
      return metadata;
    const entry = this.db
      .prepare('SELECT name,name_source FROM career_club_names WHERE career_id=? AND team_id=?')
      .get(careerId, metadata.clubId ?? -1) as
      { name: string | null; name_source: 'SAVE' | 'USER' | 'UNRESOLVED' } | undefined;
    if (entry?.name_source === 'USER' && entry.name)
      return {
        ...metadata,
        clubName: entry.name,
        clubNameSource: 'USER',
        warnings: metadata.warnings.filter(
          (w) => !w.includes('club name') && !w.includes('club label'),
        ),
      };
    const valid = validClubName(metadata.clubName) && metadata.clubNameSource !== 'UNRESOLVED';
    return {
      ...metadata,
      clubName: valid ? metadata.clubName : 'Unnamed club',
      clubNameSource: valid ? 'SAVE' : 'UNRESOLVED',
    };
  }
  imageRow(careerId: string, key: string, source?: string): ImageRow | undefined {
    return (
      source
        ? this.db
            .prepare(
              'SELECT * FROM player_images WHERE career_id=? AND internal_key=? AND source=?',
            )
            .get(careerId, key, source)
        : this.db
            .prepare(
              "SELECT * FROM player_images WHERE career_id=? AND internal_key=? ORDER BY CASE source WHEN 'MANUAL' THEN 0 ELSE 1 END LIMIT 1",
            )
            .get(careerId, key)
    ) as ImageRow | undefined;
  }
  image(careerId: string, key: string): PlayerImage | undefined {
    const row = this.imageRow(careerId, key);
    return row
      ? {
          source: row.source,
          hash: row.hash,
          updatedAt: row.updated_at,
          url: `/api/careers/${careerId}/players/${key}/image?h=${row.hash}`,
        }
      : undefined;
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
