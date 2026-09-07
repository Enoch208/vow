import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfiguration } from '../../../scripts/collection/configuration.ts';
import { config } from './helpers/collection.ts';

const publicTerms = Object.fromEntries(Object.entries({ ...config, chainId: 0x534e5f4d41494en }).map(([field, value]) => [field, value.toString()]));

test('G0 workbench requires complete public terms and the locally built probe class', () => {
  const parsed = parseConfiguration(JSON.stringify(publicTerms), config.probeClassHash);
  assert.equal(parsed.amount, 100n); assert.equal(Object.isFrozen(parsed), true);
  assert.throws(() => parseConfiguration(JSON.stringify(publicTerms), 2n), /WRONG_PROBE_BUILD/);
  for (const input of ['{}', 'not json', JSON.stringify({ ...publicTerms, privateKey: 'do-not-store' }), JSON.stringify({ ...publicTerms, amount: 100 }), JSON.stringify({ ...publicTerms, amount: '1.5' })]) {
    assert.throws(() => parseConfiguration(input, config.probeClassHash));
  }
});
