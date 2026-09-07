import { hash } from 'starknet';
import { POOL_CLASS_HASH } from '../../src/prepared-claim.ts';
import type { PublicReader } from '../../src/probe-reader.ts';
import type { VaultDeploymentManifest } from '../../src/vault-collection.ts';
import type { ManifestState } from '../../../../scripts/app/manifest.ts';

export const VAULT_ADDRESS = 0x4a1n;
export const TOKEN = 0x202n;
export const OWNER = 0x303n;
export const OPERATOR_PRIVATE_KEY = '0x5eed0000000000000000000000000000000000000000000000000000000005';
export const CHAIN = 0x534e5f4d41494en;

export const manifest: VaultDeploymentManifest = Object.freeze({
  chainId: CHAIN, vaultAddress: VAULT_ADDRESS, vaultClassHash: 0xc1a55n,
  poolAddress: 0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812an,
  poolClassHash: POOL_CLASS_HASH, feeToken: 0xfee7n, feeCollector: 0xc011n,
  maximumProtocolFee: 0n, maximumNetworkFee: 10n ** 18n,
});
export const deployed: ManifestState = { status: 'deployed', manifest };
export const notDeployed: ManifestState = { status: 'not-deployed', detail: 'No VowVault deployment manifest exists.' };

export interface MandateRow {
  owner: bigint; root: bigint; operatorKey: bigint; token: bigint; expiresAt: bigint;
  revoked: bigint; funded: bigint; reserved: bigint; paid: bigint; reclaimed: bigint;
}

export interface ChainState {
  mandates: Map<string, MandateRow>;
  reservations: Map<string, bigint[]>;
  reads: number;
  fail: boolean;
}

export function chain(): ChainState {
  return { mandates: new Map(), reservations: new Map(), reads: 0, fail: false };
}

export function mandateRow(overrides: Partial<MandateRow> = {}): MandateRow {
  return { owner: OWNER, root: 0x5eedn, operatorKey: 0x3n, token: TOKEN, expiresAt: 9000n, revoked: 0n,
    funded: 1000n, reserved: 0n, paid: 0n, reclaimed: 0n, ...overrides };
}

export function reader(state: ChainState): PublicReader {
  return { request: async (method, params) => {
    state.reads += 1;
    if (state.fail) throw new Error('TEST_RPC_DOWN');
    if (method === 'starknet_chainId') return `0x${CHAIN.toString(16)}`;
    if (method === 'starknet_getBlockWithTxHashes') return { block_hash: '0x7b', timestamp: 1000 };
    if (method !== 'starknet_call') throw new Error(`TEST_UNEXPECTED_${method}`);
    const call = (params as { request: { entry_point_selector: string; calldata: string[] } }).request;
    const key = call.calldata[0]!;
    if (call.entry_point_selector === hash.getSelectorFromName('mandate')) {
      const row = state.mandates.get(BigInt(key).toString());
      const values = row ? [row.owner, row.root, row.operatorKey, row.token, row.expiresAt, row.revoked,
        row.funded, row.reserved, row.paid, row.reclaimed] : Array.from({ length: 10 }, () => 0n);
      return values.map(hex);
    }
    if (call.entry_point_selector === hash.getSelectorFromName('reservation')) {
      return (state.reservations.get(BigInt(key).toString()) ?? Array.from({ length: 9 }, () => 0n)).map(hex);
    }
    throw new Error('TEST_UNEXPECTED_CALL');
  } };
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
