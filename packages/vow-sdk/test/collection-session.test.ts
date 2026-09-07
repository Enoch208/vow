import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CollectionSession } from '../src/collection-session.ts';
import { signClaim } from '../src/claims.ts';
import type { CollectionRequest } from '../src/collection-wallet.ts';
import { config, snapshot, prepared, syntheticKey } from './helpers/collection.ts';

function fixture(request: (input: CollectionRequest) => Promise<unknown> = async (input) => prepared(input)) {
  return new CollectionSession(config, { wallet: { request }, now: () => 1000n, readSnapshot: async () => snapshot });
}

test('G0 local controller prepares, binds, rechecks and releases exactly one call without submission', async () => {
  const requests: CollectionRequest[] = [];
  const session = fixture(async (input) => { requests.push(input); return prepared(input); });
  const review = await session.prepare();
  assert.equal(session.state, 'awaiting-signature');
  assert.equal(review.claim.outputNoteId, 777n);
  assert.equal(Object.isFrozen(review.claim), true);
  await session.prove(signClaim(review.claim, syntheticKey));
  assert.equal(session.hasPreparedCall(), true);
  const call = await session.releasePreparedCall();
  assert.equal(call.call.contract_address, '0x37');
  assert.equal(session.state, 'released');
  await assert.rejects(session.releasePreparedCall(), /NO_PREPARED/);
  const preparations = requests.filter((input) => input.type === 'wallet_strk20PrepareInvoke');
  assert.equal(preparations.length, 2);
  assert.deepEqual(preparations.map((input) => input.params.simulate), [true, false]);
  assert.ok(preparations.every((input) => input.params.api_version === '0.10.3'));
  assert.ok(requests.every((input) => ['wallet_supportedWalletApi', 'wallet_requestChainId', 'wallet_strk20PrepareInvoke'].includes(input.type)));
});

test('T-016 note changes in final proof preparation invalidate the signature and discard the call', async () => {
  const session = fixture(async (input) => prepared(input, input.type === 'wallet_strk20PrepareInvoke' && !input.params.simulate));
  const review = await session.prepare();
  await assert.rejects(session.prove(signClaim(review.claim, syntheticKey)), /CALL_MISMATCH|NOTE_CHANGED/);
  assert.equal(session.state, 'failed'); assert.equal(session.hasPreparedCall(), false);
});

test('T-006 wrong supplier key never reaches proof generation', async () => {
  let proofs = 0;
  const session = fixture(async (input) => { if (input.type === 'wallet_strk20PrepareInvoke' && !input.params.simulate) proofs++; return prepared(input); });
  const review = await session.prepare();
  await assert.rejects(session.prove(signClaim(review.claim, '0x98765')), /BAD_SUPPLIER_SIGNATURE/);
  assert.equal(proofs, 0);
});

test('G0 empty simulation proof cannot be passed off as completed proof preparation', async () => {
  const session = fixture(async (input) => {
    const result = prepared(input);
    if (result && typeof result === 'object' && 'proof' in result) result.proof = { data: '', output: [], proof_facts: [] };
    return result;
  });
  const review = await session.prepare();
  await assert.rejects(session.prove(signClaim(review.claim, syntheticKey)), /EMPTY_OR_OVERSIZED_PROOF/);
  assert.equal(session.hasPreparedCall(), false);
});

test('G0 wallet network changes during preparation discard the candidate', async () => {
  let chainReads = 0;
  const session = fixture(async (input) => input.type === 'wallet_requestChainId' && ++chainReads > 1 ? '0x2' : prepared(input));
  await assert.rejects(session.prepare(), /WRONG_WALLET_CHAIN/);
  assert.equal(session.review, undefined);
});

test('G0 reservation changes while proving discard the prepared call', async () => {
  let changed = false;
  const session = new CollectionSession(config, { now: () => 1000n, readSnapshot: async () => ({ ...snapshot, state: changed ? 2n : 1n }), wallet: { request: async (input) => {
    if (input.type === 'wallet_strk20PrepareInvoke' && !input.params.simulate) changed = true;
    return prepared(input);
  } } });
  const review = await session.prepare();
  await assert.rejects(session.prove(signClaim(review.claim, syntheticKey)), /NOT_FUNDED/);
  assert.equal(session.hasPreparedCall(), false);
});

test('G0 request overlap and late responses after invalidation cannot advance a session', async () => {
  let resolve: (value: unknown) => void = () => {};
  const session = fixture(() => new Promise((done) => { resolve = done; }));
  const pending = session.prepare();
  await assert.rejects(session.prepare(), /IN_PROGRESS/);
  session.invalidate(); resolve(['0.10.3']);
  await assert.rejects(pending, /INVALIDATED/);
  assert.equal(session.state, 'invalidated');
  assert.equal(session.review, undefined);
});

test('G0 timeout quarantines a still-running wallet request and discards its late response', async () => {
  let resolve: (value: unknown) => void = () => {};
  const session = new CollectionSession(config, { now: () => 1000n, readSnapshot: async () => snapshot, timeoutMs: 5,
    wallet: { request: () => new Promise((done) => { resolve = done; }) } });
  await assert.rejects(session.prepare(), /TIMEOUT/);
  await assert.rejects(session.prepare(), /IN_PROGRESS/);
  resolve(['0.10.3']);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(session.state, 'failed'); assert.equal(session.review, undefined);
});

test('G0 unsupported API fails before any preparation and wallet failures retain no raw payload', async () => {
  const unsupported = fixture(async () => ['0.7.2']);
  await assert.rejects(unsupported.prepare(), /API_UNSUPPORTED/);
  const failed = fixture(async () => { throw { code: 163, message: 'secret', data: 'private' }; });
  await assert.rejects(failed.prepare(), (error: unknown) => {
    assert.ok(error instanceof Error); assert.equal(error.message, 'VOW_WALLET_REQUEST_FAILED');
    assert.equal(JSON.stringify(error).includes('private'), false); return true;
  });
});

test('G0 returned wallet objects cannot mutate a validated call during subsequent asynchronous checks', async () => {
  let finalResponse: ReturnType<typeof prepared> | undefined;
  const session = fixture(async (input) => {
    if (input.type === 'wallet_supportedWalletApi' && finalResponse && typeof finalResponse === 'object' && 'call' in finalResponse) {
      finalResponse.call.contract_address = '0xdead';
    }
    const result = prepared(input);
    if (input.type === 'wallet_strk20PrepareInvoke' && !input.params.simulate) finalResponse = result;
    return result;
  });
  const review = await session.prepare();
  await session.prove(signClaim(review.claim, syntheticKey));
  assert.equal((await session.releasePreparedCall()).call.contract_address, '0x37');
});
