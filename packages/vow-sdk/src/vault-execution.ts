import { hash, transaction } from 'starknet';
import type { CompiledSierra } from 'starknet';
import { felt } from './integers.ts';
import { PublicReadError } from './probe-reader.ts';
import type { PublicReader } from './probe-reader.ts';
import { buildVaultDeploymentPlan, MAINNET_CHAIN_ID } from './vault-deployment.ts';
import type { VaultDeploymentTerms } from './vault-deployment.ts';
import type { DeploymentArtifact, DeploymentWallet } from './deployment-execution-state.ts';

export type VaultStage = 'declare' | 'deploy' | 'complete';

export interface VaultStageReading {
  readonly stage: VaultStage;
  readonly nonce: bigint;
  readonly blockHash: bigint;
  readonly declared: boolean;
  readonly deployed: boolean;
  readonly predictedVault: bigint;
}

export function validateVaultArtifact(
  artifact: DeploymentArtifact, terms: VaultDeploymentTerms,
): void {
  if (BigInt(artifact.classHash) !== terms.vaultClassHash) throw new Error('VOW_WRONG_VAULT_BUILD');
  if (BigInt(artifact.compiledClassHash) !== terms.compiledClassHash) {
    throw new Error('VOW_WRONG_VAULT_BUILD');
  }
  const recomputed = BigInt(hash.computeContractClassHash(artifact.contractClass as CompiledSierra));
  if (recomputed !== terms.vaultClassHash) throw new Error('VOW_VAULT_CLASS_HASH_DRIFT');
}

export async function readVaultStage(
  reader: PublicReader, terms: VaultDeploymentTerms, now: bigint,
): Promise<VaultStageReading> {
  const plan = buildVaultDeploymentPlan(terms, now);
  const block = await reader.request(
    'starknet_getBlockWithTxHashes', { block_id: 'latest' },
  ) as { block_hash: string };
  const blockHash = felt(BigInt(block.block_hash), 'BLOCK', 1n);
  const blockId = { block_hash: block.block_hash };
  const nonce = await reader.request(
    'starknet_getNonce', { block_id: blockId, contract_address: hex(terms.owner) },
  ) as string;
  const declaredClass = await absentOnly(() => reader.request(
    'starknet_getClass', { block_id: blockId, class_hash: hex(terms.vaultClassHash) },
  ), 28);
  const deployedClass = await absentOnly(() => reader.request(
    'starknet_getClassHashAt',
    { block_id: blockId, contract_address: hex(plan.predictedAddress) },
  ), 20);
  const declared = declaredClass !== null;
  const deployed = deployedClass !== null
    && BigInt(deployedClass as string) === terms.vaultClassHash;
  return Object.freeze({
    stage: !declared ? 'declare' : !deployed ? 'deploy' : 'complete',
    nonce: felt(BigInt(nonce), 'OWNER_NONCE'),
    blockHash,
    declared,
    deployed,
    predictedVault: plan.predictedAddress,
  });
}

export function vaultStageRequest(
  stage: Exclude<VaultStage, 'complete'>,
  terms: VaultDeploymentTerms,
  artifact: DeploymentArtifact,
  now: bigint,
) {
  validateVaultArtifact(artifact, terms);
  const plan = buildVaultDeploymentPlan(terms, now);
  if (stage === 'declare') {
    return {
      type: 'wallet_addDeclareTransaction',
      params: {
        api_version: '0.10.3',
        compiled_class_hash: artifact.compiledClassHash,
        contract_class: {
          sierra_program: artifact.contractClass.sierra_program,
          contract_class_version: artifact.contractClass.contract_class_version,
          entry_points_by_type: artifact.contractClass.entry_points_by_type,
          abi: typeof artifact.contractClass.abi === 'string'
            ? JSON.parse(artifact.contractClass.abi) as unknown
            : structuredClone(artifact.contractClass.abi),
        },
      },
    };
  }
  const call = plan.deploymentCall;
  const calldata = call.calldata;
  if (!Array.isArray(calldata)) throw new Error('VOW_INVALID_DEPLOYMENT_CALL');
  return {
    type: 'wallet_addInvokeTransaction',
    params: {
      api_version: '0.10.3',
      invoke_transaction: [{
        contract_address: hex(BigInt(call.contractAddress)),
        entry_point: String(call.entrypoint),
        calldata: calldata.map((value: unknown) => hex(BigInt(String(value)))),
      }],
    },
  };
}

export function vaultExecuteCalldata(terms: VaultDeploymentTerms, now: bigint): string[] {
  const plan = buildVaultDeploymentPlan(terms, now);
  return transaction.getExecuteCalldata([plan.deploymentCall], '1')
    .map((value) => hex(BigInt(value)));
}

export async function checkVaultWallet(wallet: DeploymentWallet, owner: bigint): Promise<void> {
  const versions = await wallet.request({ type: 'wallet_supportedWalletApi' }) as unknown;
  if (!Array.isArray(versions) || !versions.includes('0.10.3')) {
    throw new Error('VOW_UNSUPPORTED_WALLET');
  }
  const chain = await wallet.request({ type: 'wallet_requestChainId' }) as unknown;
  if (typeof chain !== 'string' || BigInt(chain) !== MAINNET_CHAIN_ID) {
    throw new Error('VOW_WRONG_WALLET_CHAIN');
  }
  const accounts = await wallet.request({
    type: 'wallet_requestAccounts',
    params: { silent_mode: false, api_version: '0.10.3' },
  }) as unknown;
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('VOW_NO_WALLET_ACCOUNT');
  const first = accounts[0];
  if (typeof first !== 'string') throw new Error('VOW_NO_WALLET_ACCOUNT');
  if (BigInt(first) !== owner) throw new Error('VOW_WRONG_WALLET_ACCOUNT');
}

export function vaultWalletErrorCode(error: unknown): number | null {
  try {
    if (!error || typeof error !== 'object') return null;
    const code = Reflect.get(error, 'code');
    return typeof code === 'number' && Number.isSafeInteger(code) && Math.abs(code) <= 2147483647
      ? code : null;
  } catch {
    return null;
  }
}

async function absentOnly<T>(read: () => Promise<T>, code: number): Promise<T | null> {
  try {
    return await read();
  } catch (error: unknown) {
    if (error instanceof PublicReadError && error.errorCode === code) return null;
    throw error;
  }
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
