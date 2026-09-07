import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeDeploymentReview, publicJson, reviewDeployment } from '../../../scripts/deployment/review.ts';
import { createDiagnosticServer } from '../../../scripts/diagnostic/server.ts';
import { config } from './helpers/collection.ts';
import { buildProbeDeploymentPlan } from '../src/deployment-plan.ts';

const { vaultAddress: omitted, probeClassHash, ...baseTerms } = config;
assert.ok(omitted > 0n);
const terms = { ...baseTerms, chainId: 0x534e5f4d41494en, owner: 100n, salt: 987n, principalLimit: 100n };

class Element {
  value = ''; textContent = ''; disabled = false; href = ''; download = ''; selected = false;
  readonly handlers = new Map<string, () => void>();
  addEventListener(name: string, handler: () => void): void { this.handlers.set(name, handler); }
  fire(name: string): void { if (name !== 'click' || !this.disabled) this.handlers.get(name)?.(); }
  focus(): void {}
  select(): void { this.selected = true; }
  click(): void { this.fire('click'); }
  remove(): void {}
}
function page(t: TestContext, clipboard: (value: string) => Promise<void> = async () => {}, loadDraft?: () => Promise<string>) {
  const elements = new Map(['deployment-terms', 'deployment-configuration', 'deployment-status', 'deployment-export-status',
    'copy-configuration', 'download-configuration', 'deployment-summary', 'deployment-calls', 'clear-deployment', 'review-deployment', 'load-deployment-draft'].map((id) => [id, new Element()]));
  const previous = ['document', 'window', 'navigator'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const window = new Element();
  const links: Element[] = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: (id: string) => elements.get(id), createElement: () => new Element(), body: { append: (link: Element) => links.push(link) },
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: clipboard } } });
  t.after(() => { for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  } });
  initializeDeploymentReview(probeClassHash, () => 1000n, loadDraft);
  return { get: (id: string) => elements.get(id)!, window, links };
}

test('Deployment review derives exact address and calls from public terms and never trusts supplied calls', () => {
  const expected = buildProbeDeploymentPlan({ ...terms, probeClassHash }, 1000n);
  const review = reviewDeployment(publicJson(terms), probeClassHash, 1000n);
  assert.equal(review.summary.predictedProbe, `0x${expected.predictedAddress.toString(16)}`);
  assert.equal(review.summary.owner, '0x64');
  assert.equal(review.summary.principalBaseUnits, '100');
  assert.deepEqual(review.calls.atomicApprovalAndFunding, expected.fundingCalls);
  assert.deepEqual(review.configuration, expected.collectionConfiguration);
  assert.match(review.summary.status, /unverified/);
  for (const input of [{ ...terms, deploymentCall: {} }, { ...terms, owner: 'secret-invalid' },
    { ...terms, principalLimit: 1n }, { ...terms, signatureDeadline: 999n }, { ...terms, chainId: 1n }]) {
    assert.throws(() => reviewDeployment(publicJson(input), probeClassHash, 1000n));
  }
});

test('Deployment page invalidates exports on edits, rejects malformed input without echoing it and clears on page exit', (t) => {
  const p = page(t);
  assert.equal(p.get('copy-configuration').disabled, true);
  p.get('deployment-terms').value = publicJson(terms);
  p.get('review-deployment').fire('click');
  assert.equal(p.get('download-configuration').disabled, false);
  assert.match(p.get('deployment-status').textContent, /still unverified/);
  p.get('deployment-terms').fire('input');
  assert.equal(p.get('deployment-configuration').value, '');
  assert.equal(p.get('copy-configuration').disabled, true);
  p.get('deployment-terms').value = 'secret-invalid-json';
  p.get('review-deployment').fire('click');
  assert.doesNotMatch(p.get('deployment-status').textContent, /secret-invalid-json/);
  assert.equal(p.get('download-configuration').disabled, true);
  p.get('deployment-terms').value = publicJson(terms);
  p.get('review-deployment').fire('click');
  p.window.fire('pagehide');
  assert.equal(p.get('deployment-terms').value, '');
  assert.equal(p.get('deployment-configuration').value, '');
});

