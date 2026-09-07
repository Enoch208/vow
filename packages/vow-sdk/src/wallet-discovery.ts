import type { CollectionWallet, CollectionRequest } from './collection-wallet.ts';

export interface DiscoveredWallet {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly transport: 'wallet-standard' | 'injected';
  readonly probe: CollectionWallet;
  subscribeInvalidation(listener: () => void): () => void;
}

export function discoverProbeWallets(registered: readonly unknown[], injectedReady: unknown): DiscoveredWallet[] {
  const found: DiscoveredWallet[] = [];
  for (const candidate of registered) {
    const adapted = adapt(candidate, 'wallet-standard');
    if (adapted && !found.some((wallet) => wallet.id === adapted.id)) found.push(adapted);
  }
  const legacy = adapt(injectedReady, 'injected');
  if (legacy && legacy.id === 'argentX' && !found.some((wallet) => wallet.id === legacy.id)) found.push(legacy);
  return found;
}

function adapt(candidate: unknown, transport: DiscoveredWallet['transport']): DiscoveredWallet | undefined {
  try {
    const wallet = object(candidate);
    if (!wallet) return;
    const api = transport === 'wallet-standard' ? object(object(wallet.features)?.['starknet:walletApi']) : wallet;
    if (!api || typeof api.request !== 'function') return;
    const id = label(api.id);
    const name = label(wallet.name);
    const version = label(transport === 'wallet-standard' ? api.walletVersion : wallet.version) ?? 'unreported';
    if (!id || !name) return;
    const request = api.request;
    return { id, name, version, transport, subscribeInvalidation: (listener) => {
      try {
        if (transport === 'wallet-standard') {
          const events = object(object(wallet.features)?.['standard:events']);
          if (!events || typeof events.on !== 'function') return () => {};
          const unsubscribe: unknown = Reflect.apply(events.on, events, ['change', () => listener()]);
          return () => { try { if (typeof unsubscribe === 'function') unsubscribe(); } catch { return; } };
        }
        if (typeof wallet.on !== 'function' || typeof wallet.off !== 'function') return () => {};
        const off = wallet.off;
        const callback = () => listener();
        Reflect.apply(wallet.on, wallet, ['accountsChanged', callback]);
        Reflect.apply(wallet.on, wallet, ['networkChanged', callback]);
        return () => {
          try {
            Reflect.apply(off, wallet, ['accountsChanged', callback]);
            Reflect.apply(off, wallet, ['networkChanged', callback]);
          } catch { return; }
        };
      } catch { listener(); return () => {}; }
    }, probe: {
      request: (input: CollectionRequest) => Promise.resolve(Reflect.apply(request, api, [input]) as unknown),
    } };
  } catch {
    return;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function label(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
}
