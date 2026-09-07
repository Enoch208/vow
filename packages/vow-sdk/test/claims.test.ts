import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ec } from 'starknet';
import { hashClaim, signClaim, validateClaimWindow, verifyClaimSignature } from '../src/claims.ts';
import type { ClaimAuthorization } from '../src/claims.ts';
import { FELT_PRIME, U128_MAX } from '../src/integers.ts';

const syntheticKey = '0x123456';
const publicKey = BigInt(ec.starkCurve.getStarkKey(syntheticKey));
const claim: ClaimAuthorization = {
  chainId: 0x534e5f4d41494en, vaultAddress: 101n, mandateId: 1n, reservationId: 2n,
  token: 102n, amount: 1234567n, outputNoteId: 103n, signatureDeadline: 2000n,
};

test('T-001 claim digest matches the Cairo interoperability vector', () => {
  assert.equal(hashClaim(claim), 0x3d3f2cca1b86dcdd2d5b8fe5c5cb8d37b5972faddd16a5e2b2f8eb87047f0b5n);
});

test('T-006 valid supplier signature binds every authorization field', () => {
  const signature = signClaim(claim, syntheticKey);
  assert.equal(verifyClaimSignature(claim, signature, publicKey), true);
  for (const field of Object.keys(claim) as (keyof ClaimAuthorization)[]) {
    const altered = { ...claim, [field]: claim[field] + 1n };
    assert.equal(verifyClaimSignature(altered, signature, publicKey), false, field);
  }
});

test('T-006 wrong supplier and malformed signatures fail closed', () => {
  const signature = signClaim(claim, syntheticKey);
  const wrongKey = BigInt(ec.starkCurve.getStarkKey('0x654321'));
  assert.equal(verifyClaimSignature(claim, signature, wrongKey), false);
  assert.equal(verifyClaimSignature(claim, { r: 0n, s: 0n }, publicKey), false);
});

test('T-007 claim deadlines are exclusive and cannot extend the reservation', () => {
  validateClaimWindow(claim, 2100n, 1999n);
  assert.throws(() => validateClaimWindow(claim, 2100n, 2000n), /EXPIRED/);
  assert.throws(() => validateClaimWindow(claim, 1999n, 1000n), /EXTENSION/);
});

test('T-012 invalid fields and overflowing collection amounts are rejected before signing', () => {
  assert.throws(() => hashClaim({ ...claim, amount: U128_MAX + 1n }), /AMOUNT/);
  assert.throws(() => hashClaim({ ...claim, amount: 0n }), /AMOUNT/);
  assert.throws(() => hashClaim({ ...claim, outputNoteId: FELT_PRIME }), /NOTE/);
  assert.throws(() => hashClaim({ ...claim, token: 0n }), /TOKEN/);
});
