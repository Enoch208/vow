import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hash } from 'starknet';
import { validateAccountDeployment, connectAndReadAccountDeployment } from '../src/account-deployment.ts';
import type { CollectionRequest, CollectionWallet } from '../src/collection-wallet.ts';

const owner = BigInt(hash.calculateContractAddressFromHash('0x12', '0x123', ['0x456'], '0x0'));
const data = { address: `0x${owner.toString(16)}`, class_hash: '0x123', salt: '0x12', calldata: ['0x456'], version: 1 };

test('Account deployment data derives the expected owner and omits optional signature data without reading it', () => {
  const input = { ...data, get sigdata(): never { throw new Error('must not read'); } };
  const result = validateAccountDeployment(input, owner);
  assert.equal(result.address, data.address); assert.equal(result.addressVerified, true);
  assert.equal('sigdata' in result, false); assert.equal(result.signatureDataOmitted, true);
  assert.equal(Object.isFrozen(result.calldata), true);
});

test('Account deployment rejects account substitution and changed constructor, class or salt', () => {
  assert.throws(() => validateAccountDeployment(data, owner + 1n), /WRONG_DEPLOYMENT_ACCOUNT/);
  for (const change of [{ calldata: ['0x457'] }, { class_hash: '0x124' }, { salt: '0x13' }]) {
    assert.throws(() => validateAccountDeployment({ ...data, ...change }, owner), /ACCOUNT_ADDRESS_MISMATCH/);
  }
});

test('Account deployment bounds public fields and rejects unexpected payload fields', () => {
  for (const change of [{ version: 3 }, { class_hash: '0x0' }, { calldata: Array(257).fill('0x1') },
    { calldata: [1] }, { salt: '-1' }, { privateKey: 'synthetic-forbidden-field' }]) {
    assert.throws(() => validateAccountDeployment({ ...data, ...change }, owner));
  }
  assert.throws(() => validateAccountDeployment(null, owner));
});

test('Activation details connect the expected public account before reading chain and deployment data', async () => {
  const calls: CollectionRequest[] = [];
  let subscribed = false;
  const wallet: CollectionWallet = { async request(request) {
    calls.push(request);
    if (request.type === 'wallet_requestAccounts') { assert.equal(subscribed, false); return [data.address]; }
    assert.equal(subscribed, true);
    return request.type === 'wallet_requestChainId' ? '0x534e5f4d41494e' : data;
  } };
  assert.equal((await connectAndReadAccountDeployment(wallet, owner, () => true, () => { subscribed = true; })).address, data.address);
  assert.deepEqual(calls, [{ type: 'wallet_requestAccounts', params: { silent_mode: false, api_version: '0.10.3' } },
    { type: 'wallet_requestChainId' }, { type: 'wallet_deploymentData', params: { api_version: '0.10.3' } }]);
});

test('Activation details stop after refusal, wrong account, wrong network or invalidation', async () => {
  for (const scenario of ['refused', 'wrong-account', 'wrong-network', 'invalidated']) {
    const calls: string[] = []; let active = true;
    const wallet: CollectionWallet = { async request(request) {
      calls.push(request.type);
      if (request.type === 'wallet_requestAccounts') {
        if (scenario === 'refused') throw { code: 113, message: 'not exposed' };
        if (scenario === 'invalidated') active = false;
        return [scenario === 'wrong-account' ? '0x123' : data.address];
      }
      return '0x1';
    } };
    await assert.rejects(connectAndReadAccountDeployment(wallet, owner, () => active));
    assert.equal(calls.includes('wallet_deploymentData'), false);
    assert.equal(calls.length, scenario === 'wrong-network' ? 2 : 1);
  }
});
