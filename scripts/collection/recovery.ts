import { SubmissionJournal } from '../../packages/vow-sdk/src/submission-journal.ts';
import { readCollectionReceipt } from '../../packages/vow-sdk/src/collection-receipt.ts';
import type { PublicReader } from '../../packages/vow-sdk/src/probe-reader.ts';
import type { ProbeConfiguration } from '../../packages/vow-sdk/src/probe-snapshot.ts';
import { parsePublicInteger } from './configuration.ts';

export function initializeRecovery(reader: PublicReader) {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const saved = element<HTMLButtonElement>('read-recovery');
  const verify = element<HTMLButtonElement>('verify-receipt');
  const tx = element<HTMLInputElement>('transaction-hash');
  const note = element<HTMLInputElement>('receipt-note');
  const status = element<HTMLOutputElement>('recovery-status');
  const output = element<HTMLPreElement>('receipt-report');
  let config: ProbeConfiguration | undefined;
  let revision = 0;
  let busy = false;
  const render = () => {
    saved.disabled = busy || !config;
    verify.disabled = busy || !config || !tx.value.trim() || !note.value.trim();
    tx.disabled = note.disabled = busy || !config;
  };
  const run = async (action: () => Promise<void>) => {
    if (busy || !config) return;
    busy = true; const current = revision; render();
    try { await action(); }
    catch {
      if (current === revision) {
        status.textContent = 'The check could not complete. Keep the transaction hash and resolve the existing attempt before trying another payment.';
        output.textContent = 'Result unverified. No transaction submitted.';
      }
    } finally { busy = false; render(); }
  };
  saved.addEventListener('click', () => {
    const terms = config; const current = revision;
    if (!terms || busy) return;
    void run(async () => {
      output.textContent = 'Reading saved attempt…';
      const journal = new SubmissionJournal({ chainId: terms.chainId, vaultAddress: terms.vaultAddress, reservationId: 1n }, window.localStorage, navigator.locks);
      const record = await journal.read();
      if (current !== revision) return;
      if (!record) { status.textContent = 'No saved collection attempt for these public terms.'; output.textContent = 'No saved attempt.'; return; }
      tx.value = record.checkpoint.transactionHash ?? ''; note.value = record.noteId;
      output.textContent = JSON.stringify(record, null, 2);
      status.textContent = record.checkpoint.conflictingTransactionHash ? 'Conflicting transaction hashes require investigation. Do not submit again.'
        : tx.value ? 'Saved attempt loaded. Check its receipt before treating it as payment.'
          : 'An attempt was recorded without a transaction hash. Find its result in the wallet before taking another action.';
    });
  });
  verify.addEventListener('click', () => {
    const terms = config; const current = revision;
    if (!terms || busy) return;
    void run(async () => {
      const transactionHash = parsePublicInteger(tx.value.trim()); const noteId = parsePublicInteger(note.value.trim());
      status.textContent = 'Checking public receipt, events and execution trace…';
      output.textContent = 'Verification in progress.';
      const report = await readCollectionReceipt(reader, terms, transactionHash, noteId);
      if (current !== revision) return;
      output.textContent = JSON.stringify(report, (_, value: unknown) => typeof value === 'bigint' ? `0x${value.toString(16)}` : value, 2);
      const messages = {
        confirmed: 'Exact collection events and call path matched. Encrypted note ownership remains unverified.',
        'receipt-matched': 'Events matched, but the execution trace is unavailable. Collection remains incompletely verified.',
        unknown: 'Transaction outcome remains unknown. Do not submit again based on this result.',
        mismatch: 'This receipt does not verify the reviewed collection. Investigate the existing transaction before another attempt.',
        reverted: 'The accepted transaction reverted. No successful collection is established. Review the cause before another attempt.',
      };
      status.textContent = messages[report.status];
    });
  });
  for (const input of [tx, note]) input.addEventListener('input', () => {
    revision++; status.textContent = 'Inputs changed. Run a fresh receipt check.'; output.textContent = 'No receipt checked.'; render();
  });
  render();
  return { setConfiguration(value: ProbeConfiguration | undefined): void {
    revision++; config = value ? Object.freeze({ ...value }) : undefined;
    tx.value = note.value = ''; output.textContent = 'No receipt checked.';
    status.textContent = value ? 'Enter a public transaction hash and its signed note ID, or load a saved attempt.' : 'Validate public terms before checking a receipt.';
    render();
  } };
}
