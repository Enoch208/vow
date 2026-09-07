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
  constructor(code: string, walletCode?: number) {
    super(code); this.code = code; this.walletCode = walletCode;
  }
}

export async function walletRequest(wallet: CollectionWallet, request: CollectionRequest): Promise<unknown> {
  try { return await wallet.request(request); }
  catch (error: unknown) {
    let code: number | undefined;
    try {
      if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'number' && Number.isSafeInteger(error.code) && Math.abs(error.code) <= 2147483647) code = error.code;
    } catch { code = undefined; }
    throw new CollectionError('VOW_WALLET_REQUEST_FAILED', code);
  }
}
