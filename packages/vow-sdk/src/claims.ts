import { ec, hash, shortString } from 'starknet';
import { address, bounded, felt, U128_MAX, U64_MAX } from './integers.ts';

export const CLAIM_DOMAIN = BigInt(shortString.encodeShortString('VOW_CLAIM_V1'));

export interface ClaimAuthorization {
  readonly chainId: bigint;
  readonly vaultAddress: bigint;
  readonly mandateId: bigint;
  readonly reservationId: bigint;
  readonly token: bigint;
  readonly amount: bigint;
  readonly outputNoteId: bigint;
  readonly signatureDeadline: bigint;
}

export interface ClaimSignature {
  readonly r: bigint;
  readonly s: bigint;
}

export function encodeClaim(claim: ClaimAuthorization): bigint[] {
  return [
    CLAIM_DOMAIN,
    felt(claim.chainId, 'CHAIN', 1n),
    address(claim.vaultAddress, 'VAULT'),
    felt(claim.mandateId, 'MANDATE', 1n),
    felt(claim.reservationId, 'RESERVATION', 1n),
    address(claim.token, 'TOKEN'),
    bounded(claim.amount, U128_MAX, 'AMOUNT', 1n),
    felt(claim.outputNoteId, 'NOTE', 1n),
    bounded(claim.signatureDeadline, U64_MAX, 'DEADLINE', 1n),
  ];
}

export function hashClaim(claim: ClaimAuthorization): bigint {
  return BigInt(hash.computePoseidonHashOnElements(encodeClaim(claim)));
}

export function signClaim(claim: ClaimAuthorization, privateKey: string): ClaimSignature {
  const signature = ec.starkCurve.sign(hashClaim(claim).toString(16), privateKey);
  return { r: signature.r, s: signature.s };
}

export function verifyClaimSignature(
  claim: ClaimAuthorization, signature: ClaimSignature, publicKey: bigint,
): boolean {
  try {
    const parsed = new ec.starkCurve.Signature(signature.r, signature.s);
    const x = felt(publicKey, 'SUPPLIER_KEY', 1n).toString(16).padStart(64, '0');
    const digest = hashClaim(claim).toString(16);
    return ec.starkCurve.verify(parsed, digest, `02${x}`)
      || ec.starkCurve.verify(parsed, digest, `03${x}`);
  } catch {
    return false;
  }
}

export function validateClaimWindow(claim: ClaimAuthorization, claimBefore: bigint, now: bigint): void {
  encodeClaim(claim);
  bounded(now, U64_MAX, 'TIMESTAMP');
  bounded(claimBefore, U64_MAX, 'CLAIM_DEADLINE', 1n);
  if (claim.signatureDeadline > claimBefore) throw new Error('VOW_DEADLINE_EXTENSION');
  if (now >= claim.signatureDeadline || now >= claimBefore) throw new Error('VOW_CLAIM_EXPIRED');
}
