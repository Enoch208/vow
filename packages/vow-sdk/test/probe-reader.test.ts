import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hash } from 'starknet';
import { readProbeSnapshot, createPublicReader, PublicReadError } from '../src/probe-reader.ts';
import type { PublicReader, PublicReadMethod } from '../src/probe-reader.ts';
import { config, snapshot } from './helpers/collection.ts';

function reader(): { api: PublicReader; calls: { method: PublicReadMethod; params: unknown }[] } {
  const calls: { method: PublicReadMethod; params: unknown }[] = [];
  const results: Record<string, string[]> = {
    configuration: [100n, 55n, 57n, config.supplierKey, 100n, 2000n].map(String),
    state: ['1'], balance_of: ['100', '0'], allowance: ['0', '0'], is_paused: ['0'], get_fee_collector: ['99'],
  };
  const entries = Object.fromEntries(Object.entries(results).map(([name, value]) => [hash.getSelectorFromName(name), value]));
  return { calls, api: { async request(method, params) {
    calls.push({ method, params });
    if (method === 'starknet_chainId') return '0x1';
    if (method === 'starknet_getBlockWithTxHashes') return { block_hash: '0x7b', timestamp: 1000 };
    const args = params as { contract_address?: string; request?: { entry_point_selector: string } };
    if (method === 'starknet_getClassHashAt') return String(args.contract_address === '0x38' ? snapshot.probeClassHash : snapshot.poolClassHash);
    return entries[args.request!.entry_point_selector];
  } } };
}

test('G0 reader pins all class, contract, balance and allowance reads to one concrete block hash', async () => {
  const source = reader();
  assert.deepEqual(await readProbeSnapshot(source.api, config), snapshot);
  assert.equal(source.calls.length, 10);
  for (const call of source.calls.slice(2)) assert.deepEqual((call.params as { block_id: unknown }).block_id, { block_hash: '0x7b' });
});

test('G0 reader rejects wrong chain before contract requests, malformed data and pending blocks', async () => {
  let count = 0;
  await assert.rejects(readProbeSnapshot({ request: async () => { count++; return '0x2'; } }, config), /WRONG_CHAIN/);
  assert.equal(count, 1);
  const source = reader();
  await assert.rejects(readProbeSnapshot({ request: async (method, params) => method === 'starknet_call' ? ['1'] : source.api.request(method, params) }, config), /INVALID_READ/);
  await assert.rejects(readProbeSnapshot({ request: async (method) => method === 'starknet_chainId' ? '0x1' : { timestamp: 1000 } }, config), /INVALID_BLOCK/);
});

test('G0 public RPC adapter verifies response identity and never exposes server error payloads', async () => {
  const good = createPublicReader('https://rpc.example.test', async (_url, options) => {
    const request = JSON.parse(String(options?.body)) as { id: number; method: string };
    assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'error');
    return Response.json({ jsonrpc: '2.0', id: request.id, result: '0x1' });
  });
  assert.equal(await good.request('starknet_chainId', []), '0x1');
  for (const body of [{ id: 999, result: '0x1' }, { id: 1, error: { message: 'secret' } }]) {
    const bad = createPublicReader('https://rpc.example.test', async () => Response.json(body));
    await assert.rejects(bad.request('starknet_chainId', []), { message: 'VOW_RPC_READ_FAILED' });
  }
  assert.throws(() => createPublicReader('https://user:secret@example.test'), /INVALID_RPC_URL/);
});

test('Read-only RPC preserves only bounded error codes from valid response envelopes', async () => {
  for (const [body, expected] of [
    [{ jsonrpc: '2.0', id: 1, error: { code: 20, message: 'private', data: 'private' } }, 20],
    [{ jsonrpc: '2.0', id: 1, error: { code: 28 } }, 28],
    [{ jsonrpc: '2.0', id: 1, error: { code: 1_000_001 } }, null],
    [{ jsonrpc: '2.0', id: 2, error: { code: 20 } }, null],
    [{ jsonrpc: '2.0', id: 1, result: '0x1', error: { code: 20 } }, null],
    [{ id: 1, error: { code: 20 } }, null],
  ] as const) {
    const api = createPublicReader('https://rpc.example.test', async () => Response.json(body));
    await assert.rejects(api.request('starknet_getClass', {}), (error: unknown) => {
      assert.ok(error instanceof PublicReadError); assert.equal(error.errorCode, expected);
      assert.equal(JSON.stringify(error).includes('private'), false);
      assert.equal(error.message, 'VOW_RPC_READ_FAILED'); return true;
    });
  }
});
