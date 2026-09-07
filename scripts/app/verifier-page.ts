import { readCollectionReceipt } from '../../packages/vow-sdk/src/collection-receipt.ts';
import type { PublicReader } from '../../packages/vow-sdk/src/probe-reader.ts';
import type { AppDeployment } from './collection-manifest.ts';
import { hex, json, publicInteger } from './public-values.ts';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function initializeVerifier(app: AppDeployment, reader: PublicReader, initial: bigint | null): void {
  element('verify-page').hidden = false;
  const transaction = element<HTMLInputElement>('transaction');
  const button = element<HTMLButtonElement>('verify');
  const status = element<HTMLElement>('verify-status');
  const output = element<HTMLPreElement>('verify-report');
  const selected = initial ?? app.preloadedTransactionHash;
  transaction.value = hex(selected);
  if (initial === null) history.replaceState(null, '', `/verify/${hex(selected)}`);
  const verify = async () => {
    let transactionHash: bigint;
    try { transactionHash = publicInteger(transaction.value); }
    catch { status.textContent = 'Enter one Starknet transaction hash.'; return; }
    button.disabled = transaction.disabled = true;
    status.textContent = 'Reading the public receipt, canonical block, pinned classes, reservation and call trace. No wallet is used.';
    output.textContent = 'Verification in progress…';
    try {
      const report = await readCollectionReceipt(reader, app.deployment, transactionHash);
      output.textContent = json(report);
      if (report.status === 'confirmed') status.textContent = 'Confirmed VOW collection. The exact ReservationClaimed event and STRK20 deposit path match the pinned deployment.';
      else if (report.status === 'receipt-matched') status.textContent = 'Receipt events match, but the trace is unavailable. This is not confirmed VOW evidence.';
      else if (report.status === 'reverted') status.textContent = 'Rejected: the transaction reverted.';
      else if (report.status === 'mismatch') status.textContent = 'Rejected as VOW evidence. Transaction success alone does not prove a VOW collection.';
      else status.textContent = 'Unknown. The public evidence is unavailable or not yet accepted; do not treat it as a collection.';
    } catch { status.textContent = 'Verification could not validate the pinned manifest or public input.'; output.textContent = 'No VOW evidence confirmed.'; }
    finally { button.disabled = transaction.disabled = false; }
  };
  button.addEventListener('click', () => { void verify(); });
  void verify();
}
