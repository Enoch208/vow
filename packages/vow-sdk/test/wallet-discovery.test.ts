import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoverProbeWallets } from '../src/wallet-discovery.ts';
import { probeStrk20Wallet } from '../src/wallet.ts';

test('G0 discovery reads identity only and sends no automatic requests', async () => {
  let calls = 0;
  const provider = {
    id: 'argentX', name: 'Ready X', version: '5.33.9',
    get accounts(): never { throw new Error('Account access forbidden'); },
    get selectedAddress(): never { throw new Error('Address access forbidden'); },
    request() { assert.equal(this, provider); calls++; return Promise.resolve([]); },
  };
  const found = discoverProbeWallets([], provider);
  assert.equal(calls, 0);
  assert.equal(found[0]?.name, 'Ready X');
  assert.equal(found[0]?.transport, 'injected');
  await probeStrk20Wallet(found[0]!.probe);
  assert.equal(calls, 1);
});

test('G0 wallet-standard discovery uses application version and preserves request receiver', async () => {
  const api = { id: 'argentX', walletVersion: '5.33.9', request() {
    assert.equal(this, api); return Promise.resolve([]);
  } };
  const wallet = { name: 'Ready X', version: '1.0.0', features: { 'starknet:walletApi': api },
    get accounts(): never { throw new Error('Account access forbidden'); },
  };
  const legacy = { id: 'argentX', name: 'Ready X', version: '5.33.9', request: async () => [] };
  const found = discoverProbeWallets([wallet], legacy);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.version, '5.33.9');
  assert.equal(found[0]?.transport, 'wallet-standard');
  assert.equal((await probeStrk20Wallet(found[0]!.probe)).api, 'responded');
});

test('G0 malformed and throwing providers are ignored without exposing their contents', () => {
  const bad = { get features(): never { throw new Error('private payload'); } };
  const wrongWallet = { id: 'other', name: 'Other', request: async () => [] };
  assert.deepEqual(discoverProbeWallets([null, {}, bad, { features: { 'starknet:walletApi': { request: 'bad' } } }], wrongWallet), []);
  assert.deepEqual(discoverProbeWallets([], { id: 'argentX', name: '\nunsafe', request: async () => [] }), []);
});

test('G0 wallet account and network events invalidate preparations without reading event data', () => {
  const listeners = new Map<string, () => void>();
  let invalidations = 0;
  const provider = { id: 'argentX', name: 'Ready X', version: '5.33.9', request: async () => [],
    on: (event: string, callback: () => void) => { listeners.set(event, callback); },
    off: (event: string) => { listeners.delete(event); },
  };
  const wallet = discoverProbeWallets([], provider)[0]!;
  const unsubscribe = wallet.subscribeInvalidation(() => { invalidations++; });
  listeners.get('accountsChanged')!(); listeners.get('networkChanged')!();
  assert.equal(invalidations, 2); unsubscribe(); assert.equal(listeners.size, 0);
});
