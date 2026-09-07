import { hash } from 'starknet';
import { address, bounded, felt, U128_MAX, U64_MAX } from './integers.ts';
import { PERMISSION_SLOTS } from './permissions.ts';
import { receiptFelt, receiptFelts, receiptRecord } from './receipt-values.ts';
import type { ReserveRequest } from './reserve-request.ts';

export interface PurchaseReservedEvent {
  readonly reservationId: bigint;
  readonly mandateId: bigint;
  readonly permissionId: bigint;
  readonly leafHash: bigint;
  readonly supplierKey: bigint;
  readonly amount: bigint;
  readonly claimBefore: bigint;
}

export interface ReservationClaimedEvent {
  readonly reservationId: bigint;
  readonly mandateId: bigint;
  readonly noteId: bigint;
  readonly amount: bigint;
}

export function decodePurchaseReserved(
  raw: unknown, vaultAddress: bigint, reservationId: bigint,
): PurchaseReservedEvent {
  const { keys, data } = single(raw, vaultAddress, reservationId, 'PurchaseReserved', 5);
  return Object.freeze({
    reservationId, mandateId: felt(keys[2]!, 'MANDATE', 1n),
    permissionId: bounded(data[0]!, BigInt(PERMISSION_SLOTS - 1), 'PERMISSION_ID'),
    leafHash: felt(data[1]!, 'LEAF', 1n), supplierKey: felt(data[2]!, 'SUPPLIER_KEY', 1n),
    amount: bounded(data[3]!, U128_MAX, 'AMOUNT', 1n),
    claimBefore: bounded(data[4]!, U64_MAX, 'CLAIM_BEFORE', 1n),
  });
}

export function decodeReservationClaimed(
  raw: unknown, vaultAddress: bigint, reservationId: bigint,
): ReservationClaimedEvent {
  const { keys, data } = single(raw, vaultAddress, reservationId, 'ReservationClaimed', 2);
  return Object.freeze({
    reservationId, mandateId: felt(keys[2]!, 'MANDATE', 1n), noteId: felt(data[0]!, 'NOTE', 1n),
    amount: bounded(data[1]!, U128_MAX, 'AMOUNT', 1n),
  });
}

export function assertReservationMatchesRequest(
  event: PurchaseReservedEvent, request: ReserveRequest,
): void {
  const matches = event.reservationId === request.reservationId
    && event.mandateId === request.authorization.mandateId
    && event.permissionId === request.authorization.permissionId
    && event.leafHash === request.authorization.leafHash
    && event.supplierKey === request.supplierKey
    && event.amount === request.authorization.requestedAmount
    && event.claimBefore === request.claimBefore;
  if (!matches) throw new Error('VOW_RESERVATION_EVENT_MISMATCH');
}

function single(
  raw: unknown, vaultAddress: bigint, reservationId: bigint, name: string, dataLength: number,
): { keys: readonly bigint[]; data: readonly bigint[] } {
  if (!Array.isArray(raw) || raw.length > 4096) throw new Error('VOW_INVALID_RECEIPT_DATA');
  address(vaultAddress, 'VAULT');
  felt(reservationId, 'RESERVATION', 1n);
  const selector = BigInt(hash.getSelectorFromName(name));
  let found: { keys: readonly bigint[]; data: readonly bigint[] } | null = null;
  for (const input of raw) {
    const event = receiptRecord(input);
    const keys = receiptFelts(event.keys, 64);
    if (receiptFelt(event.from_address) !== vaultAddress || keys[0] !== selector) continue;
    if (keys.length !== 3) throw new Error('VOW_VAULT_EVENT_MISMATCH');
    if (keys[1] !== reservationId) continue;
    const data = receiptFelts(event.data, 64);
    if (data.length !== dataLength) throw new Error('VOW_VAULT_EVENT_MISMATCH');
    if (found) throw new Error('VOW_DUPLICATE_VAULT_EVENT');
    found = { keys, data };
  }
  if (!found) throw new Error('VOW_VAULT_EVENT_MISSING');
  return found;
}
