import { hash, shortString } from 'starknet';
import { address, bounded, felt, parsePublicInteger, U128_MAX, U64_MAX } from './integers.ts';
import { PERMISSION_SLOTS } from './permissions.ts';
import type { PublicReader } from './probe-reader.ts';
import { decodeReservation } from './vault-collection.ts';
import type { VaultReservation } from './vault-collection.ts';

export const RESERVATION_DOMAIN = BigInt(shortString.encodeShortString('VOW_RESERVATION_V1'));
export const RESERVATION_NONE = 0n;
export const RESERVATION_OPEN = 1n;
export const RESERVATION_CLAIMED = 2n;
export const RESERVATION_EXPIRED = 3n;

export interface VaultMandate {
  readonly mandateId: bigint;
  readonly owner: bigint;
  readonly root: bigint;
  readonly operatorKey: bigint;
  readonly token: bigint;
  readonly expiresAt: bigint;
  readonly revoked: boolean;
  readonly funded: bigint;
  readonly reserved: bigint;
  readonly paid: bigint;
  readonly reclaimed: bigint;
}

export interface VaultReadRequest {
  readonly chainId: bigint;
  readonly vaultAddress: bigint;
  readonly mandateId: bigint;
  readonly permissionIds: readonly bigint[];
}

export interface VaultSnapshot {
  readonly chainId: bigint;
  readonly blockHash: bigint;
  readonly timestamp: bigint;
  readonly mandate: VaultMandate;
  readonly reservations: readonly VaultReservation[];
}

export function computeReservationId(mandateId: bigint, permissionId: bigint): bigint {
  return BigInt(hash.computePoseidonHashOnElements([
    RESERVATION_DOMAIN, felt(mandateId, 'MANDATE', 1n),
    bounded(permissionId, BigInt(PERMISSION_SLOTS - 1), 'PERMISSION_ID'),
  ]));
}

export function mandateAvailable(mandate: VaultMandate): bigint {
  const committed = mandate.reserved + mandate.paid + mandate.reclaimed;
  if (mandate.funded < committed) throw new Error('VOW_ACCOUNTING_BROKEN');
  return mandate.funded - committed;
}

export async function readVaultSnapshot(
  reader: PublicReader, request: VaultReadRequest,
): Promise<VaultSnapshot> {
  address(request.vaultAddress, 'VAULT');
  felt(request.chainId, 'CHAIN', 1n);
  const mandateId = felt(request.mandateId, 'MANDATE', 1n);
  if (request.permissionIds.length > PERMISSION_SLOTS) throw new RangeError('VOW_INVALID_SLOT_COUNT');
  const chainId = parsePublicInteger(await reader.request('starknet_chainId', []));
  if (chainId !== request.chainId) throw new Error('VOW_WRONG_CHAIN');
  const block = await reader.request('starknet_getBlockWithTxHashes', { block_id: 'latest' });
  if (!block || typeof block !== 'object' || !('block_hash' in block) || !('timestamp' in block)
    || typeof block.timestamp !== 'number' || !Number.isSafeInteger(block.timestamp)
    || block.timestamp < 0) throw new Error('VOW_INVALID_BLOCK');
  const blockHash = felt(parsePublicInteger(block.block_hash), 'BLOCK', 1n);
  const call = async (name: string, args: readonly bigint[], length: number) => {
    const response = await reader.request('starknet_call', {
      block_id: { block_hash: hex(blockHash) },
      request: {
        contract_address: hex(request.vaultAddress),
        entry_point_selector: hash.getSelectorFromName(name), calldata: args.map(hex),
      },
    });
    if (!Array.isArray(response) || response.length !== length) throw new Error('VOW_INVALID_READ');
    return response.map(parsePublicInteger);
  };
  const mandate = decodeMandate(mandateId, await call('mandate', [mandateId], 10));
  const reservations = await Promise.all(request.permissionIds.map(async (permissionId) => {
    const reservationId = computeReservationId(mandateId, permissionId);
    const values = await call('reservation', [reservationId], 9);
    return checkedReservation({ reservationId, mandateId, permissionId }, values);
  }));
  return Object.freeze({
    chainId, blockHash, timestamp: BigInt(block.timestamp), mandate,
    reservations: Object.freeze(reservations.filter((entry) => entry !== null)),
  });
}

function decodeMandate(mandateId: bigint, values: readonly bigint[]): VaultMandate {
  if (values[0] === 0n) throw new Error('VOW_MANDATE_NOT_FOUND');
  if (values[5]! > 1n) throw new Error('VOW_INVALID_READ');
  const mandate = Object.freeze({
    mandateId, owner: address(values[0]!, 'OWNER'), root: felt(values[1]!, 'ROOT', 1n),
    operatorKey: felt(values[2]!, 'OPERATOR_KEY', 1n), token: address(values[3]!, 'TOKEN'),
    expiresAt: bounded(values[4]!, U64_MAX, 'EXPIRES_AT', 1n), revoked: values[5] === 1n,
    funded: bounded(values[6]!, U128_MAX, 'FUNDED'), reserved: bounded(values[7]!, U128_MAX, 'RESERVED'),
    paid: bounded(values[8]!, U128_MAX, 'PAID'), reclaimed: bounded(values[9]!, U128_MAX, 'RECLAIMED'),
  });
  mandateAvailable(mandate);
  return mandate;
}

function checkedReservation(
  keys: { reservationId: bigint; mandateId: bigint; permissionId: bigint },
  values: readonly bigint[],
): VaultReservation | null {
  const reservation = decodeReservation(keys.reservationId, values);
  const state = bounded(reservation.state, RESERVATION_EXPIRED, 'RESERVATION_STATE');
  if (state === RESERVATION_NONE) return null;
  if (reservation.mandateId !== keys.mandateId || reservation.permissionId !== keys.permissionId) {
    throw new Error('VOW_RESERVATION_SLOT_MISMATCH');
  }
  felt(reservation.leafHash, 'LEAF', 1n);
  felt(reservation.supplierKey, 'SUPPLIER_KEY', 1n);
  address(reservation.token, 'TOKEN');
  bounded(reservation.amount, U128_MAX, 'AMOUNT', 1n);
  bounded(reservation.claimBefore, U64_MAX, 'CLAIM_BEFORE', 1n);
  felt(reservation.purchaseCommitment, 'PURCHASE_COMMITMENT');
  return reservation;
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
