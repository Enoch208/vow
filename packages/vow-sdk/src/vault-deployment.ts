import { defaultDeployer, hash } from 'starknet';
import type { Call } from 'starknet';
import { address, bounded, felt, U128_MAX, U64_MAX } from './integers.ts';

export const MAINNET_CHAIN_ID = 0x534e5f4d41494en;
export const VAULT_DEPLOY_DOMAIN = 0x564f575f5641554c545f4445504c4f595f5631n;

export interface VaultDeploymentTerms {
  readonly chainId: bigint;
  readonly owner: bigint;
  readonly salt: bigint;
  readonly vaultClassHash: bigint;
  readonly compiledClassHash: bigint;
  readonly poolAddress: bigint;
  readonly token: bigint;
  readonly feeToken: bigint;
  readonly maximumFee: bigint;
}

export interface VaultDeploymentPlan {
  readonly status: 'preview-only';
  readonly predictedAddress: bigint;
  readonly constructorCalldata: readonly string[];
  readonly deploymentCall: Readonly<Call>;
  readonly networkFees: 'not-estimated';
  readonly declaration: 'must-check-class-declaration';
  readonly reviewDigest: bigint;
}

export function validateVaultDeploymentTerms(terms: VaultDeploymentTerms): void {
  if (terms.chainId !== MAINNET_CHAIN_ID) throw new Error('VOW_WRONG_CHAIN');
  address(terms.owner, 'OWNER');
  address(terms.poolAddress, 'POOL');
  address(terms.token, 'TOKEN');
  address(terms.feeToken, 'FEE_TOKEN');
  felt(terms.salt, 'SALT', 1n);
  felt(terms.vaultClassHash, 'CLASS_HASH', 1n);
  felt(terms.compiledClassHash, 'COMPILED_CLASS_HASH', 1n);
  bounded(terms.maximumFee, U128_MAX, 'MAXIMUM_FEE', 1n);
  if (terms.poolAddress === terms.token) throw new Error('VOW_POOL_TOKEN_COLLISION');
  if (terms.poolAddress === terms.owner) throw new Error('VOW_POOL_OWNER_COLLISION');
}

export function buildVaultDeploymentPlan(
  terms: VaultDeploymentTerms, now: bigint,
): VaultDeploymentPlan {
  validateVaultDeploymentTerms(terms);
  bounded(now, U64_MAX, 'NOW', 1n);
  const constructorCalldata = [hex(terms.poolAddress)];
  const deployment = defaultDeployer.buildDeployerCall(
    {
      classHash: hex(terms.vaultClassHash), salt: hex(terms.salt), unique: true,
      constructorCalldata,
    },
    hex(terms.owner),
  );
  if (deployment.calls.length !== 1 || deployment.addresses.length !== 1) {
    throw new Error('VOW_INVALID_DEPLOYMENT');
  }
  const predictedAddress = address(BigInt(deployment.addresses[0]!), 'VAULT');
  const reviewDigest = BigInt(hash.computePoseidonHashOnElements([
    VAULT_DEPLOY_DOMAIN, terms.chainId, terms.owner, terms.vaultClassHash, terms.compiledClassHash,
    terms.salt, predictedAddress, terms.poolAddress, terms.token, terms.feeToken, terms.maximumFee,
  ]));
  return Object.freeze({
    status: 'preview-only',
    predictedAddress,
    constructorCalldata: Object.freeze(constructorCalldata),
    deploymentCall: freezeCall(deployment.calls[0]!),
    networkFees: 'not-estimated',
    declaration: 'must-check-class-declaration',
    reviewDigest,
  });
}

function freezeCall(call: Call): Readonly<Call> {
  const copied = structuredClone(call);
  if (copied.calldata) Object.freeze(copied.calldata);
  return Object.freeze(copied);
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
