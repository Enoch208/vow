import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { SubmissionJournal } from '../src/submission-journal.ts';
import { runJournaledSubmission } from '../src/journaled-submission.ts';
import type { RecoveryStorage } from '../src/submission-journal.ts';
import { readCollectionReceipt } from '../src/collection-receipt.ts';
import { receiptFixture, receiptConfig as config, noteId, txHash } from './helpers/receipt.ts';

const digest = 987n;
function fixture() {
  const values = new Map<string, string>();
  const storage: RecoveryStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  const open = (vaultAddress = config.vaultAddress) => new SubmissionJournal({ chainId: config.chainId, vaultAddress, reservationId: 1n }, storage, navigator.locks);
  return { values, storage, open };
}
const run = (journal: SubmissionJournal, dispatch: () => Promise<bigint>, timeoutMs = 1000) => runJournaledSubmission({ journal, reviewDigest: digest, noteId, expiresAt: 2000n, now: () => 1000n, dispatch, timeoutMs });

test('T-018 native Web Locks serialize simultaneous tabs and changed-note reviews for one reservation', async () => {
  const f = fixture(); let dispatched = 0;
  const result = await Promise.allSettled([
    run(f.open(), async () => { dispatched++; return txHash; }),
    runJournaledSubmission({ journal: f.open(), reviewDigest: digest + 1n, noteId: noteId + 1n, expiresAt: 2000n, now: () => 1000n, dispatch: async () => { dispatched++; return txHash + 1n; }, timeoutMs: 1000 }),
  ]);
  assert.equal(dispatched, 1); assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  const failure = result.find((r) => r.status === 'rejected');
  assert.equal(failure?.status === 'rejected' && failure.reason.message, 'VOW_EXISTING_SUBMISSION_ATTEMPT');
  assert.equal(f.values.size, 1);
});

test('T-018 journal writes and verifies the recovery record before calling the dispatcher', async () => {
  const f = fixture();
  const result = await run(f.open(), async () => {
    const record = await f.open().read();
    assert.equal(record?.checkpoint.state, 'unknown'); assert.equal(record.noteId, `0x${noteId.toString(16)}`);
    assert.equal(record.checkpoint.transactionHash, null); return txHash;
  });
  assert.equal(result.status, 'submitted'); assert.equal(result.transactionHash, txHash);
  await assert.rejects(run(f.open(), async () => { throw new Error('SHOULD_NOT_DISPATCH'); }), /EXISTING_SUBMISSION/);
  const saved = [...f.values.values()][0]!;
  assert.deepEqual(Object.keys(JSON.parse(saved)), ['version', 'scope', 'noteId', 'checkpoint']);
  assert.equal(saved.includes('proof'), false); assert.equal(saved.includes('signature'), false);
});

test('T-018 blocked storage, failed readback and corrupt records prevent dispatch without echoing stored contents', async () => {
  for (const mode of ['throw', 'drop', 'corrupt'] as const) {
    const f = fixture(); let dispatched = 0;
    if (mode === 'throw') f.storage.setItem = () => { throw new Error('test-storage-payload'); };
    if (mode === 'drop') f.storage.setItem = () => {};
    if (mode === 'corrupt') f.storage.getItem = () => 'test-storage-payload';
    await assert.rejects(run(f.open(), async () => { dispatched++; return txHash; }), (error: unknown) => {
      assert.ok(error instanceof Error); assert.match(error.message, /VOW_(RECOVERY_STORAGE_UNAVAILABLE|CORRUPT_RECOVERY_RECORD)/);
      assert.equal(error.message.includes('test-storage-payload'), false); return true;
    });
    assert.equal(dispatched, 0);
  }
});

test('T-018 timed-out dispatch survives controller replacement and saves a late hash without another dispatch', async () => {
  const f = fixture(); let resolve: (hash: bigint) => void = () => { throw new Error('TEST_NOT_STARTED'); };
  const result = await run(f.open(), () => new Promise((done) => { resolve = done; }), 5);
  assert.equal(result.status, 'unknown'); assert.equal(result.recovery, 'saved');
  await assert.rejects(run(f.open(), async () => txHash), /EXISTING_SUBMISSION/);
  resolve(txHash); await delay(10);
  const restored = await f.open().read();
  assert.equal(restored?.checkpoint.transactionHash, `0x${txHash.toString(16)}`);
  assert.equal(restored.checkpoint.state, 'unknown');
});

test('T-018 post-dispatch storage failure returns the known public hash for manual recovery', async () => {
  const f = fixture();
  const result = await run(f.open(), async () => { f.storage.setItem = () => { throw new Error('QUOTA'); }; return txHash; });
  assert.deepEqual(result, { status: 'unknown', transactionHash: txHash, recovery: 'storage-failed' });
  await assert.rejects(run(f.open(), async () => txHash), /EXISTING_SUBMISSION/);
});

test('T-018 restored confirmation needs fresh evidence and conflicting late hashes stay quarantined', async () => {
  const f = fixture(); const chain = receiptFixture();
  await run(f.open(), async () => txHash);
  const confirmed = await f.open().reconcile(digest, (hash, note) => readCollectionReceipt(chain.reader, config, hash, note));
  assert.equal(confirmed.checkpoint.state, 'confirmed'); assert.equal((await f.open().read())?.checkpoint.state, 'unknown');
  await f.open().recordHash(digest, txHash + 1n);
  const conflicted = await f.open().reconcile(digest, (hash, note) => readCollectionReceipt(chain.reader, config, hash, note));
  assert.equal(conflicted.checkpoint.state, 'unknown'); assert.notEqual(conflicted.checkpoint.conflictingTransactionHash, null);
  await assert.rejects(f.open().recordHash(digest + 1n, txHash), /REVIEW_CHANGED/);
});

test('T-018 expiry and invalid scopes are rejected while different reservations retain separate records', async () => {
  const f = fixture(); let dispatched = 0;
  await assert.rejects(runJournaledSubmission({ journal: f.open(), reviewDigest: digest, noteId, expiresAt: 999n, now: () => 1000n, dispatch: async () => { dispatched++; return txHash; }, timeoutMs: 5 }), /REVIEW_EXPIRED/);
  assert.equal(dispatched, 0); assert.equal(f.values.size, 0);
  await run(f.open(), async () => txHash); await run(f.open(config.vaultAddress + 1n), async () => txHash + 1n);
  assert.equal(f.values.size, 2);
  assert.throws(() => new SubmissionJournal({ chainId: config.chainId, vaultAddress: config.vaultAddress, reservationId: 2n }, f.storage, navigator.locks), /PROBE_IDS/);
});

test('T-018 rejected or malformed dispatcher outcomes stay unknown and retain their durable attempt', async () => {
  for (const dispatch of [async () => { throw new Error('test-wallet-payload'); }, async () => 0n]) {
    const f = fixture(); const result = await run(f.open(), dispatch);
    assert.equal(result.status, 'unknown'); assert.equal(result.transactionHash, null);
    await assert.rejects(run(f.open(), async () => txHash), /EXISTING_SUBMISSION/);
  }
});
