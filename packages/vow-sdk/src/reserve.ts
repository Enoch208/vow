import { ec, hash, shortString } from 'starknet';
import { address, bounded, felt, U128_MAX, U64_MAX } from './integers.ts';
import { PERMISSION_SLOTS } from './permissions.ts';

export const RESERVE_DOMAIN = BigInt(shortString.encodeShortString('VOW_RESERVE_V1'));

export interface ReserveAuthorization {
  readonly chainId: bigint;
  readonly vaultAddress: bigint;
  readonly mandateId: bigint;
  readonly immutableRoot: bigint;
  readonly permissionId: bigint;
  readonly leafHash: bigint;
  readonly requestedAmount: bigint;
  readonly requestId: bigint;
  readonly requestDeadline: bigint;
}

export interface ReserveSignature {
  readonly r: bigint;
  readonly s: bigint;
}

export function encodeReserve(authorization: ReserveAuthorization): bigint[] {
  return [
    RESERVE_DOMAIN,
    felt(authorization.chainId, 'CHAIN', 1n),
    address(authorization.vaultAddress, 'VAULT'),
    felt(authorization.mandateId, 'MANDATE', 1n),
    felt(authorization.immutableRoot, 'ROOT', 1n),
    bounded(authorization.permissionId, BigInt(PERMISSION_SLOTS - 1), 'PERMISSION_ID'),
    felt(authorization.leafHash, 'LEAF', 1n),
    bounded(authorization.requestedAmount, U128_MAX, 'REQUESTED_AMOUNT', 1n),
    felt(authorization.requestId, 'REQUEST_ID', 1n),
    bounded(authorization.requestDeadline, U64_MAX, 'REQUEST_DEADLINE', 1n),
  ];
}

export function hashReserve(authorization: ReserveAuthorization): bigint {
  return BigInt(hash.computePoseidonHashOnElements(encodeReserve(authorization)));
}

export function signReserve(
  authorization: ReserveAuthorization, operatorPrivateKey: string,
): ReserveSignature {
  const signature = ec.starkCurve.sign(hashReserve(authorization).toString(16), operatorPrivateKey);
  return { r: signature.r, s: signature.s };
}

export function verifyReserveSignature(
  authorization: ReserveAuthorization, signature: ReserveSignature, operatorKey: bigint,
): boolean {
  try {
    const parsed = new ec.starkCurve.Signature(signature.r, signature.s);
    const x = felt(operatorKey, 'OPERATOR_KEY', 1n).toString(16).padStart(64, '0');
    const digest = hashReserve(authorization).toString(16);
    return ec.starkCurve.verify(parsed, digest, `02${x}`)
      || ec.starkCurve.verify(parsed, digest, `03${x}`);
  } catch {
    return false;
  }
}

export function validateReserveAgainstPermission(input: {
  readonly authorization: ReserveAuthorization;
  readonly maximumAmount: bigint;
  readonly validAfter: bigint;
  readonly approveBefore: bigint;
  readonly now: bigint;
}): void {
  encodeReserve(input.authorization);
  bounded(input.now, U64_MAX, 'TIMESTAMP');
  const maximum = bounded(input.maximumAmount, U128_MAX, 'MAXIMUM_AMOUNT', 1n);
  if (input.authorization.requestedAmount > maximum) throw new Error('VOW_OVER_CAP');
  if (input.now < bounded(input.validAfter, U64_MAX, 'VALID_AFTER')) throw new Error('VOW_TOO_EARLY');
  if (input.now >= bounded(input.approveBefore, U64_MAX, 'APPROVE_BEFORE', 1n)) {
    throw new Error('VOW_APPROVAL_EXPIRED');
  }
  if (input.now >= input.authorization.requestDeadline) throw new Error('VOW_APPROVAL_EXPIRED');
}
