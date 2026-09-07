import { address, felt, parsePublicInteger } from '../../packages/vow-sdk/src/integers.ts';
import { MAINNET_CHAIN_ID } from '../../packages/vow-sdk/src/vault-deployment.ts';
import { validateVaultDeployment } from '../../packages/vow-sdk/src/vault-collection.ts';
import type { VaultDeploymentManifest } from '../../packages/vow-sdk/src/vault-collection.ts';

const FIELDS = ['chainId', 'vaultAddress', 'vaultClassHash', 'poolAddress', 'poolClassHash',
  'feeToken', 'feeCollector', 'maximumProtocolFee', 'maximumNetworkFee'] as const;

export type ManifestState =
  | { readonly status: 'deployed'; readonly manifest: VaultDeploymentManifest }
  | { readonly status: 'not-deployed'; readonly detail: string }
  | { readonly status: 'unreadable'; readonly detail: string };

export function parseVaultManifest(text: unknown, expectedVaultClassHash: bigint): VaultDeploymentManifest {
  felt(expectedVaultClassHash, 'VAULT_CLASS_HASH', 1n);
  if (typeof text !== 'string' || text.length > 4096) throw new Error('VOW_INVALID_VAULT_MANIFEST');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('VOW_INVALID_VAULT_MANIFEST'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('VOW_INVALID_VAULT_MANIFEST');
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== FIELDS.length ||
      Object.keys(record).some((key) => !FIELDS.some((field) => field === key))) throw new Error('VOW_INVALID_VAULT_MANIFEST');
  let values: Record<string, bigint>;
  try { values = Object.fromEntries(FIELDS.map((field) => [field, parsePublicInteger(record[field])])); }
  catch { throw new Error('VOW_INVALID_VAULT_MANIFEST'); }
  const manifest = Object.freeze(values as unknown as VaultDeploymentManifest);
  validateVaultDeployment(manifest);
  address(manifest.vaultAddress, 'VAULT');
  if (manifest.chainId !== MAINNET_CHAIN_ID) throw new Error('VOW_WRONG_CHAIN');
  if (manifest.vaultClassHash !== expectedVaultClassHash) throw new Error('VOW_WRONG_VAULT_BUILD');
  if (new Set([manifest.vaultAddress, manifest.poolAddress, manifest.feeToken]).size !== 3) throw new Error('VOW_INVALID_VAULT_MANIFEST');
  return manifest;
}

export async function loadVaultManifest(load: () => Promise<Response>, expectedVaultClassHash: bigint): Promise<ManifestState> {
  let response: Response;
  try { response = await load(); }
  catch { return { status: 'unreadable', detail: 'The deployment manifest could not be read from this local server.' }; }
  if (response.status === 404) {
    return { status: 'not-deployed', detail: 'No VowVault deployment manifest exists. No vault has been declared, deployed or funded.' };
  }
  if (!response.ok) return { status: 'unreadable', detail: `The local server answered ${response.status} for the deployment manifest.` };
  try { return { status: 'deployed', manifest: parseVaultManifest(await response.text(), expectedVaultClassHash) }; }
  catch (error: unknown) {
    const code = error instanceof Error && /^VOW_[A-Z_]+$/.test(error.message) ? error.message : 'VOW_INVALID_VAULT_MANIFEST';
    return { status: 'unreadable', detail: `The deployment manifest was rejected (${code}). Writes stay blocked.` };
  }
}

export interface AppTokenMetadata {
  readonly address: bigint;
  readonly symbol: string;
  readonly decimals: number;
}

export interface AppDeployment {
  readonly schemaVersion: 1;
  readonly status: 'deployed' | 'not-deployed';
  readonly deployment: VaultDeploymentManifest;
  readonly tokens: readonly AppTokenMetadata[];
  readonly preloadedTransactionHash: bigint | null;
  readonly evidence: string;
}

const DEPLOYMENT_FIELDS = ['schemaVersion', 'status', 'deployment', 'tokens', 'preloadedTransactionHash', 'evidence'] as const;

export function parseAppDeployment(input: unknown): AppDeployment {
  const record = exactly(input, DEPLOYMENT_FIELDS);
  if (record.schemaVersion !== 1) throw new Error('VOW_INVALID_APP_DEPLOYMENT');
  if (record.status !== 'deployed' && record.status !== 'not-deployed') throw new Error('VOW_INVALID_APP_DEPLOYMENT');
  const raw = exactly(record.deployment, FIELDS);
  const deployment = Object.freeze(Object.fromEntries(FIELDS.map((field) => [field, integer(raw[field])])) as unknown as VaultDeploymentManifest);
  address(deployment.vaultAddress, 'VAULT');
  if (!Array.isArray(record.tokens) || record.tokens.length < 1 || record.tokens.length > 8) throw new Error('VOW_INVALID_APP_DEPLOYMENT');
  const tokens = record.tokens.map((entry: unknown) => {
    const token = exactly(entry, ['address', 'symbol', 'decimals']);
    if (typeof token.symbol !== 'string' || !/^[A-Za-z0-9]{1,12}$/.test(token.symbol)) throw new Error('VOW_INVALID_APP_DEPLOYMENT');
    if (typeof token.decimals !== 'number' || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255) throw new Error('VOW_INVALID_APP_DEPLOYMENT');
    return Object.freeze({ address: address(integer(token.address), 'TOKEN'), symbol: token.symbol, decimals: token.decimals });
  });
  if (typeof record.evidence !== 'string' || record.evidence.length < 1 || record.evidence.length > 512) throw new Error('VOW_INVALID_APP_DEPLOYMENT');
  return Object.freeze({ schemaVersion: 1, status: record.status, deployment, tokens: Object.freeze(tokens),
    preloadedTransactionHash: record.preloadedTransactionHash === null ? null : felt(integer(record.preloadedTransactionHash), 'TRANSACTION_HASH', 1n),
    evidence: record.evidence });
}

function exactly(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length ||
      Object.keys(value).some((key) => !fields.includes(key))) throw new Error('VOW_INVALID_APP_DEPLOYMENT');
  return value as Record<string, unknown>;
}

function integer(value: unknown): bigint {
  try { return parsePublicInteger(value); } catch { throw new Error('VOW_INVALID_APP_DEPLOYMENT'); }
}
