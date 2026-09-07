import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probeStrk20Wallet } from '../src/wallet.ts';

test('G0 probe requests no accounts, tokens, signatures, or transactions', async () => {
  const result = await probeStrk20Wallet({ request: async (request) => {
    assert.deepEqual(request, { type: 'wallet_supportedWalletApi' });
    return [];
  } });
  assert.equal(result.api, 'responded');
  assert.equal(result.collection, 'unverified');
});

test('G0 probe does not promote malformed or failed responses to support', async () => {
  const malformed = await probeStrk20Wallet({ request: async () => ({ supported: true }) });
  assert.equal(malformed.reason, 'MALFORMED_RESPONSE');
  const failed = await probeStrk20Wallet({ request: async () => { throw new Error('sensitive'); } });
  assert.equal(failed.reason, 'REQUEST_FAILED');
  assert.equal(JSON.stringify(failed).includes('sensitive'), false);
});

test('G0 unresponsive wallet times out without claiming lack of support', async () => {
  const result = await probeStrk20Wallet({ request: () => new Promise(() => {}) }, 5);
  assert.equal(result.reason, 'TIMEOUT');
  assert.equal(result.api, 'unverified');
});

test('G0 failed requests expose only a bounded numeric code', async () => {
  const result = await probeStrk20Wallet({ request: async () => {
    throw { code: -32601, message: 'sensitive', data: { account: 'private' } };
  } });
  assert.deepEqual(result, { api: 'unverified', collection: 'unverified', reason: 'REQUEST_FAILED', errorCode: -32601 });
  for (const code of ['private', Infinity, 1.5, 2147483648]) {
    const failure = await probeStrk20Wallet({ request: async () => { throw { code }; } });
    assert.equal(failure.errorCode, undefined);
  }
  const failure = await probeStrk20Wallet({ request: async () => {
    throw Object.defineProperty({}, 'code', { get() { throw new Error('private'); } });
  } });
  assert.equal(failure.reason, 'REQUEST_FAILED');
  assert.equal(failure.errorCode, undefined);
});

test('G0 version reports retain only bounded version lists and never establish collection', async () => {
  const result = await probeStrk20Wallet({ request: async () => ['0.10.3', '0.10.3-rc.2'] });
  assert.deepEqual(result.versions, ['0.10.3', '0.10.3-rc.2']);
  assert.equal(result.collection, 'unverified');
  for (const response of [['private-data'], [{ balance: '123' }], Array(33).fill('0.10.3')]) {
    const invalid = await probeStrk20Wallet({ request: async () => response });
    assert.equal(invalid.reason, 'MALFORMED_RESPONSE');
    assert.equal(invalid.versions, undefined);
  }
});
