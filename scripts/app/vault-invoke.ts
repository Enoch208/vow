import { hash } from 'starknet';
import { address, bounded, felt, U64_MAX } from '../../packages/vow-sdk/src/integers.ts';
import { encodePermission } from '../../packages/vow-sdk/src/permissions.ts';
import type { PermissionLeaf } from '../../packages/vow-sdk/src/permissions.ts';
import { encodeReserve } from '../../packages/vow-sdk/src/reserve.ts';
import type { ReserveAuthorization, ReserveSignature } from '../../packages/vow-sdk/src/reserve.ts';

export interface VaultInvokeRequest {
  readonly type: 'wallet_addInvokeTransaction';
  readonly params: {
    readonly api_version: '0.10.3';
    readonly calls: readonly {
      readonly contract_address: string;
      readonly entry_point: string;
      readonly calldata: readonly string[];
    }[];
  };
}

export interface MandateTerms {
  readonly vaultAddress: bigint;
  readonly owner: bigint;
  readonly root: bigint;
  readonly operatorKey: bigint;
  readonly token: bigint;
  readonly expiresAt: bigint;
}

export function createMandateInvoke(terms: MandateTerms): VaultInvokeRequest {
  return invoke(address(terms.vaultAddress, 'VAULT'), 'create_mandate', [
    address(terms.owner, 'OWNER'), felt(terms.root, 'ROOT', 1n), felt(terms.operatorKey, 'OPERATOR_KEY', 1n),
    address(terms.token, 'TOKEN'), bounded(terms.expiresAt, U64_MAX, 'MANDATE_EXPIRY', 1n),
  ]);
}

export function reserveInvoke(authorization: ReserveAuthorization, leaf: PermissionLeaf,
  proof: readonly bigint[], signature: ReserveSignature): VaultInvokeRequest {
  if (proof.length !== 4) throw new Error('VOW_INVALID_PROOF_LENGTH');
  return invoke(address(authorization.vaultAddress, 'VAULT'), 'reserve', [
    ...encodeReserve(authorization).slice(1), ...encodePermission(leaf).slice(1),
    BigInt(proof.length), ...proof.map((value) => felt(value, 'PROOF', 1n)),
    felt(signature.r, 'SIGNATURE_R', 1n), felt(signature.s, 'SIGNATURE_S', 1n),
  ]);
}

function invoke(vaultAddress: bigint, entryPoint: string, calldata: readonly bigint[]): VaultInvokeRequest {
  return Object.freeze({ type: 'wallet_addInvokeTransaction', params: Object.freeze({ api_version: '0.10.3',
    calls: Object.freeze([Object.freeze({ contract_address: hex(vaultAddress),
      entry_point: hash.getSelectorFromName(entryPoint), calldata: Object.freeze(calldata.map(hex)) })]) }) });
}

function hex(value: bigint): string { return `0x${felt(value, 'CALLDATA').toString(16)}`; }
