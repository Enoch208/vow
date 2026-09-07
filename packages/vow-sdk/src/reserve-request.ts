import type { Call } from 'starknet';
import { bounded, felt, U128_MAX, U64_MAX } from './integers.ts';
import type { OperatorKey } from './operator-key.ts';
import type { PermissionSet } from './permission-set.ts';
import { encodePermission, verifyPermissionProof } from './permissions.ts';
import { computeReservationId } from './reservation-reader.ts';
import { encodeReserve, validateReserveAgainstPermission } from './reserve.ts';
import type { ReserveAuthorization, ReserveSignature } from './reserve.ts';

export interface ReserveRequestInput {
  readonly set: PermissionSet;
  readonly operatorKey: bigint;
  readonly permissionId: bigint;
  readonly requestedAmount: bigint;
  readonly requestId: bigint;
  readonly requestDeadline: bigint;
  readonly now: bigint;
}

export interface ReserveRequest {
  readonly authorization: ReserveAuthorization;
  readonly signature: ReserveSignature;
  readonly call: Readonly<Call>;
  readonly reservationId: bigint;
  readonly supplierKey: bigint;
  readonly claimBefore: bigint;
}

export function buildReserveRequest(input: ReserveRequestInput, key: OperatorKey): ReserveRequest {
  const { set } = input;
  const leaf = set.permission(input.permissionId);
  const slot = set.slot(input.permissionId);
  if (!verifyPermissionProof(slot.leafHash, slot.permissionId, slot.proof, set.root)) {
    throw new Error('VOW_BAD_PROOF');
  }
  const now = bounded(input.now, U64_MAX, 'NOW');
  const authorization: ReserveAuthorization = {
    chainId: set.context.chainId, vaultAddress: set.context.vaultAddress,
    mandateId: set.context.mandateId, immutableRoot: set.root, permissionId: slot.permissionId,
    leafHash: slot.leafHash, requestedAmount: bounded(input.requestedAmount, U128_MAX, 'REQUESTED_AMOUNT', 1n),
    requestId: felt(input.requestId, 'REQUEST_ID', 1n),
    requestDeadline: bounded(input.requestDeadline, U64_MAX, 'REQUEST_DEADLINE', 1n),
  };
  validateReserveAgainstPermission({
    authorization, maximumAmount: leaf.maximumAmount, validAfter: leaf.validAfter,
    approveBefore: leaf.approveBefore, now,
  });
  const signature = key.sign(authorization, input.operatorKey, now);
  const calldata = [
    ...encodeReserve(authorization).slice(1), ...encodePermission(leaf).slice(1),
    BigInt(slot.proof.length), ...slot.proof, signature.r, signature.s,
  ].map(hex);
  const call: Call = {
    contractAddress: hex(set.context.vaultAddress), entrypoint: 'reserve', calldata,
  };
  Object.freeze(call.calldata);
  return Object.freeze({
    authorization: Object.freeze(authorization), signature: Object.freeze(signature),
    call: Object.freeze(call),
    reservationId: computeReservationId(set.context.mandateId, slot.permissionId),
    supplierKey: leaf.supplierClaimPublicKey, claimBefore: leaf.claimBefore,
  });
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
