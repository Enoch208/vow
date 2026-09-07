import type { STRK20_ACTION } from 'starknet';
import type { ProbeWallet } from './wallet.ts';
import type { PreparedSubmissionRequest } from './collection-submission.ts';

export type CollectionRequest =
  | PreparedSubmissionRequest
  | { readonly type: 'wallet_supportedWalletApi' }
  | { readonly type: 'wallet_requestChainId' }
  | { readonly type: 'wallet_requestAccounts'; readonly params: { readonly silent_mode: boolean; readonly api_version: '0.10.3' } }
  | { readonly type: 'wallet_deploymentData'; readonly params: { readonly api_version: '0.10.3' } }
  | { readonly type: 'wallet_strk20PrepareInvoke'; readonly params: {
    readonly actions: STRK20_ACTION[]; readonly simulate: boolean; readonly api_version: '0.10.3';
  } };
export interface CollectionWallet extends ProbeWallet {
  request(request: CollectionRequest): Promise<unknown>;
}

export class CollectionError extends Error {
  readonly code: string;
  readonly walletCode: number | undefined;
  readonly walletReason: WalletFailureReason | undefined;
  constructor(code: string, walletCode?: number, walletReason?: WalletFailureReason) {
    super(code); this.code = code; this.walletCode = walletCode; this.walletReason = walletReason;
  }
}

export type WalletFailureReason = 'INVALID_REQUEST_PAYLOAD' | 'NOT_REGISTERED'
  | 'INSUFFICIENT_PRIVATE_BALANCE' | 'PRIVACY_LEAK' | 'USER_REFUSED_OP' | 'UNKNOWN_ERROR';

export async function walletRequest(wallet: CollectionWallet, request: CollectionRequest): Promise<unknown> {
  try { return await wallet.request(request); }
  catch (error: unknown) {
    throw new CollectionError('VOW_WALLET_REQUEST_FAILED', walletCode(error), walletReason(error));
  }
}

const FAILURE_REASONS: readonly WalletFailureReason[] = ['INVALID_REQUEST_PAYLOAD', 'NOT_REGISTERED',
  'INSUFFICIENT_PRIVATE_BALANCE', 'PRIVACY_LEAK', 'USER_REFUSED_OP', 'UNKNOWN_ERROR'];

function walletCode(error: unknown): number | undefined {
  for (const raw of candidates(error, 'code')) {
    if (typeof raw === 'number' && Number.isSafeInteger(raw) && Math.abs(raw) <= 2147483647) return raw;
    if (typeof raw === 'string' && /^-?[0-9]{1,10}$/.test(raw)) {
      const parsed = Number(raw);
      if (Number.isSafeInteger(parsed) && Math.abs(parsed) <= 2147483647) return parsed;
    }
  }
  return undefined;
}

function walletReason(error: unknown): WalletFailureReason | undefined {
  const texts: string[] = [];
  if (typeof error === 'string') texts.push(error);
  for (const field of ['message', 'reason', 'error'] as const) {
    for (const raw of candidates(error, field)) if (typeof raw === 'string') texts.push(raw);
  }
  for (const text of texts) {
    if (text.length > 128) continue;
    const exact = /^An error occurred \(([A-Z_]{1,40})\)$/.exec(text)?.[1] ?? text.trim();
    const match = FAILURE_REASONS.find((reason) => reason === exact);
    if (match) return match;
  }
  return undefined;
}

function candidates(error: unknown, field: string): unknown[] {
  const found: unknown[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 3 || !node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (field in record) found.push(record[field]);
    for (const nested of ['data', 'cause', 'error'] as const) {
      if (nested in record) visit(record[nested], depth + 1);
    }
  };
  try { visit(error, 0); } catch { return found; }
  return found;
}
