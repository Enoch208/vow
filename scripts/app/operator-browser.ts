import { createPublicReader } from '../../packages/vow-sdk/src/probe-reader.ts';
import { PUBLIC_MAINNET_RPC } from '../../packages/vow-sdk/src/rpc-endpoint.ts';
import { loadVaultManifest } from './manifest.ts';
import { initializeOperator } from './operator.ts';
import { createWalletPicker } from './wallet-picker.ts';

declare const VAULT_CLASS_HASH: string;

const picker = createWalletPicker(() => operator.render());
const operator = initializeOperator({
  reader: createPublicReader(PUBLIC_MAINNET_RPC),
  loadManifest: () => loadVaultManifest(() => fetch('/deployment/manifest.json', { cache: 'no-store', credentials: 'omit' }), BigInt(VAULT_CLASS_HASH)),
  wallet: () => picker.selected(),
  now: () => BigInt(Math.floor(Date.now() / 1000)),
});
picker.scan();
window.addEventListener('pagehide', () => operator.reset());
