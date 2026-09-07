import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAINNET_CHAIN_ID, buildVaultDeploymentPlan, validateVaultDeploymentTerms,
} from '../src/vault-deployment.ts';
import type { VaultDeploymentTerms } from '../src/vault-deployment.ts';

const terms: VaultDeploymentTerms = {
  chainId: MAINNET_CHAIN_ID,
  owner: 0x5282ba58af3296b7c6bdb51dfb12789cbf4603799e7fc8baef6a9704de1679en,
  salt: 0x1234n,
  vaultClassHash: 0x3c85f692be0a2280bc85fc9802019121a8b52ef4de0db9273c3806f7355ce14n,
  compiledClassHash: 0x2087a8efc270aca5965055f22568a72a058df02fc373fc333386e130b17253bn,
  poolAddress: 0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812an,
  token: 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938dn,
  feeToken: 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938dn,
  maximumFee: 20_000_000_000_000_000_000n,
};

test('the vault constructor commits to the pool and nothing else', () => {
  const plan = buildVaultDeploymentPlan(terms, 1_700_000_000n);
  assert.deepEqual(plan.constructorCalldata, [`0x${terms.poolAddress.toString(16)}`]);
  assert.equal(plan.status, 'preview-only');
  assert.equal(plan.networkFees, 'not-estimated');
  assert.equal(plan.declaration, 'must-check-class-declaration');
});

test('the predicted address is deterministic and salt-bound', () => {
  const first = buildVaultDeploymentPlan(terms, 1_700_000_000n);
  const again = buildVaultDeploymentPlan(terms, 1_800_000_000n);
  assert.equal(first.predictedAddress, again.predictedAddress);
  const resalted = buildVaultDeploymentPlan({ ...terms, salt: terms.salt + 1n }, 1_700_000_000n);
  assert.notEqual(resalted.predictedAddress, first.predictedAddress);
});

test('the review digest binds every field a reviewer approves', () => {
  const baseline = buildVaultDeploymentPlan(terms, 1_700_000_000n).reviewDigest;
  const fields: (keyof VaultDeploymentTerms)[] = [
    'owner', 'salt', 'vaultClassHash', 'compiledClassHash', 'poolAddress', 'token', 'feeToken',
    'maximumFee',
  ];
  for (const field of fields) {
    const altered = buildVaultDeploymentPlan({ ...terms, [field]: terms[field] + 1n }, 1n);
    assert.notEqual(altered.reviewDigest, baseline, field);
  }
});

test('the plan never carries a signature, fee estimate or declaration claim', () => {
  const plan = buildVaultDeploymentPlan(terms, 1_700_000_000n);
  const serialized = JSON.stringify(plan, (_key, value) =>
    typeof value === 'bigint' ? value.toString(16) : value);
  assert.equal(serialized.includes('signature'), false);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.deploymentCall), true);
  assert.equal(Object.isFrozen(plan.constructorCalldata), true);
});

test('a non-mainnet chain, zero address or zero fee cap is refused', () => {
  assert.throws(() => validateVaultDeploymentTerms({ ...terms, chainId: 1n }), /WRONG_CHAIN/);
  assert.throws(() => validateVaultDeploymentTerms({ ...terms, owner: 0n }), /OWNER/);
  assert.throws(() => validateVaultDeploymentTerms({ ...terms, poolAddress: 0n }), /POOL/);
  assert.throws(() => validateVaultDeploymentTerms({ ...terms, token: 0n }), /TOKEN/);
  assert.throws(() => validateVaultDeploymentTerms({ ...terms, salt: 0n }), /SALT/);
  assert.throws(() => validateVaultDeploymentTerms({ ...terms, vaultClassHash: 0n }), /CLASS_HASH/);
  assert.throws(() => validateVaultDeploymentTerms({ ...terms, maximumFee: 0n }), /MAXIMUM_FEE/);
});

test('a pool that collides with the token or the owner is refused', () => {
  assert.throws(
    () => validateVaultDeploymentTerms({ ...terms, poolAddress: terms.token }), /COLLISION/,
  );
  assert.throws(
    () => validateVaultDeploymentTerms({ ...terms, poolAddress: terms.owner }), /COLLISION/,
  );
});
