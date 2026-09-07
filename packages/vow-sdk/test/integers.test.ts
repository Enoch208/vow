import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAmount, parseAmount, U128_MAX } from '../src/integers.ts';

test('T-019 decimal parsing preserves base units without floating-point arithmetic', () => {
  assert.equal(parseAmount('0.000001', 6), 1n);
  assert.equal(parseAmount('9007199254740993', 0), 9007199254740993n);
  assert.equal(parseAmount(U128_MAX.toString(), 0), U128_MAX);
  assert.equal(formatAmount(1234500n, 6), '1.2345');
  for (const decimals of [0, 6, 18, 255]) {
    for (const value of [0n, 1n, 999n, U128_MAX]) {
      assert.equal(parseAmount(formatAmount(value, decimals), decimals), value);
    }
  }
});

test('T-019 ambiguous, excessive precision, and out-of-range inputs fail', () => {
  for (const input of ['1e3', ' 1', '1 ', '-1', '+1', '01', '.1', '1.', '1,000', 'NaN', '']) {
    assert.throws(() => parseAmount(input, 6), /INVALID/);
  }
  assert.throws(() => parseAmount('0.0000001', 6), /PRECISION/);
  assert.throws(() => parseAmount((U128_MAX + 1n).toString(), 0), /AMOUNT/);
  for (const decimals of [-1, 256, 1.5, NaN]) {
    assert.throws(() => parseAmount('1', decimals), /DECIMALS/);
  }
});