test('Deployment page exports only validated public configuration and offers manual copy fallback', async (t) => {
  const p = page(t, async () => { throw new Error('clipboard unavailable'); });
  p.get('deployment-terms').value = publicJson(terms);
  p.get('review-deployment').fire('click');
  p.get('copy-configuration').fire('click');
  await delay(0);
  assert.equal(p.get('deployment-configuration').selected, true);
  assert.match(p.get('deployment-export-status').textContent, /copy it manually/);
  p.get('download-configuration').fire('click');
  const link = p.links[0]!;
  assert.equal(link.download, 'vow-collection-configuration.json');
  assert.match(link.href, /^blob:/);
  assert.equal(await (await fetch(link.href)).text(), p.get('deployment-configuration').value + '\n');
});

test('Deployment page ignores a late clipboard result after the reviewed terms change', async (t) => {
  let done = () => {};
  const p = page(t, () => new Promise<void>((resolve) => { done = resolve; }));
  p.get('deployment-terms').value = publicJson(terms); p.get('review-deployment').fire('click');
  p.get('copy-configuration').fire('click');
  p.get('deployment-terms').fire('input'); done(); await delay(0);
  assert.equal(p.get('deployment-export-status').textContent, 'No configuration prepared.');
});

test('Deployment route serves the reviewed workflow and bundled build without exposing internal files or accepting HTTP writes', async (t) => {
  const server = createDiagnosticServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve());
  }));
  const bound = server.address(); assert.ok(bound && typeof bound === 'object');
  const origin = `http://127.0.0.1:${bound.port}`;
  const response = await fetch(origin + '/deployment');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy')!, /connect-src 'self'/);
  const html = await response.text();
  assert.match(html, /Review first/);
  assert.match(html, /Download configuration/);
  assert.doesNotMatch(html, /wallet_addInvokeTransaction|wallet_requestAccounts/);
  assert.equal((await fetch(origin + '/deployment/browser.js')).status, 200);
  const artifact = await fetch(origin + '/deployment/contract.json');
  assert.equal(artifact.status, 200);
  assert.deepEqual(Object.keys(await artifact.json()).sort(), ['classHash', 'compiledClassHash', 'contractClass', 'starknetVersion']);
  assert.match(response.headers.get('content-security-policy')!, /https:\/\/api\.cartridge\.gg\/x\/starknet\/mainnet/);
  assert.equal((await fetch(origin + '/deployment/review.json')).status, 404);
  assert.equal((await fetch(origin + '/private/probe-public-terms.json')).status, 404);
  assert.equal((await fetch(origin + '/deployment?terms=anything')).status, 404);
  assert.equal((await fetch(origin + '/deployment', { method: 'POST', body: 'not stored' })).status, 405);
});


test('Local draft is reviewed only after explicit loading and invalid content never becomes an export', async (t) => {
  let loads = 0;
  const p = page(t, undefined, async () => { loads++; return loads === 1 ? publicJson(terms) : 'private-invalid-content'; });
  assert.equal(loads, 0);
  p.get('load-deployment-draft').fire('click'); await delay(0);
  assert.equal(loads, 1);
  assert.equal(p.get('deployment-terms').value, publicJson(terms));
  assert.equal(p.get('download-configuration').disabled, false);
  p.get('load-deployment-draft').fire('click'); await delay(0);
  assert.equal(p.get('download-configuration').disabled, true);
  assert.equal(p.get('deployment-configuration').value, '');
  assert.doesNotMatch(p.get('deployment-status').textContent, /private-invalid-content/);
});

test('Changing terms during a draft load discards the stale server result', async (t) => {
  let done: (value: string) => void = () => {};
  const p = page(t, undefined, () => new Promise<string>((resolve) => { done = resolve; }));
  p.get('load-deployment-draft').fire('click');
  p.get('deployment-terms').value = 'new user input'; p.get('deployment-terms').fire('input');
  done(publicJson(terms)); await delay(0);
  assert.equal(p.get('deployment-terms').value, 'new user input');
  assert.equal(p.get('deployment-configuration').value, '');
  assert.equal(p.get('load-deployment-draft').disabled, false);
});
