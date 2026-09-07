import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertProbeReady } from '../src/probe-snapshot.ts';
import { config, snapshot } from './helpers/collection.ts';

test('G0 preflight accepts funded exact terms, allowing unsolicited donations without increasing entitlement', () => {
  assertProbeReady(config, snapshot, 1000n);
  assertProbeReady(config, { ...snapshot, balance: 200n }, 1000n);
});

test('G0 preflight rejects stale chain state, wrong code, changed terms and insufficient escrow', () => {
  const replacements = [
    { chainId: 2n }, { probeClassHash: 2n }, { poolClassHash: 2n }, { poolAddress: 2n }, { token: 2n },
    { supplierKey: 2n }, { amount: 101n }, { claimBefore: 2001n }, { feeCollector: 2n }, { state: 0n },
    { state: 2n }, { balance: 99n }, { allowance: 1n }, { poolPaused: 1n }, { timestamp: 699n }, { timestamp: 1031n },
  ];
  for (const changed of replacements) assert.throws(() => assertProbeReady(config, { ...snapshot, ...changed }, 1000n), JSON.stringify(changed, (_, value: unknown) => typeof value === 'bigint' ? String(value) : value));
  assert.throws(() => assertProbeReady(config, { ...snapshot, timestamp: 1900n }, 1900n), /EXPIRED/);
});
