import { SubmissionJournal } from './submission-journal.ts';
import type { RecoveryRecord } from './submission-journal.ts';
import { felt } from './integers.ts';

export interface JournaledSubmissionResult {
  readonly status: 'submitted' | 'unknown';
  readonly transactionHash: bigint | null;
  readonly recovery: 'saved' | 'storage-failed';
}

export async function runJournaledSubmission(input: {
  readonly journal: SubmissionJournal;
  readonly reviewDigest: bigint;
  readonly noteId: bigint;
  readonly expiresAt: bigint;
  readonly now: () => bigint;
  readonly dispatch: () => Promise<bigint>;
  readonly timeoutMs: number;
}): Promise<JournaledSubmissionResult> {
  const { journal, reviewDigest, noteId, expiresAt, now, dispatch, timeoutMs } = input;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new Error('VOW_INVALID_SUBMISSION_TIMEOUT');
  await journal.reserve(reviewDigest, noteId, expiresAt, now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let receivedHash: bigint | null = null;
  const unknown = async (): Promise<JournaledSubmissionResult> => {
    try { await journal.markUnknown(reviewDigest); return { status: 'unknown', transactionHash: receivedHash, recovery: 'saved' }; }
    catch { return { status: 'unknown', transactionHash: receivedHash, recovery: 'storage-failed' }; }
  };
  const pending = (async (): Promise<JournaledSubmissionResult> => {
    try {
      if (now() >= expiresAt) return unknown();
      receivedHash = felt(await dispatch(), 'TRANSACTION_HASH', 1n);
      let record: RecoveryRecord;
      try { record = await journal.recordHash(reviewDigest, receivedHash); }
      catch { return { status: 'unknown', transactionHash: receivedHash, recovery: 'storage-failed' }; }
      return { status: record.checkpoint.state === 'submitted' ? 'submitted' : 'unknown', transactionHash: receivedHash, recovery: 'saved' };
    } catch { return unknown(); }
  })();
  const timeout = new Promise<JournaledSubmissionResult>((resolve) => {
    timer = setTimeout(() => { void unknown().then(resolve); }, timeoutMs);
  });
  try { return await Promise.race([pending, timeout]); }
  finally { clearTimeout(timer); }
}
