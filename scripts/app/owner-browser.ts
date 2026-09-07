import { createPublicReader } from '../../packages/vow-sdk/src/probe-reader.ts';
import { PUBLIC_MAINNET_RPC } from '../../packages/vow-sdk/src/rpc-endpoint.ts';
import { loadVaultManifest } from './manifest.ts';
import { initializeOwner } from './owner.ts';
import { createWalletPicker } from './wallet-picker.ts';

declare const VAULT_CLASS_HASH: string;

const picker = createWalletPicker(() => owner.render());
const owner = initializeOwner({
  reader: createPublicReader(PUBLIC_MAINNET_RPC),
  loadManifest: () => loadVaultManifest(() => fetch('/deployment/manifest.json', { cache: 'no-store', credentials: 'omit' }), BigInt(VAULT_CLASS_HASH)),
  wallet: () => picker.selected(),
  download: (filename, contents) => {
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.rel = 'noopener';
    anchor.click(); URL.revokeObjectURL(url);
  },
  now: () => BigInt(Math.floor(Date.now() / 1000)),
});
picker.scan();
window.addEventListener('pagehide', () => owner.reset());
