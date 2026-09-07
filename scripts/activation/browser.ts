import { getWallets } from '@wallet-standard/app';
import { discoverProbeWallets } from '../../packages/vow-sdk/src/wallet-discovery.ts';
import type { DiscoveredWallet } from '../../packages/vow-sdk/src/wallet-discovery.ts';
import { CollectionError } from '../../packages/vow-sdk/src/collection-wallet.ts';
import { connectAndReadAccountDeployment } from '../../packages/vow-sdk/src/account-deployment.ts';
import { parsePublicInteger } from '../collection/configuration.ts';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const owner = element<HTMLInputElement>('owner');
const list = element<HTMLSelectElement>('wallet');
const read = element<HTMLButtonElement>('read');
const scanButton = element<HTMLButtonElement>('scan');
const status = element('status'); const result = element('result');
const registry = getWallets();
const initialOwner = new URLSearchParams(location.hash.slice(1)).get('owner');
if (initialOwner && /^0x[0-9a-fA-F]{1,63}$/.test(initialOwner)) owner.value = initialOwner;
if (location.hash) history.replaceState(null, '', location.pathname);
let wallets: DiscoveredWallet[] = [];
let busy = false; let revision = 0; let unsubscribe = () => {};
function render(): void { read.disabled = busy || wallets.length === 0 || !owner.value.trim(); list.disabled = busy || wallets.length === 0; scanButton.disabled = owner.disabled = busy; }
function discard(): void { revision++; result.textContent = 'No account data loaded.'; status.textContent = 'Selection changed. Read activation details again.'; }
function scan(): void {
  discard(); if (busy) return;
  let injected: unknown;
  try { injected = Reflect.get(window, 'starknet_argentX'); } catch { injected = undefined; }
  wallets = discoverProbeWallets(registry.get(), injected);
  list.replaceChildren(...wallets.map((wallet, index) => {
    const option = document.createElement('option'); option.value = String(index); option.textContent = `${wallet.name} · ${wallet.version}`; return option;
  })); render();
}
read.addEventListener('click', async () => {
  const wallet = wallets[Number(list.value)]; if (!wallet || busy) return;
  discard(); const current = revision; busy = true; render();
  let timer: ReturnType<typeof setTimeout> | undefined;
  unsubscribe(); unsubscribe = () => {};
  try {
    if (revision !== current) return;
    const expected = parsePublicInteger(owner.value.trim());
    status.textContent = 'Approve the site connection in Ready if prompted. Only your public account and deployment details are requested.';
    const operation = async () => {
      return connectAndReadAccountDeployment(wallet.probe, expected, () => revision === current,
        () => { unsubscribe = wallet.subscribeInvalidation(discard); });
    };
    const validated = await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => {
      if (revision === current) { revision++; status.textContent = 'The read timed out. Late results will be discarded. No activation performed.'; }
      reject(new Error('VOW_ACTIVATION_READ_TIMEOUT'));
    }, 90_000); })]);
    if (revision !== current) return;
    result.textContent = JSON.stringify(validated, null, 2);
    status.textContent = 'Address verified. Share this public result for fee preparation. No activation performed.';
  } catch (error: unknown) {
    if (revision === current) status.textContent = error instanceof CollectionError
      ? `Ready did not provide deployment details${error.walletCode === undefined ? '' : ` (code ${error.walletCode})`}. Unlock Ready and check the site connection. No transaction sent.`
      : error instanceof Error && error.message === 'VOW_WRONG_DEPLOYMENT_ACCOUNT'
        ? 'The connected account does not match the expected address. Select the intended account in Ready and retry.'
        : 'The public details could not be verified. Check the expected address and mainnet selection. Nothing submitted.';
  } finally { if (timer) clearTimeout(timer); busy = false; render(); }
});
owner.addEventListener('input', () => { discard(); render(); }); list.addEventListener('change', discard);
scanButton.addEventListener('click', scan); registry.on('register', scan); registry.on('unregister', scan);
window.addEventListener('pagehide', () => { discard(); unsubscribe(); });
scan(); status.textContent = 'No activation details requested.';
