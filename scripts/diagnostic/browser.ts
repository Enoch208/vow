import { getWallets } from '@wallet-standard/app';
import { discoverProbeWallets } from '../../packages/vow-sdk/src/wallet-discovery.ts';
import { probeStrk20Wallet } from '../../packages/vow-sdk/src/wallet.ts';
import type { DiscoveredWallet } from '../../packages/vow-sdk/src/wallet-discovery.ts';

const registry = getWallets();
const list = document.querySelector<HTMLSelectElement>('#wallet')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const result = document.querySelector<HTMLPreElement>('#result')!;
const run = document.querySelector<HTMLButtonElement>('#run')!;
const rescan = document.querySelector<HTMLButtonElement>('#rescan')!;
let wallets: DiscoveredWallet[] = [];
let running = false;

function scan(): void {
  if (running) return;
  let injected: unknown;
  try { injected = Reflect.get(window, 'starknet_argentX'); } catch { injected = undefined; }
  wallets = discoverProbeWallets(registry.get(), injected);
  list.replaceChildren(...wallets.map((wallet, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${wallet.name} · ${wallet.version} · ${wallet.transport}`;
    return option;
  }));
  run.disabled = wallets.length === 0;
  list.disabled = wallets.length === 0;
  status.textContent = wallets.length ? 'Wallet detected. Ready for a read-only check.' : 'No supported wallet provider detected. Open this page in the browser with Ready installed, then scan again.';
  result.textContent = 'No capability check has run.';
}

run.addEventListener('click', async () => {
  const wallet = wallets[Number(list.value)];
  if (!wallet || running) return;
  running = true;
  run.disabled = rescan.disabled = list.disabled = true;
  status.textContent = 'Querying supported wallet API versions. No signing or transaction request is sent.';
  try {
    const capability = await probeStrk20Wallet(wallet.probe);
    result.textContent = JSON.stringify({
      wallet: { name: wallet.name, id: wallet.id, version: wallet.version, transport: wallet.transport },
      capability,
    }, null, 2);
    status.textContent = capability.api === 'responded'
      ? 'Wallet API versions received. Share the result below. Private collection is still unverified.'
      : 'The read-only request did not succeed. Share the result below, including errorCode if present, so we can investigate. This does not establish lack of STRK20 support. No funds are needed.';
  } finally {
    running = false;
    run.disabled = rescan.disabled = list.disabled = false;
  }
});

rescan.addEventListener('click', scan);
registry.on('register', scan);
registry.on('unregister', scan);
scan();
setTimeout(() => { if (wallets.length === 0) scan(); }, 1000);
