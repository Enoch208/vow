import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCollectionBudgetManifest, validateCollectionBudgetManifest } from '../src/collection-budget.ts';
import { U128_MAX } from '../src/integers.ts';
import { TEST_COSTS } from '../src/test-budget.ts';
import { budgetConfig as config, budgetReview as review, budgetManifest } from './helpers/collection-budget.ts';

test('T-019 exact approved collection budget assesses every cost under $5 with integer arithmetic', () => {
  const result = validateCollectionBudgetManifest(budgetManifest(), config, review, 1001);
  assert.equal(result.status, 'within-quoted-cap'); assert.equal(result.approvedReviewDigest, review.reviewDigest);
  assert.equal(result.totalSTRK, 12_600_000_000_000_000_000n);
  assert.equal(result.estimatedUSDCentsRoundedUp, 38n); assert.equal(result.expiresAt, 1290);
  assert.equal(result.networkFeeEnforcement, 'manual-wallet-confirmation');
  assert.deepEqual(parseCollectionBudgetManifest(JSON.stringify(budgetManifest()), config, review, 1001), result);
});

test('T-019 missing, extra, malformed or unapproved budget fields fail closed at every level', () => {
  for (const mutate of [
    (data: Record<string, unknown>) => { delete data.approval; },
    (data: Record<string, unknown>) => { data.extra = true; },
    (data: Record<string, unknown>) => { data.approval = 'pending'; },
    (data: Record<string, unknown>) => { data.maximumUSDCents = '501'; },
    (data: Record<string, unknown>) => { (data.configuration as Record<string, unknown>).extra = '1'; },
    (data: Record<string, unknown>) => { (data.quote as Record<string, unknown>).source = 'unexpected'; },
    (data: Record<string, unknown>) => { delete (data.feeCapsSTRK as Record<string, unknown>).privacyRegistration; },
    (data: Record<string, unknown>) => { (data.feeCapsSTRK as Record<string, unknown>).extra = '1'; },
  ]) {
    const data = budgetManifest(); mutate(data);
    assert.throws(() => validateCollectionBudgetManifest(data, config, review, 1001), /VOW_/);
  }
  for (const value of ['', '{', 'x'.repeat(16_385)]) assert.throws(() => parseCollectionBudgetManifest(value, config, review, 1001), /INVALID_BUDGET_MANIFEST/);
});

test('T-006 changed configuration, fingerprint, approved digest or network cap invalidates budget approval', () => {
  for (const field of Object.keys(config) as (keyof typeof config)[]) {
    const data = budgetManifest(); data.configuration[field] = `0x${(config[field] + 1n).toString(16)}`;
    assert.throws(() => validateCollectionBudgetManifest(data, config, review, 1001), /TERMS_CHANGED/);
  }
  for (const field of ['configurationFingerprint', 'approvedReviewDigest', 'maximumNetworkFeeSTRK'] as const) {
    const data = budgetManifest(); data[field] = '1';
    assert.throws(() => validateCollectionBudgetManifest(data, config, review, 1001), /CHANGED/);
  }
  assert.throws(() => validateCollectionBudgetManifest(budgetManifest(), { ...config, recipient: config.recipient + 1n }, review, 1001), /TERMS_CHANGED/);
  assert.throws(() => validateCollectionBudgetManifest(budgetManifest(), config, { ...review, maximumPreparedFee: 1n }, 1001), /REVIEW_CHANGED/);
  assert.throws(() => validateCollectionBudgetManifest(budgetManifest(), { ...config, token: 1n }, review, 1001), /ASSET_MISMATCH/);
});

test('T-019 underfunded principal, collection or protocol limits and trusted historical minima are rejected', () => {
  for (const stage of ['principalSTRK', 'collection', 'protocolFee']) {
    const data = budgetManifest();
    if (stage === 'principalSTRK') data.principalSTRK = '1'; else data.feeCapsSTRK[stage as 'collection' | 'protocolFee'] = '1';
    assert.throws(() => validateCollectionBudgetManifest(data, config, review, 1001), /COMPONENT_UNDER_CAP/);
  }
  for (const stage of TEST_COSTS) assert.throws(() => validateCollectionBudgetManifest(budgetManifest(), config, review, 1001,
    { [stage]: BigInt(budgetManifest().feeCapsSTRK[stage]) + 1n }), /COMPONENT_UNDER_CAP/);
});

test('T-019 stale, future or mismatched quotes and expired review approvals cannot enable collection', () => {
  for (const quote of [{ pair: 'ETH/USD', usdPerSTRK: '0.03', observedAt: 990 },
    { pair: 'STRK/USD', usdPerSTRK: '0.03', observedAt: 699 }, { pair: 'STRK/USD', usdPerSTRK: '0.03', observedAt: 1002 },
    { pair: 'STRK/USD', usdPerSTRK: '0', observedAt: 990 }, { pair: 'STRK/USD', usdPerSTRK: '0.030000001', observedAt: 990 }]) {
    assert.throws(() => validateCollectionBudgetManifest({ ...budgetManifest(), quote }, config, review, 1001), /VOW_/);
  }
  for (const approvedAt of [699, 1002, -1]) assert.throws(() => validateCollectionBudgetManifest({ ...budgetManifest(), approvedAt }, config, review, 1001), /EXPIRED/);
  assert.throws(() => validateCollectionBudgetManifest(budgetManifest(), config, review, 1300), /EXPIRED/);
});

test('T-019 overflow, noninteger amounts and totals over $5 are rejected', () => {
  for (const principalSTRK of [(U128_MAX + 1n).toString(), '-1', '1.1', '1e18']) {
    assert.throws(() => validateCollectionBudgetManifest({ ...budgetManifest(), principalSTRK }, config, review, 1001), /VOW_/);
  }
  assert.throws(() => validateCollectionBudgetManifest({ ...budgetManifest(), principalSTRK: U128_MAX.toString() }, config, review, 1001), /TOTAL_COST/);
  assert.throws(() => validateCollectionBudgetManifest({ ...budgetManifest(), principalSTRK: '200000000000000000000' }, config, review, 1001), /EXCEEDS_CAP/);
});
