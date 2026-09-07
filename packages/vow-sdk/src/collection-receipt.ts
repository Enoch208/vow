import { hash } from 'starknet';
import { address, felt } from './integers.ts';
import type { ProbeConfiguration } from './probe-snapshot.ts';
import { validateProbeConfiguration } from './probe-snapshot.ts';
import { POOL_CLASS_HASH } from './prepared-claim.ts';
import type { PublicReader } from './probe-reader.ts';
import { PublicReadError } from './probe-reader.ts';
import { equalFelts, receiptFelt, receiptFelts, receiptRecord } from './receipt-values.ts';
import { assertCollectionEvents } from './collection-receipt-events.ts';
import { assertCollectionTrace } from './collection-trace.ts';
import type { VaultDeploymentManifest } from './vault-collection.ts';
import { readVaultCollectionReceipt } from './vault-collection-receipt.ts';
import type { VaultCollectionReceiptReport } from './vault-collection-receipt.ts';

export interface CollectionReceiptReport {
  readonly transactionHash: bigint;
  readonly status: 'unknown' | 'reverted' | 'mismatch' | 'receipt-matched' | 'confirmed';
  readonly reason: string;
  readonly blockHash: bigint | null;
  readonly finality: 'ACCEPTED_ON_L1' | 'ACCEPTED_ON_L2' | null;
  readonly events: 'matched' | 'unverified';
  readonly callPath: 'matched' | 'unverified' | 'mismatch';
  readonly noteOwnership: 'unverified';
  readonly retryAllowed: false;
  readonly source: 'single-rpc-observation';
}

export function readCollectionReceipt(reader: PublicReader, configuration: ProbeConfiguration, transactionHash: bigint, noteId: bigint): Promise<CollectionReceiptReport>;
export function readCollectionReceipt(reader: PublicReader, configuration: VaultDeploymentManifest, transactionHash: bigint): Promise<VaultCollectionReceiptReport>;
export async function readCollectionReceipt(reader: PublicReader, configuration: ProbeConfiguration | VaultDeploymentManifest, transactionHash: bigint, noteId?: bigint): Promise<CollectionReceiptReport | VaultCollectionReceiptReport> {
  if ('vaultClassHash' in configuration) return readVaultCollectionReceipt(reader, configuration, transactionHash);
  if (noteId === undefined) throw new Error('VOW_NOTE_ID_REQUIRED');
  return readProbeCollectionReceipt(reader, configuration, transactionHash, noteId);
}

