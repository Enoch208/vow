import { hash } from 'starknet';
import { felt } from './integers.ts';
import type { PublicReader } from './probe-reader.ts';
import { PublicReadError } from './probe-reader.ts';
import { equalFelts, receiptFelt, receiptFelts, receiptRecord } from './receipt-values.ts';
import { assertVaultCollectionTrace } from './collection-trace.ts';
import { decodeReservation, validateVaultDeployment } from './vault-collection.ts';
import type { VaultDeploymentManifest, VaultReservation } from './vault-collection.ts';

export interface VaultCollectionReceiptReport {
  readonly transactionHash: bigint;
  readonly status: 'unknown' | 'reverted' | 'mismatch' | 'receipt-matched' | 'confirmed';
  readonly reason: string;
  readonly blockHash: bigint | null;
  readonly finality: 'ACCEPTED_ON_L1' | 'ACCEPTED_ON_L2' | null;
  readonly events: 'matched' | 'unverified';
  readonly callPath: 'matched' | 'unverified' | 'mismatch';
  readonly vaultClass: 'matched' | 'unverified';
  readonly poolClass: 'matched' | 'unverified';
  readonly claimEvent: 'matched' | 'unverified';
  readonly poolDeposit: 'matched' | 'unverified';
  readonly reservationState: 'matched' | 'unverified';
  readonly tokenPull: 'matched' | 'unverified';
  readonly reservationId: bigint | null;
  readonly mandateId: bigint | null;
  readonly noteId: bigint | null;
  readonly token: bigint | null;
  readonly amount: bigint | null;
  readonly signatureDeadline: bigint | null;
  readonly noteOwnership: 'unverified';
  readonly retryAllowed: false;
  readonly source: 'single-rpc-observation';
}

export async function readVaultCollectionReceipt(reader: PublicReader, deployment: VaultDeploymentManifest, transactionHash: bigint): Promise<VaultCollectionReceiptReport> {
  const manifest = Object.freeze({ ...deployment });
  validateVaultDeployment(manifest);
  felt(transactionHash, 'TRANSACTION_HASH', 1n);
  let report: VaultCollectionReceiptReport = { transactionHash, status: 'unknown', reason: 'VOW_RECEIPT_UNAVAILABLE', blockHash: null,
    finality: null, events: 'unverified', callPath: 'unverified', reservationId: null, mandateId: null, noteId: null, token: null,
    amount: null, signatureDeadline: null, vaultClass: 'unverified', poolClass: 'unverified', claimEvent: 'unverified',
    poolDeposit: 'unverified', reservationState: 'unverified', tokenPull: 'unverified', noteOwnership: 'unverified', retryAllowed: false,
    source: 'single-rpc-observation' };
  try {
    if (receiptFelt(await reader.request('starknet_chainId', [])) !== manifest.chainId) throw new Error('VOW_WRONG_CHAIN');
    const receipt = receiptRecord(await reader.request('starknet_getTransactionReceipt', { transaction_hash: hex(transactionHash) }));
    if (receiptFelt(receipt.transaction_hash) !== transactionHash || receipt.type !== 'INVOKE') throw new Error('VOW_TRANSACTION_MISMATCH');
    if (receipt.finality_status !== 'ACCEPTED_ON_L1' && receipt.finality_status !== 'ACCEPTED_ON_L2') return { ...report, reason: 'VOW_NOT_ACCEPTED' };
    if (receipt.block_hash === undefined) return { ...report, reason: 'VOW_BLOCK_UNAVAILABLE' };
    const blockHash = felt(receiptFelt(receipt.block_hash), 'BLOCK_HASH', 1n);
    const blockNumber = receipt.block_number;
    if (typeof blockNumber !== 'number' || !Number.isSafeInteger(blockNumber) || blockNumber < 0) throw new Error('VOW_INVALID_RECEIPT_DATA');
    const atBlock: VaultCollectionReceiptReport = { ...report, blockHash, finality: receipt.finality_status };
    report = atBlock;
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
    const event = claimedEvent(receipt.events, manifest);
    const identified = { ...atBlock, reservationId: event.reservationId, mandateId: event.mandateId, noteId: event.noteId,
      amount: event.amount, claimEvent: 'matched' as const };
    report = identified;
    const blockId = { block_hash: hex(blockHash) };
    const classAt = async (target: bigint) => receiptFelt(await reader.request('starknet_getClassHashAt', { block_id: blockId, contract_address: hex(target) }));
    const call = async (name: string, calldata: bigint[], maximum: number) => receiptFelts(await reader.request('starknet_call', { block_id: blockId, request: {
      contract_address: hex(manifest.vaultAddress), entry_point_selector: hash.getSelectorFromName(name), calldata: calldata.map(hex),
    } }), maximum);
    const [vaultClass, poolClass, poolRaw, reservationRaw] = await Promise.all([
      classAt(manifest.vaultAddress), classAt(manifest.poolAddress), call('pool', [], 1), call('reservation', [event.reservationId], 9),
    ]);
    if (vaultClass !== manifest.vaultClassHash || poolClass !== manifest.poolClassHash || !equalFelts(poolRaw, [manifest.poolAddress])) throw new Error('VOW_CLASS_CHANGED');
    const classesMatched = { ...identified, vaultClass: 'matched' as const, poolClass: 'matched' as const };
    report = classesMatched;
    const reservation = decodeReservation(event.reservationId, reservationRaw);
    assertClaimedReservation(reservation, event, timestamp);
    report = { ...classesMatched, token: reservation.token, reservationState: 'matched' };
    assertPoolEvent(receipt.events, manifest, reservation, event.noteId, event.index);
    const matched = { ...report, events: 'matched' as const,
      poolDeposit: 'matched' as const };
    report = matched;
    let trace: unknown;
    try { trace = await reader.request('starknet_traceTransaction', { transaction_hash: hex(transactionHash) }); }
    catch (error: unknown) {
      if (!(error instanceof PublicReadError)) throw error;
      await checkBlock();
      return { ...matched, status: 'unknown', reason: 'VOW_TRACE_UNAVAILABLE' };
    }
    let signatureDeadline: bigint;
    try { signatureDeadline = assertVaultCollectionTrace(trace, manifest, reservation, event.noteId, timestamp); }
    catch { await checkBlock(); return { ...matched, status: 'mismatch', callPath: 'mismatch', reason: 'VOW_TRACE_MISMATCH' }; }
    await checkBlock();
    return { ...matched, status: 'confirmed', callPath: 'matched', tokenPull: 'matched', signatureDeadline, reason: 'VOW_COLLECTION_CONFIRMED' };
  } catch (error: unknown) {
    if (error instanceof PublicReadError) return report;
    const reason = error instanceof Error && /^VOW_[A-Z_]+$/.test(error.message) ? error.message : 'VOW_INVALID_RECEIPT_DATA';
    return { ...report, status: reason === 'VOW_BLOCK_CHANGED' ? 'unknown' : 'mismatch', reason };
  }
}

