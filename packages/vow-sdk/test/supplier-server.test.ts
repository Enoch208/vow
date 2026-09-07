import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { createSupplierServer } from '../../../scripts/supplier/server.ts';

test('Supplier key server isolates its page and accepts no input or network permission', async (context) => {
  const server = createSupplierServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const bound = server.address(); assert.ok(bound && typeof bound === 'object');
  const base = `http://127.0.0.1:${bound.port}`;
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy')!, /connect-src 'none'/);
  assert.match(response.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(await response.text(), /This page makes no network or wallet requests/);
  for (const asset of ['/browser.js', '/style.css']) assert.equal((await fetch(base + asset)).status, 200);
  for (const path of ['/collection', '/.env', '/?key=forbidden', '/package.json']) assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await fetch(base, { method: 'POST', body: 'synthetic forbidden input' })).status, 405);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    request(base, { headers: { Host: 'untrusted.example' } }, (result) => { result.resume(); result.on('end', () => resolve(result.statusCode)); }).on('error', reject).end();
  });
  assert.equal(status, 403);
});
