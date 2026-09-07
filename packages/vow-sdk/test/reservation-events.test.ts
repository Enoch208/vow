import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hash } from 'starknet';
import {
  assertReservationMatchesRequest, decodePurchaseReserved, decodeReservationClaimed,
} from '../src/reservation-events.ts';
import { buildReserveRequest } from '../src/reserve-request.ts';
import { computeReservationId } from '../src/reservation-reader.ts';
import { MANDATE, NOW, OPERATOR_KEY, SUPPLIER_KEY, VAULT, fixtureSet, operator } from './helpers/vault-client.ts';

const RESERVATION = computeReservationId(MANDATE, 0n);
const hex = (value: bigint) => `0x${value.toString(16)}`;
const event = (name: string, from: bigint, keys: bigint[], data: bigint[]) => ({
  from_address: hex(from),
  keys: [hash.getSelectorFromName(name), ...keys.map(hex)],
  data: data.map(hex),
});

function request() {
  const key = operator();
  try {
    return buildReserveRequest({
      set: fixtureSet(), operatorKey: OPERATOR_KEY, permissionId: 0n, requestedAmount: 40n,
      requestId: 55n, requestDeadline: 1700n, now: NOW,
    }, key);
  } finally { key.lock(); }
}

function reserved(overrides: { from?: bigint; keys?: bigint[]; data?: bigint[] } = {}) {
  const leafHash = fixtureSet().slot(0n).leafHash;
  return event('PurchaseReserved', overrides.from ?? VAULT, overrides.keys ?? [RESERVATION, MANDATE],
    overrides.data ?? [0n, leafHash, SUPPLIER_KEY, 40n, 2000n]);
}

test('T-017 a PurchaseReserved event is decoded and matched against the request the operator signed', () => {
  const built = request();
  const decoded = decodePurchaseReserved([event('Transfer', 202n, [], [1n]), reserved()], VAULT, RESERVATION);
  assert.deepEqual(decoded, {
    reservationId: RESERVATION, mandateId: MANDATE, permissionId: 0n,
    leafHash: fixtureSet().slot(0n).leafHash, supplierKey: SUPPLIER_KEY, amount: 40n, claimBefore: 2000n,
  });
  assertReservationMatchesRequest(decoded, built);
});

test('T-017 a reservation event from another vault, slot or amount is never accepted as this request', () => {
  const built = request();
  assert.throws(() => decodePurchaseReserved([reserved({ from: VAULT + 1n })], VAULT, RESERVATION), /EVENT_MISSING/);
  assert.throws(() => decodePurchaseReserved([reserved({ keys: [RESERVATION + 1n, MANDATE] })], VAULT, RESERVATION), /EVENT_MISSING/);
  assert.throws(() => decodePurchaseReserved([], VAULT, RESERVATION), /EVENT_MISSING/);
  assert.throws(() => decodePurchaseReserved([reserved(), reserved()], VAULT, RESERVATION), /DUPLICATE_VAULT_EVENT/);
  assert.throws(() => decodePurchaseReserved([reserved({ keys: [RESERVATION] })], VAULT, RESERVATION), /EVENT_MISMATCH/);
  assert.throws(
    () => decodePurchaseReserved([reserved({ data: [0n, 1n, SUPPLIER_KEY, 40n] })], VAULT, RESERVATION), /EVENT_MISMATCH/,
  );
  const changes: bigint[][] = [
    [1n, fixtureSet().slot(0n).leafHash, SUPPLIER_KEY, 40n, 2000n],
    [0n, fixtureSet().slot(1n).leafHash, SUPPLIER_KEY, 40n, 2000n],
    [0n, fixtureSet().slot(0n).leafHash, SUPPLIER_KEY + 1n, 40n, 2000n],
    [0n, fixtureSet().slot(0n).leafHash, SUPPLIER_KEY, 41n, 2000n],
    [0n, fixtureSet().slot(0n).leafHash, SUPPLIER_KEY, 40n, 2001n],
  ];
  for (const data of changes) {
    const decoded = decodePurchaseReserved([reserved({ data })], VAULT, RESERVATION);
    assert.throws(() => assertReservationMatchesRequest(decoded, built), /RESERVATION_EVENT_MISMATCH/, data.join(','));
  }
  const otherMandate = decodePurchaseReserved([reserved({ keys: [RESERVATION, MANDATE + 1n] })], VAULT, RESERVATION);
  assert.throws(() => assertReservationMatchesRequest(otherMandate, built), /RESERVATION_EVENT_MISMATCH/);
});

test('T-017 a ReservationClaimed event reports the settled note and amount for that reservation only', () => {
  const claimed = event('ReservationClaimed', VAULT, [RESERVATION, MANDATE], [777n, 40n]);
  assert.deepEqual(decodeReservationClaimed([reserved(), claimed], VAULT, RESERVATION), {
    reservationId: RESERVATION, mandateId: MANDATE, noteId: 777n, amount: 40n,
  });
  assert.throws(() => decodeReservationClaimed([reserved()], VAULT, RESERVATION), /EVENT_MISSING/);
  assert.throws(() => decodeReservationClaimed([claimed, claimed], VAULT, RESERVATION), /DUPLICATE_VAULT_EVENT/);
  assert.throws(
    () => decodeReservationClaimed([event('ReservationClaimed', VAULT, [RESERVATION, MANDATE], [0n, 40n])], VAULT, RESERVATION),
    /INVALID_NOTE/,
  );
  assert.throws(() => decodeReservationClaimed('not-a-list', VAULT, RESERVATION), /INVALID_RECEIPT_DATA/);
  assert.throws(() => decodeReservationClaimed([claimed], 0n, RESERVATION), /VAULT/);
});
