import { felt } from './integers.ts';
import type { CollectionReceiptReport } from './collection-receipt.ts';
import { receiptFelt, receiptRecord } from './receipt-values.ts';

export type SubmissionState = 'ready' | 'signing' | 'submitted' | 'unknown' | 'rejected' | 'reverted' | 'confirmed';
export interface SubmissionCheckpoint {
  readonly version: 1;
  readonly reviewDigest: string;
  readonly state: SubmissionState;
  readonly transactionHash: string | null;
  readonly conflictingTransactionHash: string | null;
}

export class SubmissionAttempt {
  readonly #reviewDigest: bigint;
  #state: SubmissionState = 'ready';
  #transactionHash: bigint | null = null;
  #conflictingTransactionHash: bigint | null = null;
  #reconciling = false;

  constructor(reviewDigest: bigint) {
    this.#reviewDigest = felt(reviewDigest, 'REVIEW_DIGEST', 1n);
  }

  get state(): SubmissionState { return this.#state; }
  get transactionHash(): bigint | null { return this.#transactionHash; }

  begin(approvedReviewDigest: bigint): void {
    if (this.#state !== 'ready') throw new Error('VOW_ATTEMPT_ALREADY_STARTED');
    if (approvedReviewDigest !== this.#reviewDigest) throw new Error('VOW_REVIEW_CHANGED');
    this.#state = 'signing';
  }

  recordSubmittedHash(transactionHash: bigint): void {
    felt(transactionHash, 'TRANSACTION_HASH', 1n);
    if (!['signing', 'unknown', 'submitted'].includes(this.#state)) throw new Error('VOW_INVALID_ATTEMPT_STATE');
    if (this.#conflictingTransactionHash !== null) throw new Error('VOW_TRANSACTION_HASH_CHANGED');
    if (this.#transactionHash !== null && transactionHash !== this.#transactionHash) {
      this.#conflictingTransactionHash = transactionHash;
      this.#state = 'unknown';
      throw new Error('VOW_TRANSACTION_HASH_CHANGED');
    }
    this.#transactionHash = transactionHash;
    this.#state = 'submitted';
  }

  recordUncertainOutcome(): void {
    if (!['signing', 'submitted', 'unknown'].includes(this.#state)) throw new Error('VOW_INVALID_ATTEMPT_STATE');
    this.#state = 'unknown';
  }

  recordExplicitRejection(): void {
    if (this.#state !== 'signing' || this.#transactionHash !== null) throw new Error('VOW_INVALID_ATTEMPT_STATE');
    this.#state = 'rejected';
  }

  async reconcile(read: (transactionHash: bigint) => Promise<CollectionReceiptReport>): Promise<SubmissionState> {
    if (!['submitted', 'unknown', 'confirmed', 'reverted'].includes(this.#state)) throw new Error('VOW_INVALID_ATTEMPT_STATE');
    if (this.#reconciling) throw new Error('VOW_RECONCILIATION_IN_PROGRESS');
    if (this.#conflictingTransactionHash !== null) { this.#state = 'unknown'; return this.#state; }
    if (this.#transactionHash === null) { this.#state = 'unknown'; return this.#state; }
    this.#reconciling = true;
    try {
      const report = await read(this.#transactionHash);
      if (report.transactionHash !== this.#transactionHash) throw new Error('VOW_TRANSACTION_HASH_CHANGED');
      const confirmed = report.status === 'confirmed' && report.events === 'matched' && report.callPath === 'matched';
      const accepted = report.blockHash !== null && report.blockHash > 0n && ['ACCEPTED_ON_L1', 'ACCEPTED_ON_L2'].includes(report.finality ?? '');
      this.#state = this.#conflictingTransactionHash !== null ? 'unknown' : accepted && confirmed ? 'confirmed' : accepted && report.status === 'reverted' ? 'reverted' : 'unknown';
    } catch { this.#state = 'unknown'; }
    finally { this.#reconciling = false; }
    return this.#state;
  }

  checkpoint(): SubmissionCheckpoint {
    return Object.freeze({ version: 1, reviewDigest: hex(this.#reviewDigest), state: this.#state,
      transactionHash: this.#transactionHash === null ? null : hex(this.#transactionHash),
      conflictingTransactionHash: this.#conflictingTransactionHash === null ? null : hex(this.#conflictingTransactionHash) });
  }

  static restore(input: unknown, expectedReviewDigest: bigint): SubmissionAttempt {
    const data = receiptRecord(input);
    const fields = ['version', 'reviewDigest', 'state', 'transactionHash', 'conflictingTransactionHash'];
    if (Object.keys(data).length !== fields.length || Object.keys(data).some((key) => !fields.includes(key)) || data.version !== 1 ||
        !['ready', 'signing', 'submitted', 'unknown', 'rejected', 'reverted', 'confirmed'].includes(String(data.state))) throw new Error('VOW_INVALID_CHECKPOINT');
    const attempt = new SubmissionAttempt(receiptFelt(data.reviewDigest));
    if (attempt.#reviewDigest !== expectedReviewDigest) throw new Error('VOW_REVIEW_CHANGED');
    attempt.#transactionHash = data.transactionHash === null ? null : felt(receiptFelt(data.transactionHash), 'TRANSACTION_HASH', 1n);
    attempt.#conflictingTransactionHash = data.conflictingTransactionHash === null ? null : felt(receiptFelt(data.conflictingTransactionHash), 'TRANSACTION_HASH', 1n);
    attempt.#state = 'unknown';
    return attempt;
  }
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
