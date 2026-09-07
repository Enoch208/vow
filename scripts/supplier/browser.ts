import { SupplierKey } from '../../packages/vow-sdk/src/supplier-key.ts';
import { createSupplierBackup, parseSupplierBackup, unlockSupplierBackup } from '../../packages/vow-sdk/src/supplier-backup.ts';
import { parseClaimReview } from './claim-review.ts';
import { setupPasswordFields } from './password-fields.ts';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const passwords = ['new-password', 'confirm-password', 'unlock-password'].map((id) => element<HTMLInputElement>(id));
const file = element<HTMLInputElement>('backup-file');
const publicKey = element<HTMLTextAreaElement>('public-key');
const claimInput = element<HTMLTextAreaElement>('claim');
const status = element<HTMLOutputElement>('status');
const confirmation = element<HTMLInputElement>('confirm-claim');
const backupStatus = element<HTMLOutputElement>('backup-status');
const buttons = ['create', 'download', 'unlock', 'review', 'sign'].map((id) => element<HTMLButtonElement>(id));
const passwordControls = setupPasswordFields(render);
let key: SupplierKey | undefined;
let backupText: string | undefined;
let review: ReturnType<typeof parseClaimReview> | undefined;
let busy = false;
let revision = 0;
let idleTimer: ReturnType<typeof setTimeout>;
const now = () => BigInt(Math.floor(Date.now() / 1000));
function render(): void {
  buttons[0]!.disabled = buttons[2]!.disabled = busy;
  buttons[1]!.disabled = busy || !backupText;
  buttons[3]!.disabled = busy || !key || key.locked;
  confirmation.disabled = busy || !review || !key || key.locked;
  buttons[4]!.disabled = confirmation.disabled || !confirmation.checked;
  file.disabled = claimInput.disabled = busy;
  for (const password of passwords) password.disabled = busy;
  const passwordValid = passwordControls.update();
  buttons[0]!.disabled = busy || !passwordValid;
}
function clearClaim(): void {
  review = undefined; confirmation.checked = false;
  element('claim-summary').textContent = 'No claim reviewed.';
  element('signature').textContent = 'No signature created.';
  render();
}
function lock(): void {
  revision++; key?.lock(); key = undefined; backupText = undefined;
  for (const password of passwords) password.value = '';
  file.value = ''; publicKey.value = ''; claimInput.value = '';
  element('backup-status').textContent = 'Session cleared. Keep any downloaded backup secure.';
  clearClaim(); status.textContent = 'Key locked.';
}
function touch(): void { clearTimeout(idleTimer); idleTimer = setTimeout(lock, 300_000); }
function message(error: unknown): string {
  const messages: Record<string, string> = {
    VOW_PASSWORD_MISMATCH: 'The backup passwords do not match.',
    VOW_BACKUP_PASSWORD_LENGTH: 'Use a password between 16 and 1024 characters.',
    VOW_BACKUP_UNLOCK_FAILED: 'Backup unlock failed. Check the file and password.',
    VOW_WRONG_SUPPLIER_KEY: 'This key is not the supplier key bound to that collection.',
    VOW_CLAIM_EXPIRED: 'The claim deadline has passed. Prepare a new valid claim.',
    VOW_CLAIM_DIGEST_MISMATCH: 'The claim does not match its digest. Do not sign it.',
    VOW_BACKUP_FILE_REQUIRED: 'Choose your encrypted backup file first.',
    VOW_BROWSER_CRYPTO_UNAVAILABLE: 'This browser cannot encrypt a backup here. Open http://127.0.0.1:4318/ in Chrome and retry.',
  };
  return error instanceof Error ? messages[error.message] ?? 'Validation failed. No signature was created.' : 'Operation failed.';
}
async function run(action: (current: number) => Promise<void>, feedback: HTMLElement = status): Promise<void> {
  if (busy) return;
  busy = true; const current = ++revision; render();
  try { await action(current); } catch (error: unknown) {
    if (revision === current) { status.textContent = feedback.textContent = message(error); }
  }
  finally { busy = false; render(); }
}
element('create').addEventListener('click', () => {
  if (busy) return;
  const password = passwords[0]!.value; const repeated = passwords[1]!.value;
  if (password.length < 16 || password.length > 1024 || password !== repeated) {
    backupStatus.textContent = message(new Error(password.length < 16 || password.length > 1024 ? 'VOW_BACKUP_PASSWORD_LENGTH' : 'VOW_PASSWORD_MISMATCH'));
    return;
  }
  lock();
  backupStatus.textContent = 'Creating your encrypted backup… Download will become available when it is ready.';
  void run(async (current) => {
    if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) throw new Error('VOW_BROWSER_CRYPTO_UNAVAILABLE');
    const generated = SupplierKey.generate();
    try {
      const encrypted = await createSupplierBackup(generated, password);
      if (revision !== current) return;
      backupText = JSON.stringify(encrypted, null, 2);
      element('backup-status').textContent = 'Encrypted backup ready. Download it, then restore it below before sharing your public key.';
      status.textContent = 'New key locked. Verify your downloaded backup to continue.';
    } finally { generated.lock(); }
  }, backupStatus);
});
element('download').addEventListener('click', () => {
  if (!backupText || busy) return;
  const url = URL.createObjectURL(new Blob([backupText], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'vow-supplier-backup.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  element('backup-status').textContent = 'Download requested. Restore the saved file below to verify it.';
});
element('unlock').addEventListener('click', () => {
  if (busy) return;
  const selected = file.files?.[0]; const password = passwords[2]!.value;
  lock();
  void run(async (current) => {
    if (!selected || selected.size > 2048) throw new Error('VOW_BACKUP_FILE_REQUIRED');
    const encrypted = parseSupplierBackup(await selected.text());
    if (revision !== current) return;
    const restored = await unlockSupplierBackup(encrypted, password);
    if (revision !== current) { restored.lock(); return; }
    key = restored; publicKey.value = `0x${restored.publicKey.toString(16)}`;
    backupStatus.textContent = 'Your saved backup was restored successfully. Keep the file and password secure.';
    status.textContent = 'Backup verified. Public key ready to share; private key stays local.';
    touch();
  });
});
element('review').addEventListener('click', () => {
  if (!key || key.locked || busy) return;
  clearClaim();
  try {
    review = parseClaimReview(claimInput.value, now());
    if (review.supplierKey !== key.publicKey) { review = undefined; throw new Error('VOW_WRONG_SUPPLIER_KEY'); }
    const claim = review.claim;
    element('claim-summary').textContent = `Network: Starknet mainnet\nVault: 0x${claim.vaultAddress.toString(16)}\nToken: 0x${claim.token.toString(16)}\nAmount (base units): ${claim.amount}\nReservation: ${claim.reservationId}\nExact note: 0x${claim.outputNoteId.toString(16)}\nSignature deadline (Unix seconds): ${claim.signatureDeadline}`;
    status.textContent = 'Compare these terms with the funded reservation before confirming.';
  } catch (error: unknown) { status.textContent = message(error); }
  render();
});
confirmation.addEventListener('change', render);
claimInput.addEventListener('input', clearClaim);
element('sign').addEventListener('click', () => {
  if (!key || !review || !confirmation.checked || busy) return;
  try {
    const signature = key.sign(review.claim, review.supplierKey, now());
    element('signature').textContent = JSON.stringify(signature, (_, value: unknown) => typeof value === 'bigint' ? `0x${value.toString(16)}` : value, 2);
    status.textContent = 'Exact claim signed locally. No transaction submitted.';
    key.lock(); key = undefined; review = undefined; confirmation.checked = false;
  } catch (error: unknown) { status.textContent = message(error); }
  render();
});
element('lock').addEventListener('click', lock);
window.addEventListener('pagehide', lock);
for (const event of ['pointerdown', 'keydown']) window.addEventListener(event, touch, { passive: true });
render(); touch();
