import assert from 'node:assert/strict';
import { request } from 'node:http';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createDiagnosticServer } from '../../../scripts/diagnostic/server.ts';

async function fixture(context: TestContext): Promise<string> {
  const server = createDiagnosticServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  context.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

test('G0 diagnostic serves its allowlisted page/modules with restrictive headers', async (context) => {
  const base = await fixture(context);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy')!, /connect-src 'none'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(await page.text(), /No capability check has run/);
  for (const path of ['/scripts/diagnostic/browser.js', '/packages/vow-sdk/src/wallet.js', '/packages/vow-sdk/src/wallet-discovery.js', '/vendor/wallets.js', '/diagnostic.css']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
});

test('G0 diagnostic never serves repository files or accepts writes', async (context) => {
  const base = await fixture(context);
  for (const path of ['/package.json', '/.env', '/evidence/claims.json', '/?key=anything', '/%2e%2e/package.json']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base, { method: 'POST', body: 'not stored' })).status, 405);
});

test('G0 diagnostic rejects an unexpected Host header', async (context) => {
  const base = await fixture(context);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    request(base, { headers: { Host: 'untrusted.example' } }, (response) => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    }).on('error', reject).end();
  });
  assert.equal(status, 403);
});

test('G0 collection page restricts connections to the public RPC and exposes only bundled assets', async (context) => {
  const base = await fixture(context);
  const page = await fetch(base + '/collection');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy')!, /connect-src 'self' https:\/\/api\.cartridge\.gg\/x\/starknet\/mainnet;/);
  const html = await page.text();
  assert.match(html, /Submission requires a separate exact review, an approved budget and your explicit action/);
  assert.match(html, /id="submit-collection" type="button" disabled/);
  assert.match(html, /Total budget: UNVERIFIED/);
  for (const path of ['/collection/browser.js', '/collection/style.css', '/collection/build.json']) {
    assert.equal((await fetch(base + path)).status, 200);
  }
  assert.equal((await fetch(base + '/collection?key=anything')).status, 404);
  assert.equal((await fetch(base + '/scripts/collection/browser.ts')).status, 404);
  const budget = await fetch(base + '/collection/budget.json');
  assert.ok(budget.status === 200 || budget.status === 404);
  assert.equal(budget.headers.get('cache-control'), 'no-store');
  if (budget.status === 404) assert.equal(await budget.text(), 'No approved collection budget.');
  assert.equal((await fetch(base + '/collection/budget.json?approval=true')).status, 404);
  assert.equal((await fetch(base + '/collection/budget.json', { method: 'POST', body: '{}' })).status, 405);
});

test('Account activation page serves a bundled read-only tool with no page network connections', async (context) => {
  const base = await fixture(context);
  const page = await fetch(base + '/activation');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy')!, /connect-src 'none'/);
  assert.match(await page.text(), /Connect and read activation details/);
  assert.equal((await fetch(base + '/activation/browser.js')).status, 200);
  assert.equal((await fetch(base + '/activation', { method: 'POST', body: 'not stored' })).status, 405);
  assert.equal((await fetch(base + '/activation?data=anything')).status, 404);
});
