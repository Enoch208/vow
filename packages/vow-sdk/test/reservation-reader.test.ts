import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hash } from 'starknet';
import type { PublicReadMethod, PublicReader } from '../src/probe-reader.ts';
import {
  RESERVATION_CLAIMED, RESERVATION_OPEN, computeReservationId, mandateAvailable, readVaultSnapshot,
} from '../src/reservation-reader.ts';
import type { VaultMandate } from '../src/reservation-reader.ts';
import { CHAIN, EXPIRES_AT, FIXTURE_ROOT, MANDATE, OPERATOR_KEY, OWNER, SUPPLIER_KEY, TOKEN, VAULT, fixtureSet } from './helpers/vault-client.ts';

const BLOCK = { block_hash: '0x7b', timestamp: 1000 };
const MANDATE_VALUES = [OWNER, FIXTURE_ROOT, OPERATOR_KEY, TOKEN, EXPIRES_AT, 0n, 100n, 40n, 0n, 0n];
const RESERVATION_VALUES = [MANDATE, 0n, fixtureSet().slot(0n).leafHash, SUPPLIER_KEY, TOKEN, 40n, 2000n, 777n, RESERVATION_OPEN];
const EMPTY_RESERVATION = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];

function reader(overrides: {
  chainId?: string; block?: unknown; mandate?: readonly bigint[]; reservation?: readonly bigint[];
} = {}): PublicReader & { blockIds: unknown[] } {
  const blockIds: unknown[] = [];
  return {
    blockIds,
    async request(method: PublicReadMethod, params: unknown) {
      if (method === 'starknet_chainId') return overrides.chainId ?? `0x${CHAIN.toString(16)}`;
      if (method === 'starknet_getBlockWithTxHashes') return overrides.block ?? BLOCK;
      if (method !== 'starknet_call') throw new Error('TEST_UNEXPECTED_METHOD');
      const query = params as { block_id: unknown; request: { entry_point_selector: string; calldata: string[] } };
      blockIds.push(query.block_id);
      if (query.request.entry_point_selector === hash.getSelectorFromName('mandate')) {
        return (overrides.mandate ?? MANDATE_VALUES).map((value) => `0x${value.toString(16)}`);
      }
      const values = query.request.calldata[0] === `0x${computeReservationId(MANDATE, 0n).toString(16)}`
        ? overrides.reservation ?? RESERVATION_VALUES : EMPTY_RESERVATION;
      return values.map((value) => `0x${value.toString(16)}`);
    },
  };
}

const query = { chainId: CHAIN, vaultAddress: VAULT, mandateId: MANDATE, permissionIds: [0n, 1n] };

test('T-017 the reader returns mandate accounting and only the slots that hold a reservation', async () => {
  const source = reader();
  const snapshot = await readVaultSnapshot(source, query);
  assert.equal(snapshot.blockHash, 0x7bn);
  assert.equal(snapshot.timestamp, 1000n);
  assert.deepEqual(snapshot.mandate, {
    mandateId: MANDATE, owner: OWNER, root: FIXTURE_ROOT, operatorKey: OPERATOR_KEY, token: TOKEN,
    expiresAt: EXPIRES_AT, revoked: false, funded: 100n, reserved: 40n, paid: 0n, reclaimed: 0n,
  });
  assert.equal(mandateAvailable(snapshot.mandate), 60n);
  assert.equal(snapshot.reservations.length, 1);
  assert.deepEqual(snapshot.reservations[0], {
    reservationId: computeReservationId(MANDATE, 0n), mandateId: MANDATE, permissionId: 0n,
    leafHash: fixtureSet().slot(0n).leafHash, supplierKey: SUPPLIER_KEY, token: TOKEN, amount: 40n,
    claimBefore: 2000n, purchaseCommitment: 777n, state: RESERVATION_OPEN,
  });
  assert.deepEqual(source.blockIds, Array.from({ length: 3 }, () => ({ block_hash: '0x7b' })));
});

test('T-017 a wrong chain, missing mandate or unreadable view never becomes a snapshot', async () => {
  await assert.rejects(readVaultSnapshot(reader({ chainId: '0x534e5f5345504f4c4941' }), query), /WRONG_CHAIN/);
  await assert.rejects(
    readVaultSnapshot(reader({ mandate: [0n, ...MANDATE_VALUES.slice(1)] }), query), /MANDATE_NOT_FOUND/,
  );
  await assert.rejects(readVaultSnapshot(reader({ mandate: MANDATE_VALUES.slice(1) }), query), /INVALID_READ/);
  await assert.rejects(readVaultSnapshot(reader({ block: { block_hash: '0x7b' } }), query), /INVALID_BLOCK/);
  await assert.rejects(
    readVaultSnapshot(reader({ block: { block_hash: '0x7b', timestamp: -1 } }), query), /INVALID_BLOCK/,
  );
  await assert.rejects(readVaultSnapshot(reader(), { ...query, mandateId: 0n }), /MANDATE/);
  await assert.rejects(readVaultSnapshot(reader(), { ...query, vaultAddress: 0n }), /VAULT/);
});

test('T-017 accounting that cannot be reconciled and foreign reservation rows fail closed', async () => {
  const overdrawn = [...MANDATE_VALUES];
  overdrawn[7] = 101n;
  await assert.rejects(readVaultSnapshot(reader({ mandate: overdrawn }), query), /ACCOUNTING_BROKEN/);
  const revoked = [...MANDATE_VALUES];
  revoked[5] = 2n;
  await assert.rejects(readVaultSnapshot(reader({ mandate: revoked }), query), /INVALID_READ/);
  const foreign = [...RESERVATION_VALUES];
  foreign[1] = 4n;
  await assert.rejects(readVaultSnapshot(reader({ reservation: foreign }), query), /SLOT_MISMATCH/);
  const otherMandate = [...RESERVATION_VALUES];
  otherMandate[0] = 2n;
  await assert.rejects(readVaultSnapshot(reader({ reservation: otherMandate }), query), /SLOT_MISMATCH/);
  const unknownState = [...RESERVATION_VALUES];
  unknownState[8] = 4n;
  await assert.rejects(readVaultSnapshot(reader({ reservation: unknownState }), query), /RESERVATION_STATE/);
});

test('T-017 a claimed reservation keeps its terminal state and its paid amount in the books', async () => {
  const claimed = [...RESERVATION_VALUES];
  claimed[8] = RESERVATION_CLAIMED;
  const paid: readonly bigint[] = [OWNER, FIXTURE_ROOT, OPERATOR_KEY, TOKEN, EXPIRES_AT, 1n, 100n, 0n, 40n, 0n];
  const snapshot = await readVaultSnapshot(reader({ reservation: claimed, mandate: paid }), query);
  assert.equal(snapshot.reservations[0]!.state, RESERVATION_CLAIMED);
  assert.equal(snapshot.mandate.revoked, true);
  assert.equal(mandateAvailable(snapshot.mandate), 60n);
  const broken: VaultMandate = { ...snapshot.mandate, reclaimed: 61n };
  assert.throws(() => mandateAvailable(broken), /ACCOUNTING_BROKEN/);
});
