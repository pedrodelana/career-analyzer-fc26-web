import { readFile, writeFile, access, readdir, stat, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './config.js';
import { Store } from './store.js';
import { digest } from './catalog.js';
import { safeFile, directory, internalDirectory, checkOutputFile } from './paths.js';
import { runPython } from './python.js';
import { AppError } from './errors.js';
import type { CareerPlayer } from '../../../packages/shared/src/domain.js';
export class Images {
  constructor(
    public store: Store,
    public base = join(ROOT, 'storage/players'),
    public converter: (input: string, output: string) => Promise<unknown> = (input, output) =>
      runPython('image', input, output),
  ) {}
  async import(
    careerId: string,
    key: string,
    bytes: Buffer,
    source: 'MANUAL' | 'LIVE_EDITOR',
    sourcePath: string | null = null,
  ) {
    if (bytes.length > 10 * 1024 * 1024)
      throw new AppError('IMAGE_TOO_LARGE', 'Images must be smaller than 10 MB.', 413);
    const hash = digest(bytes);
    const cached = this.store.imageRow(careerId, key, source);
    const original = join(this.base, 'original', hash);
    const web = join(this.base, 'web', `${hash}.webp`);
    await internalDirectory(join(this.base, 'original'));
    await internalDirectory(join(this.base, 'web'));
    await checkOutputFile(original);
    await checkOutputFile(web);
    await checkOutputFile(web.replace(/\.webp$/, '.png'));
    let converted = false;
    try {
      await access(web);
      await access(web.replace(/\.webp$/, '.png'));
      converted = true;
    } catch {
      /* New or incomplete cache. */
    }
    if (cached?.hash === hash && converted) return false;
    if (!converted) {
      await writeFile(original, bytes, { flag: 'w' });
      await this.converter(original, web);
    }
    this.store.db
      .prepare(
        'INSERT INTO player_images VALUES(?,?,?,?,?,?) ON CONFLICT(career_id,internal_key,source) DO UPDATE SET source_path=excluded.source_path,hash=excluded.hash,updated_at=excluded.updated_at',
      )
      .run(careerId, key, source, sourcePath, hash, new Date().toISOString());
    return true;
  }
  async sync(
    careerId: string,
    players: CareerPlayer[],
  ): Promise<{ updated: number; warnings: string[] }> {
    if (!this.store.settings().autoImages) return { updated: 0, warnings: [] };
    let updated = 0;
    const warnings: string[] = [];
    const config = this.store.settings();
    const folders = new Map<string, { path: string; names: Map<string, string> } | null>();
    for (const folder of [config.headDirectory, config.youthHeadDirectory]) {
      if (folders.has(folder)) continue;
      try {
        const path = await directory(folder);
        const names = new Map(
          (await readdir(path, { withFileTypes: true }))
            .filter((e) => e.isFile() && !e.isSymbolicLink())
            .map((e) => [e.name.toLowerCase(), e.name]),
        );
        folders.set(folder, { path, names });
      } catch {
        folders.set(folder, null);
        warnings.push('An image source folder is unavailable. Imported images remain available.');
      }
    }
    for (const player of players) {
      if (!player.imageEligible) {
        warnings.push(`Player ${player.playerId}: automatic image association is ambiguous.`);
        continue;
      }
      const source = folders.get(
        player.squadType === 'YOUTH' ? config.youthHeadDirectory : config.headDirectory,
      );
      if (!source) continue;
      const name = ['dds', 'png', 'jpg', 'jpeg', 'webp']
        .map((ext) => source.names.get(`p${player.playerId}.${ext}`))
        .find(Boolean);
      if (!name) continue;
      try {
        const path = await safeFile(source.path, join(source.path, name));
        if ((await stat(path)).size > 10 * 1024 * 1024)
          throw new AppError('IMAGE_TOO_LARGE', 'The source image exceeds 10 MB.');
        if (
          await this.import(careerId, player.internalKey, await readFile(path), 'LIVE_EDITOR', path)
        )
          updated++;
      } catch (error) {
        console.error(
          JSON.stringify({
            code: 'IMAGE_CONVERSION_ERROR',
            player: player.internalKey,
            detail: String(error),
          }),
        );
        warnings.push(`Player ${player.playerId}: the local image could not be imported.`);
      }
    }
    return { updated, warnings: [...new Set(warnings)] };
  }
  async file(careerId: string, key: string, format: 'webp' | 'png' = 'webp'): Promise<string> {
    const row = this.store.imageRow(careerId, key);
    if (!row) throw new AppError('IMAGE_NOT_FOUND', 'No imported image is available.', 404);
    const folder = join(this.base, 'web');
    if ((await lstat(folder)).isSymbolicLink())
      throw new AppError('INVALID_STORAGE_PATH', 'Imported image storage cannot be redirected.');
    const file = await safeFile(folder, join(folder, `${row.hash}.${format}`));
    return safeFile(ROOT, file);
  }
}
