import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createServer } from '../apps/api/src/server.js';
import { setup, saveFile } from './fixtures.js';
const headers = { host: '127.0.0.1', 'x-fc26-client': 'local-web' };
test('API rejects foreign origin and host, validates inputs, scopes players/history/exports to career and snapshot', async () => {
  const f = await setup();
  const app = await createServer({ store: f.store, decoder: f.decoder, logger: false });
  try {
    await saveFile(f.dir, 'CmMgrA', 'a');
    await saveFile(f.dir, 'CmMgrB', 'b');
    assert.equal(
      (await app.inject({ url: '/api/health', headers: { host: 'evil.example' } })).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: '/api/health',
          headers: { ...headers, origin: 'https://evil.example' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/saves/discover',
          headers: { host: '127.0.0.1' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/saves/discover', headers })).statusCode,
      200,
    );
    const careers = (await app.inject({ url: '/api/careers', headers })).json().careers;
    const a = careers[0],
      b = careers[1];
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/careers/${a.id}/select`,
          headers,
          payload: { saveId: b.latestSave.id },
        })
      ).statusCode,
      400,
    );
    await app.inject({ method: 'POST', url: `/api/careers/${a.id}/select`, headers, payload: {} });
    const refresh = await app.inject({
      method: 'POST',
      url: `/api/careers/${a.id}/refresh`,
      headers,
    });
    assert.equal(refresh.statusCode, 200, refresh.body);
    const snapshot = refresh.json().snapshotId;
    const imagePath = `/api/careers/${a.id}/players/record-1/image?snapshotId=${snapshot}`;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const boundary = 'fc26-test-boundary';
    const upload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="portrait.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const uploaded = await app.inject({
      method: 'POST',
      url: imagePath,
      headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: upload,
    });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    assert.equal(
      (await app.inject({ url: `/api/careers/${a.id}/players/record-1/image`, headers })).headers[
        'content-type'
      ],
      'image/webp',
    );
    assert.equal(
      (await app.inject({ url: `/api/careers/${b.id}/players?snapshotId=${snapshot}`, headers }))
        .statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/careers/${a.id}/players/unknown?snapshotId=${snapshot}`,
          headers,
        })
      ).statusCode,
      404,
    );
    const exported = await app.inject({
      url: `/api/careers/${a.id}/export/xlsx?snapshotId=${snapshot}`,
      headers,
    });
    assert.equal(exported.statusCode, 200, exported.body.slice(0, 100));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(exported.rawPayload as unknown as Parameters<typeof book.xlsx.load>[0]);
    assert.deepEqual(
      book.worksheets.map((s) => s.name),
      ['Summary', 'First Team', 'Youth Academy'],
    );
    assert.equal(book.getWorksheet('First Team')?.getCell('B2').value, 'Synthetic Player');
    assert.equal(book.getWorksheet('First Team')?.getCell('I2').value, 70);
    assert.equal(book.getWorksheet('Youth Academy')?.rowCount, 1);
    assert.equal(book.getWorksheet('First Team')?.getImages().length, 1);
    await app.inject({ method: 'POST', url: `/api/careers/${b.id}/select`, headers, payload: {} });
    assert.equal(
      (await app.inject({ url: `/api/careers/${b.id}/players?snapshotId=${snapshot}`, headers }))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/careers/${a.id}/export/xlsx?snapshotId=${snapshot}`,
          headers,
        })
      ).statusCode,
      409,
    );
    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers,
      payload: { shell: 'whoami' },
    });
    assert.equal(invalid.statusCode, 400);
    assert.ok(!invalid.body.includes('stack'));
    assert.equal((await app.inject({ url: '/api/file?path=../../.env', headers })).statusCode, 404);
  } finally {
    await app.close();
    f.store.close();
  }
});
