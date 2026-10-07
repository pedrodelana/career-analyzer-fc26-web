import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { z, ZodError } from 'zod';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './store.js';
import { Catalog, type Decoder } from './catalog.js';
import { Images } from './images.js';
import { runPython } from './python.js';
import { AppError } from './errors.js';
import { ROOT, WEB_ORIGIN } from './config.js';
import { directory, expandPath } from './paths.js';
import { exportWorkbook } from './export.js';
import type { Diagnostics } from '../../../packages/shared/src/domain.js';
import { compareRatings } from '../../../packages/shared/src/domain.js';
const paramsSchema = z.object({
  careerId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  internalKey: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,100}$/)
    .optional(),
});
const querySchema = z.object({
  snapshotId: z.string().uuid().optional(),
  type: z.enum(['FIRST_TEAM', 'YOUTH']).optional(),
});
const settingsSchema = z
  .object({
    saveDirectory: z.string().min(1).max(4096),
    headDirectory: z.string().min(1).max(4096),
    youthHeadDirectory: z.string().min(1).max(4096),
    autoImages: z.boolean(),
    gameDirectory: z.string().max(4096),
  })
  .strict();
export async function createServer(
  options: { store?: Store; decoder?: Decoder; images?: Images; logger?: boolean } = {},
) {
  const store = options.store ?? new Store();
  const catalog = new Catalog(store, options.decoder);
  const images = options.images ?? new Images(store);
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 1024 * 1024 });
  let busy = false;
  const origins = new Set([WEB_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173']);
  app.addHook('onRequest', async (request) => {
    const host = request.headers.host?.split(':')[0];
    if (host !== '127.0.0.1' && host !== 'localhost')
      throw new AppError('INVALID_HOST', 'Use the local application address.', 403);
    if (request.headers.origin && !origins.has(request.headers.origin))
      throw new AppError('INVALID_ORIGIN', 'This origin cannot access the local application.', 403);
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers['x-fc26-client'] !== 'local-web'
    )
      throw new AppError('INVALID_CLIENT', 'Use the local application to make changes.', 403);
  });
  await app.register(cors, {
    origin: [...origins],
    allowedHeaders: ['Content-Type', 'X-FC26-Client'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
  await app.register(multipart, {
    limits: { files: 1, fileSize: 10 * 1024 * 1024, fields: 0, parts: 1 },
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    if (error instanceof AppError)
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some submitted values are invalid. Check the fields and try again.',
        },
      });
    const status =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    return reply.code(status >= 400 && status < 500 ? status : 500).send({
      error: {
        code: 'REQUEST_FAILED',
        message:
          status === 413
            ? 'The upload is too large. Maximum size is 10 MB.'
            : 'The operation could not be completed. Check the local server logs.',
      },
    });
  });
  const mutate = async <T>(operation: () => Promise<T> | T): Promise<T> => {
    if (busy)
      throw new AppError(
        'OPERATION_IN_PROGRESS',
        'Another operation is running. Wait for it to finish.',
        409,
      );
    busy = true;
    try {
      return await operation();
    } finally {
      busy = false;
    }
  };
  app.get('/api/health', async () => ({ ok: true, service: 'FC26 Career Analyzer', busy }));
  app.get('/api/settings', async () => ({
    settings: store.settings(),
    selection: store.selection(),
  }));
  app.put('/api/settings', async (request) =>
    mutate(async () => {
      const body = settingsSchema.parse(request.body);
      const previous = store.settings();
      // Missing optional defaults are allowed until changed by the user.
      for (const key of [
        'saveDirectory',
        'headDirectory',
        'youthHeadDirectory',
        'gameDirectory',
      ] as const)
        if (body[key] && body[key] !== previous[key]) body[key] = await directory(body[key]);
      store.set('config', body);
      return { settings: body };
    }),
  );
  app.get('/api/diagnostics', async (): Promise<Diagnostics> => {
    let python = { python: false, pillow: false, parser: false };
    try {
      python = await runPython('doctor');
    } catch {
      /* Report setup problems without hiding the application. */
    }
    const config = store.settings();
    return {
      ...python,
      node: process.version,
      globalNames: existsSync(join(ROOT, 'data/global_names.json')),
      saveDirectory: existsSync(expandPath(config.saveDirectory)),
      headDirectory: existsSync(expandPath(config.headDirectory)),
      youthHeadDirectory: existsSync(expandPath(config.youthHeadDirectory)),
    };
  });
  app.post('/api/names/generate', async () =>
    mutate(async () => {
      const game = store.settings().gameDirectory;
      if (game) await directory(game);
      return runPython('names', game);
    }),
  );
  app.get('/api/careers', async () => ({
    careers: catalog.careers(),
    selection: store.selection(),
  }));
  app.get('/api/careers/:careerId/settings', async (request) => {
    const { careerId } = paramsSchema.parse(request.params);
    const query = z
      .object({
        saveId: z
          .string()
          .regex(/^[a-f0-9]{32}$/)
          .optional(),
      })
      .parse(request.query);
    return catalog.careerSettings(careerId, query.saveId);
  });
  app.put('/api/careers/:careerId/settings', async (request) =>
    mutate(() => {
      const { careerId } = paramsSchema.parse(request.params);
      const body = z
        .object({
          saveId: z
            .string()
            .regex(/^[a-f0-9]{32}$/)
            .optional(),
          clubName: z.string().max(100).nullable().optional(),
        })
        .strict()
        .parse(request.body);
      return catalog.updateCareerSettings(careerId, body);
    }),
  );
  app.post('/api/saves/discover', async () => mutate(() => catalog.discover()));
  app.get('/api/careers/:careerId/saves', async (request) => {
    const { careerId } = paramsSchema.parse(request.params);
    return { saves: store.saves(careerId).map((row) => store.dto(row)) };
  });
  app.post('/api/careers/:careerId/select', async (request) =>
    mutate(() => {
      const { careerId } = paramsSchema.parse(request.params);
      const body = z
        .object({
          saveId: z
            .string()
            .regex(/^[a-f0-9]{32}$/)
            .optional(),
        })
        .strict()
        .parse(request.body ?? {});
      return catalog.select(careerId, body.saveId);
    }),
  );
  app.post('/api/careers/:careerId/refresh', async (request) =>
    mutate(async () => {
      const { careerId } = paramsSchema.parse(request.params);
      const current = await catalog.refresh(careerId);
      const sync = await images.sync(careerId, current.data?.players ?? []);
      return {
        ...catalog.current(careerId),
        imageWarnings: sync.warnings,
        imagesUpdated: sync.updated,
      };
    }),
  );
  app.put('/api/careers/:careerId/player-record', async (request) =>
    mutate(() => {
      const { careerId } = paramsSchema.parse(request.params);
      const body = z
        .object({
          snapshotId: z.string().uuid(),
          playerId: z.number().int().nonnegative(),
          squadType: z.enum(['FIRST_TEAM', 'YOUTH']),
          recordKey: z.string().min(1).max(200).nullable(),
        })
        .strict()
        .parse(request.body);
      return catalog.resolvePlayerRecord(careerId, body);
    }),
  );
  app.get('/api/careers/:careerId/current', async (request) => {
    const { careerId } = paramsSchema.parse(request.params);
    return catalog.current(careerId);
  });
  app.get('/api/careers/:careerId/players', async (request) => {
    const { careerId } = paramsSchema.parse(request.params);
    const query = querySchema.parse(request.query);
    const snapshot = catalog.scopedSnapshot(careerId, query.snapshotId);
    const parsed = store.parsed(snapshot);
    return {
      snapshotId: snapshot.id,
      players: parsed.players.filter((p) => !query.type || p.squadType === query.type),
      integrity: parsed.integrity,
      issues: parsed.issues,
    };
  });
  function playerContext(params: unknown, query: unknown) {
    const { careerId, internalKey } = paramsSchema.parse(params);
    const { snapshotId } = querySchema.parse(query);
    const snapshot = catalog.scopedSnapshot(careerId, snapshotId);
    const player = store.parsed(snapshot).players.find((p) => p.internalKey === internalKey);
    if (!player)
      throw new AppError('PLAYER_NOT_FOUND', 'This player is not in the selected snapshot.', 404);
    return { careerId, player, snapshot };
  }
  app.get('/api/careers/:careerId/players/:internalKey', async (request) => {
    const { careerId, player } = playerContext(request.params, request.query);
    const history = store.db
      .prepare(
        'SELECT p.data,s.created_at,s.id AS snapshot_id,s.save_id FROM snapshot_players p JOIN snapshots s ON s.id=p.snapshot_id WHERE p.career_id=? AND p.internal_key=? ORDER BY s.created_at',
      )
      .all(careerId, player.internalKey) as {
      data: string;
      created_at: string;
      snapshot_id: string;
      save_id: string;
    }[];
    const normalized = history.map((row) => ({
      ...row,
      data: store
        .parsed(store.snapshot(careerId, row.snapshot_id)!)
        .players.find((p) => p.internalKey === player.internalKey)!,
    }));
    return {
      player,
      history: normalized.map((row, index) => ({
        ...row,
        change: index ? compareRatings(normalized[index - 1].data, row.data) : null,
      })),
    };
  });
  app.get('/api/careers/:careerId/history', async (request) => {
    const { careerId } = paramsSchema.parse(request.params);
    catalog.selection(careerId);
    return {
      snapshots: store.db
        .prepare(
          'SELECT id,save_id,hash,created_at FROM snapshots WHERE career_id=? ORDER BY created_at DESC',
        )
        .all(careerId),
    };
  });
  app.post('/api/careers/:careerId/players/:internalKey/image', async (request) =>
    mutate(async () => {
      const { careerId, player } = playerContext(request.params, request.query);
      const upload = await request.file();
      if (!upload) throw new AppError('IMAGE_REQUIRED', 'Choose a DDS, PNG, JPEG or WEBP image.');
      const buffer = await upload.toBuffer();
      await images.import(careerId, player.internalKey, buffer, 'MANUAL');
      return { image: store.image(careerId, player.internalKey) };
    }),
  );
  app.delete('/api/careers/:careerId/players/:internalKey/image', async (request) =>
    mutate(() => {
      const { careerId, player } = playerContext(request.params, request.query);
      store.db
        .prepare(
          "DELETE FROM player_images WHERE career_id=? AND internal_key=? AND source='MANUAL'",
        )
        .run(careerId, player.internalKey);
      return { image: store.image(careerId, player.internalKey) ?? null };
    }),
  );
  app.get('/api/careers/:careerId/players/:internalKey/image', async (request, reply) => {
    const { careerId, internalKey } = paramsSchema.parse(request.params);
    catalog.selection(careerId);
    if (!internalKey) throw new AppError('PLAYER_NOT_FOUND', 'Player not found.', 404);
    const snapshot = catalog.scopedSnapshot(careerId);
    if (!store.parsed(snapshot).players.some((p) => p.internalKey === internalKey))
      throw new AppError('PLAYER_NOT_FOUND', 'Player not found in the active snapshot.', 404);
    const path = await images.file(careerId, internalKey);
    return reply
      .type('image/webp')
      .header('Cache-Control', 'private, no-cache')
      .send(await readFile(path));
  });
  app.get('/api/careers/:careerId/export/xlsx', async (request, reply) => {
    const { careerId } = paramsSchema.parse(request.params);
    const { snapshotId } = querySchema.parse(request.query);
    const snapshot = catalog.scopedSnapshot(careerId, snapshotId);
    const selection = catalog.selection(careerId);
    if (snapshot.save_id !== selection.saveId)
      throw new AppError(
        'SAVE_NOT_SELECTED',
        'Export is restricted to the currently selected save.',
        409,
      );
    const result = await exportWorkbook(store, images, snapshot);
    return reply
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .send(result.bytes);
  });
  app.addHook('onClose', async () => {
    if (!options.store) store.close();
  });
  return app;
}
