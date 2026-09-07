import { getWallets } from '@wallet-standard/app';
import { discoverProbeWallets } from '../../packages/vow-sdk/src/wallet-discovery.ts';
import type { DiscoveredWallet } from '../../packages/vow-sdk/src/wallet-discovery.ts';
import type { WriteWallet } from './write-flow.ts';

export function createWalletPicker(onChange: () => void) {
  const list = document.getElementById('wallet') as HTMLSelectElement;
  const button = document.getElementById('scan-wallet') as HTMLButtonElement;
  const status = document.getElementById('wallet-status') as HTMLOutputElement;
  const registry = getWallets();
  let wallets: DiscoveredWallet[] = [];
  const scan = () => {
    let injected: unknown;
    try { injected = Reflect.get(window, 'starknet_argentX'); } catch { injected = undefined; }
    wallets = discoverProbeWallets(registry.get(), injected);
    list.replaceChildren(...wallets.map((wallet, index) => {
      const option = document.createElement('option');
      option.value = String(index); option.textContent = `${wallet.name} · ${wallet.version}`;
      return option;
    }));
    list.disabled = wallets.length === 0;
    status.textContent = wallets.length === 0 ? 'No STRK20 wallet detected. Writes stay disabled.'
      : `${wallets.length} wallet(s) detected. The wallet confirms every fee; this page cannot cap it.`;
    onChange();
  };
  list.addEventListener('change', onChange);
  button.addEventListener('click', scan);
  registry.on('register', scan); registry.on('unregister', scan);
  return {
    scan,
    selected(): WriteWallet | undefined {
      const wallet = wallets[Number(list.value)];
      return wallet ? wallet.probe as unknown as WriteWallet : undefined;
    },
  };
}
