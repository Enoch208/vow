import { getWallets } from '@wallet-standard/app';
import { discoverProbeWallets } from '../../packages/vow-sdk/src/wallet-discovery.ts';
import type { DiscoveredWallet } from '../../packages/vow-sdk/src/wallet-discovery.ts';
import { CollectionSession } from '../../packages/vow-sdk/src/collection-session.ts';
import { createPublicReader, readProbeSnapshot } from '../../packages/vow-sdk/src/probe-reader.ts';
import { CollectionError } from '../../packages/vow-sdk/src/collection-wallet.ts';
import type { ProbeConfiguration } from '../../packages/vow-sdk/src/probe-snapshot.ts';
import { parseConfiguration, parsePublicInteger } from './configuration.ts';
import { initializeRecovery } from './recovery.ts';
import { initializeSubmission } from './submission.ts';
import { createCollectionBudgetGate } from './budget.ts';
import { PUBLIC_MAINNET_RPC } from '../../packages/vow-sdk/src/rpc-endpoint.ts';

declare const PROBE_CLASS_HASH: string;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const configuration = element<HTMLTextAreaElement>('configuration');
const list = element<HTMLSelectElement>('wallet');
const prepare = element<HTMLButtonElement>('prepare');
const prove = element<HTMLButtonElement>('prove');
const load = element<HTMLButtonElement>('load');
const scanButton = element<HTMLButtonElement>('scan');
const status = element<HTMLOutputElement>('status');
const review = element<HTMLPreElement>('review');
const r = element<HTMLInputElement>('signature-r');
const s = element<HTMLInputElement>('signature-s');
const registry = getWallets();
const reader = createPublicReader(PUBLIC_MAINNET_RPC);
const recovery = initializeRecovery(reader);
const collectionBudget = createCollectionBudgetGate();
let wallets: DiscoveredWallet[] = [];
let config: ProbeConfiguration | undefined;
let session: CollectionSession | undefined;
let busy = false;
let invalidated = false;
let unsubscribe = () => {};
const submission = initializeSubmission(reader, (value) => { busy = value; render(); }, undefined,
  (review, configuration) => collectionBudget.allows(configuration, review),
  (review, configuration) => collectionBudget.load(configuration, review));
element('build').textContent = `Required local probe class: ${PROBE_CLASS_HASH}`;

