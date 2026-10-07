import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type {
  Career,
  Metadata,
  ParsedSave,
  Selection,
  Current,
  CareerSettings,
} from '../../../packages/shared/src/domain.js';
import { POSITION_ORDER, validClubName, isValidDate } from '../../../packages/shared/src/domain.js';
import { Store, type SaveRow, type SnapshotRow } from './store.js';
import { directory, safeFile } from './paths.js';
import { runPython } from './python.js';
import { AppError } from './errors.js';
import { ROOT } from './config.js';
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const metadataSchema = z.object({
  clubNameSource: z.enum(['SAVE', 'USER', 'UNRESOLVED']).optional(),
  clubNameMethod: z.enum(['TEAM_TABLE', 'CUSTOM_METADATA']).nullable().optional(),
  clubNameEvidence: z.array(z.string()).optional(),
  clubId: z.number().nullable(),
  clubName: z.string().min(1),
  inGameDate: z.string().nullable(),
  careerIdentifier: z.string().nullable(),
  identityStatus: z.enum(['CONFIRMED', 'UNCONFIRMED', 'ERROR']),
  evidence: z.array(z.string()),
  warnings: z.array(z.string()),
});
const maybeNumber = z.number().finite().nullable();
const playerSchema = z.object({
  attributes: z.record(z.string(), maybeNumber).optional(),
  rawRatings: z
    .object({
      overall: maybeNumber,
      potential: maybeNumber,
      attributes: z.record(z.string(), maybeNumber),
    })
    .optional(),
  internalKey: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  playerId: z.number().int().nonnegative(),
  displayName: z.string(),
  squadType: z.enum(['FIRST_TEAM', 'YOUTH']),
  age: maybeNumber,
  birthDate: z.string().nullable(),
  primaryPosition: z.enum(POSITION_ORDER).nullable(),
  secondaryPositions: z.array(z.enum(POSITION_ORDER)),
  overall: maybeNumber,
  potential: maybeNumber,
  growthMargin: maybeNumber,
  contractEndYear: maybeNumber,
  weeklyWage: maybeNumber,
  appearances: maybeNumber,
  minutes: maybeNumber,
  averageRating: maybeNumber,
  nationality: z.string().nullable(),
  imageEligible: z.boolean(),
});
const parsedSchema = z.object({
  careerDateInfo: z
    .object({
      lastMatchDate: z.string().refine(isValidDate).nullable(),
      nextMatchDate: z.string().refine(isValidDate).nullable(),
      referenceDate: z.string().refine(isValidDate).nullable(),
      referenceDateSource: z.enum(['SAVE_LAST_MATCH', 'MATCH_HISTORY', 'UNAVAILABLE']),
    })
    .refine(
      (d) =>
        d.referenceDate === d.lastMatchDate &&
        (d.referenceDateSource === 'UNAVAILABLE'
          ? d.referenceDate === null
          : d.referenceDate !== null),
    ),
  normalizationVersion: z.literal(2),
  metadata: metadataSchema,
  players: z.array(playerSchema),
  integrity: z.object({
    firstTeamExpected: z.number().int().nonnegative(),
    firstTeamResolved: z.number().int().nonnegative(),
    youthExpected: z.number().int().nonnegative(),
    youthResolved: z.number().int().nonnegative(),
    ambiguousCount: z.number().int().nonnegative(),
    unresolvedCount: z.number().int().nonnegative(),
  }),
  issues: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      playerId: z.number().optional(),
      squadType: z.enum(['FIRST_TEAM', 'YOUTH']).optional(),
      candidates: z
        .array(
          z.object({
            recordKey: z.string(),
            displayName: z.string(),
            birthDate: z.string().nullable(),
            overall: maybeNumber,
            player: playerSchema.optional(),
          }),
        )
        .optional(),
    }),
  ),
  decisions: z.array(z.object({ playerId: z.number(), reason: z.string() })),
});
export interface Decoder {
  metadata(path: string): Promise<Metadata>;
  parse(path: string): Promise<ParsedSave>;
}
const defaultDecoder: Decoder = {
  metadata: (path) => runPython('metadata', path),
  parse: (path) => runPython('parse', path),
};
export function careerIdentity(metadata: Metadata, saveId: string): string {
  if (
    metadata.identityStatus === 'CONFIRMED' &&
    metadata.careerIdentifier &&
    metadata.evidence.length
  )
    return `career-${digest(metadata.careerIdentifier).slice(0, 32)}`;
  return `local-${saveId}`;
}
export class Catalog {
  constructor(
    public store: Store,
    public decoder: Decoder = defaultDecoder,
  ) {}
  async discover() {
    const revision = digest(
      Buffer.concat(
        await Promise.all(
          ['main.py', 'club_names.py'].map((file) => readFile(join(ROOT, 'parser/src', file))),
        ),
      ),
    );
    const cacheCurrent = this.store.get<string>('metadataRevision', '') === revision;
    const folder = await directory(this.store.settings().saveDirectory);
    const entries = (await readdir(folder, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && /^cmmgr/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    const scanned: SaveRow[] = [];
    for (const entry of entries) {
      const path = join(folder, entry.name);
      const id = digest(process.platform === 'win32' ? path.toLowerCase() : path).slice(0, 32);
      const old = this.store.save(id);
      let size = 0,
        mtime = '',
        error: string | null = null,
        hash: string | null = null;
      let metadata: Metadata = {
        clubId: null,
        clubName: 'Unidentified club',
        inGameDate: null,
        careerIdentifier: null,
        identityStatus: 'ERROR',
        evidence: [],
        warnings: [],
      };
      try {
        await safeFile(folder, path);
        const info = await stat(path);
        size = info.size;
        mtime = info.mtime.toISOString();
        if (cacheCurrent && old && old.size === size && old.mtime === mtime && !old.error) {
          scanned.push({ ...old, missing: 0 });
          continue;
        }
        metadata = metadataSchema.parse(await this.decoder.metadata(path));
        hash = null;
        if (metadata.identityStatus === 'ERROR')
          error =
            'The controlled club could not be established. This save is retained with its metadata error.';
        if (
          metadata.identityStatus === 'CONFIRMED' &&
          (!metadata.careerIdentifier || !metadata.evidence.length)
        )
          throw new Error('Invalid career identity');
      } catch (cause) {
        error =
          cause instanceof AppError
            ? cause.message
            : 'Save metadata could not be read. The file remains available in the library.';
        console.error(
          JSON.stringify({ code: 'SAVE_METADATA_ERROR', file: entry.name, detail: String(cause) }),
        );
      }
      const careerId = careerIdentity(metadata, id);
      scanned.push({
        id,
        career_id: careerId,
        path,
        file_name: entry.name,
        size,
        mtime,
        metadata: JSON.stringify(metadata),
        error,
        missing: 0,
        hash,
        imported_hash: old?.career_id === careerId ? old.imported_hash : null,
      });
    }
    this.store.transaction(() => {
      this.store.db.prepare('UPDATE saves SET missing=1').run();
      for (const row of scanned) {
        const metadata = JSON.parse(row.metadata) as Metadata;
        this.store.db
          .prepare(
            'INSERT INTO careers VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET identity_status=excluded.identity_status,evidence=excluded.evidence',
          )
          .run(row.career_id, metadata.identityStatus, JSON.stringify(metadata.evidence));
        this.store.rememberClub(row.career_id, metadata);
        this.store.db
          .prepare(
            `INSERT INTO saves(id,career_id,path,file_name,size,mtime,metadata,error,missing,hash,imported_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET career_id=excluded.career_id,path=excluded.path,file_name=excluded.file_name,size=excluded.size,mtime=excluded.mtime,metadata=excluded.metadata,error=excluded.error,missing=0,hash=excluded.hash,imported_hash=excluded.imported_hash`,
          )
          .run(
            row.id,
            row.career_id,
            row.path,
            row.file_name,
            row.size,
            row.mtime,
            row.metadata,
            row.error,
            0,
            row.hash,
            row.imported_hash,
          );
      }
      this.store.set('metadataRevision', revision);
    });
    return {
      careers: this.careers(),
      files: scanned.length,
      errors: scanned.filter((row) => row.error).length,
    };
  }
  careers(): Career[] {
    const groups = new Map<string, SaveRow[]>();
    for (const save of this.store.saves()) {
      // Keep absent files and their history in SQLite, outside the active library.
      if (save.missing) continue;
      const group = groups.get(save.career_id) ?? [];
      group.push(save);
      groups.set(save.career_id, group);
    }
    return [...groups].map(([id, saves]) => {
      const latest = saves[0];
      const metadata = this.store.dto(latest).metadata;
      return {
        id,
        identityStatus: metadata.identityStatus,
        clubName: metadata.clubName,
        saveCount: saves.length,
        latestSave: this.store.dto(latest),
        evidence: metadata.evidence,
      };
    });
  }
  select(careerId: string, saveId?: string): Selection {
    const saves = this.store.saves(careerId);
    if (!saves.length)
      throw new AppError('CAREER_NOT_FOUND', 'This career is not in the library.', 404);
    const save = saveId
      ? saves.find((row) => row.id === saveId)
      : saves.find((row) => !row.missing);
    if (!save)
      throw new AppError(
        'SAVE_NOT_IN_SELECTED_CAREER',
        'Choose a save that belongs to this career.',
      );
    if (save.missing || !existsSync(save.path))
      throw new AppError(
        'SELECTED_SAVE_MISSING',
        'The selected save is missing. Choose another save explicitly.',
        404,
      );
    if (this.store.dto(save).metadata.clubNameSource === 'UNRESOLVED' && !save.error)
      throw new AppError(
        'CLUB_NAME_REQUIRED',
        'Enter the club name in Career settings before opening this career.',
        409,
      );
    const selection: Selection = {
      careerId,
      saveId: save.id,
      mode: saveId ? 'PINNED_SAVE' : 'LATEST_IN_CAREER',
    };
    this.store.set('selection', selection);
    this.store.set(`selection:${careerId}`, selection);
    return selection;
  }
  selection(careerId: string): Selection {
    const active = this.store.selection();
    if (active?.careerId !== careerId)
      throw new AppError('CAREER_NOT_SELECTED', 'Select this career before continuing.', 409);
    return active;
  }
  current(careerId: string): Current {
    const selection = this.selection(careerId);
    const save = this.store.save(selection.saveId);
    if (!save || save.career_id !== careerId)
      throw new AppError(
        'CAREER_IDENTITY_CONFLICT',
        'The selected file now belongs to a different or unconfirmed career. Select it again.',
        409,
      );
    const snapshotId = this.store.get<string | null>(`current:${careerId}:${save.id}`, null);
    const snapshot = snapshotId ? this.store.snapshot(careerId, snapshotId) : undefined;
    const latest = this.store.saves(careerId).find((row) => !row.missing);
    const data = snapshot ? this.store.parsed(snapshot) : null;
    const saveDto = this.store.dto(save);
    if (data && snapshot?.hash === save.hash) {
      saveDto.metadata.inGameDate = data.metadata.inGameDate;
      saveDto.metadata.inGameDateSource = data.metadata.inGameDateSource;
    }
    return {
      careerId,
      save: saveDto,
      latestSave: latest ? this.store.dto(latest) : null,
      mode: selection.mode,
      snapshotId: snapshot?.id ?? null,
      createdAt: snapshot?.created_at ?? null,
      data,
      imageWarnings: [],
      changes: null,
    };
  }
  async refresh(careerId: string): Promise<Current> {
    const original = this.selection(careerId);
    await this.discover();
    const selected = this.store.save(original.saveId);
    // A disappeared selected file always requires an explicit replacement.
    if (!selected || selected.missing)
      throw new AppError(
        'SELECTED_SAVE_MISSING',
        'Your selected save is missing. Choose a save explicitly.',
        409,
      );
    if (selected.career_id !== careerId)
      throw new AppError(
        'CAREER_IDENTITY_CONFLICT',
        'Save identity changed. Return to the library and select it again.',
        409,
      );
    const target =
      original.mode === 'PINNED_SAVE'
        ? selected
        : this.store.saves(careerId).find((row) => !row.missing);
    if (!target)
      throw new AppError(
        'SELECTED_SAVE_MISSING',
        'There are no available saves in this career.',
        404,
      );
    const path = await safeFile(await directory(this.store.settings().saveDirectory), target.path);
    const hash = await fileHash(path);
    // For an unconfirmed identity, changed contents are a new provisional
    // record context; manual images/history cannot silently cross overwrites.
    const names = join(ROOT, 'data/global_names.json');
    const normalizerKey = digest(
      Buffer.concat([
        await readFile(join(ROOT, 'parser/src/main.py')),
        await readFile(join(ROOT, 'parser/src/normalize.py')),
        await readFile(join(ROOT, 'parser/src/ratings.py')),
        await readFile(join(ROOT, 'parser/src/club_names.py')),
        await readFile(join(ROOT, 'parser/src/career_dates.py')),
        existsSync(names) ? await readFile(names) : Buffer.from('no-names'),
      ]),
    );
    let snapshot = this.store.db
      .prepare(
        'SELECT * FROM snapshots WHERE career_id=? AND save_id=? AND hash=? AND normalizer_key=?',
      )
      .get(careerId, target.id, hash, normalizerKey) as SnapshotRow | undefined;
    if (!snapshot) {
      const parsed: ParsedSave = parsedSchema.parse(await this.decoder.parse(path));
      parsed.source = { fileName: target.file_name, modifiedAt: target.mtime, size: target.size };
      if (careerIdentity(parsed.metadata, target.id) !== careerId)
        throw new AppError(
          'CAREER_IDENTITY_CONFLICT',
          'The parsed save does not match the selected career.',
          409,
        );
      if (hash !== (await fileHash(path)))
        throw new AppError(
          'SAVE_CHANGED_DURING_READ',
          'The game changed this save while it was being read. Try refreshing again.',
          409,
        );
      this.store.rememberClub(careerId, parsed.metadata);
      if (parsed.metadata.identityStatus !== 'CONFIRMED')
        for (const player of [
          ...parsed.players,
          ...parsed.issues.flatMap((issue) =>
            (issue.candidates ?? []).flatMap((candidate) =>
              candidate.player ? [candidate.player] : [],
            ),
          ),
        ])
          player.internalKey = digest(`${hash}:${player.internalKey}`).slice(0, 32);
      if (new Set(parsed.players.map((p) => p.internalKey)).size !== parsed.players.length)
        throw new AppError(
          'PLAYER_RECORD_AMBIGUOUS',
          'The parser returned conflicting player identities.',
        );
      if (
        parsed.players.filter((p) => p.squadType === 'FIRST_TEAM').length !==
          parsed.integrity.firstTeamResolved ||
        parsed.players.filter((p) => p.squadType === 'YOUTH').length !==
          parsed.integrity.youthResolved
      )
        throw new AppError('INTEGRITY_ERROR', 'The parser returned inconsistent player counts.');
      snapshot = {
        id: randomUUID(),
        career_id: careerId,
        save_id: target.id,
        hash,
        created_at: new Date().toISOString(),
        data: JSON.stringify(parsed),
        normalizer_key: normalizerKey,
      };
      const fresh = snapshot;
      this.store.transaction(() => {
        this.store.db
          .prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,?,?)')
          .run(fresh.id, careerId, target.id, hash, fresh.created_at, fresh.data, normalizerKey);
        for (const player of parsed.players)
          this.store.db
            .prepare('INSERT INTO snapshot_players VALUES(?,?,?,?,?)')
            .run(fresh.id, careerId, player.internalKey, player.playerId, JSON.stringify(player));
      });
    }
    this.store.transaction(() => {
      this.store.db
        .prepare('UPDATE saves SET hash=?,imported_hash=? WHERE id=?')
        .run(hash, hash, target.id);
      const selection = { ...original, saveId: target.id };
      this.store.set('selection', selection);
      this.store.set(`selection:${careerId}`, selection);
      this.store.set(`current:${careerId}:${target.id}`, snapshot.id);
    });
    return this.current(careerId);
  }
  resolvePlayerRecord(
    careerId: string,
    body: {
      snapshotId: string;
      playerId: number;
      squadType: 'FIRST_TEAM' | 'YOUTH';
      recordKey: string | null;
    },
  ): Current {
    const snapshot = this.scopedSnapshot(careerId);
    if (snapshot.id !== body.snapshotId)
      throw new AppError(
        'SNAPSHOT_CHANGED',
        'The selected snapshot changed. Reload before choosing a player.',
        409,
      );
    const parsed = JSON.parse(snapshot.data) as ParsedSave;
    const issues = parsed.issues.filter(
      (issue) =>
        issue.playerId === body.playerId &&
        issue.squadType === body.squadType &&
        ['PLAYER_RECORD_AMBIGUOUS', 'PLAYER_RECORD_USER_SELECTED'].includes(issue.code),
    );
    if (issues.length !== 1)
      throw new AppError(
        'PLAYER_RECORD_NOT_SELECTABLE',
        'This player has no unique conflict to resolve.',
        409,
      );
    const issue = issues[0];
    const choices = issue.candidates?.filter((c) => c.recordKey === body.recordKey) ?? [];
    const chosen = choices.length === 1 ? choices[0].player : undefined;
    if (
      body.recordKey !== null &&
      (!chosen || chosen.playerId !== body.playerId || chosen.squadType !== body.squadType)
    )
      throw new AppError(
        'PLAYER_RECORD_NOT_SELECTABLE',
        'Refresh the save and choose an available player record.',
        409,
      );
    const previous = issue.candidates?.find((c) => c.recordKey === issue.selectedRecordKey)?.player;
    if (previous)
      parsed.players = parsed.players.filter((p) => p.internalKey !== previous.internalKey);
    if (
      chosen &&
      parsed.players.some(
        (p) => p.internalKey === chosen.internalKey || p.playerId === chosen.playerId,
      )
    )
      throw new AppError(
        'PLAYER_RECORD_AMBIGUOUS',
        'The chosen record conflicts with another roster entry.',
        409,
      );
    const count = body.squadType === 'YOUTH' ? 'youthResolved' : 'firstTeamResolved';
    if (previous) {
      parsed.integrity[count]--;
      parsed.integrity.ambiguousCount++;
    }
    if (chosen) {
      // A user identifies the roster record, not ID-only history or images.
      parsed.players.push({
        ...chosen,
        imageEligible: false,
        weeklyWage: null,
        appearances: null,
        minutes: null,
        averageRating: null,
      });
      parsed.integrity[count]++;
      parsed.integrity.ambiguousCount--;
      issue.code = 'PLAYER_RECORD_USER_SELECTED';
      issue.selectedRecordKey = body.recordKey!;
      issue.message = `${chosen.displayName}: record selected by the user for this snapshot only. ID-only match statistics, wages and automatic images remain unassigned.`;
    } else {
      issue.code = 'PLAYER_RECORD_AMBIGUOUS';
      delete issue.selectedRecordKey;
      issue.message = `Player ${body.playerId}: ${issue.candidates?.length ?? 0} candidate records; active record could not be established.`;
    }
    this.store.transaction(() => {
      this.store.db
        .prepare('UPDATE snapshots SET data=? WHERE id=? AND career_id=?')
        .run(JSON.stringify(parsed), snapshot.id, careerId);
      if (previous)
        this.store.db
          .prepare(
            'DELETE FROM snapshot_players WHERE snapshot_id=? AND career_id=? AND internal_key=?',
          )
          .run(snapshot.id, careerId, previous.internalKey);
      if (chosen) {
        const player = parsed.players[parsed.players.length - 1];
        this.store.db
          .prepare('INSERT INTO snapshot_players VALUES(?,?,?,?,?)')
          .run(snapshot.id, careerId, player.internalKey, player.playerId, JSON.stringify(player));
      }
    });
    return this.current(careerId);
  }
  scopedSnapshot(careerId: string, snapshotId?: string): SnapshotRow {
    const selection = this.selection(careerId);
    const id =
      snapshotId ?? this.store.get<string | null>(`current:${careerId}:${selection.saveId}`, null);
    const snapshot = id ? this.store.snapshot(careerId, id) : undefined;
    if (!snapshot)
      throw new AppError(
        'SNAPSHOT_NOT_FOUND',
        'Refresh the selected save to create a snapshot.',
        404,
      );
    return snapshot;
  }
  careerSettings(careerId: string, saveId?: string): CareerSettings {
    const active = this.store.selection();
    const saves = this.store.saves(careerId);
    const targetId = saveId ?? (active?.careerId === careerId ? active.saveId : undefined);
    const save = targetId
      ? saves.find((s) => s.id === targetId)
      : (saves.find((s) => !s.missing) ?? saves[0]);
    if (!save) throw new AppError('CAREER_NOT_FOUND', 'This career or save was not found.', 404);
    const meta = this.store.dto(save).metadata;
    return {
      careerId,
      teamId: meta.clubId,
      saveId: save.id,
      clubName: meta.clubNameSource === 'UNRESOLVED' ? '' : meta.clubName,
      clubNameSource: meta.clubNameSource ?? 'UNRESOLVED',
      automaticClubName:
        meta.clubNameMethod === 'CUSTOM_METADATA' && meta.clubNameSource === 'SAVE',
    };
  }
  updateCareerSettings(
    careerId: string,
    body: {
      saveId?: string;
      clubName?: string | null;
    },
  ): CareerSettings {
    const settings = this.careerSettings(careerId, body.saveId);
    if (settings.automaticClubName && typeof body.clubName === 'string')
      throw new AppError(
        'CLUB_NAME_FROM_SAVE',
        'The custom club name was recovered from this save. Manual naming is available when it cannot be recovered.',
      );
    if (body.clubName !== undefined && settings.teamId == null)
      throw new AppError(
        'CLUB_NOT_RESOLVED',
        'The controlled team must be identified before assigning a name.',
      );
    if (typeof body.clubName === 'string' && !validClubName(body.clubName))
      throw new AppError(
        'INVALID_CLUB_NAME',
        'Enter a club name of 1–100 characters. Generic placeholders are not accepted.',
      );
    this.store.transaction(() => {
      if (body.clubName !== undefined) {
        const raw = JSON.parse(this.store.save(settings.saveId)!.metadata) as Metadata;
        const name =
          body.clubName === null
            ? validClubName(raw.clubName)
              ? raw.clubName
              : null
            : body.clubName.trim();
        this.store.db
          .prepare(
            'INSERT INTO career_club_names VALUES(?,?,?,?,?) ON CONFLICT(career_id,team_id) DO UPDATE SET name=excluded.name,name_source=excluded.name_source,updated_at=excluded.updated_at',
          )
          .run(
            careerId,
            settings.teamId!,
            name,
            body.clubName === null ? (name ? 'SAVE' : 'UNRESOLVED') : 'USER',
            new Date().toISOString(),
          );
      }
    });
    return this.careerSettings(careerId, settings.saveId);
  }
}
