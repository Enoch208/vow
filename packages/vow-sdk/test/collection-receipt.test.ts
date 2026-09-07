import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { readCollectionReceipt } from '../src/collection-receipt.ts';
import { PublicReadError, createPublicReader } from '../src/probe-reader.ts';
import type { PublicReadMethod } from '../src/probe-reader.ts';
import { receiptFixture, receiptConfig as config, noteId, txHash, hex, selector } from './helpers/receipt.ts';

test('T-017 receipt verification requires exact VOW and pool events, pinned terms and the matching token pull', async () => {
  const f = receiptFixture();
  const report = await readCollectionReceipt(f.reader, config, txHash, noteId);
  assert.equal(report.status, 'confirmed');
  assert.equal(report.events, 'matched'); assert.equal(report.callPath, 'matched');
  assert.equal(report.noteOwnership, 'unverified'); assert.equal(report.retryAllowed, false);
  assert.equal(f.calls.filter((c) => c.method === 'starknet_getBlockWithTxHashes').length, 2);
  for (const call of f.calls.filter((c) => ['starknet_call', 'starknet_getClassHashAt'].includes(c.method))) {
    assert.deepEqual((call.params as { block_id: unknown }).block_id, { block_hash: '0x987' });
  }
  f.receipt.finality_status = 'ACCEPTED_ON_L1';
  f.block.status = 'ACCEPTED_ON_L1';
  assert.equal((await readCollectionReceipt(f.reader, config, txHash, noteId)).finality, 'ACCEPTED_ON_L1');
});

test('T-017 successful unrelated, wrong-note, wrong-token, wrong-amount and duplicate receipts fail closed', async () => {
  const mutations: ((f: ReturnType<typeof receiptFixture>) => void)[] = [
    (f) => { f.receipt.events.shift(); },
    (f) => { f.receipt.events.pop(); },
    (f) => { f.receipt.events[0]!.from_address = '0x999'; },
    (f) => { f.receipt.events[1]!.from_address = '0x999'; },
    (f) => { f.receipt.events[0]!.data[0] = '0x999'; },
    (f) => { f.receipt.events[1]!.keys[2] = '0x999'; },
    (f) => { f.receipt.events[1]!.keys[3] = '0x999'; },
    (f) => { f.receipt.events[1]!.data[0] = '0x999'; },
    (f) => { f.receipt.events.push(f.receipt.events[0]!); },
    (f) => { f.receipt.events.push(f.receipt.events[1]!); },
    (f) => { f.receipt.events.reverse(); },
    (f) => { f.receipt.events[0]!.keys.push('0x1'); },
    (f) => { f.receipt.events[1]!.data.push('0x1'); },
    (f) => { f.receipt.transaction_hash = '0x999'; },
    (f) => { f.receipt.type = 'DECLARE'; },
  ];
  for (const mutate of mutations) {
    const f = receiptFixture(); mutate(f);
    const result = await readCollectionReceipt(f.reader, config, txHash, noteId);
    assert.equal(result.status, 'mismatch'); assert.equal(result.retryAllowed, false);
  }
});

test('T-017 event decoding matches the recorded pool ABI and locally compiled probe ABI', async () => {
  const pool = JSON.parse(await readFile('evidence/pool-abi.json', 'utf8')) as { name: string; members?: unknown }[];
  assert.deepEqual(pool.find((entry) => entry.name === 'privacy::events::OpenNoteDeposited')?.members, [
    { name: 'depositor', type: 'core::starknet::contract_address::ContractAddress', kind: 'key' },
    { name: 'token', type: 'core::starknet::contract_address::ContractAddress', kind: 'key' },
    { name: 'note_id', type: 'core::felt252', kind: 'key' },
    { name: 'amount', type: 'core::integer::u128', kind: 'data' },
  ]);
  const probe = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_CollectionProbe.contract_class.json', 'utf8')) as { abi: { name: string; members?: unknown }[] };
  assert.deepEqual(probe.abi.find((entry) => entry.name.endsWith('::Collected'))?.members, [
    { name: 'note_id', type: 'core::felt252', kind: 'data' }, { name: 'amount', type: 'core::integer::u128', kind: 'data' },
  ]);
});

test('T-017 mismatched class, chain, immutable terms and spent state cannot count as VOW settlement', async () => {
  for (const [method, replacement] of [
    ['starknet_chainId', '0x1'], ['starknet_getClassHashAt', '0x999'], ['starknet_call', ['0x3']],
  ] as const) {
    const f = receiptFixture();
    const result = await readCollectionReceipt({ request: async (name, args) => name === method ? replacement : f.reader.request(name, args) }, config, txHash, noteId);
    assert.equal(result.status, 'mismatch');
  }
  const f = receiptFixture(); f.block.timestamp = Number(config.signatureDeadline);
  assert.equal((await readCollectionReceipt(f.reader, config, txHash, noteId)).reason, 'VOW_CLAIM_EXPIRED');
});

