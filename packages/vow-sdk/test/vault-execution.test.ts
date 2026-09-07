import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { hash } from 'starknet';
import type { CompiledSierra, CompiledSierraCasm } from 'starknet';
import { MAINNET_CHAIN_ID } from '../src/vault-deployment.ts';
import type { VaultDeploymentTerms } from '../src/vault-deployment.ts';
import {
  checkVaultWallet, readVaultStage, validateVaultArtifact, vaultStageRequest,
} from '../src/vault-execution.ts';
import { PublicReadError } from '../src/probe-reader.ts';
import type { PublicReader } from '../src/probe-reader.ts';
import type { DeploymentArtifact } from '../src/deployment-execution-state.ts';

const sierra = JSON.parse(await readFile(
  'contracts/target/dev/vow_collection_probe_VowVault.contract_class.json', 'utf8',
)) as CompiledSierra;
const casm = JSON.parse(await readFile(
  'contracts/target/dev/vow_collection_probe_VowVault.compiled_contract_class.json', 'utf8',
)) as CompiledSierraCasm;

const CLASS_HASH = BigInt(hash.computeContractClassHash(sierra));
const COMPILED = BigInt(hash.computeCompiledClassHash(casm, '0.14.3'));
const BLOCK = '0x605d7bbe661cbf3ddbdaaa7d1a1acb97619940b2f233a88f6a21b0f92a07b3c';
const OWNER = 0x5282ba58af3296b7c6bdb51dfb12789cbf4603799e7fc8baef6a9704de1679en;

const terms: VaultDeploymentTerms = {
  chainId: MAINNET_CHAIN_ID, owner: OWNER, salt: 0x1234n, vaultClassHash: CLASS_HASH,
  compiledClassHash: COMPILED,
  poolAddress: 0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812an,
  token: 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938dn,
  feeToken: 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938dn,
  maximumFee: 35_000_000_000_000_000_000n,
};
const artifact: DeploymentArtifact = {
  classHash: `0x${CLASS_HASH.toString(16)}`, compiledClassHash: `0x${COMPILED.toString(16)}`,
  starknetVersion: '0.14.3', contractClass: sierra,
};

function reader(options: { declared: boolean; deployed: boolean }): PublicReader {
  return {
    async request(method) {
      if (method === 'starknet_getBlockWithTxHashes') return { block_hash: BLOCK };
      if (method === 'starknet_getNonce') return '0x1';
      if (method === 'starknet_getClass') {
        if (!options.declared) throw new PublicReadError(28);
        return sierra;
      }
      if (method === 'starknet_getClassHashAt') {
        if (!options.deployed) throw new PublicReadError(20);
        return `0x${CLASS_HASH.toString(16)}`;
      }
      throw new Error(`UNEXPECTED_${method}`);
    },
  };
}

test('an undeclared class reports the declare stage', async () => {
  const reading = await readVaultStage(reader({ declared: false, deployed: false }), terms, 1n);
  assert.equal(reading.stage, 'declare');
  assert.equal(reading.declared, false);
  assert.equal(reading.nonce, 1n);
});

test('a declared but undeployed vault reports the deploy stage', async () => {
  const reading = await readVaultStage(reader({ declared: true, deployed: false }), terms, 1n);
  assert.equal(reading.stage, 'deploy');
  assert.equal(reading.declared, true);
  assert.equal(reading.deployed, false);
});

test('an already deployed vault reports complete and offers no further stage', async () => {
  const reading = await readVaultStage(reader({ declared: true, deployed: true }), terms, 1n);
  assert.equal(reading.stage, 'complete');
  assert.equal(reading.predictedVault > 0n, true);
});

test('a transport failure is never silently read as not-declared', async () => {
  const broken: PublicReader = {
    async request() { throw new PublicReadError(null); },
  };
  await assert.rejects(() => readVaultStage(broken, terms, 1n), /VOW_RPC_READ_FAILED/);
  const wrongCode: PublicReader = {
    async request(method) {
      if (method === 'starknet_getBlockWithTxHashes') return { block_hash: BLOCK };
      if (method === 'starknet_getNonce') return '0x1';
      throw new PublicReadError(51);
    },
  };
  await assert.rejects(() => readVaultStage(wrongCode, terms, 1n), /VOW_RPC_READ_FAILED/);
});

test('a foreign class at the predicted address is not treated as our vault', async () => {
  const impostor: PublicReader = {
    async request(method) {
      if (method === 'starknet_getBlockWithTxHashes') return { block_hash: BLOCK };
      if (method === 'starknet_getNonce') return '0x1';
      if (method === 'starknet_getClass') return sierra;
      return '0xdead';
    },
  };
  const reading = await readVaultStage(impostor, terms, 1n);
  assert.equal(reading.deployed, false);
  assert.equal(reading.stage, 'deploy');
});

