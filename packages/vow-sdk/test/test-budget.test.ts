import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessTestBudget, TEST_COSTS } from '../src/test-budget.ts';
import type { TestBudget, TestCost } from '../src/test-budget.ts';
const costs = Object.fromEntries(TEST_COSTS.map((name) => [name, 10n ** 18n])) as Record<TestCost, bigint>;
const budget: TestBudget = { maximumUSDCents: 500n, principalSTRK: 1n * 10n ** 18n, feeCapsSTRK: costs,
  quote: { pair: 'STRK/USD', usdPerSTRK: '0.05', observedAt: 1000 } };

test('Test budget includes every fee cap and principal using integer USD conversion', () => {
  const report = assessTestBudget(budget, 1000);
  assert.equal(report.status, 'within-quoted-cap');
  assert.equal(report.totalSTRK, 9n * 10n ** 18n);
  assert.equal(report.maximumSTRKAtQuote, 100n * 10n ** 18n);
  assert.equal(report.estimatedUSDCentsRoundedUp, 45n);
  assert.equal(assessTestBudget({ ...budget, principalSTRK: 100n * 10n ** 18n }, 1000).status, 'over-quoted-cap');
});

test('Missing costs and quotes cannot be treated as zero-cost approval', () => {
  assert.equal(assessTestBudget({ ...budget, principalSTRK: null }, 1000).status, 'needs-estimates');
  const result = assessTestBudget({ ...budget, feeCapsSTRK: { ...costs, accountActivation: null }, quote: null }, 1000);
  assert.deepEqual(result, { status: 'needs-estimates', missing: ['accountActivation', 'STRK/USD quote'] });
  for (const missing of TEST_COSTS) assert.equal(assessTestBudget({ ...budget, feeCapsSTRK: { ...costs, [missing]: null } }, 1000).status, 'needs-estimates');
});

test('Stale or future quotes, zero prices and negative cost caps are refused', () => {
  assert.throws(() => assessTestBudget(budget, 1301), /STALE_QUOTE/);
  assert.throws(() => assessTestBudget(budget, 999), /STALE_QUOTE/);
  assert.throws(() => assessTestBudget({ ...budget, quote: { pair: 'STRK/USD', usdPerSTRK: '0', observedAt: 1000 } }, 1000), /QUOTE_PRICE/);
  assert.throws(() => assessTestBudget({ ...budget, feeCapsSTRK: { ...costs, recoveryReserve: -1n } }, 1000), /FEE_CAP/);
});
