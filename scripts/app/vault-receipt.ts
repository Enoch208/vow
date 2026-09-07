import { hash } from 'starknet';
import { felt } from '../../packages/vow-sdk/src/integers.ts';
import { receiptFelt, receiptFelts, receiptRecord } from '../../packages/vow-sdk/src/receipt-values.ts';
import type { PublicReader } from '../../packages/vow-sdk/src/probe-reader.ts';
import type { VaultDeploymentManifest } from '../../packages/vow-sdk/src/vault-collection.ts';
import type { SettledState } from './write-flow.ts';

export interface VaultWriteReceipt {
  readonly state: SettledState;
  readonly reason: string;
  readonly blockHash: string | null;
  readonly finality: 'ACCEPTED_ON_L1' | 'ACCEPTED_ON_L2' | null;
  readonly vaultEvent: 'matched' | 'unverified';
  readonly retryAllowed: false;
  readonly source: 'single-rpc-observation';
}

export async function readVaultWriteReceipt(reader: PublicReader, manifest: VaultDeploymentManifest,
  transactionHash: bigint, eventName: string): Promise<VaultWriteReceipt> {
  felt(transactionHash, 'TRANSACTION_HASH', 1n);
  const unresolved = (reason: string, blockHash: string | null = null,
    finality: VaultWriteReceipt['finality'] = null): VaultWriteReceipt =>
    Object.freeze({ state: 'UNKNOWN' as const, reason, blockHash, finality, vaultEvent: 'unverified' as const,
      retryAllowed: false as const, source: 'single-rpc-observation' as const });
  try {
    if (receiptFelt(await reader.request('starknet_chainId', [])) !== manifest.chainId) return unresolved('VOW_WRONG_CHAIN');
    const receipt = receiptRecord(await reader.request('starknet_getTransactionReceipt', { transaction_hash: hex(transactionHash) }));
    if (receiptFelt(receipt.transaction_hash) !== transactionHash || receipt.type !== 'INVOKE') return unresolved('VOW_TRANSACTION_MISMATCH');
    if (receipt.finality_status !== 'ACCEPTED_ON_L1' && receipt.finality_status !== 'ACCEPTED_ON_L2') return unresolved('VOW_NOT_ACCEPTED');
    if (receipt.block_hash === undefined) return unresolved('VOW_BLOCK_UNAVAILABLE');
    const blockHash = felt(receiptFelt(receipt.block_hash), 'BLOCK_HASH', 1n);
    const blockNumber = receipt.block_number;
    if (typeof blockNumber !== 'number' || !Number.isSafeInteger(blockNumber) || blockNumber < 0) return unresolved('VOW_INVALID_RECEIPT_DATA');
    const finality = receipt.finality_status;
    const block = receiptRecord(await reader.request('starknet_getBlockWithTxHashes', { block_id: { block_number: blockNumber } }));
    if (receiptFelt(block.block_hash) !== blockHash || block.block_number !== blockNumber ||
        receiptFelts(block.transactions, 100_000).filter((value) => value === transactionHash).length !== 1) {
      return unresolved('VOW_BLOCK_CHANGED', hex(blockHash), finality);
    }
    if (receipt.execution_status === 'REVERTED') {
      return Object.freeze({ state: 'REVERTED' as const, reason: 'VOW_TRANSACTION_REVERTED', blockHash: hex(blockHash), finality,
        vaultEvent: 'unverified' as const, retryAllowed: false as const, source: 'single-rpc-observation' as const });
    }
    if (receipt.execution_status !== 'SUCCEEDED') return unresolved('VOW_EXECUTION_UNVERIFIED', hex(blockHash), finality);
    if (!emitted(receipt.events, manifest.vaultAddress, eventName)) return unresolved('VOW_VAULT_EVENT_MISSING', hex(blockHash), finality);
    return Object.freeze({ state: 'CONFIRMED' as const, reason: `VOW_${eventName.toUpperCase()}_CONFIRMED`, blockHash: hex(blockHash), finality,
      vaultEvent: 'matched' as const, retryAllowed: false as const, source: 'single-rpc-observation' as const });
  } catch { return unresolved('VOW_RECEIPT_UNAVAILABLE'); }
}

function emitted(raw: unknown, vaultAddress: bigint, eventName: string): boolean {
  if (!Array.isArray(raw) || raw.length > 4096) throw new Error('VOW_INVALID_RECEIPT_DATA');
  const selector = BigInt(hash.getSelectorFromName(eventName));
  return raw.some((input: unknown) => {
    const event = receiptRecord(input);
    return receiptFelt(event.from_address) === vaultAddress && receiptFelts(event.keys, 64)[0] === selector;
  });
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
