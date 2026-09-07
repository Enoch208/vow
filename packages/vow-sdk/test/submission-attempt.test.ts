import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SubmissionAttempt } from '../src/submission-attempt.ts';
import { readCollectionReceipt } from '../src/collection-receipt.ts';
import { receiptFixture, receiptConfig as config, noteId, txHash } from './helpers/receipt.ts';

const reviewDigest = 987n;

test('T-018 submission attempt requires the exact approved review and consumes its single start', () => {
  const attempt = new SubmissionAttempt(reviewDigest);
  assert.throws(() => attempt.begin(reviewDigest + 1n), /REVIEW_CHANGED/);
  assert.equal(attempt.state, 'ready');
  attempt.begin(reviewDigest);
  assert.equal(attempt.state, 'signing');
  assert.throws(() => attempt.begin(reviewDigest), /ALREADY_STARTED/);
  assert.throws(() => attempt.recordSubmittedHash(0n), /INVALID_TRANSACTION_HASH/);
});

test('T-018 timeout before a wallet hash blocks retries and accepts a late hash for reconciliation only', async () => {
  const attempt = new SubmissionAttempt(reviewDigest); attempt.begin(reviewDigest);
  attempt.recordUncertainOutcome();
  let reads = 0;
  assert.equal(await attempt.reconcile(async () => { reads++; throw new Error(); }), 'unknown');
  assert.equal(reads, 0); assert.throws(() => attempt.begin(reviewDigest), /ALREADY_STARTED/);
  attempt.recordSubmittedHash(txHash);
  const fixture = receiptFixture();
  assert.equal(await attempt.reconcile((hash) => readCollectionReceipt(fixture.reader, config, hash, noteId)), 'confirmed');
  assert.throws(() => attempt.begin(reviewDigest), /ALREADY_STARTED/);
});

test('T-018 hash replacement, failed reads and event-only receipt results never authorize another attempt', async () => {
  const conflicted = new SubmissionAttempt(reviewDigest); conflicted.begin(reviewDigest); conflicted.recordSubmittedHash(txHash);
  assert.throws(() => conflicted.recordSubmittedHash(txHash + 1n), /HASH_CHANGED/);
  assert.equal(conflicted.transactionHash, txHash); assert.equal(conflicted.state, 'unknown');
  assert.throws(() => conflicted.recordSubmittedHash(txHash), /HASH_CHANGED/);
  const attempt = new SubmissionAttempt(reviewDigest); attempt.begin(reviewDigest); attempt.recordSubmittedHash(txHash);
  assert.equal(await attempt.reconcile(async () => { throw new Error('private RPC payload'); }), 'unknown');
  const fixture = receiptFixture();
  const report = await readCollectionReceipt(fixture.reader, config, txHash, noteId);
  assert.equal(await attempt.reconcile(async () => ({ ...report, status: 'receipt-matched', callPath: 'unverified' })), 'unknown');
  assert.equal(await attempt.reconcile(async () => ({ ...report, transactionHash: txHash + 1n })), 'unknown');
  assert.equal(JSON.stringify(attempt.checkpoint()).includes('private'), false);
  assert.throws(() => attempt.begin(reviewDigest), /ALREADY_STARTED/);
});

test('T-018 a conflicting late wallet hash quarantines an in-flight result and survives restoration', async () => {
  const attempt = new SubmissionAttempt(reviewDigest); attempt.begin(reviewDigest); attempt.recordSubmittedHash(txHash);
  const f = receiptFixture(); const report = await readCollectionReceipt(f.reader, config, txHash, noteId);
  let resolve: (value: typeof report) => void = () => { throw new Error('TEST_NOT_STARTED'); };
  const pending = attempt.reconcile(() => new Promise((done) => { resolve = done; }));
  assert.throws(() => attempt.recordSubmittedHash(txHash + 1n), /HASH_CHANGED/);
  resolve(report); assert.equal(await pending, 'unknown');
  const restored = SubmissionAttempt.restore(attempt.checkpoint(), reviewDigest);
  assert.equal(restored.checkpoint().conflictingTransactionHash, `0x${(txHash + 1n).toString(16)}`);
  assert.equal(await restored.reconcile(async () => report), 'unknown');
});

test('T-018 only explicit pre-submission rejection produces rejected; revert requires an accepted receipt', async () => {
  const rejected = new SubmissionAttempt(reviewDigest); rejected.begin(reviewDigest); rejected.recordExplicitRejection();
  assert.equal(rejected.state, 'rejected'); assert.throws(() => rejected.begin(reviewDigest), /ALREADY_STARTED/);
  const attempt = new SubmissionAttempt(reviewDigest); attempt.begin(reviewDigest); attempt.recordSubmittedHash(txHash);
  assert.throws(() => attempt.recordExplicitRejection(), /INVALID_ATTEMPT_STATE/);
  const f = receiptFixture(); f.receipt.execution_status = 'REVERTED';
  const report = await readCollectionReceipt(f.reader, config, txHash, noteId);
  assert.equal(await attempt.reconcile(async () => ({ ...report, finality: null })), 'unknown');
  assert.equal(await attempt.reconcile(async () => report), 'reverted');
  assert.throws(() => attempt.begin(reviewDigest), /ALREADY_STARTED/);
});

test('T-018 serialized checkpoints resume as unknown and require fresh matching receipt evidence', async () => {
  const attempt = new SubmissionAttempt(reviewDigest); attempt.begin(reviewDigest); attempt.recordSubmittedHash(txHash);
  const f = receiptFixture();
  await attempt.reconcile((hash) => readCollectionReceipt(f.reader, config, hash, noteId));
  const checkpoint = JSON.parse(JSON.stringify(attempt.checkpoint())) as unknown;
  const restored = SubmissionAttempt.restore(checkpoint, reviewDigest);
  assert.equal(restored.state, 'unknown'); assert.equal(restored.transactionHash, txHash);
  assert.throws(() => restored.begin(reviewDigest), /ALREADY_STARTED/);
  assert.equal(await restored.reconcile((hash) => readCollectionReceipt(f.reader, config, hash, noteId)), 'confirmed');
  assert.throws(() => SubmissionAttempt.restore(checkpoint, reviewDigest + 1n), /REVIEW_CHANGED/);
  assert.throws(() => SubmissionAttempt.restore({ ...attempt.checkpoint(), signature: 'forbidden' }, reviewDigest), /INVALID_CHECKPOINT/);
  const ready = SubmissionAttempt.restore(new SubmissionAttempt(reviewDigest).checkpoint(), reviewDigest);
  assert.equal(ready.state, 'unknown'); assert.throws(() => ready.begin(reviewDigest), /ALREADY_STARTED/);
});

test('T-018 concurrent reconciliation is rejected and a changed chain observation can demote confirmation', async () => {
  const attempt = new SubmissionAttempt(reviewDigest); attempt.begin(reviewDigest); attempt.recordSubmittedHash(txHash);
  const f = receiptFixture();
  const report = await readCollectionReceipt(f.reader, config, txHash, noteId);
  let resolve: (value: typeof report) => void = () => { throw new Error('TEST_NOT_STARTED'); };
  const pending = attempt.reconcile(() => new Promise((done) => { resolve = done; }));
  await assert.rejects(attempt.reconcile(async () => report), /IN_PROGRESS/);
  resolve(report); assert.equal(await pending, 'confirmed');
  f.block.block_hash = '0x999';
  assert.equal(await attempt.reconcile((hash) => readCollectionReceipt(f.reader, config, hash, noteId)), 'unknown');
  assert.throws(() => attempt.begin(reviewDigest), /ALREADY_STARTED/);
});