test('T-018 missing transaction, RPC timeout and pre-confirmed receipts remain unknown with no retry permission', async () => {
  for (const error of [new PublicReadError(29), new PublicReadError(), new PublicReadError(24)]) {
    const result = await readCollectionReceipt({ request: async (name) => { if (name === 'starknet_chainId') return hex(config.chainId); throw error; } }, config, txHash, noteId);
    assert.equal(result.status, 'unknown'); assert.equal(result.retryAllowed, false);
  }
  const f = receiptFixture(); f.receipt.finality_status = 'PRE_CONFIRMED';
  assert.equal((await readCollectionReceipt(f.reader, config, txHash, noteId)).status, 'unknown');
  assert.equal(f.calls.length, 2);
});

test('T-018 a changed canonical block or absent transaction invalidates even matching settlement evidence', async () => {
  for (const late of [false, true]) {
    const f = receiptFixture(); let count = 0;
    const result = await readCollectionReceipt({ request: async (name, args) => {
      if (name === 'starknet_getBlockWithTxHashes' && ++count === (late ? 2 : 1)) return { ...f.block, block_hash: '0x999' };
      return f.reader.request(name, args);
    } }, config, txHash, noteId);
    assert.equal(result.status, 'unknown'); assert.equal(result.events, 'unverified');
  }
  const f = receiptFixture(); f.block.transactions = [];
  assert.equal((await readCollectionReceipt(f.reader, config, txHash, noteId)).reason, 'VOW_BLOCK_CHANGED');
});

test('T-017 accepted revert is distinguished from payment without exposing revert text', async () => {
  const f = receiptFixture(); f.receipt.execution_status = 'REVERTED';
  const report = await readCollectionReceipt(f.reader, config, txHash, noteId);
  assert.equal(report.status, 'reverted'); assert.equal(report.events, 'unverified');
  assert.equal(f.calls.some((c) => c.method === 'starknet_traceTransaction'), false);
});

test('T-017 unavailable trace preserves event evidence but cannot report confirmed collection', async () => {
  const f = receiptFixture();
  const report = await readCollectionReceipt({ request: async (name, args) => {
    if (name === 'starknet_traceTransaction') throw new PublicReadError(-32601);
    return f.reader.request(name, args);
  } }, config, txHash, noteId);
  assert.equal(report.status, 'receipt-matched'); assert.equal(report.callPath, 'unverified');
  assert.equal(report.events, 'matched'); assert.equal(report.retryAllowed, false);
});

test('T-017 trace rejects wrong caller, class, signature terms, transfer destination, amount and duplicate callbacks', async () => {
  const mutations: ((f: ReturnType<typeof receiptFixture>) => void)[] = [
    (f) => { f.callback.caller_address = '0x999'; },
    (f) => { f.callback.class_hash = '0x999'; },
    (f) => { f.callback.call_type = 'DELEGATE'; },
    (f) => { f.callback.calldata[2] = '0x999'; },
    (f) => { f.callback.calldata[3] = '0x999'; },
    (f) => { f.callback.calldata[4] = '0x0'; },
    (f) => { f.callback.calldata[5] = '0x0'; },
    (f) => { f.callback.result[3] = '0x999'; },
    (f) => { f.pool.class_hash = '0x999'; },
    (f) => { f.pull.calldata[1] = '0x999'; },
    (f) => { f.pull.calldata[2] = '0x999'; },
    (f) => { f.pull.result = ['0x0']; },
    (f) => { f.pool.calls.pop(); },
    (f) => { f.pool.calls.push(f.callback); },
    (f) => { f.pool.calls.push(f.pull); },
    (f) => { f.pool.calls.reverse(); },
    (f) => { f.pool.calls = [f.callback]; f.callback.calls = [f.pull]; },
    (f) => { f.trace.execute_invocation.calls = []; },
  ];
  for (const mutate of mutations) {
    const f = receiptFixture(); mutate(f);
    const result = await readCollectionReceipt(f.reader, config, txHash, noteId);
    assert.equal(result.status, 'mismatch'); assert.equal(result.callPath, 'mismatch');
  }
});

test('T-018 receipt reader snapshots caller configuration before asynchronous work', async () => {
  const f = receiptFixture(); const mutable = { ...config };
  const result = await readCollectionReceipt({ request: async (name, args) => {
    mutable.token = 999n; mutable.amount = 999n;
    return f.reader.request(name, args);
  } }, mutable, txHash, noteId);
  assert.equal(result.status, 'confirmed');
});

test('T-017 extended public reader still blocks broadcasts before making a network request', async () => {
  let requests = 0;
  const reader = createPublicReader('https://rpc.example.test', async () => { requests++; return Response.json({}); });
  await assert.rejects(reader.request('starknet_addInvokeTransaction' as PublicReadMethod, {}), /READ_ONLY_RPC/);
  assert.equal(requests, 0);
});

test('T-017 trace entry point matches the recorded apply_actions ABI and rejects an invented invoke entry point', async () => {
  const abi = JSON.parse(await readFile('evidence/pool-abi.json', 'utf8')) as { type: string; items?: { name: string }[] }[];
  const names = abi.filter((entry) => entry.type === 'interface').flatMap((entry) => entry.items ?? []).map((entry) => entry.name);
  assert.ok(names.includes('apply_actions')); assert.equal(names.includes('invoke'), false);
  const f = receiptFixture();
  assert.equal((await readCollectionReceipt(f.reader, config, txHash, noteId)).status, 'confirmed');
  f.pool.entry_point_selector = selector('invoke');
  assert.equal((await readCollectionReceipt(f.reader, config, txHash, noteId)).callPath, 'mismatch');
});