test('the declare request carries the compiled class hash and no signature', () => {
  const request = vaultStageRequest('declare', terms, artifact, 1n);
  assert.equal(request.type, 'wallet_addDeclareTransaction');
  assert.deepEqual(Object.keys(request.params).sort(), ['api_version', 'declare_transaction']);
  const declaration = (request.params as {
    declare_transaction: { compiled_class_hash: string; contract_class: CompiledSierra };
  }).declare_transaction;
  assert.equal(
    declaration.compiled_class_hash,
    artifact.compiledClassHash,
  );
  assert.equal(typeof declaration.contract_class.abi, 'string');
  assert.deepEqual(JSON.parse(declaration.contract_class.abi as unknown as string), sierra.abi);
  assert.equal('signature' in declaration, false);
  assert.equal('sender_address' in declaration, false);
  assert.equal('compiled_class_hash' in request.params, false);
  assert.equal(Array.isArray(artifact.contractClass.abi), true);
});

test('the deploy request carries exactly one call to the deployer', () => {
  const request = vaultStageRequest('deploy', terms, artifact, 1n);
  assert.equal(request.type, 'wallet_addInvokeTransaction');
  assert.deepEqual(Object.keys(request.params).sort(), ['api_version', 'invoke_transaction']);
  const calls = (request.params as { invoke_transaction: Record<string, unknown>[] })
    .invoke_transaction;
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]!).sort(), ['calldata', 'contract_address', 'entry_point']);
  assert.equal(calls[0]!.entry_point, 'deploy_contract');
  assert.equal('calls' in request.params, false);
});

test('an artifact that does not match the reviewed terms is refused', () => {
  assert.throws(
    () => validateVaultArtifact({ ...artifact, classHash: '0x1' }, terms), /WRONG_VAULT_BUILD/,
  );
  assert.throws(
    () => validateVaultArtifact({ ...artifact, compiledClassHash: '0x1' }, terms),
    /WRONG_VAULT_BUILD/,
  );
  assert.throws(
    () => vaultStageRequest('declare', terms, { ...artifact, classHash: '0x1' }, 1n),
    /WRONG_VAULT_BUILD/,
  );
});

test('a contract class whose payload does not hash to the declared class hash is refused', () => {
  const restringified = {
    ...artifact,
    contractClass: {
      ...sierra,
      abi: hash.formatSpaces(JSON.stringify(sierra.abi)),
    },
  } as unknown as DeploymentArtifact;
  assert.notEqual(
    hash.computeContractClassHash(restringified.contractClass as CompiledSierra),
    `0x${CLASS_HASH.toString(16)}`,
  );
  assert.throws(() => validateVaultArtifact(restringified, terms), /CLASS_HASH_DRIFT/);
  assert.throws(
    () => vaultStageRequest('declare', terms, restringified, 1n), /CLASS_HASH_DRIFT/,
  );
  validateVaultArtifact(artifact, terms);
});

test('a wallet on the wrong account cannot be used to deploy', async () => {
  const wallet = { request: async (input: { type: string }) => {
    if (input.type === 'wallet_supportedWalletApi') return ['0.10.3'];
    if (input.type === 'wallet_requestChainId') return `0x${MAINNET_CHAIN_ID.toString(16)}`;
    return [`0x${(OWNER + 1n).toString(16)}`];
  } };
  await assert.rejects(() => checkVaultWallet(wallet, OWNER), /WRONG_WALLET_ACCOUNT/);
  await assert.rejects(
    () => checkVaultWallet({ request: async (input) => {
      if (input.type === 'wallet_supportedWalletApi') return ['0.10.3'];
      if (input.type === 'wallet_requestChainId') return `0x${MAINNET_CHAIN_ID.toString(16)}`;
      return [];
    } }, OWNER), /NO_WALLET_ACCOUNT/,
  );
  await assert.rejects(() => checkVaultWallet({ request: async (input) =>
    input.type === 'wallet_supportedWalletApi' ? ['0.10.2'] : [] }, OWNER),
  /UNSUPPORTED_WALLET/);
  await assert.rejects(() => checkVaultWallet({ request: async (input) => {
    if (input.type === 'wallet_supportedWalletApi') return ['0.10.3'];
    if (input.type === 'wallet_requestChainId') return '0x534e5f5345504f4c4941';
    return [];
  } }, OWNER), /WRONG_WALLET_CHAIN/);
  await checkVaultWallet({ request: async (input) => {
    if (input.type === 'wallet_supportedWalletApi') return ['0.10.3'];
    if (input.type === 'wallet_requestChainId') return `0x${MAINNET_CHAIN_ID.toString(16)}`;
    return [`0x${OWNER.toString(16)}`];
  } }, OWNER);
});
