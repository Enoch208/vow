import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ec } from 'starknet';
import { hashPermission, permissionRoot } from '../src/permissions.ts';
import {
  hashReserve, signReserve, validateReserveAgainstPermission, verifyReserveSignature,
} from '../src/reserve.ts';
import type { ReserveAuthorization } from '../src/reserve.ts';
import { REAL_PERMISSIONS, paddedLeafHashes } from './permission-fixture.ts';

const operatorSecret = '0xabcdef';
const operatorKey = BigInt(ec.starkCurve.getStarkKey(operatorSecret));
const permission = REAL_PERMISSIONS[0]!;
const root = permissionRoot(paddedLeafHashes());

const authorization: ReserveAuthorization = {
  chainId: 0x534e5f4d41494en, vaultAddress: 201n, mandateId: 1n, immutableRoot: root,
  permissionId: 0n, leafHash: hashPermission(permission), requestedAmount: 40n, requestId: 55n,
  requestDeadline: 1700n,
};

test('T-005 reserve digest matches the Cairo interoperability vector', () => {
  assert.equal(
    hashReserve(authorization),
    0x10582df0952a9b449807faddbf241cb95f3d2a26fed0664a4a3c4911968e39an,
  );
});

test('T-005 the operator signature binds every authorization field', () => {
  const signature = signReserve(authorization, operatorSecret);
  assert.equal(verifyReserveSignature(authorization, signature, operatorKey), true);
  for (const field of Object.keys(authorization) as (keyof ReserveAuthorization)[]) {
    const altered = { ...authorization, [field]: authorization[field] + 1n };
    assert.equal(verifyReserveSignature(altered, signature, operatorKey), false, field);
  }
});

test('T-005 another operator key cannot authorize a reservation', () => {
  const signature = signReserve(authorization, operatorSecret);
  const impostor = BigInt(ec.starkCurve.getStarkKey('0xfeed'));
  assert.equal(verifyReserveSignature(authorization, signature, impostor), false);
  assert.equal(verifyReserveSignature(authorization, { r: 0n, s: 0n }, operatorKey), false);
  const forged = signReserve(authorization, '0xfeed');
  assert.equal(verifyReserveSignature(authorization, forged, operatorKey), false);
});

test('T-005 the operator cannot exceed the committed permission cap', () => {
  const within = { ...authorization, requestedAmount: permission.maximumAmount };
  validateReserveAgainstPermission({
    authorization: within, maximumAmount: permission.maximumAmount,
    validAfter: permission.validAfter, approveBefore: permission.approveBefore, now: 1000n,
  });
  assert.throws(
    () => validateReserveAgainstPermission({
      authorization: { ...authorization, requestedAmount: permission.maximumAmount + 1n },
      maximumAmount: permission.maximumAmount, validAfter: permission.validAfter,
      approveBefore: permission.approveBefore, now: 1000n,
    }),
    /OVER_CAP/,
  );
});

test('T-005 approval windows are enforced at both boundaries', () => {
  const check = (now: bigint) => validateReserveAgainstPermission({
    authorization, maximumAmount: permission.maximumAmount, validAfter: permission.validAfter,
    approveBefore: permission.approveBefore, now,
  });
  assert.throws(() => check(499n), /TOO_EARLY/);
  check(500n);
  check(1699n);
  assert.throws(() => check(1700n), /APPROVAL_EXPIRED/);
  assert.throws(
    () => validateReserveAgainstPermission({
      authorization: { ...authorization, requestDeadline: 1900n },
      maximumAmount: permission.maximumAmount, validAfter: permission.validAfter,
      approveBefore: permission.approveBefore, now: 1800n,
    }),
    /APPROVAL_EXPIRED/,
  );
});

test('T-005 malformed authorizations are rejected before hashing', () => {
  assert.throws(() => hashReserve({ ...authorization, requestId: 0n }), /REQUEST_ID/);
  assert.throws(() => hashReserve({ ...authorization, requestedAmount: 0n }), /REQUESTED_AMOUNT/);
  assert.throws(() => hashReserve({ ...authorization, permissionId: 16n }), /PERMISSION_ID/);
  assert.throws(() => hashReserve({ ...authorization, immutableRoot: 0n }), /ROOT/);
  assert.throws(() => hashReserve({ ...authorization, vaultAddress: 0n }), /VAULT/);
});
