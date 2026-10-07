import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { root } from './python-runtime.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, '.tools/browsers');
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
const external = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    external.push(url.hostname);
    return route.abort();
  }
  return route.continue();
});
const output = join(root, '.tools/screenshots');
await mkdir(output, { recursive: true });
try {
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('heading', { name: 'Your career library' }).waitFor();
  await page.locator('.banner.loading').waitFor({ state: 'hidden', timeout: 120000 });
  const count = await page.locator('.career-card').count();
  assert.ok(count > 0, 'Expected real career saves in configured directory');
  await page.screenshot({ path: join(output, 'library.png'), fullPage: true });
  await page
    .getByRole('button', { name: 'Use career', exact: true })
    .and(page.locator('button:enabled'))
    .first()
    .click();
  await page.locator('.banner.loading').waitFor({ state: 'hidden', timeout: 120000 });
  assert.equal(
    await page.locator('.banner.error').count(),
    0,
    await page.locator('main').innerText(),
  );
  await page.getByRole('heading', { name: 'Snapshot details' }).waitFor();
  await page.screenshot({ path: join(output, 'overview.png'), fullPage: true });
  await page.getByRole('button', { name: /^First team/ }).click();
  const total = await page.locator('tbody tr').count();
  assert.ok(total > 0);
  await page.getByRole('columnheader', { name: 'POT' }).getByRole('button').click();
  await page.getByRole('columnheader', { name: 'POT' }).getByRole('button').click();
  assert.equal(
    await page.getByRole('columnheader', { name: 'POT' }).getAttribute('aria-sort'),
    'descending',
  );
  const name = await page.locator('.player-link').first().innerText();
  await page.getByRole('textbox', { name: 'Search players' }).fill(name);
  assert.ok((await page.locator('tbody tr').count()) >= 1);
  await page.getByRole('button', { name: /^Youth academy/ }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Search players' }).inputValue(), '');
  await page.getByRole('button', { name: 'Card view', exact: true }).click();
  assert.ok((await page.locator('.prospect-card').count()) > 0);
  await page.screenshot({ path: join(output, 'academy.png'), fullPage: true });
  await page.locator('.prospect-card').first().click();
  await page.getByRole('heading', { name: 'Player details', exact: true }).waitFor();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel' }).click();
  const download = await downloadPromise;
  await download.saveAs(join(output, 'smoke-export.xlsx'));
  await page.getByRole('button', { name: 'Back to squad' }).click();
  await page.getByRole('button', { name: /^First team/ }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Search players' }).inputValue(), name);
  await page.getByRole('button', { name: 'Switch career' }).click();
  await page
    .getByRole('button', { name: 'Use career', exact: true })
    .and(page.locator('button:enabled'))
    .nth(1)
    .click();
  await page.locator('.banner.loading').waitFor({ state: 'hidden', timeout: 120000 });
  await page.getByRole('button', { name: /^First team/ }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Search players' }).inputValue(), '');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'System check' }).waitFor();
  await page.screenshot({ path: join(output, 'settings.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Careers', exact: true }).click();
  await page.screenshot({ path: join(output, 'mobile.png'), fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(overflow, false, 'Mobile layout should not overflow');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    JSON.stringify({
      ok: true,
      careerEntries: count,
      firstTeamRows: total,
      checks: [
        'library',
        'real save import',
        'sorting',
        'independent filters',
        'academy cards',
        'player detail',
        'Excel download',
        'career switching',
        'settings',
        'mobile layout',
        'no external requests',
        'no browser errors',
      ],
    }),
  );
} finally {
  await browser.close();
}
