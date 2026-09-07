import assert from 'node:assert/strict';
import { test } from 'node:test';
import { constants, hash } from 'starknet';
import { buildProbeDeploymentPlan } from '../src/deployment-plan.ts';
import { config } from './helpers/collection.ts';

const terms = { ...config, chainId: 0x534e5f4d41494en, owner: 100n, salt: 987n, principalLimit: 100n };

test('G0 deployment preview pins owner-bound address and exact approval/funding without estimating or submitting', () => {
  const plan = buildProbeDeploymentPlan(terms, 1000n);
  assert.equal(plan.status, 'preview-only');
  assert.equal(plan.networkFees, 'not-estimated');
  assert.equal(BigInt(plan.deploymentCall.contractAddress), BigInt(constants.UDC.ADDRESS));
  assert.deepEqual(plan.constructorCalldata, [terms.owner, terms.poolAddress, terms.token, terms.supplierKey, terms.amount, terms.claimBefore].map((value) => `0x${value.toString(16)}`));
  const uniqueSalt = hash.computePedersenHash(terms.owner, terms.salt);
  const predicted = hash.calculateContractAddressFromHash(uniqueSalt, terms.probeClassHash, [...plan.constructorCalldata], constants.UDC.ADDRESS);
  assert.equal(plan.predictedAddress, BigInt(predicted));
  assert.deepEqual(plan.fundingCalls[0]?.calldata, [`0x${plan.predictedAddress.toString(16)}`, '0x64', '0x0']);
  assert.equal(plan.fundingCalls[1]?.entrypoint, 'fund');
  assert.deepEqual(plan.fundingCalls[1]?.calldata, []);
  assert.equal(plan.collectionConfiguration.vaultAddress, plan.predictedAddress);
  assert.equal(Object.isFrozen(plan.fundingCalls[0]?.calldata), true);
});

test('G0 changed owner, supplier, token, cap or deadline produces a different review commitment', () => {
  const initial = buildProbeDeploymentPlan(terms, 1000n);
  for (const change of [{ owner: 101n }, { token: 58n }, { claimBefore: 2001n }, { principalLimit: 101n }, { recipient: 334n }, { maximumFee: 11n }]) {
    assert.notEqual(buildProbeDeploymentPlan({ ...terms, ...change }, 1000n).reviewDigest, initial.reviewDigest);
  }
  assert.notEqual(buildProbeDeploymentPlan({ ...terms, owner: 101n }, 1000n).predictedAddress, initial.predictedAddress);
});

test('G0 preview rejects expired terms, unapproved principal, wrong chain and invalid supplier point', () => {
  assert.throws(() => buildProbeDeploymentPlan({ ...terms, principalLimit: 99n }, 1000n), /PRINCIPAL_LIMIT/);
  assert.throws(() => buildProbeDeploymentPlan(terms, 1900n), /EXPIRED/);
  assert.throws(() => buildProbeDeploymentPlan({ ...terms, chainId: 1n }, 1000n), /WRONG_CHAIN/);
  assert.throws(() => buildProbeDeploymentPlan({ ...terms, supplierKey: 0n }, 1000n));
});
