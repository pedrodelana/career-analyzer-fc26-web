import test from 'node:test';
import assert from 'node:assert/strict';
import { POSITION_ORDER, sortPlayers, type CareerPlayer } from '../packages/shared/src/domain.js';
const player = (
  id: number,
  position: CareerPlayer['primaryPosition'],
  overall: number | null,
): CareerPlayer => ({
  internalKey: String(id),
  playerId: id,
  displayName: `Player ${id}`,
  squadType: 'FIRST_TEAM',
  age: null,
  birthDate: null,
  primaryPosition: position,
  secondaryPositions: [],
  overall,
  potential: null,
  growthMargin: null,
  contractEndYear: null,
  weeklyWage: null,
  appearances: null,
  minutes: null,
  averageRating: null,
  nationality: null,
  imageEligible: true,
});
test('position order is football order in both directions, with overall descending ties', () => {
  const players = POSITION_ORDER.map((position, i) => player(i, position, 50));
  players.push(player(30, 'GOL', 90));
  const ascending = sortPlayers(players, 'primaryPosition', 'asc');
  assert.equal(ascending[0].overall, 90);
  assert.deepEqual(
    ascending.slice(1).map((p) => p.primaryPosition),
    [...POSITION_ORDER],
  );
  const descending = sortPlayers(players, 'primaryPosition', 'desc');
  assert.equal(descending[0].primaryPosition, 'ATA');
  assert.equal(descending.at(-2)?.overall, 90);
});
test('nulls always sort last, zero is a value, neutral preserves input without mutation', () => {
  const players = [player(1, null, null), player(2, 'MC', 0), player(3, 'ATA', 90)];
  assert.deepEqual(
    sortPlayers(players, 'overall', 'asc').map((p) => p.playerId),
    [2, 3, 1],
  );
  assert.deepEqual(
    sortPlayers(players, 'overall', 'desc').map((p) => p.playerId),
    [3, 2, 1],
  );
  assert.deepEqual(sortPlayers(players, 'overall', 'none'), players);
  assert.equal(players[0].playerId, 1);
});

test('birth dates sort chronologically across years, with missing dates last', () => {
  const players = [
    { ...player(1, 'MC', 70), birthDate: '2006-01-01' },
    { ...player(2, 'MC', 70), birthDate: '2005-12-31' },
    player(3, 'MC', 70),
  ];
  assert.deepEqual(
    sortPlayers(players, 'birthDate', 'asc').map((p) => p.playerId),
    [2, 1, 3],
  );
  assert.deepEqual(
    sortPlayers(players, 'birthDate', 'desc').map((p) => p.playerId),
    [1, 2, 3],
  );
});
