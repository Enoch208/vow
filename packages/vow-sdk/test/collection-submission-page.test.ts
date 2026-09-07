import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { hash } from 'starknet';
import { initializeSubmission } from '../../../scripts/collection/submission.ts';
import { CollectionSession } from '../src/collection-session.ts';
import { SubmissionJournal } from '../src/submission-journal.ts';
import type { CollectionRequest } from '../src/collection-wallet.ts';
import type { PublicReader } from '../src/probe-reader.ts';
import { signClaim } from '../src/claims.ts';
import { config, snapshot, prepared, syntheticKey } from './helpers/collection.ts';

class Element {
  value = ''; textContent = ''; disabled = false; checked = false;
  readonly handlers = new Map<string, () => void>();
  addEventListener(name: string, handler: () => void): void { this.handlers.set(name, handler); }
  fire(name: string): void { if (name !== 'click' || !this.disabled) this.handlers.get(name)?.(); }
}

async function page(t: TestContext, allowBudget?: () => boolean, refreshBudget: () => Promise<void> = async () => {}) {
  const ids = ['network-fee-cap', 'review-submission', 'approve-submission', 'submission-budget-status', 'refresh-collection-budget', 'submit-collection', 'submission-status', 'submission-review', 'submission-result'];
  const elements = new Map(ids.map((name) => [name, new Element()]));
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: (name: string) => elements.get(name) } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value),
  } } });
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  });
  const terms = { ...config, chainId: 0x534e5f4d41494en };
  const state = { funded: true, writes: 0, result: 'success', budgetChanged: () => {} };
  const wallet = { request: async (request: CollectionRequest): Promise<unknown> => {
    if (request.type === 'wallet_requestChainId') return `0x${terms.chainId.toString(16)}`;
    if (request.type === 'wallet_requestAccounts') return ['0x14d'];
    if (request.type === 'wallet_addInvokeTransaction') {
      state.writes++;
      if (state.result === 'refused') throw { code: 113, data: 'sensitive-wallet-error' };
      if (state.result === 'unknown') throw { code: 163, data: 'sensitive-wallet-error' };
      return { transaction_hash: '0xabc' };
    }
    return prepared(request);
  }, subscribeInvalidation: (_listener: () => void) => () => {} };
  const session = new CollectionSession(terms, { wallet, now: () => 1000n, readSnapshot: async () => ({ ...snapshot, chainId: terms.chainId }) });
  const candidate = await session.prepare(); const signature = signClaim(candidate.claim, syntheticKey);
  await session.prove(signature);
  const reader: PublicReader = { request: async (method, params) => {
    state.budgetChanged();
    if (method === 'starknet_chainId') return `0x${terms.chainId.toString(16)}`;
    if (method === 'starknet_getBlockWithTxHashes') return { block_hash: '0x7b', timestamp: 1000 };
    const data = params as { contract_address?: string; request?: { entry_point_selector: string } };
    if (method === 'starknet_getClassHashAt') return `0x${(data.contract_address === '0x38' ? terms.probeClassHash : snapshot.poolClassHash).toString(16)}`;
    const values: Record<string, bigint[]> = {
      configuration: [snapshot.owner, terms.poolAddress, terms.token, terms.supplierKey, terms.amount, terms.claimBefore],
      state: [state.funded ? 1n : 2n], balance_of: [terms.amount, 0n], allowance: [0n, 0n], is_paused: [0n], get_fee_collector: [terms.feeCollector],
    };
    const name = Object.keys(values).find((key) => hash.getSelectorFromName(key) === data.request?.entry_point_selector);
    if (!name) throw new Error('TEST_UNEXPECTED_READ');
    return values[name]!.map((value) => `0x${value.toString(16)}`);
  } };
  const busy: boolean[] = [];
  const ui = initializeSubmission(reader, (value) => busy.push(value), () => 1001n, allowBudget, refreshBudget);
  const preparation = { configuration: terms, session, signature, wallet };
  return { ui, preparation, element: (name: string) => elements.get(name)!, elements, storage, state, busy };
}

async function review(p: Awaited<ReturnType<typeof page>>) {
  p.ui.setPreparation(p.preparation);
  for (let attempt = 0; attempt < 200 && p.element('network-fee-cap').disabled; attempt++) await delay(5);
  p.element('network-fee-cap').value = '0.5'; p.element('network-fee-cap').fire('input');
  p.element('review-submission').fire('click');
  for (let attempt = 0; attempt < 200 && p.element('submission-review').textContent === 'No submission reviewed.'; attempt++) await delay(5);
}
function acknowledge(p: Awaited<ReturnType<typeof page>>) {
  p.element('approve-submission').checked = true; p.element('approve-submission').fire('change');
}

test('T-006 submission page shows exact public review but its default unverified budget blocks even forced clicks', async (t) => {
  const p = await page(t);
  assert.equal(p.element('review-submission').disabled, true);
  await review(p); acknowledge(p);
  const text = p.element('submission-review').textContent;
  assert.match(text, /"recipient": "0x14d"/); assert.match(text, /"outputNoteId": "0x309"/);
  assert.match(text, /"maximumNetworkFeeSTRK": "0.5"/); assert.match(text, /"reviewDigest"/);
  assert.match(text, /manual-wallet-confirmation/);
  assert.doesNotMatch(text, /synthetic-not-a-real-proof/);
  assert.match(p.element('submission-budget-status').textContent, /UNVERIFIED/);
  assert.equal(p.element('submit-collection').disabled, true);
  p.element('submit-collection').handlers.get('click')?.(); await delay(10);
  assert.equal(p.state.writes, 0); assert.equal(p.storage.size, 0);
});

