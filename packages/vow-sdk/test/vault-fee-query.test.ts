import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { hash } from 'starknet';
import type { CompiledSierra, CompiledSierraCasm } from 'starknet';
import { MAINNET_CHAIN_ID } from '../src/vault-deployment.ts';
import type { VaultDeploymentTerms } from '../src/vault-deployment.ts';
import { buildVaultFeeQuery } from '../src/vault-fee-query.ts';
import type { VaultOwnerContext } from '../src/vault-fee-query.ts';

const sierra = JSON.parse(await readFile(
  'contracts/target/dev/vow_collection_probe_VowVault.contract_class.json', 'utf8',
)) as CompiledSierra;
const casm = JSON.parse(await readFile(
  'contracts/target/dev/vow_collection_probe_VowVault.compiled_contract_class.json', 'utf8',
)) as CompiledSierraCasm;

const STARKNET_VERSION = '0.14.3';
const BLOCK = 0x340f0dad3301ec05a48c5a2ca38ec01e380c6cf48ecf27cdb90b729177fd8ddn;
const owner: VaultOwnerContext = {
  address: 0x5282ba58af3296b7c6bdb51dfb12789cbf4603799e7fc8baef6a9704de1679en,
  nonce: 1n, version: 1, blockHash: BLOCK,
};
const terms: VaultDeploymentTerms = {
  chainId: MAINNET_CHAIN_ID, owner: owner.address, salt: 0x1234n,
  vaultClassHash: BigInt(hash.computeContractClassHash(sierra)),
  compiledClassHash: BigInt(hash.computeCompiledClassHash(casm, STARKNET_VERSION)),
  poolAddress: 0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812an,
  token: 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938dn,
  feeToken: 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938dn,
  maximumFee: 25_000_000_000_000_000_000n,
};
const build = () => buildVaultFeeQuery(owner, terms, sierra, casm, BLOCK, STARKNET_VERSION, 1n);

test('the request declares then deploys with consecutive nonces and no signature', () => {
  const query = build();
  assert.equal(query.method, 'starknet_estimateFee');
  assert.equal(query.params.request.length, 2);
  const [declare, deploy] = query.params.request;
  assert.equal(declare!.type, 'DECLARE');
  assert.equal(deploy!.type, 'INVOKE');
  assert.equal(declare!.nonce, '0x1');
  assert.equal(deploy!.nonce, '0x2');
  for (const entry of query.params.request) assert.deepEqual(entry.signature, []);
});

test('the review states exactly which stages are estimated and which are not', () => {
  const { review } = build();
  assert.deepEqual(review.stages, ['classDeclaration', 'vaultDeployment']);
  assert.equal(review.totalBudgetVerified, false);
  assert.equal(review.validation, 'skipped');
  assert.equal(review.sourceDisclosure, 'full-contract-class');
  assert.equal(review.omitted.includes('mandateCreation'), true);
  assert.equal(review.omitted.includes('funding'), true);
  assert.equal(review.omitted.includes('collection'), true);
});

test('a stale nonce block or foreign account cannot be estimated', () => {
  assert.throws(
    () => buildVaultFeeQuery({ ...owner, blockHash: BLOCK + 1n }, terms, sierra, casm, BLOCK,
      STARKNET_VERSION, 1n), /OWNER_BLOCK_MISMATCH/,
  );
  assert.throws(
    () => buildVaultFeeQuery({ ...owner, address: owner.address + 1n }, terms, sierra, casm, BLOCK,
      STARKNET_VERSION, 1n), /WRONG_DEPLOYMENT_ACCOUNT/,
  );
});

test('a class hash that does not match the local build is refused', () => {
  assert.throws(
    () => buildVaultFeeQuery(owner, { ...terms, vaultClassHash: terms.vaultClassHash + 1n }, sierra,
      casm, BLOCK, STARKNET_VERSION, 1n), /WRONG_VAULT_BUILD/,
  );
  assert.throws(
    () => buildVaultFeeQuery(owner, { ...terms, compiledClassHash: terms.compiledClassHash + 1n },
      sierra, casm, BLOCK, STARKNET_VERSION, 1n), /WRONG_VAULT_BUILD/,
  );
});

test('an unsupported chain version is refused', () => {
  assert.throws(
    () => buildVaultFeeQuery(owner, terms, sierra, casm, BLOCK, '0.13.1', 1n),
    /UNSUPPORTED_CHAIN_VERSION/,
  );
});
