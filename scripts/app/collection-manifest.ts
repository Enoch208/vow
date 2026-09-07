import { address, bounded, felt, U128_MAX } from '../../packages/vow-sdk/src/integers.ts';
import type { VaultDeploymentManifest } from '../../packages/vow-sdk/src/vault-collection.ts';

export interface AppToken {
  readonly address: bigint;
  readonly symbol: string;
  readonly decimals: number;
}

export interface AppDeployment {
  readonly schemaVersion: 1;
  readonly status: 'deployed' | 'not-deployed';
  readonly deployment: VaultDeploymentManifest;
  readonly tokens: readonly AppToken[];
  readonly preloadedTransactionHash: bigint;
  readonly evidence: string;
}

const deploymentFields = ['chainId', 'vaultAddress', 'vaultClassHash', 'poolAddress', 'poolClassHash', 'feeToken', 'feeCollector', 'maximumProtocolFee', 'maximumNetworkFee'] as const;

export function parseAppDeployment(input: unknown): AppDeployment {
  const root = object(input, ['schemaVersion', 'status', 'deployment', 'tokens', 'preloadedTransactionHash', 'evidence']);
  if (root.schemaVersion !== 1 || (root.status !== 'deployed' && root.status !== 'not-deployed') || typeof root.evidence !== 'string' || root.evidence.length < 1 || root.evidence.length > 160) throw new Error('VOW_INVALID_DEPLOYMENT_MANIFEST');
  const rawDeployment = object(root.deployment, deploymentFields);
  const deployment = Object.fromEntries(deploymentFields.map((field) => [field, integer(rawDeployment[field])])) as unknown as VaultDeploymentManifest;
  for (const field of ['vaultAddress', 'poolAddress', 'feeToken', 'feeCollector'] as const) address(deployment[field], 'DEPLOYMENT_ADDRESS');
  for (const field of ['chainId', 'vaultClassHash', 'poolClassHash'] as const) felt(deployment[field], 'DEPLOYMENT_FELT', 1n);
  bounded(deployment.maximumProtocolFee, U128_MAX, 'PROTOCOL_FEE'); bounded(deployment.maximumNetworkFee, U128_MAX, 'NETWORK_FEE');
  if (!Array.isArray(root.tokens) || root.tokens.length < 1 || root.tokens.length > 16) throw new Error('VOW_INVALID_DEPLOYMENT_MANIFEST');
  const tokens = root.tokens.map((input) => {
    const token = object(input, ['address', 'symbol', 'decimals']);
    const tokenAddress = address(integer(token.address), 'TOKEN');
    if (typeof token.symbol !== 'string' || !/^[A-Z0-9]{2,12}$/.test(token.symbol) || typeof token.decimals !== 'number' || !Number.isSafeInteger(token.decimals) || token.decimals < 0 || token.decimals > 38) throw new Error('VOW_INVALID_DEPLOYMENT_MANIFEST');
    return Object.freeze({ address: tokenAddress, symbol: token.symbol, decimals: token.decimals });
  });
  if (new Set(tokens.map((token) => token.address.toString())).size !== tokens.length) throw new Error('VOW_INVALID_DEPLOYMENT_MANIFEST');
  return Object.freeze({ schemaVersion: 1, status: root.status, deployment: Object.freeze(deployment), tokens: Object.freeze(tokens),
    preloadedTransactionHash: felt(integer(root.preloadedTransactionHash), 'TRANSACTION_HASH', 1n), evidence: root.evidence });
}

function object(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('VOW_INVALID_DEPLOYMENT_MANIFEST');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== fields.length || Object.keys(value).some((key) => !fields.includes(key))) throw new Error('VOW_INVALID_DEPLOYMENT_MANIFEST');
  return value;
}

function integer(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 80 || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) throw new Error('VOW_INVALID_DEPLOYMENT_MANIFEST');
  return BigInt(value);
}
