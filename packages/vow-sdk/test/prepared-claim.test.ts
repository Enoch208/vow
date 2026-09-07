import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortString } from 'starknet';
import { buildClaimActions, buildProbeClaimActions, decodePreparedClaim, decodePreparedProbeClaim, POOL_CLASS_HASH } from '../src/prepared-claim.ts';
import type { ProbeClaimExpectation } from '../src/prepared-claim.ts';

const expected: ProbeClaimExpectation = {
  poolAddress: 55n, observedPoolClassHash: POOL_CLASS_HASH, feeToken: 88n, feeCollector: 99n, maximumFee: 10n,
  claim: { chainId: 1n, vaultAddress: 56n, mandateId: 1n, reservationId: 1n, token: 57n, amount: 100n, outputNoteId: 777n, signatureDeadline: 1900n },
};
const operation = BigInt(shortString.encodeShortString('CLAIM'));

function payload(options: { note?: bigint; signature?: readonly bigint[]; extra?: bigint[] } = {}) {
  const note = options.note ?? 777n;
  const actions = [
    [0n, 10n, 2n, 1n, 57n],
    [7n, 1n, 2n, 3n, 57n, note],
    [10n, 56n, 6n, operation, 1n, note, 1900n, ...(options.signature ?? [0n, 0n])],
    ...(options.extra ? [options.extra] : []),
  ];
  return { call: {
    contract_address: '0x37', entry_point: 'apply_actions',
    calldata: [BigInt(actions.length), ...actions.flat(), 1n].map(String),
  }, proof: { data: '', output: [], proof_facts: [] } };
}

test('T-015 decoder resolves note from the exact pinned pool action structure', () => {
  const claim = decodePreparedProbeClaim(payload(), expected);
  assert.equal(claim.outputNoteId, 777n);
  assert.equal(claim.amount, 100n);
});

test('T-015 every truncation is rejected except the optional screening suffix', () => {
  const full = payload();
  const actionsEnd = full.call.calldata.length - 1;
  for (let length = 0; length < actionsEnd; length++) {
    assert.throws(() => decodePreparedProbeClaim({ ...full, call: { ...full.call, calldata: full.call.calldata.slice(0, length) } }, expected));
  }
  decodePreparedProbeClaim({ ...full, call: { ...full.call, calldata: full.call.calldata.slice(0, actionsEnd) } }, expected);
  full.call.calldata.push('0');
  assert.throws(() => decodePreparedProbeClaim(full, expected), /TRAILING/);
});

test('T-015 changed pool, selector, class, token, helper, and duplicate invocation fail closed', () => {
  for (const replacement of [{ contract_address: '0x38' }, { entry_point: 'transfer' }]) {
    const prepared = payload();
    assert.throws(() => decodePreparedProbeClaim({ ...prepared, call: { ...prepared.call, ...replacement } }, expected));
  }
  assert.throws(() => decodePreparedProbeClaim(payload(), { ...expected, observedPoolClassHash: 1n }), /CLASS_CHANGED/);
  assert.throws(() => decodePreparedProbeClaim(payload(), { ...expected, claim: { ...expected.claim, token: 58n } }), /TARGET/);
  assert.throws(() => decodePreparedProbeClaim(payload(), { ...expected, claim: { ...expected.claim, vaultAddress: 58n } }), /TARGET/);
  assert.throws(() => decodePreparedProbeClaim(payload({ extra: [10n, 56n, 0n] }), expected), /AMBIGUOUS/);
});

test('T-016 final preparation must preserve the signed destination and signature', () => {
  const signature = { r: 123n, s: 456n };
  decodePreparedProbeClaim(payload({ signature: [123n, 456n] }), expected, signature);
  assert.throws(() => decodePreparedProbeClaim(payload({ note: 778n, signature: [123n, 456n] }), expected, signature), /NOTE_CHANGED/);
  assert.throws(() => decodePreparedProbeClaim(payload({ signature: [123n, 457n] }), expected, signature), /CALL_MISMATCH/);
  const actions = buildProbeClaimActions(expected.claim, 333n, signature);
  assert.equal(actions[1]?.type, 'invoke');
  if (actions[1]?.type === 'invoke') assert.equal(actions[1].calldata[2], '${openNoteIds[0]}');
});

test('T-015 extra transfers must be limited to the approved fee collector and budget', () => {
  decodePreparedProbeClaim(payload({ extra: [3n, 99n, 88n, 10n] }), expected);
  assert.throws(() => decodePreparedProbeClaim(payload({ extra: [3n, 100n, 88n, 10n] }), expected), /UNEXPECTED_TRANSFER/);
  assert.throws(() => decodePreparedProbeClaim(payload({ extra: [3n, 99n, 88n, 11n] }), expected), /FEE_LIMIT/);
  assert.throws(() => decodePreparedProbeClaim(payload({ extra: [2n, 99n, 88n, 10n] }), expected), /UNEXPECTED_ACTION/);
});

test('VowVault preparation binds an arbitrary reservation ID without weakening probe-only wrappers', () => {
  const vaultExpected = { ...expected, claim: { ...expected.claim, mandateId: 9n, reservationId: 0x123n } };
  const prepared = payload(); prepared.call.calldata[16] = String(0x123n);
  assert.equal(decodePreparedClaim(prepared, vaultExpected).reservationId, 0x123n);
  const actions = buildClaimActions(vaultExpected.claim, 333n);
  assert.equal(actions[1]?.type, 'invoke');
  if (actions[1]?.type === 'invoke') assert.equal(actions[1].calldata[1], '0x123');
  assert.throws(() => decodePreparedProbeClaim(prepared, vaultExpected), /PROBE_IDS/);
});

test('T-015 the open-note placeholder sits where the deployed vault reads it and a note-last layout is rejected', () => {
  const actions = buildClaimActions(expected.claim, 333n);
  assert.equal(actions[1]?.type, 'invoke');
  if (actions[1]?.type !== 'invoke') return;
  assert.equal(actions[1].calldata[2], '${openNoteIds[0]}');
  const legacy = payload();
  legacy.call.calldata.splice(15, 6, String(operation), '1', '1900', '0', '0', '777');
  assert.throws(() => decodePreparedClaim(legacy, expected), /CALL_MISMATCH/);
});