test('T-018 a validated budget still requires explicit acknowledgement and click, then stores only public recovery', async (t) => {
  const p = await page(t, () => true); await review(p);
  assert.equal(p.element('submit-collection').disabled, true); assert.equal(p.state.writes, 0);
  acknowledge(p); assert.equal(p.element('submit-collection').disabled, false);
  p.element('submit-collection').fire('click'); await delay(20);
  assert.equal(p.state.writes, 1); assert.equal(p.element('submit-collection').disabled, true);
  assert.match(p.element('submission-result').textContent, /"transactionHash": "0xabc"/);
  assert.match(p.element('submission-status').textContent, /not confirmation/);
  assert.equal(p.storage.size, 1);
  for (const stored of p.storage.values()) assert.doesNotMatch(stored, /proof|signature|synthetic-not-a-real-proof/);
  p.element('submit-collection').handlers.get('click')?.(); await delay(10); assert.equal(p.state.writes, 1);
});

test('T-006 editing a reviewed fee cap discards the review and prevents stale approval dispatch', async (t) => {
  const p = await page(t, () => true); await review(p); acknowledge(p);
  p.element('network-fee-cap').value = '0.6'; p.element('network-fee-cap').fire('input');
  assert.equal(p.element('submit-collection').disabled, true); assert.equal(p.element('approve-submission').checked, false);
  assert.equal(p.element('submission-review').textContent, 'No submission reviewed.');
  p.element('submit-collection').handlers.get('click')?.(); await delay(10);
  assert.equal(p.state.writes, 0);
});

test('T-018 changed funding or budget during fresh preflight never reaches wallet write', async (t) => {
  let allowed = true;
  const p = await page(t, () => allowed); await review(p); acknowledge(p);
  p.state.budgetChanged = () => { allowed = false; };
  p.element('submit-collection').fire('click'); await delay(20);
  assert.equal(p.state.writes, 0); assert.equal(p.element('submit-collection').disabled, true);
  assert.match(p.element('submission-status').textContent, /unresolved/);
});

test('T-018 consumed funding blocks submission despite a previously reviewed proof', async (t) => {
  const p = await page(t, () => true); await review(p); acknowledge(p); p.state.funded = false;
  p.element('submit-collection').fire('click'); await delay(20);
  assert.equal(p.state.writes, 0); assert.equal(p.element('submit-collection').disabled, true);
});

test('T-018 refusal remains quarantined after clearing and cannot be retried from this page', async (t) => {
  const p = await page(t, () => true); await review(p); acknowledge(p); p.state.result = 'refused';
  p.element('submit-collection').fire('click'); await delay(20);
  assert.match(p.element('submission-status').textContent, /refusal/);
  assert.doesNotMatch(p.element('submission-result').textContent, /sensitive-wallet-error/);
  p.ui.clear(); p.ui.setPreparation(p.preparation); acknowledge(p);
  assert.equal(p.element('submit-collection').disabled, true);
  assert.equal(p.element('review-submission').disabled, true); assert.equal(p.state.writes, 1);
});

test('T-018 unknown wallet failure leaves its attempt and disables retry', async (t) => {
  const p = await page(t, () => true); await review(p); acknowledge(p); p.state.result = 'unknown';
  p.element('submit-collection').fire('click'); await delay(20);
  assert.match(p.element('submission-status').textContent, /unresolved/);
  assert.equal(p.element('submit-collection').disabled, true); assert.equal(p.storage.size, 1);
});

test('T-018 a restored durable attempt blocks a new review before it can enable submission', async (t) => {
  const p = await page(t, () => true); const config = p.preparation.configuration;
  const journal = new SubmissionJournal({ chainId: config.chainId, vaultAddress: config.vaultAddress, reservationId: 1n }, {
    getItem: (key) => p.storage.get(key) ?? null, setItem: (key, value) => { p.storage.set(key, value); },
  }, navigator.locks);
  await journal.reserve(123n, 777n, 1500n, 1000n);
  await review(p); acknowledge(p);
  assert.equal(p.element('review-submission').disabled, true); assert.equal(p.element('submit-collection').disabled, true);
  assert.match(p.element('submission-status').textContent, /attempt already exists/);
  p.element('review-submission').handlers.get('click')?.(); await delay(10);
  assert.equal(p.element('submission-review').textContent, 'No submission reviewed.');
  assert.equal(p.state.writes, 0);
});

test('T-019 budget loading is separate from approval and submission refetches before dispatch', async (t) => {
  let allowed = false; let refreshed = 0;
  const p = await page(t, () => allowed, async () => { refreshed++; }); await review(p); acknowledge(p);
  assert.equal(refreshed, 1); assert.equal(p.element('submit-collection').disabled, true);
  allowed = true;
  p.element('refresh-collection-budget').fire('click'); await delay(10);
  assert.equal(refreshed, 2); assert.equal(p.element('submit-collection').disabled, false);
  assert.equal(p.state.writes, 0); assert.equal(p.storage.size, 0);
  p.state.budgetChanged = () => { allowed = false; };
  p.element('submit-collection').fire('click'); await delay(20);
  assert.equal(refreshed, 3); assert.equal(p.state.writes, 0);
  assert.equal(p.element('submit-collection').disabled, true);
});
