import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { reviewCollectionSubmission } from '../src/collection-submission.ts';
import { buildProbeClaimActions } from '../src/prepared-claim.ts';
import { retainPreparedProof } from '../src/prepared-proof.ts';
import { signClaim } from '../src/claims.ts';
import { config, prepared, syntheticKey } from './helpers/collection.ts';

const claim = { chainId: config.chainId, vaultAddress: config.vaultAddress, mandateId: 1n, reservationId: 1n,
  token: config.token, amount: config.amount, outputNoteId: 777n, signatureDeadline: config.signatureDeadline };
const signature = signClaim(claim, syntheticKey);
function payload() {
  return retainPreparedProof(prepared({ type: 'wallet_strk20PrepareInvoke', params: { actions: buildProbeClaimActions(claim, config.recipient, signature), simulate: false, api_version: '0.10.3' } }));
}

test('T-006 submission review binds the single prepared call and proof with canonical wallet API fields', async () => {
  const candidate = await reviewCollectionSubmission(payload(), config, 777n, signature, 100n, 1000n);
  const request = candidate.take(candidate.review.reviewDigest, 1001n);
  assert.equal(request.type, 'wallet_addInvokeTransaction');
  assert.deepEqual(Object.keys(request.params), ['api_version', 'invoke_transaction', 'proof']);
  assert.equal(request.params.api_version, '0.10.3'); assert.equal(request.params.invoke_transaction.length, 1);
  assert.ok(request.params.invoke_transaction[0]!.calldata.every((value) => /^0x[0-9a-f]+$/.test(value)));
  assert.equal(createHash('sha256').update(JSON.stringify(request)).digest('hex'), candidate.review.payloadSha256);
  assert.equal(candidate.review.networkFeeEnforcement, 'manual-wallet-confirmation');
  assert.equal(candidate.review.totalBudget, 'not-assessed');
  assert.equal(JSON.stringify(candidate.review, (_, value: unknown) => typeof value === 'bigint' ? String(value) : value).includes('synthetic-not-a-real-proof'), false);
});

test('T-006 proof changes and fee cap changes require different submission review digests', async () => {
  const first = await reviewCollectionSubmission(payload(), config, 777n, signature, 100n, 1000n);
  const changed = payload(); Object.assign(changed.proof, { data: 'another-synthetic-proof' });
  const second = await reviewCollectionSubmission(changed, config, 777n, signature, 100n, 1000n);
  const third = await reviewCollectionSubmission(payload(), config, 777n, signature, 101n, 1000n);
  assert.notEqual(first.review.reviewDigest, second.review.reviewDigest);
  assert.notEqual(first.review.reviewDigest, third.review.reviewDigest);
  assert.throws(() => first.take(second.review.reviewDigest, 1001n), /REVIEW_CHANGED/);
});

test('T-006 changed destination, supplier signature, public transfer and incomplete proof are rejected before review', async () => {
  await assert.rejects(reviewCollectionSubmission(payload(), config, 778n, signature, 100n, 1000n), /BAD_SUPPLIER_SIGNATURE/);
  await assert.rejects(reviewCollectionSubmission(payload(), config, 777n, { r: 1n, s: 2n }, 100n, 1000n), /BAD_SUPPLIER_SIGNATURE/);
  const changed = payload(); Object.assign(changed.call, { contract_address: '0x999' });
  await assert.rejects(reviewCollectionSubmission(changed, config, 777n, signature, 100n, 1000n), /BAD_POOL/);
  for (const field of ['output', 'proof_facts'] as const) {
    const empty = payload(); empty.proof[field].splice(0);
    await assert.rejects(reviewCollectionSubmission(empty, config, 777n, signature, 100n, 1000n), /EMPTY_PROOF_MATERIAL/);
  }
  await assert.rejects(reviewCollectionSubmission(payload(), { ...config, maximumFee: 9n }, 777n, signature, 100n, 1000n), /FEE_LIMIT/);
});

test('T-018 submission payload is copied before async hashing and released only once before expiry', async () => {
  const original = payload(); const mutable = { ...config };
  const pending = reviewCollectionSubmission(original, mutable, 777n, signature, 100n, 1000n);
  Object.assign(original.proof, { data: 'mutated' }); original.call.calldata[0] = '999'; mutable.amount = 999n;
  const reviewed = await pending;
  assert.equal(reviewed.review.expiresAt, 1300n);
  const request = reviewed.take(reviewed.review.reviewDigest, 1001n);
  assert.equal(request.params.proof.data, 'synthetic-not-a-real-proof');
  assert.throws(() => reviewed.take(reviewed.review.reviewDigest, 1001n), /ALREADY_RELEASED/);
  const expired = await reviewCollectionSubmission(payload(), config, 777n, signature, 100n, 1000n);
  assert.throws(() => expired.take(expired.review.reviewDigest, 1300n), /REVIEW_EXPIRED/);
  assert.throws(() => expired.take(expired.review.reviewDigest, 1001n), /ALREADY_RELEASED/);
});

test('T-018 discarded review cannot release proof material and existing claim expiry is respected', async () => {
  const nearExpiry = await reviewCollectionSubmission(payload(), config, 777n, signature, 100n, 1899n);
  assert.equal(nearExpiry.review.expiresAt, 1900n);
  nearExpiry.discard(); assert.throws(() => nearExpiry.take(nearExpiry.review.reviewDigest, 1899n), /ALREADY_RELEASED/);
  await assert.rejects(reviewCollectionSubmission(payload(), config, 777n, signature, 100n, 1900n), /CLAIM_EXPIRED/);
});
