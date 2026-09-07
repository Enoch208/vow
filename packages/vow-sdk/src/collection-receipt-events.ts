import { hash } from 'starknet';
import type { ProbeConfiguration } from './probe-snapshot.ts';
import { equalFelts, receiptFelt, receiptFelts, receiptRecord } from './receipt-values.ts';

export function assertCollectionEvents(raw: unknown, config: ProbeConfiguration, noteId: bigint): void {
  if (!Array.isArray(raw) || raw.length > 4096) throw new Error('VOW_INVALID_RECEIPT_DATA');
  const collected = BigInt(hash.getSelectorFromName('Collected'));
  const deposited = BigInt(hash.getSelectorFromName('OpenNoteDeposited'));
  let collectedIndex = -1;
  let depositedIndex = -1;
  for (const [index, input] of raw.entries()) {
    const event = receiptRecord(input);
    const from = receiptFelt(event.from_address);
    const keys = receiptFelts(event.keys, 64);
    if (from === config.vaultAddress && keys[0] === collected) {
      if (collectedIndex !== -1 || !equalFelts(keys, [collected]) || !equalFelts(receiptFelts(event.data, 2), [noteId, config.amount])) {
        throw new Error('VOW_COLLECTION_EVENT_MISMATCH');
      }
      collectedIndex = index;
    }
    if (from === config.poolAddress && keys[0] === deposited && (keys[1] === config.vaultAddress || keys[3] === noteId)) {
      if (depositedIndex !== -1 || !equalFelts(keys, [deposited, config.vaultAddress, config.token, noteId]) || !equalFelts(receiptFelts(event.data, 1), [config.amount])) {
        throw new Error('VOW_POOL_EVENT_MISMATCH');
      }
      depositedIndex = index;
    }
  }
  if (collectedIndex < 0 || depositedIndex <= collectedIndex) throw new Error('VOW_COLLECTION_EVENTS_MISSING');
}
