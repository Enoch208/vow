import { hash } from 'starknet';
import type { PublicReader, PublicReadMethod } from '../../src/probe-reader.ts';
import { POOL_CLASS_HASH } from '../../src/prepared-claim.ts';
import { config } from './collection.ts';

export const receiptConfig = { ...config, chainId: 0x534e5f4d41494en };
export const txHash = 123n;
export const noteId = 456n;
export const hex = (value: bigint) => `0x${value.toString(16)}`;
export const selector = (name: string) => hash.getSelectorFromName(name);

export function receiptFixture() {
  const c = receiptConfig;
  const makeCall = (target: bigint, name: string, args: bigint[], result: bigint[], caller: bigint, classHash: bigint) => ({
    contract_address: hex(target), entry_point_selector: selector(name), calldata: args.map(hex), result: result.map(hex),
    caller_address: hex(caller), class_hash: hex(classHash), call_type: 'CALL', entry_point_type: 'EXTERNAL', calls: [] as unknown[],
  });
  const callback = makeCall(c.vaultAddress, 'privacy_invoke', [0x434c41494dn, 1n, noteId, c.signatureDeadline, 1n, 2n], [1n, noteId, c.token, c.amount], c.poolAddress, c.probeClassHash);
  const pull = makeCall(c.token, 'transfer_from', [c.vaultAddress, c.poolAddress, c.amount, 0n], [1n], c.poolAddress, 789n);
  const pool = { ...makeCall(c.poolAddress, 'apply_actions', [], [], 888n, POOL_CLASS_HASH), calls: [callback, pull] as unknown[] };
  const trace = { type: 'INVOKE', execute_invocation: { ...makeCall(888n, '__execute__', [], [], 0n, 777n), calls: [pool] } };
  const receipt = { type: 'INVOKE', transaction_hash: hex(txHash), block_hash: '0x987', block_number: 50,
    execution_status: 'SUCCEEDED', finality_status: 'ACCEPTED_ON_L2', events: [
      { from_address: hex(c.vaultAddress), keys: [selector('Collected')], data: [noteId, c.amount].map(hex) },
      { from_address: hex(c.poolAddress), keys: [selector('OpenNoteDeposited'), ...[c.vaultAddress, c.token, noteId].map(hex)], data: [hex(c.amount)] },
    ] };
  const block = { block_hash: '0x987', block_number: 50, status: 'ACCEPTED_ON_L2', timestamp: 1000, transactions: [hex(txHash)] };
  const calls: { method: PublicReadMethod; params: unknown }[] = [];
  const reader: PublicReader = { async request(method, params) {
    calls.push({ method, params });
    if (method === 'starknet_chainId') return hex(c.chainId);
    if (method === 'starknet_getTransactionReceipt') return receipt;
    if (method === 'starknet_getBlockWithTxHashes') return block;
    if (method === 'starknet_traceTransaction') return trace;
    if (method === 'starknet_getClassHashAt') return hex((params as { contract_address: string }).contract_address === hex(c.vaultAddress) ? c.probeClassHash : POOL_CLASS_HASH);
    if (method === 'starknet_call') return (params as { request: { entry_point_selector: string } }).request.entry_point_selector === selector('configuration')
      ? [100n, c.poolAddress, c.token, c.supplierKey, c.amount, c.claimBefore].map(hex) : ['0x2'];
    throw new Error('UNEXPECTED_TEST_REQUEST');
  } };
  return { reader, receipt, block, trace, callback, pull, pool, calls };
}
