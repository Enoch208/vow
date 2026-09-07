import { felt } from '../../packages/vow-sdk/src/integers.ts';
import { receiptFelt, receiptRecord } from '../../packages/vow-sdk/src/receipt-values.ts';
import type { VaultInvokeRequest } from './vault-invoke.ts';

export type WriteState = 'READY' | 'SIGNING' | 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'REVERTED' | 'UNKNOWN';
export type SettledState = 'CONFIRMED' | 'REVERTED' | 'UNKNOWN';
export const WRITE_STATES: readonly WriteState[] = ['READY', 'SIGNING', 'SUBMITTED', 'CONFIRMED', 'REJECTED', 'REVERTED', 'UNKNOWN'];
const TERMINAL: readonly WriteState[] = ['CONFIRMED', 'REJECTED', 'REVERTED'];

export interface WriteOutcome {
  readonly state: WriteState;
  readonly transactionHash: string | null;
  readonly retryAllowed: false;
  readonly detail: string;
}

export interface WriteWallet {
  request(request: VaultInvokeRequest | { readonly type: string; readonly params?: unknown }): Promise<unknown>;
}

const DETAIL: Record<WriteState, string> = {
  READY: 'Nothing has been signed or sent. Review the exact call before you continue.',
  SIGNING: 'The wallet holds the exact call. Compare its network fee before approving.',
  SUBMITTED: 'The wallet returned a transaction hash. A hash is not confirmation; reconcile its public receipt.',
  CONFIRMED: 'The public receipt matched this call in an accepted block.',
  REJECTED: 'The wallet reported an explicit refusal and no transaction hash. Nothing was sent.',
  REVERTED: 'The transaction was accepted in a block and reverted. It changed no vault state.',
  UNKNOWN: 'The outcome is unresolved. This is not permission to retry: reconcile it, or find the hash in your wallet first.',
};

export class WriteFlow {
  #state: WriteState = 'READY';
  #hash: bigint | null = null;
  #detail = DETAIL.READY;
  #busy = false;
  readonly #notify: (outcome: WriteOutcome) => void;

  constructor(notify: (outcome: WriteOutcome) => void = () => {}) { this.#notify = notify; }

  get outcome(): WriteOutcome {
    return Object.freeze({ state: this.#state, transactionHash: this.#hash === null ? null : hex(this.#hash),
      retryAllowed: false, detail: this.#detail });
  }
  get dispatchable(): boolean { return this.#state === 'READY' && !this.#busy; }
  get reconcilable(): boolean { return !this.#busy && (this.#state === 'SUBMITTED' || (this.#state === 'UNKNOWN' && this.#hash !== null)); }

  async submit(input: { readonly wallet: WriteWallet; readonly request: VaultInvokeRequest;
    readonly preflight: () => Promise<void>; readonly timeoutMs: number }): Promise<WriteOutcome> {
    if (this.#busy) throw new Error('VOW_WRITE_IN_PROGRESS');
    if (this.#state !== 'READY') throw new Error('VOW_WRITE_NOT_RETRYABLE');
    if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 600_000) throw new Error('VOW_INVALID_WRITE_TIMEOUT');
    this.#busy = true;
    try {
      try { await input.preflight(); }
      catch (error: unknown) {
        this.#move('READY', `Nothing was signed or sent. ${reason(error)}`);
        return this.outcome;
      }
      this.#move('SIGNING', DETAIL.SIGNING);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const dispatch = Promise.resolve().then(() => input.wallet.request(input.request));
      const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), input.timeoutMs); });
      try {
        const settled = await Promise.race([dispatch.then(() => 'settled' as const).catch(() => 'settled' as const), timeout]);
        if (settled === 'timeout') {
          this.#move('UNKNOWN', `The wallet did not answer within ${input.timeoutMs} ms. ${DETAIL.UNKNOWN}`);
          void dispatch.then((response) => { this.#attachLateHash(response); }).catch(() => {});
          return this.outcome;
        }
      } finally { clearTimeout(timer); }
      try { this.#move('SUBMITTED', DETAIL.SUBMITTED, transactionHash(await dispatch)); }
      catch (error: unknown) {
        if (refused(error)) this.#move('REJECTED', DETAIL.REJECTED);
        else this.#move('UNKNOWN', DETAIL.UNKNOWN);
      }
      return this.outcome;
    } finally { this.#busy = false; this.#notify(this.outcome); }
  }

  attachTransactionHash(value: bigint): WriteOutcome {
    if (this.#state !== 'UNKNOWN') throw new Error('VOW_HASH_NOT_ACCEPTED');
    const recovered = felt(value, 'TRANSACTION_HASH', 1n);
    if (this.#hash !== null && this.#hash !== recovered) throw new Error('VOW_TRANSACTION_HASH_CHANGED');
    this.#hash = recovered;
    this.#move('UNKNOWN', DETAIL.UNKNOWN);
    return this.outcome;
  }

  async reconcile(read: (transactionHash: bigint) => Promise<SettledState>): Promise<WriteOutcome> {
    if (this.#busy) throw new Error('VOW_WRITE_IN_PROGRESS');
    if (TERMINAL.includes(this.#state)) throw new Error('VOW_WRITE_ALREADY_SETTLED');
    if (this.#hash === null) throw new Error('VOW_NO_TRANSACTION_HASH');
    this.#busy = true;
    try {
      let settled: SettledState;
      try { settled = await read(this.#hash); } catch { settled = 'UNKNOWN'; }
      this.#move(settled, DETAIL[settled]);
      return this.outcome;
    } finally { this.#busy = false; this.#notify(this.outcome); }
  }

  #attachLateHash(response: unknown): void {
    if (this.#state !== 'UNKNOWN' || this.#hash !== null) return;
    try { this.#hash = transactionHash(response); } catch { return; }
    this.#move('UNKNOWN', `The wallet answered after the timeout with a transaction hash. ${DETAIL.UNKNOWN}`);
    this.#notify(this.outcome);
  }

  #move(state: WriteState, detail: string, transactionHash?: bigint): void {
    if (transactionHash !== undefined) this.#hash = transactionHash;
    this.#state = state; this.#detail = detail;
  }
}

function transactionHash(response: unknown): bigint {
  const record = receiptRecord(response);
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, 'transaction_hash')) throw new Error('VOW_MALFORMED_WALLET_RESULT');
  return felt(receiptFelt(record.transaction_hash), 'TRANSACTION_HASH', 1n);
}

function refused(error: unknown): boolean {
  try { return !!error && typeof error === 'object' && Reflect.get(error, 'code') === 113; }
  catch { return false; }
}

function reason(error: unknown): string {
  return error instanceof Error && /^VOW_[A-Z_]+$/.test(error.message) ? `Checks stopped with ${error.message}.` : 'A preparation check failed.';
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
