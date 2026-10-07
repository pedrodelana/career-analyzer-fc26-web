import { mkdtemp, writeFile, utimes, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../apps/api/src/config.js';
import { Store } from '../apps/api/src/store.js';
import { Catalog, type Decoder } from '../apps/api/src/catalog.js';
import type { Metadata, ParsedSave, CareerPlayer } from '../packages/shared/src/domain.js';
export const metadata = (id: string | null = 'a', club = 'Same Club'): Metadata => ({
  clubId: 1,
  clubName: club,
  inGameDate: null,
  careerIdentifier: id,
  identityStatus: id ? 'CONFIRMED' : 'UNCONFIRMED',
  evidence: id ? ['Synthetic fixture persistent identifier'] : [],
  warnings: [],
});
export const fixturePlayer: CareerPlayer = {
  internalKey: 'record-1',
  playerId: 7,
  displayName: 'Synthetic Player',
  squadType: 'FIRST_TEAM',
  age: 20,
  birthDate: '2006-01-01',
  primaryPosition: 'MC',
  secondaryPositions: [],
  overall: 70,
  potential: 80,
  growthMargin: 10,
  contractEndYear: 2029,
  weeklyWage: 1000,
  appearances: null,
  minutes: null,
  averageRating: null,
  nationality: null,
  imageEligible: true,
};
export const parsed = (meta = metadata()): ParsedSave => ({
  careerDateInfo: {
    lastMatchDate: null,
    nextMatchDate: null,
    referenceDate: null,
    referenceDateSource: 'UNAVAILABLE',
  },
  normalizationVersion: 2,
  metadata: meta,
  players: [fixturePlayer],
  integrity: {
    firstTeamExpected: 1,
    firstTeamResolved: 1,
    youthExpected: 0,
    youthResolved: 0,
    ambiguousCount: 0,
    unresolvedCount: 0,
  },
  issues: [],
  decisions: [],
});
export async function setup() {
  await mkdir(join(ROOT, '.tools/test-data'), { recursive: true });
  const dir = await mkdtemp(join(ROOT, '.tools/test-data/catalog-'));
  const store = new Store(':memory:');
  store.set('config', { ...store.settings(), saveDirectory: dir, autoImages: false });
  let reads = 0;
  const decoder: Decoder = {
    metadata: async (path) => {
      reads++;
      const text = await readFile(path, 'utf8');
      if (text === 'broken') throw new Error('broken');
      return metadata(...(JSON.parse(text) as [string | null, string]));
    },
    parse: async (path) =>
      parsed(metadata(...(JSON.parse(await readFile(path, 'utf8')) as [string | null, string]))),
  };
  const catalog = new Catalog(store, decoder);
  return { dir, store, catalog, decoder, reads: () => reads };
}
export async function saveFile(
  dir: string,
  name: string,
  id: string | null,
  club = 'Same Club',
  time = '2026-01-01T00:00:00Z',
) {
  const path = join(dir, name);
  await writeFile(path, JSON.stringify([id, club]));
  await utimes(path, new Date(time), new Date(time));
  return path;
}