function claimedEvent(raw: unknown, manifest: VaultDeploymentManifest) {
  if (!Array.isArray(raw) || raw.length > 4096) throw new Error('VOW_INVALID_RECEIPT_DATA');
  const selector = BigInt(hash.getSelectorFromName('ReservationClaimed'));
  const matches = raw.map((input, index) => ({ event: receiptRecord(input), index })).filter(({ event }) => receiptFelt(event.from_address) === manifest.vaultAddress && receiptFelts(event.keys, 64)[0] === selector);
  if (matches.length !== 1) throw new Error('VOW_COLLECTION_EVENTS_MISSING');
  const keys = receiptFelts(matches[0]!.event.keys, 3);
  const data = receiptFelts(matches[0]!.event.data, 2);
  if (keys.length !== 3 || data.length !== 2) throw new Error('VOW_COLLECTION_EVENT_MISMATCH');
  return { reservationId: keys[1]!, mandateId: keys[2]!, noteId: data[0]!, amount: data[1]!, index: matches[0]!.index };
}

function assertClaimedReservation(reservation: VaultReservation, event: ReturnType<typeof claimedEvent>, timestamp: bigint): void {
  if (reservation.mandateId !== event.mandateId || reservation.amount !== event.amount || reservation.state !== 2n ||
      event.noteId === 0n || timestamp >= reservation.claimBefore) throw new Error('VOW_RESERVATION_MISMATCH');
}

function assertPoolEvent(raw: unknown, manifest: VaultDeploymentManifest, reservation: VaultReservation, noteId: bigint, claimIndex: number): void {
  if (!Array.isArray(raw)) throw new Error('VOW_INVALID_RECEIPT_DATA');
  const selector = BigInt(hash.getSelectorFromName('OpenNoteDeposited'));
  const matches = raw.map((input, index) => ({ event: receiptRecord(input), index })).filter(({ event }) => receiptFelt(event.from_address) === manifest.poolAddress && receiptFelts(event.keys, 64)[0] === selector &&
    (receiptFelts(event.keys, 64)[1] === manifest.vaultAddress || receiptFelts(event.keys, 64)[3] === noteId));
  if (matches.length !== 1 || matches[0]!.index <= claimIndex) throw new Error('VOW_COLLECTION_EVENTS_MISSING');
  const keys = receiptFelts(matches[0]!.event.keys, 4);
  const data = receiptFelts(matches[0]!.event.data, 1);
  if (!equalFelts(keys, [selector, manifest.vaultAddress, reservation.token, noteId]) || !equalFelts(data, [reservation.amount])) throw new Error('VOW_POOL_EVENT_MISMATCH');
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