function render(): void {
  prepare.disabled = busy || !config || wallets.length === 0;
  prove.disabled = r.disabled = s.disabled = busy || session?.state !== 'awaiting-signature';
  load.disabled = scanButton.disabled = configuration.disabled = busy;
  list.disabled = busy || wallets.length === 0;
}
function discard(): void {
  unsubscribe(); unsubscribe = () => {};
  session?.invalidate(); invalidated = true;
  submission.clear();
  collectionBudget.clear();
  review.textContent = 'Preparation discarded. Existing submission attempts remain in recovery.';
  r.value = s.value = ''; status.textContent = 'Check saved recovery before preparing another collection.';
  render();
}
function scan(): void {
  if (busy) { discard(); return; }
  discard();
  let injected: unknown;
  try { injected = Reflect.get(window, 'starknet_argentX'); } catch { injected = undefined; }
  wallets = discoverProbeWallets(registry.get(), injected);
  list.replaceChildren(...wallets.map((wallet, index) => {
    const option = document.createElement('option'); option.value = String(index);
    option.textContent = `${wallet.name} · ${wallet.version}`; return option;
  }));
  render();
}
function json(value: unknown): string { return JSON.stringify(value, (_, item: unknown) => typeof item === 'bigint' ? `0x${item.toString(16)}` : item, 2); }
function failure(error: unknown): string {
  if (error instanceof CollectionError && error.walletCode !== undefined) return `Wallet preparation stopped (code ${error.walletCode}). No transaction was sent.`;
  if (error instanceof Error && error.message.startsWith('VOW_')) {
    const messages: Record<string, string> = {
      VOW_WRONG_PROBE_BUILD: 'The manifest does not match this local contract build.',
      VOW_NOT_FUNDED: 'The reservation is not open and fully funded.',
      VOW_WRONG_WALLET_CHAIN: 'The wallet network does not match the reviewed terms.',
      VOW_PREPARATION_TIMEOUT: 'Preparation timed out. The wallet may still be working. Discard its request before starting again.',
      VOW_NOTE_CHANGED: 'The wallet changed the signed note. The preparation was discarded.',
      VOW_CLAIM_CALL_MISMATCH: 'The prepared invocation does not match the signed claim. The preparation was discarded.',
      VOW_RPC_READ_FAILED: 'Public contract reads failed. The probe must be deployed and the RPC reachable.',
      VOW_BAD_SUPPLIER_SIGNATURE: 'The signature does not match the supplier key and exact claim.',
      VOW_CLAIM_EXPIRED: 'The claim deadline has passed.',
    };
    return messages[error.message] ?? 'Validation failed. Check the reviewed public terms and wallet state. No transaction was sent.';
  }
  return 'Preparation failed. No transaction was sent.';
}
load.addEventListener('click', () => {
  discard(); config = undefined;
  try {
    config = parseConfiguration(configuration.value, BigInt(PROBE_CLASS_HASH));
    element('terms').textContent = json(config);
    element('configuration-status').textContent = 'Public terms validated locally. Contract checks run before preparation.';
  } catch (error: unknown) {
    element('configuration-status').textContent = failure(error); element('terms').textContent = 'No valid public terms loaded.';
  }
  recovery.setConfiguration(config);
  render();
});
configuration.addEventListener('input', () => { config = undefined; recovery.setConfiguration(undefined); discard(); element('configuration-status').textContent = 'Terms changed. Validate again.'; element('terms').textContent = 'No validated public terms.'; });
list.addEventListener('change', discard);
async function run(action: () => Promise<void>): Promise<void> {
  busy = true; invalidated = false; render();
  try { await action(); } catch (error: unknown) { if (!invalidated) status.textContent = failure(error); }
  finally { busy = false; render(); }
}
prepare.addEventListener('click', () => {
  const terms = config; const wallet = wallets[Number(list.value)];
  if (busy || !terms || !wallet) return;
  void run(async () => {
    submission.clear();
    session?.invalidate();
    session = new CollectionSession(terms, { wallet: wallet.probe, readSnapshot: () => readProbeSnapshot(reader, terms), now: () => BigInt(Math.floor(Date.now() / 1000)) });
    unsubscribe(); unsubscribe = wallet.subscribeInvalidation(discard);
    if (invalidated) return;
    status.textContent = 'Checking contract and wallet, then preparing the note. No transaction will be submitted.';
    review.textContent = 'Waiting for a verified destination…'; r.value = s.value = '';
    const candidate = await session.prepare();
    if (invalidated) return;
    review.textContent = json(candidate);
    status.textContent = 'Destination prepared. Review the exact claim before signing it with your local supplier claim key.';
  });
});
prove.addEventListener('click', () => {
  const current = session;
  if (busy || !current || current.state !== 'awaiting-signature') return;
  void run(async () => {
    const signature = { r: parsePublicInteger(r.value.trim()), s: parsePublicInteger(s.value.trim()) };
    r.value = s.value = '';
    status.textContent = 'Checking the supplier signature and asking the wallet to prepare its proof. No transaction will be submitted.';
    await current.prove(signature);
    if (invalidated) return;
    status.textContent = 'Signed destination preserved and nonempty proof material received. Proof validity and payment remain unverified. Nothing submitted.';
    const wallet = wallets[Number(list.value)];
    if (!config || !wallet) return;
    submission.setPreparation({ session: current, configuration: config, signature,
      wallet: { request: (request) => wallet.probe.request(request), subscribeInvalidation: (listener) => wallet.subscribeInvalidation(listener) } });
  });
});
scanButton.addEventListener('click', scan);
element('clear').addEventListener('click', discard);
registry.on('register', scan); registry.on('unregister', scan);
window.addEventListener('pagehide', discard);
scan(); status.textContent = 'No collection preparation has run.'; review.textContent = 'No supplier signature requested.';
