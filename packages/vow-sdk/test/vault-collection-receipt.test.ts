import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { hash } from 'starknet';
import { readCollectionReceipt } from '../src/collection-receipt.ts';
import type { PublicReader, PublicReadMethod } from '../src/probe-reader.ts';
import { POOL_CLASS_HASH } from '../src/prepared-claim.ts';
import type { VaultDeploymentManifest } from '../src/vault-collection.ts';

const manifest: VaultDeploymentManifest = { chainId: 0x534e5f4d41494en, vaultAddress: 56n, vaultClassHash: 1234n, poolAddress: 55n,
  poolClassHash: POOL_CLASS_HASH, feeToken: 57n, feeCollector: 58n, maximumProtocolFee: 6n, maximumNetworkFee: 1n };
const transactionHash = 123n;
const reservationId = 987n;
const mandateId = 4n;
const noteId = 456n;
const amount = 100n;
const token = 57n;
const signatureDeadline = 1900n;
const hex = (value: bigint) => `0x${value.toString(16)}`;
const selector = (name: string) => hash.getSelectorFromName(name);

function fixture() {
  const makeCall = (target: bigint, name: string, calldata: bigint[], result: bigint[], caller: bigint, classHash: bigint) => ({
    contract_address: hex(target), entry_point_selector: selector(name), calldata: calldata.map(hex), result: result.map(hex),
    caller_address: hex(caller), class_hash: hex(classHash), call_type: 'CALL', entry_point_type: 'EXTERNAL', calls: [] as unknown[],
  });
  const callback = makeCall(manifest.vaultAddress, 'privacy_invoke', [0x434c41494dn, reservationId, noteId, signatureDeadline, 11n, 12n],
    [1n, noteId, token, amount], manifest.poolAddress, manifest.vaultClassHash);
  const pull = makeCall(token, 'transfer_from', [manifest.vaultAddress, manifest.poolAddress, amount, 0n], [1n], manifest.poolAddress, 789n);
  const pool = { ...makeCall(manifest.poolAddress, 'apply_actions', [], [], 888n, manifest.poolClassHash), calls: [callback, pull] as unknown[] };
  const trace = { type: 'INVOKE', execute_invocation: { ...makeCall(888n, '__execute__', [], [], 0n, 777n), calls: [pool] } };
  const receipt = { type: 'INVOKE', transaction_hash: hex(transactionHash), block_hash: '0x987', block_number: 50,
    execution_status: 'SUCCEEDED', finality_status: 'ACCEPTED_ON_L2', events: [
      { from_address: hex(manifest.vaultAddress), keys: [selector('ReservationClaimed'), hex(reservationId), hex(mandateId)], data: [hex(noteId), hex(amount)] },
      { from_address: hex(manifest.poolAddress), keys: [selector('OpenNoteDeposited'), hex(manifest.vaultAddress), hex(token), hex(noteId)], data: [hex(amount)] },
    ] };
  const block = { block_hash: '0x987', block_number: 50, status: 'ACCEPTED_ON_L2', timestamp: 1000, transactions: [hex(transactionHash)] };
  const reservation = [mandateId, 2n, 3n, 4n, token, amount, 2000n, 5n, 2n].map(hex);
  const calls: { method: PublicReadMethod; params: unknown }[] = [];
  const reader: PublicReader = { async request(method, params) {
    calls.push({ method, params });
    if (method === 'starknet_chainId') return hex(manifest.chainId);
    if (method === 'starknet_getTransactionReceipt') return receipt;
    if (method === 'starknet_getBlockWithTxHashes') return block;
    if (method === 'starknet_traceTransaction') return trace;
    if (method === 'starknet_getClassHashAt') return (params as { contract_address: string }).contract_address === hex(manifest.vaultAddress) ? hex(manifest.vaultClassHash) : hex(manifest.poolClassHash);
    if (method === 'starknet_call') return (params as { request: { entry_point_selector: string } }).request.entry_point_selector === selector('pool') ? [hex(manifest.poolAddress)] : reservation;
    throw new Error('UNEXPECTED_TEST_REQUEST');
  } };
  return { reader, receipt, block, trace, callback, pull, pool, reservation, calls };
}

test('T-017 VowVault receipt requires ReservationClaimed, matching reservation state, pool deposit and exact token pull', async () => {
  const f = fixture();
  const report = await readCollectionReceipt(f.reader, manifest, transactionHash);
  assert.equal(report.status, 'confirmed');
  assert.equal(report.reservationId, reservationId); assert.equal(report.mandateId, mandateId);
  assert.equal(report.noteId, noteId); assert.equal(report.token, token); assert.equal(report.amount, amount);
  assert.equal(report.signatureDeadline, signatureDeadline); assert.equal(report.noteOwnership, 'unverified');
  assert.equal(f.calls.filter((call) => call.method === 'starknet_getBlockWithTxHashes').length, 2);
});

test('T-017 VowVault receipt decoder matches the compiled ReservationClaimed ABI', async () => {
  const artifact = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_VowVault.contract_class.json', 'utf8')) as { abi: { name: string; members?: unknown }[] };
  assert.deepEqual(artifact.abi.find((entry) => entry.name.endsWith('::ReservationClaimed'))?.members, [
    { name: 'reservation_id', type: 'core::felt252', kind: 'key' },
    { name: 'mandate_id', type: 'core::felt252', kind: 'key' },
    { name: 'note_id', type: 'core::felt252', kind: 'data' },
    { name: 'amount', type: 'core::integer::u128', kind: 'data' },
  ]);
});

test('T-017 successful unrelated STRK20 activity is rejected as VOW evidence', async () => {
  const f = fixture();
  f.receipt.events.shift();
  const report = await readCollectionReceipt(f.reader, manifest, transactionHash);
  assert.equal(report.status, 'mismatch'); assert.equal(report.reason, 'VOW_COLLECTION_EVENTS_MISSING');
  assert.equal(f.calls.some((call) => call.method === 'starknet_traceTransaction'), false);
});

test('T-017 wrong reservation, duplicate claim event, wrong note and altered trace fail closed', async () => {
  const mutations: ((value: ReturnType<typeof fixture>) => void)[] = [
    (f) => { f.reservation[0] = hex(mandateId + 1n); },
    (f) => { f.receipt.events.push(structuredClone(f.receipt.events[0]!)); },
    (f) => { f.receipt.events[1]!.keys[3] = hex(noteId + 1n); },
    (f) => { f.receipt.events.reverse(); },
    (f) => { f.callback.calldata[1] = hex(reservationId + 1n); },
    (f) => { f.pull.calldata[1] = hex(manifest.poolAddress + 1n); },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f);
    const report = await readCollectionReceipt(f.reader, manifest, transactionHash);
    assert.equal(report.status, 'mismatch');
  }
});

test('T-017 verifier pins VowVault and pool classes at the receipt block', async () => {
  for (const target of [manifest.vaultAddress, manifest.poolAddress]) {
    const f = fixture();
    const report = await readCollectionReceipt({ request: async (method, params) => {
      if (method === 'starknet_getClassHashAt' && (params as { contract_address: string }).contract_address === hex(target)) return '0x999';
      return f.reader.request(method, params);
    } }, manifest, transactionHash);
    assert.equal(report.status, 'mismatch'); assert.equal(report.reason, 'VOW_CLASS_CHANGED');
  }
});
