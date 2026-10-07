// Browser checks use the real API with an isolated synthetic catalog.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { setup, saveFile, fixturePlayer, parsed, metadata } from './fixtures.js';
import { createServer } from '../apps/api/src/server.js';
import { ROOT } from '../apps/api/src/config.js';

process.env.PLAYWRIGHT_BROWSERS_PATH = join(ROOT, '.tools/browsers');
const { chromium, expect } = await import('@playwright/test');
const f = await setup();
const base = f.decoder.metadata;
let recoverCustomName = false;
f.decoder.metadata = async (path) => {
  const meta = await base(path);
  return recoverCustomName && path.endsWith('CmMgrCreatedA')
    ? {
        ...meta,
        clubName: 'River City Athletic',
        clubNameSource: 'SAVE',
        clubNameMethod: 'CUSTOM_METADATA',
      }
    : meta;
};
let referenceDate = '2026-03-14';
let duplicatePlayer = false;
f.decoder.parse = async (path) => {
  const data = parsed(await f.decoder.metadata(path));
  data.players = [
    {
      ...fixturePlayer,
      displayName: 'Daniel Woolley',
      overall: 69,
      potential: 69,
      growthMargin: 0,
      attributes: { acceleration: 70 },
    },
    {
      ...fixturePlayer,
      internalKey: 'senior-2',
      playerId: 8,
      displayName: 'Sebastian Herbert',
      overall: 70,
      potential: 70,
      growthMargin: 0,
    },
    {
      ...fixturePlayer,
      internalKey: 'youth-1',
      playerId: 9,
      displayName: 'Arne Christiansen',
      squadType: 'YOUTH',
      overall: 62,
      potential: 95,
      growthMargin: 33,
    },
  ];
  data.integrity = {
    ...data.integrity,
    firstTeamExpected: 2,
    firstTeamResolved: 2,
    youthExpected: 1,
    youthResolved: 1,
  };
  data.players = data.players.map((p) => ({ ...p, birthDate: '2006-03-15' }));
  if (duplicatePlayer) {
    data.integrity.youthExpected++;
    data.integrity.ambiguousCount++;
    data.issues.push({
      code: 'PLAYER_RECORD_AMBIGUOUS',
      playerId: 460059,
      squadType: 'YOUTH',
      message: 'Two records share the same player ID.',
      candidates: ['Costa', 'Young'].map((name, index) => {
        const player = {
          ...fixturePlayer,
          internalKey: `duplicate-${name}`,
          playerId: 460059,
          displayName: name,
          squadType: 'YOUTH' as const,
          overall: index ? 49 : 54,
          birthDate: index ? '2012-03-20' : '2010-03-01',
          imageEligible: false,
        };
        return {
          recordKey: `duplicate-${name}`,
          displayName: name,
          overall: player.overall,
          birthDate: player.birthDate,
          player,
        };
      }),
    });
  }
  if (path.endsWith('CmMgrCreatedA'))
    data.careerDateInfo = {
      lastMatchDate: referenceDate,
      nextMatchDate: '2026-03-17',
      referenceDate,
      referenceDateSource: 'SAVE_LAST_MATCH',
    };
  return data;
};
await saveFile(f.dir, 'CmMgrCreatedA', 'a', 'Create Club Team');
await saveFile(f.dir, 'CmMgrCreatedB', 'b', 'Create Club Team');
await saveFile(f.dir, 'CmMgrOfficial', 'official', 'Official United');
const app = await createServer({ store: f.store, decoder: f.decoder, logger: false });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (!['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('External request blocked');
  if (!url.pathname.startsWith('/api/')) return route.continue();
  const response = await app.inject({
    method: route.request().method() as 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: url.pathname + url.search,
    headers: { ...route.request().headers(), host: '127.0.0.1' },
    payload: route.request().postData() ?? undefined,
  });
  const headers: Record<string, string> = {};
  for (const key of ['content-type', 'content-disposition'])
    if (response.headers[key]) headers[key] = String(response.headers[key]);
  await route.fulfill({ status: response.statusCode, headers, body: response.rawPayload });
});
const idle = () => expect(page.locator('.banner.loading')).toHaveCount(0);
const dialog = page.getByRole('dialog');
try {
  await page.goto('http://127.0.0.1:5173');
  await idle();
  await expect(page.locator('.career-card')).toHaveCount(3);
  await expect(page.getByText('Create Club Team', { exact: true })).toHaveCount(0);
  await page
    .locator('.career-card')
    .filter({ hasText: 'CmMgrCreatedA' })
    .getByRole('button', { name: 'Name club & open' })
    .click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Club name').fill('Create Club Team');
  await dialog.getByRole('button', { name: 'Save & open' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Generic placeholders');
  await dialog.getByLabel('Club name').fill('Northbridge FC');
  await dialog.getByRole('button', { name: 'Save & open' }).click();
  await expect(dialog).toHaveCount(0);
  await idle();
  await expect(page.locator('.context-club')).toContainText('Northbridge FC');
  await page.getByRole('button', { name: /^First team/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('thead th')).toHaveText([
    'Photo',
    'Player',
    'Age',
    'Date of birth',
    'Position',
    'Secondary',
    'OVR',
    'POT',
    'Contract',
    'Weekly wage',
  ]);
  await expect(page.getByRole('columnheader', { name: 'Date of birth' })).toBeVisible();
  const woolley = page.locator('tbody tr').filter({ hasText: 'Daniel Woolley' });
  await expect(woolley.locator('td').nth(2)).toHaveText('19');
  await expect(woolley.locator('td').nth(3)).toHaveText('15/03/2006');
  await expect(woolley.locator('td').nth(6)).toHaveText('69');
  await expect(woolley.locator('td').nth(8)).toHaveText('2029');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Minimum OVR').fill('69');
  await page.getByLabel('Maximum OVR').fill('69');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(woolley).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await page.getByRole('columnheader', { name: 'OVR', exact: true }).getByRole('button').click();
  await expect(page.locator('.player-link').first()).toHaveText('Daniel Woolley');
  await page.getByRole('columnheader', { name: 'OVR', exact: true }).getByRole('button').click();
  await expect(page.locator('.player-link').first()).toHaveText('Sebastian Herbert');
  await page.getByRole('button', { name: 'Daniel Woolley', exact: true }).click();
  await expect(page.locator('.attribute-grid')).toContainText('70');
  await expect(page.locator('.profile-ratings')).toContainText('69');
  await page.getByRole('button', { name: 'Back to squad' }).click();
  await page.getByRole('button', { name: 'Career settings', exact: true }).click();
  await expect(dialog.locator('input[type=date]')).toHaveCount(0);
  await dialog.getByLabel('Club name').fill('Northbridge Athletic');
  await dialog.getByRole('button', { name: 'Save career settings' }).click();
  await expect(dialog).toHaveCount(0);
  await idle();
  referenceDate = '2026-03-15';
  await writeFile(join(f.dir, 'CmMgrCreatedA'), JSON.stringify(['a', 'Create Club Team'], null, 2));
  await page.getByRole('button', { name: 'Refresh save', exact: true }).click();
  await idle();
  await expect(woolley.locator('td').nth(2)).toHaveText('20');
  await page.getByRole('button', { name: /^Youth academy/ }).click();
  await expect(page.getByRole('columnheader', { name: 'Date of birth' })).toBeVisible();
  await expect(page.locator('tbody tr td').nth(6)).toHaveText('62');
  await expect(page.locator('tbody tr td').nth(7)).toHaveText('95');
  await expect(page.locator('thead th')).toHaveText([
    'Photo',
    'Player',
    'Age',
    'Date of birth',
    'Position',
    'Secondary',
    'OVR',
    'POT',
    'Growth',
    'Weekly wage',
  ]);
  const output = join(ROOT, '.tools/screenshots');
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, 'regression-academy.png'), fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel' }).click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().startsWith('Northbridge_Athletic_'));
  await idle();
  await page.getByRole('button', { name: 'Switch career' }).click();
  await expect(
    page.getByRole('heading', { name: 'Northbridge Athletic', exact: true }),
  ).toBeVisible();
  const second = page.locator('.career-card').filter({ hasText: 'CmMgrCreatedB' });
  await second.getByRole('button', { name: 'Name club & open' }).click();
  await dialog.getByLabel('Club name').fill('Southbridge United');
  await dialog.getByRole('button', { name: 'Save & open' }).click();
  await expect(dialog).toHaveCount(0);
  await idle();
  await expect(page.locator('.context-club')).toContainText('Southbridge United');
  await page.getByRole('button', { name: /^First team/ }).click();
  await expect(page.locator('tbody tr').first().locator('td').nth(2)).toHaveText('—');
  await page.getByRole('button', { name: 'Switch career' }).click();
  await page
    .locator('.career-card')
    .filter({ hasText: 'Northbridge Athletic' })
    .getByRole('button', { name: 'Use career' })
    .click();
  await idle();
  await expect(page.locator('.context-club')).toContainText('Northbridge Athletic');
  await page.getByRole('button', { name: 'Career settings', exact: true }).click();
  await expect(dialog.locator('input[type=date]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, 'regression-mobile-settings.png'), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  recoverCustomName = true;
  await writeFile(join(f.dir, 'CmMgrCreatedA'), JSON.stringify(['a', 'Create Club Team'], null, 4));
  await page.getByRole('button', { name: 'Refresh save', exact: true }).click();
  await idle();
  await expect(page.locator('.context-club')).toContainText('River City Athletic');
  await page.getByRole('button', { name: 'Career settings', exact: true }).click();
  await expect(dialog.getByLabel('Club name')).toHaveValue('River City Athletic');
  await expect(dialog.getByLabel('Club name')).toHaveAttribute('readonly', '');
  await expect(dialog.getByText(/Name recovered automatically/)).toBeVisible();
  await page.keyboard.press('Escape');
  duplicatePlayer = true;
  await writeFile(join(f.dir, 'CmMgrCreatedA'), JSON.stringify(['a', 'Create Club Team'], null, 6));
  await page.getByRole('button', { name: 'Refresh save', exact: true }).click();
  await idle();
  await page.locator('.integrity summary').click();
  await expect(page.locator('.integrity summary')).toContainText('Academy 1/2');
  await page.getByRole('button', { name: 'Use Young', exact: true }).click();
  await idle();
  await expect(page.locator('.integrity summary')).toContainText('Academy 2/2');
  await expect(page.getByRole('button', { name: 'Selected: Young', exact: true })).toBeDisabled();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  );
  await page.screenshot({
    path: join(output, 'regression-player-choice-mobile.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Undo selection', exact: true }).click();
  await idle();
  await expect(page.locator('.integrity summary')).toContainText('Academy 1/2');
  await page.getByRole('button', { name: 'Use Young', exact: true }).click();
  await idle();
  await page.getByRole('button', { name: 'Refresh save', exact: true }).click();
  await idle();
  await expect(page.locator('.integrity summary')).toContainText('Academy 2/2');
  await expect(page.getByRole('button', { name: 'Selected: Young', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Switch career' }).click();
  await expect(
    page.getByRole('heading', { name: 'River City Athletic', exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  assert.equal(
    f.catalog.careers().find((c) => c.latestSave.fileName === 'CmMgrOfficial')?.clubName,
    metadata('official', 'Official United').clubName,
  );
  console.log(
    'PASS: automatic custom name recovery and manual fallback/editing/isolation, date/age, birthdays, normalized sorting/filters/profiles, squad columns, Excel download, mobile dialog, duplicate player selection/undo/persistence.',
  );
} finally {
  await browser.close();
  await app.close();
  f.store.close();
}
