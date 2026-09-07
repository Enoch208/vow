import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createAppServer } from '../../../scripts/app/server.ts';
import { parseAppDeployment } from '../../../scripts/app/collection-manifest.ts';
import { parseAppRoute } from '../../../scripts/app/route.ts';

test('claim and verify routes accept one exact public felt and reject query-string secret channels', () => {
  assert.deepEqual(parseAppRoute('/claim/0x123'), { kind: 'claim', value: 0x123n });
  assert.deepEqual(parseAppRoute('/verify/456'), { kind: 'verify', value: 456n });
  assert.deepEqual(parseAppRoute('/verify'), { kind: 'verify', value: null });
  for (const path of ['/claim', '/claim/0', '/claim/0x1?key=secret', '/verify/0', '/verify/0x1/more']) assert.throws(() => parseAppRoute(path));
});

test('pinned app manifest rejects unknown fields and malformed token metadata', () => {
  const value = { schemaVersion: 1, status: 'not-deployed', deployment: { chainId: '1', vaultAddress: '2', vaultClassHash: '3', poolAddress: '4',
    poolClassHash: '5', feeToken: '6', feeCollector: '7', maximumProtocolFee: '0', maximumNetworkFee: '0' },
  tokens: [{ address: '6', symbol: 'STRK', decimals: 18 }], preloadedTransactionHash: '8', evidence: 'A real negative control.' };
  assert.equal(parseAppDeployment(value).tokens[0]!.symbol, 'STRK');
  assert.throws(() => parseAppDeployment({ ...value, secret: 'no' }));
  assert.throws(() => parseAppDeployment({ ...value, tokens: [{ address: '6', symbol: '<script>', decimals: 18 }] }));
});

async function server(context: TestContext): Promise<string> {
  const instance = createAppServer();
  await new Promise<void>((resolve, reject) => { instance.once('error', reject); instance.listen(0, '127.0.0.1', resolve); });
  context.after(() => new Promise<void>((resolve, reject) => { instance.closeAllConnections(); instance.close((error) => error ? reject(error) : resolve()); }));
  const address = instance.address(); assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

test('app serves dynamic claim and logged-out verifier routes from a fixed read-only allowlist', async (context) => {
  const base = await server(context);
  for (const path of ['/claim/0x123', '/verify', '/verify/0x123']) {
    const response = await fetch(base + path); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy')!, /connect-src 'self' https:\/\/api\.cartridge\.gg\/x\/starknet\/mainnet/);
    const html = await response.text(); assert.match(html, /amount and timing are public/i); assert.match(html, /PUBLIC VERIFIER · NO WALLET/);
  }
  for (const path of ['/app/browser.js', '/app/style.css', '/app/deployment.json']) assert.equal((await fetch(base + path)).status, 200);
  for (const path of ['/claim/0x123?key=secret', '/package.json', '/scripts/app/browser.ts']) assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await fetch(base + '/verify/0x123', { method: 'POST', body: '{}' })).status, 405);
});
