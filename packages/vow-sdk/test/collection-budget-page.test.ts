import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCollectionBudgetGate } from '../../../scripts/collection/budget.ts';
import { budgetConfig as config, budgetReview as review, budgetManifest } from './helpers/collection-budget.ts';

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

test('T-019 budget loader reads only the fixed same-origin file without credentials and reevaluates quote freshness', async () => {
  let now = 1001; let reads = 0;
  const gate = createCollectionBudgetGate(async (input, options) => {
    reads++; assert.equal(input, '/collection/budget.json');
    assert.equal(options?.method, 'GET'); assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store');
    assert.equal(options?.referrerPolicy, 'no-referrer');
    return json(budgetManifest());
  }, () => now);
  assert.equal(gate.allows(config, review), false);
  await gate.load(config, review); assert.equal(reads, 1); assert.equal(gate.allows(config, review), true);
  now = 1291; assert.equal(gate.allows(config, review), false);
});

test('T-019 a missing, malformed, oversized or mismatched local budget never authorizes submission', async () => {
  for (const response of [
    new Response('Not found', { status: 404 }), new Response('Unavailable', { status: 503 }),
    new Response('{}', { headers: { 'content-type': 'text/html' } }),
    new Response('{}', { headers: { 'content-type': 'application/json-evil' } }),
    new Response('x'.repeat(16_385), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '999999' } }),
    json({ ...budgetManifest(), approvedReviewDigest: '1' }), json({ ...budgetManifest(), quote: null }),
  ]) {
    const gate = createCollectionBudgetGate(async () => response, () => 1001);
    await gate.load(config, review); assert.equal(gate.allows(config, review), false);
  }
});

test('T-018 a failed refresh invalidates a previously accepted budget and never retains old authorization', async () => {
  let available = true;
  const gate = createCollectionBudgetGate(async () => available ? json(budgetManifest()) : new Response('', { status: 404 }), () => 1001);
  await gate.load(config, review); assert.equal(gate.allows(config, review), true);
  available = false; await gate.load(config, review); assert.equal(gate.allows(config, review), false);
});

test('T-018 an old in-flight budget response cannot override a newer missing manifest or cleared session', async () => {
  let first = true; let resolve: (response: Response) => void = () => {};
  const gate = createCollectionBudgetGate(async () => {
    if (first) { first = false; return new Promise<Response>((done) => { resolve = done; }); }
    return new Response('', { status: 404 });
  }, () => 1001);
  const pending = gate.load(config, review);
  await gate.load(config, review); resolve(json(budgetManifest())); await pending;
  assert.equal(gate.allows(config, review), false);
  first = true; const cleared = gate.load(config, review); gate.clear(); resolve(json(budgetManifest())); await cleared;
  assert.equal(gate.allows(config, review), false);
});

test('T-006 cached approval cannot authorize a changed recipient or prepared review', async () => {
  const gate = createCollectionBudgetGate(async () => json(budgetManifest()), () => 1001);
  await gate.load(config, review);
  assert.equal(gate.allows({ ...config, recipient: config.recipient + 1n }, review), false);
  assert.equal(gate.allows(config, { ...review, reviewDigest: review.reviewDigest + 1n }), false);
});
