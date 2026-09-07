import { address, felt } from './integers.ts';
import type { PreparedSubmissionRequest, reviewCollectionSubmission } from './collection-submission.ts';
import { runJournaledSubmission } from './journaled-submission.ts';
import type { JournaledSubmissionResult } from './journaled-submission.ts';
import type { SubmissionJournal } from './submission-journal.ts';

export type CollectionDispatchRequest = PreparedSubmissionRequest
  | { readonly type: 'wallet_supportedWalletApi' }
  | { readonly type: 'wallet_requestChainId' }
  | { readonly type: 'wallet_requestAccounts'; readonly params: { readonly silent_mode: true; readonly api_version: '0.10.3' } };

export interface CollectionDispatchWallet {
  request(request: CollectionDispatchRequest): Promise<unknown>;
  subscribeInvalidation(listener: () => void): () => void;
}

export interface CollectionDispatchResult extends JournaledSubmissionResult {
  readonly walletOutcome: 'submitted' | 'refused' | 'unknown' | 'not-dispatched';
  readonly retryAllowed: false;
}

export async function runCollectionDispatch(input: {
  readonly reviewed: Awaited<ReturnType<typeof reviewCollectionSubmission>>;
  readonly approvedReviewDigest: bigint;
  readonly expectedAccount: bigint;
  readonly wallet: CollectionDispatchWallet;
  readonly journal: SubmissionJournal;
  readonly preflight: () => Promise<void>;
  readonly now: () => bigint;
  readonly timeoutMs: number;
}): Promise<CollectionDispatchResult> {
  const { reviewed, approvedReviewDigest, expectedAccount, wallet, journal, preflight, now, timeoutMs } = input;
  address(expectedAccount, 'EXPECTED_ACCOUNT');
  felt(approvedReviewDigest, 'REVIEW_DIGEST', 1n);
  if (approvedReviewDigest !== reviewed.review.reviewDigest) throw new Error('VOW_REVIEW_CHANGED');
  if (reviewed.review.claim.chainId !== 0x534e5f4d41494en) throw new Error('VOW_WRONG_WALLET_CHAIN');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new Error('VOW_INVALID_SUBMISSION_TIMEOUT');
  let invalidated = false;
  let walletOutcome: CollectionDispatchResult['walletOutcome'] = 'not-dispatched';
  let unsubscribe = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = () => {
    if (invalidated) throw new Error('VOW_SESSION_INVALIDATED');
    if (now() >= reviewed.review.expiresAt) throw new Error('VOW_REVIEW_EXPIRED');
  };
  try {
    try {
      unsubscribe = wallet.subscribeInvalidation(() => { invalidated = true; reviewed.discard(); });
      if (typeof unsubscribe !== 'function') throw new Error();
    } catch { throw new Error('VOW_WALLET_EVENTS_UNAVAILABLE'); }
    active();
    const result = await runJournaledSubmission({ journal, reviewDigest: approvedReviewDigest,
      noteId: reviewed.review.claim.outputNoteId, expiresAt: reviewed.review.expiresAt, now, timeoutMs,
      dispatch: async () => {
        timer = setTimeout(() => { invalidated = true; reviewed.discard(); }, timeoutMs);
        active();
        const versions = await wallet.request({ type: 'wallet_supportedWalletApi' });
        active();
        if (!Array.isArray(versions) || !versions.includes('0.10.3')) throw new Error('VOW_API_UNSUPPORTED');
        const chain = await wallet.request({ type: 'wallet_requestChainId' });
        active();
        if (hexFelt(chain) !== reviewed.review.claim.chainId) throw new Error('VOW_WRONG_WALLET_CHAIN');
        const accounts = await wallet.request({ type: 'wallet_requestAccounts', params: { silent_mode: true, api_version: '0.10.3' } });
        active();
        if (!Array.isArray(accounts) || accounts.length !== 1 || hexFelt(accounts[0]) !== expectedAccount) throw new Error('VOW_WRONG_WALLET_ACCOUNT');
        await preflight();
        active();
        const finalChain = await wallet.request({ type: 'wallet_requestChainId' });
        active();
        if (hexFelt(finalChain) !== reviewed.review.claim.chainId) throw new Error('VOW_WRONG_WALLET_CHAIN');
        const request = reviewed.take(approvedReviewDigest, now());
        active();
        walletOutcome = 'unknown';
        let response: unknown;
        try { response = await wallet.request(request); }
        catch (error: unknown) {
          if (refused(error)) walletOutcome = 'refused';
          throw new Error('VOW_WALLET_SUBMISSION_UNRESOLVED');
        }
        const transactionHash = transactionResult(response);
        walletOutcome = 'submitted';
        return transactionHash;
      } });
    return { ...result, walletOutcome, retryAllowed: false };
  } finally {
    invalidated = true;
    clearTimeout(timer);
    reviewed.discard();
    try { unsubscribe(); } catch { }
  }
}

function hexFelt(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error('VOW_MALFORMED_WALLET_RESULT');
  return felt(BigInt(value), 'WALLET_RESULT', 1n);
}

function transactionResult(value: unknown): bigint {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'transaction_hash')) {
    throw new Error('VOW_MALFORMED_WALLET_RESULT');
  }
  return hexFelt(Reflect.get(value, 'transaction_hash'));
}

function refused(error: unknown): boolean {
  try { return !!error && typeof error === 'object' && Reflect.get(error, 'code') === 113; }
  catch { return false; }
}
