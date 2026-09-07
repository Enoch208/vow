import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../../../scripts/app/server.ts';
import { parseVaultManifest } from '../../../scripts/app/manifest.ts';
import { POOL_CLASS_HASH } from '../src/prepared-claim.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const page = (name: string) => readFile(`${root}scripts/app/${name}`, 'utf8');
const DEPLOYMENT_IDENTIFIERS = [
  '0x641ca5237870312273ed2cd693372ee49e103d5c585af6185324f3662e15227',
  '0x3c85f692be0a2280bc85fc9802019121a8b52ef4de0db9273c3806f7355ce14',
  '0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a',
  '0x3f3cc7727c66634967621dc8d4697f1bfd6c29f81757496a4783bf5c90deb89',
] as const;
const VAULT_CLASS_HASH = 0xc1a55n;
const manifest = {
  chainId: '0x534e5f4d41494e', vaultAddress: '0x4a1', vaultClassHash: `0x${VAULT_CLASS_HASH.toString(16)}`,
  poolAddress: '0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a',
  poolClassHash: `0x${POOL_CLASS_HASH.toString(16)}`, feeToken: '0xfee7', feeCollector: '0xc011',
  maximumProtocolFee: '0', maximumNetworkFee: '1000000000000000000',
};

async function server(context: TestContext): Promise<string> {
  const instance = createAppServer();
  await new Promise<void>((resolve, reject) => { instance.once('error', reject); instance.listen(0, '127.0.0.1', resolve); });
  context.after(() => new Promise<void>((resolve, reject) => {
    instance.closeAllConnections(); instance.close((error) => error ? reject(error) : resolve());
  }));
  const address = instance.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

test('T-APP-1 the overview explains the problem and links the screens, the docs and the verifier', async (context) => {
  const base = await server(context);
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy')!, /connect-src 'none'/);
  const html = await response.text();
  assert.match(html, /Never let it choose where the money goes/);
  assert.match(html, /href="\/owner"/);
  assert.match(html, /href="\/operator"/);
  assert.match(html, /href="\/verify"/);
  assert.match(html, /signs nothing, requests no wallet and submits nothing/);
  assert.match(html, /href="\/docs\/README\.md"/);
  assert.match(html, /href="\/evidence\/claims\.json"/);
  assert.match(html, /matching VowVault (?:class and contract are verified|is deployed) on Starknet mainnet/i);
  assert.match(html, /no supplier collection or note credit is claimed/i);
  for (const id of ['T-005', 'T-002', 'T-003', 'T-004', 'T-011']) assert.match(html, new RegExp(id));
  assert.match(html, /npm run verify:vault/);
  assert.match(html, /no generic drain, arbitrary external-call, root-replacement or upgrade entrypoint/i);
});

test('T-APP-1 release surfaces pin one deployment and report zero qualifying collections', async () => {
  const surfaces = await Promise.all([
    readFile(`${root}README.md`, 'utf8'),
    readFile(`${root}JUDGES.md`, 'utf8'),
    page('index.html'),
    page('collection.html'),
    readFile(`${root}web/app/page.tsx`, 'utf8'),
  ]);
  for (const [index, surface] of surfaces.entries()) {
    for (const identifier of DEPLOYMENT_IDENTIFIERS) assert.match(surface, new RegExp(identifier), `surface ${index}`);
    assert.match(surface, /no [^.]*collection|zero collections/i, `surface ${index}`);
    assert.match(surface, /0 of 5|zero of five/i, `surface ${index}`);
  }
  const submission = JSON.parse(await readFile(`${root}strk20.json`, 'utf8')) as {
    transactions: { stage: string }[];
    contracts: Record<string, unknown>[];
    note: string;
  };
  const allowed = ['create_mandate', 'approve', 'fund_mandate', 'reserve', 'expire_reservation'];
  assert.equal(submission.transactions.length > 0, true);
  for (const { stage } of submission.transactions) {
    assert.equal(allowed.includes(stage), true, `unexpected submitted stage ${stage}`);
  }
  assert.equal(submission.transactions.some(({ stage }) => /collect|claim/i.test(stage)), false);
  assert.match(submission.note, /No supplier collection has occurred/);
  assert.equal(submission.contracts.length, 1);
  const values = Object.values(submission.contracts[0]!);
  for (const identifier of DEPLOYMENT_IDENTIFIERS) assert.ok(values.includes(identifier), identifier);
});

test('T-APP-2 the owner and operator screens are the only routes allowed to reach the public RPC', async (context) => {
  const base = await server(context);
  for (const path of ['/owner', '/operator']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-security-policy')!, /connect-src 'self' https:\/\/api\.cartridge\.gg\/x\/starknet\/mainnet/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  for (const path of ['/', '/app.css', '/docs/PRIVACY.md']) {
    assert.match((await fetch(base + path)).headers.get('content-security-policy')!, /connect-src 'none'/, path);
  }
  for (const path of ['/owner.js', '/operator.js', '/app.css', '/docs/THREAT_MODEL.md', '/docs/JUDGES.md', '/docs/REPRODUCE.md', '/evidence/claims.json']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
});

test('T-APP-3 the screens are read-only, host-pinned and serve no other repository file', async (context) => {
  const base = await server(context);
  for (const path of ['/package.json', '/private.md', '/private/review.json', '/.env', '/owner?key=secret',
    '/scripts/app/owner.ts', '/%2e%2e/package.json', '/docs/../package.json']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  for (const path of ['/owner', '/operator', '/']) {
    assert.equal((await fetch(base + path, { method: 'POST', body: 'nothing is stored' })).status, 405, path);
  }
  const status = await new Promise<number | undefined>((resolve, reject) => {
    request(base + '/owner', { headers: { Host: 'untrusted.example' } }, (response) => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    }).on('error', reject).end();
  });
  assert.equal(status, 403);
});

test('T-APP-4 an absent deployment manifest fails closed with a named blocker', async (context) => {
  const base = await server(context);
  const response = await fetch(base + '/deployment/manifest.json');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  if (response.status === 404) assert.match(await response.text(), /No VowVault deployment manifest\. Every write flow stays blocked/);
  else assert.equal(response.status, 200);
});

test('T-APP-5 the deployment manifest is pinned to this build and rejects anything else', async () => {
  assert.equal(parseVaultManifest(JSON.stringify(manifest), VAULT_CLASS_HASH).vaultAddress, 0x4a1n);
  const rejected: Record<string, unknown>[] = [
    { ...manifest, extra: '1' },
    { ...manifest, chainId: '0x534e5f5345504f4c4941' },
    { ...manifest, vaultClassHash: '0xbad' },
    { ...manifest, poolClassHash: '0x1' },
    { ...manifest, vaultAddress: '0x0' },
    { ...manifest, vaultAddress: manifest.poolAddress },
    { ...manifest, maximumNetworkFee: 'not-a-number' },
  ];
  for (const value of rejected) assert.throws(() => parseVaultManifest(JSON.stringify(value), VAULT_CLASS_HASH), JSON.stringify(value).slice(0, 60));
  for (const value of ['', 'null', '[]', '{', 'x'.repeat(5000)]) assert.throws(() => parseVaultManifest(value, VAULT_CLASS_HASH));
});

test('T-APP-6 every control on both screens is labelled, headings are ordered and focus is never removed', async () => {
  const css = await page('app.css');
  assert.match(css, /:focus-visible \{ outline: 3px solid/);
  assert.doesNotMatch(css, /outline:\s*(none|0)/);
  for (const name of ['index.html', 'owner.html', 'operator.html']) {
    const html = await page(name);
    assert.match(html, /<html lang="en">/, name);
    assert.match(html, /<title>[^<]{10,}<\/title>/, name);
    assert.equal([...html.matchAll(/<h1[ >]/g)].length, 1, name);
    assert.doesNotMatch(html, /\son[a-z]+="/, name);
    assert.doesNotMatch(html, /\sstyle="/, name);
    const levels = [...html.matchAll(/<h([1-3])[ >]/g)].map((match) => Number(match[1]));
    levels.forEach((level, index) => assert.ok(index === 0 || level <= levels[index - 1]! + 1, `${name} heading jump at ${index}`));
    const labelled = new Set([...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((match) => match[1]!));
    for (const control of html.matchAll(/<(input|textarea|select)\s[^>]*id="([^"]+)"[^>]*>/g)) {
      if (control[0]!.includes('type="radio"')) {
        assert.match(control[0]!, /\sname="permission"/, `${name} ${control[2]}`);
        continue;
      }
      assert.ok(labelled.has(control[2]!), `${name} control ${control[2]} has no label`);
    }
  }
});

test('T-APP-7 the screen palette meets a 4.5:1 contrast ratio on every text pair it ships', async () => {
  const css = await page('app.css');
  const token = (name: string) => {
    const found = new RegExp(`--${name}: (#[0-9a-f]{6})`).exec(css);
    assert.ok(found, `missing --${name}`);
    return found[1]!;
  };
  const pairs: [string, string][] = [
    [token('ink'), token('panel')], [token('ink'), token('ground')], [token('muted'), token('panel')],
    [token('accent-ink'), token('accent')], [token('warn-line'), token('warn-bg')], [token('stop-line'), token('stop-bg')],
    ['#1c5545', token('panel')], ['#4a5a55', '#e6ecea'],
  ];
  for (const [foreground, background] of pairs) {
    assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background} is ${contrast(foreground, background).toFixed(2)}:1`);
  }
});

test('T-APP-8 the operator dashboard links the recorded reservation and invents no dashboard data', async () => {
  const html = await page('operator.html');
  const evidence = JSON.parse(await readFile(`${root}evidence/reservation-receipt.json`, 'utf8')) as { reservationId: string };
  assert.match(html, /class="operator-workspace"/);
  assert.match(html, /class="operator-dashboard"/);
  assert.match(html, /aria-current="page">Operator control/);
  assert.match(html, new RegExp(`href="/claim/${evidence.reservationId}"`));
  assert.match(html, /id="ledger-funded">unread/);
  assert.match(html, /id="write-state" class="state" data-state="READY"/);
  assert.doesNotMatch(html, /\b(mock|fixture|sample transaction)\b/i);
});

function contrast(foreground: string, background: string): number {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}
function luminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
