import { address, bounded, felt, U64_MAX } from './integers.ts';
import { receiptFelt, receiptRecord } from './receipt-values.ts';
import { SubmissionAttempt } from './submission-attempt.ts';
import type { SubmissionCheckpoint } from './submission-attempt.ts';
import type { CollectionReceiptReport } from './collection-receipt.ts';

export interface RecoveryRecord {
  readonly version: 1;
  readonly scope: string;
  readonly noteId: string;
  readonly checkpoint: SubmissionCheckpoint;
}
export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface ReservationScope {
  readonly chainId: bigint;
  readonly vaultAddress: bigint;
  readonly reservationId: bigint;
}

export class SubmissionJournal {
  readonly #key: string;
  readonly #storage: RecoveryStorage;
  readonly #locks: Pick<LockManager, 'request'>;

  constructor(scope: ReservationScope, storage: RecoveryStorage, locks: Pick<LockManager, 'request'>, mode: 'probe' | 'vault' = 'probe') {
    felt(scope.chainId, 'CHAIN', 1n); address(scope.vaultAddress, 'VAULT');
    felt(scope.reservationId, 'RESERVATION', 1n);
    if (mode === 'probe' && scope.reservationId !== 1n) throw new Error('VOW_PROBE_IDS');
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || !locks || typeof locks.request !== 'function') {
      throw new Error('VOW_RECOVERY_UNAVAILABLE');
    }
    this.#key = `vow:collection:v1:${hex(scope.chainId)}:${hex(scope.vaultAddress)}:${hex(scope.reservationId)}`;
    this.#storage = storage; this.#locks = locks;
  }

  async read(): Promise<RecoveryRecord | null> {
    return this.#locked(() => {
      const record = this.#load();
      return record ? this.#record(record.noteId, this.#restore(record)) : null;
    });
  }

  async reserve(reviewDigest: bigint, noteId: bigint, expiresAt: bigint, now: bigint): Promise<RecoveryRecord> {
    felt(reviewDigest, 'REVIEW_DIGEST', 1n); felt(noteId, 'NOTE_ID', 1n);
    bounded(expiresAt, U64_MAX, 'DEADLINE', 1n); bounded(now, U64_MAX, 'NOW');
    if (now >= expiresAt) throw new Error('VOW_REVIEW_EXPIRED');
    return this.#locked(() => {
      if (this.#load()) throw new Error('VOW_EXISTING_SUBMISSION_ATTEMPT');
      const attempt = new SubmissionAttempt(reviewDigest); attempt.begin(reviewDigest);
      return this.#save(this.#record(hex(noteId), attempt));
    });
  }

  async recordHash(reviewDigest: bigint, transactionHash: bigint): Promise<RecoveryRecord> {
    felt(transactionHash, 'TRANSACTION_HASH', 1n);
    return this.#locked(() => {
      const record = this.#required(reviewDigest); const attempt = this.#restore(record);
      try { attempt.recordSubmittedHash(transactionHash); }
      catch (error: unknown) {
        if (!(error instanceof Error) || error.message !== 'VOW_TRANSACTION_HASH_CHANGED') throw error;
      }
      return this.#save(this.#record(record.noteId, attempt));
    });
  }

  async markUnknown(reviewDigest: bigint): Promise<RecoveryRecord> {
    return this.#locked(() => {
      const record = this.#required(reviewDigest);
      return this.#save(this.#record(record.noteId, this.#restore(record)));
    });
  }

  async reconcile(reviewDigest: bigint, read: (hash: bigint, noteId: bigint) => Promise<CollectionReceiptReport>): Promise<RecoveryRecord> {
    return this.#locked(async () => {
      const record = this.#required(reviewDigest); const attempt = this.#restore(record);
      await attempt.reconcile((hash) => read(hash, receiptFelt(record.noteId)));
      return this.#save(this.#record(record.noteId, attempt));
    });
  }

  #required(reviewDigest: bigint): RecoveryRecord {
    felt(reviewDigest, 'REVIEW_DIGEST', 1n);
    const record = this.#load();
    if (!record) throw new Error('VOW_NO_SUBMISSION_ATTEMPT');
    if (receiptFelt(record.checkpoint.reviewDigest) !== reviewDigest) throw new Error('VOW_REVIEW_CHANGED');
    return record;
  }

  #restore(record: RecoveryRecord): SubmissionAttempt {
    return SubmissionAttempt.restore(record.checkpoint, receiptFelt(record.checkpoint.reviewDigest));
  }

  #load(): RecoveryRecord | null {
    let raw: string | null;
    try { raw = this.#storage.getItem(this.#key); } catch { throw new Error('VOW_RECOVERY_STORAGE_UNAVAILABLE'); }
    if (raw === null) return null;
    try {
      if (typeof raw !== 'string' || raw.length > 4096) throw new Error();
      const data = receiptRecord(JSON.parse(raw));
      if (Object.keys(data).length !== 4 || Object.keys(data).some((key) => !['version', 'scope', 'noteId', 'checkpoint'].includes(key)) ||
          data.version !== 1 || data.scope !== this.#key) throw new Error();
      felt(receiptFelt(data.noteId), 'NOTE_ID', 1n);
      const checkpoint = receiptRecord(data.checkpoint);
      SubmissionAttempt.restore(checkpoint, receiptFelt(checkpoint.reviewDigest));
      return data as unknown as RecoveryRecord;
    } catch { throw new Error('VOW_CORRUPT_RECOVERY_RECORD'); }
  }

  #record(noteId: string, attempt: SubmissionAttempt): RecoveryRecord {
    return Object.freeze({ version: 1, scope: this.#key, noteId, checkpoint: attempt.checkpoint() });
  }

  #save(record: RecoveryRecord): RecoveryRecord {
    const serialized = JSON.stringify(record);
    try {
      this.#storage.setItem(this.#key, serialized);
      if (this.#storage.getItem(this.#key) !== serialized) throw new Error();
    } catch { throw new Error('VOW_RECOVERY_STORAGE_UNAVAILABLE'); }
    return record;
  }

  async #locked<T>(action: () => T | Promise<T>): Promise<T> {
    return this.#locks.request(this.#key, { mode: 'exclusive' }, async () => action());
  }
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
