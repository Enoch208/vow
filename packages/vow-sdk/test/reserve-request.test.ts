import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OperatorKey } from '../src/operator-key.ts';
import { PermissionSet } from '../src/permission-set.ts';
import { encodePermission } from '../src/permissions.ts';
import { buildReserveRequest } from '../src/reserve-request.ts';
import type { ReserveRequestInput } from '../src/reserve-request.ts';
import { computeReservationId } from '../src/reservation-reader.ts';
import { encodeReserve, verifyReserveSignature } from '../src/reserve.ts';
import type { ReserveAuthorization } from '../src/reserve.ts';
import {
  FIXTURE_RESERVATION_ID, MANDATE, NOW, OPERATOR_KEY, REQUESTS, VAULT, fixtureSet, operator,
} from './helpers/vault-client.ts';

const input = (overrides: Partial<ReserveRequestInput> = {}): ReserveRequestInput => ({
  set: fixtureSet(), operatorKey: OPERATOR_KEY, permissionId: 0n, requestedAmount: 40n,
  requestId: 55n, requestDeadline: 1700n, now: NOW, ...overrides,
});

test('T-005 a reserve request carries the signed authorization, the opened leaf and its own proof', () => {
  const key = operator();
  try {
    const request = buildReserveRequest(input(), key);
    const set = fixtureSet();
    const leaf = set.permission(0n);
    assert.equal(verifyReserveSignature(request.authorization, request.signature, OPERATOR_KEY), true);
    assert.equal(request.reservationId, computeReservationId(MANDATE, 0n));
    assert.equal(request.reservationId, FIXTURE_RESERVATION_ID);
    assert.equal(request.supplierKey, leaf.supplierClaimPublicKey);
    assert.equal(request.claimBefore, leaf.claimBefore);
    assert.equal(request.call.contractAddress, `0x${VAULT.toString(16)}`);
    assert.equal(request.call.entrypoint, 'reserve');
    assert.deepEqual(request.call.calldata, [
      ...encodeReserve(request.authorization).slice(1), ...encodePermission(leaf).slice(1),
      4n, ...set.slot(0n).proof, request.signature.r, request.signature.s,
    ].map((value) => `0x${value.toString(16)}`));
    assert.notDeepEqual([...set.slot(0n).proof], [...set.slot(1n).proof]);
  } finally { key.lock(); }
});

test('T-005 the operator signature is not transferable across mandate, root, amount or request id', () => {
  const key = operator();
  try {
    const request = buildReserveRequest(input(), key);
    for (const field of Object.keys(request.authorization) as (keyof ReserveAuthorization)[]) {
      const altered = { ...request.authorization, [field]: request.authorization[field] + 1n };
      assert.equal(verifyReserveSignature(altered, request.signature, OPERATOR_KEY), false, field);
    }
    const other = buildReserveRequest(input({ set: PermissionSet.create(REQUESTS) }), key);
    assert.notEqual(other.authorization.immutableRoot, request.authorization.immutableRoot);
    assert.equal(verifyReserveSignature(other.authorization, request.signature, OPERATOR_KEY), false);
    assert.equal(verifyReserveSignature(request.authorization, other.signature, OPERATOR_KEY), false);
    const impostor = operator(0xfeedn);
    try {
      const forged = buildReserveRequest(input({ operatorKey: impostor.publicKey }), impostor);
      assert.equal(verifyReserveSignature(forged.authorization, forged.signature, OPERATOR_KEY), false);
      assert.throws(() => buildReserveRequest(input(), impostor), /WRONG_OPERATOR_KEY/);
    } finally { impostor.lock(); }
  } finally { key.lock(); }
});

test('T-005 the operator cannot exceed the committed cap or reserve outside the approval window', () => {
  const key = operator();
  try {
    buildReserveRequest(input({ requestedAmount: 40n }), key);
    assert.throws(() => buildReserveRequest(input({ requestedAmount: 41n }), key), /OVER_CAP/);
    assert.throws(() => buildReserveRequest(input({ permissionId: 1n, requestedAmount: 31n }), key), /OVER_CAP/);
    assert.throws(() => buildReserveRequest(input({ requestedAmount: 0n }), key), /REQUESTED_AMOUNT/);
    assert.throws(() => buildReserveRequest(input({ now: 499n }), key), /TOO_EARLY/);
    assert.throws(() => buildReserveRequest(input({ now: 1800n, requestDeadline: 1900n }), key), /APPROVAL_EXPIRED/);
    assert.throws(() => buildReserveRequest(input({ now: 1700n }), key), /APPROVAL_EXPIRED/);
    assert.throws(() => buildReserveRequest(input({ requestId: 0n }), key), /REQUEST_ID/);
  } finally { key.lock(); }
});

test('T-005 padding slots and unknown slots can never be turned into a reservation', () => {
  const key = operator();
  try {
    assert.throws(() => buildReserveRequest(input({ permissionId: 3n }), key), /NOT_A_PERMISSION_SLOT/);
    assert.throws(() => buildReserveRequest(input({ permissionId: 16n }), key), /PERMISSION_ID/);
  } finally { key.lock(); }
});

test('T-005 an operator key stays opaque, locks on demand and never serializes its secret', async () => {
  const key = OperatorKey.generate();
  assert.ok(key.publicKey > 0n);
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(key))), ['publicKey', 'locked']);
  assert.equal(JSON.stringify(key).includes('"locked":false'), true);
  let exposed: Uint8Array | undefined;
  await key.encrypt(async (bytes) => {
    exposed = bytes;
    assert.equal(bytes.length, 32);
    return bytes.buffer as ArrayBuffer;
  });
  assert.deepEqual(exposed, new Uint8Array(32));
  key.lock();
  assert.equal(key.locked, true);
  assert.throws(() => buildReserveRequest(input({ operatorKey: key.publicKey }), key), /KEY_LOCKED/);
  await assert.rejects(key.encrypt(async (bytes) => bytes.buffer as ArrayBuffer), /KEY_LOCKED/);
  assert.throws(() => OperatorKey.restore(new Uint8Array(32)), /INVALID_OPERATOR_KEY/);
});