async function readProbeCollectionReceipt(reader: PublicReader, configuration: ProbeConfiguration, transactionHash: bigint, noteId: bigint): Promise<CollectionReceiptReport> {
  const config = Object.freeze({ ...configuration });
  validateProbeConfiguration(config);
  felt(transactionHash, 'TRANSACTION_HASH', 1n);
  felt(noteId, 'NOTE_ID', 1n);
  const report: CollectionReceiptReport = { transactionHash, status: 'unknown', reason: 'VOW_RECEIPT_UNAVAILABLE', blockHash: null,
    finality: null, events: 'unverified', callPath: 'unverified', noteOwnership: 'unverified', retryAllowed: false, source: 'single-rpc-observation' };
  try {
    if (receiptFelt(await reader.request('starknet_chainId', [])) !== config.chainId) throw new Error('VOW_WRONG_CHAIN');
    const receipt = receiptRecord(await reader.request('starknet_getTransactionReceipt', { transaction_hash: hex(transactionHash) }));
    if (receiptFelt(receipt.transaction_hash) !== transactionHash || receipt.type !== 'INVOKE') throw new Error('VOW_TRANSACTION_MISMATCH');
    if (receipt.finality_status !== 'ACCEPTED_ON_L1' && receipt.finality_status !== 'ACCEPTED_ON_L2') return { ...report, reason: 'VOW_NOT_ACCEPTED' };
    if (receipt.block_hash === undefined) return { ...report, reason: 'VOW_BLOCK_UNAVAILABLE' };
    const blockHash = felt(receiptFelt(receipt.block_hash), 'BLOCK_HASH', 1n);
    const blockNumber = receipt.block_number;
    if (typeof blockNumber !== 'number' || !Number.isSafeInteger(blockNumber) || blockNumber < 0) throw new Error('VOW_INVALID_RECEIPT_DATA');
    const atBlock: CollectionReceiptReport = { ...report, blockHash, finality: receipt.finality_status };
    const checkBlock = async () => {
      const block = receiptRecord(await reader.request('starknet_getBlockWithTxHashes', { block_id: { block_number: blockNumber } }));
      if (receiptFelt(block.block_hash) !== blockHash || block.block_number !== blockNumber ||
          (block.status !== 'ACCEPTED_ON_L1' && block.status !== 'ACCEPTED_ON_L2') ||
          receiptFelts(block.transactions, 100_000).filter((value) => value === transactionHash).length !== 1) throw new Error('VOW_BLOCK_CHANGED');
      if (typeof block.timestamp !== 'number' || !Number.isSafeInteger(block.timestamp) || block.timestamp < 0) throw new Error('VOW_INVALID_RECEIPT_DATA');
      return BigInt(block.timestamp);
    };
    const timestamp = await checkBlock();
    if (receipt.execution_status === 'REVERTED') return { ...atBlock, status: 'reverted', reason: 'VOW_TRANSACTION_REVERTED' };
    if (receipt.execution_status !== 'SUCCEEDED') return { ...atBlock, reason: 'VOW_EXECUTION_UNVERIFIED' };
    if (timestamp >= config.signatureDeadline || timestamp >= config.claimBefore) throw new Error('VOW_CLAIM_EXPIRED');
    assertCollectionEvents(receipt.events, config, noteId);
    const blockId = { block_hash: hex(blockHash) };
    const classAt = async (target: bigint) => receiptFelt(await reader.request('starknet_getClassHashAt', { block_id: blockId, contract_address: hex(target) }));
    const call = (name: string) => reader.request('starknet_call', { block_id: blockId, request: {
      contract_address: hex(config.vaultAddress), entry_point_selector: hash.getSelectorFromName(name), calldata: [],
    } });
    const [probeClass, poolClass, termsRaw, stateRaw] = await Promise.all([classAt(config.vaultAddress), classAt(config.poolAddress), call('configuration'), call('state')]);
    if (probeClass !== config.probeClassHash || poolClass !== POOL_CLASS_HASH) throw new Error('VOW_CLASS_CHANGED');
    const terms = receiptFelts(termsRaw, 6);
    if (terms.length !== 6 || !equalFelts(terms.slice(1), [config.poolAddress, config.token, config.supplierKey, config.amount, config.claimBefore]) ||
        !equalFelts(receiptFelts(stateRaw, 1), [2n])) throw new Error('VOW_CONFIGURATION_CHANGED');
    address(terms[0]!, 'OWNER');
    const matched = { ...atBlock, events: 'matched' as const };
    let trace: unknown;
    try { trace = await reader.request('starknet_traceTransaction', { transaction_hash: hex(transactionHash) }); }
    catch { await checkBlock(); return { ...matched, status: 'receipt-matched', reason: 'VOW_TRACE_UNAVAILABLE' }; }
    try { assertCollectionTrace(trace, config, noteId); }
    catch { await checkBlock(); return { ...matched, status: 'mismatch', callPath: 'mismatch', reason: 'VOW_TRACE_MISMATCH' }; }
    await checkBlock();
    return { ...matched, status: 'confirmed', callPath: 'matched', reason: 'VOW_COLLECTION_CONFIRMED' };
  } catch (error: unknown) {
    if (error instanceof PublicReadError) return report;
    const reason = error instanceof Error && /^VOW_[A-Z_]+$/.test(error.message) ? error.message : 'VOW_INVALID_RECEIPT_DATA';
    return { ...report, status: reason === 'VOW_BLOCK_CHANGED' ? 'unknown' : 'mismatch', reason };
  }
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
