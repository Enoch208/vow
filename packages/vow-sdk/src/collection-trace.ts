import { hash } from 'starknet';
import type { ProbeConfiguration } from './probe-snapshot.ts';
import type { VaultDeploymentManifest, VaultReservation } from './vault-collection.ts';
import { POOL_CLASS_HASH } from './prepared-claim.ts';
import { equalFelts, receiptFelt, receiptFelts, receiptRecord } from './receipt-values.ts';

export function assertCollectionTrace(raw: unknown, config: ProbeConfiguration, noteId: bigint): void {
  const trace = receiptRecord(raw);
  if (trace.type !== 'INVOKE') throw new Error('VOW_TRACE_MISMATCH');
  const callbackSelector = BigInt(hash.getSelectorFromName('privacy_invoke'));
  const transferSelectors = ['transfer_from', 'transferFrom'].map((name) => BigInt(hash.getSelectorFromName(name)));
  const invokeSelector = BigInt(hash.getSelectorFromName('apply_actions'));
  let count = 0;
  let matched = 0;
  const walk = (rawCall: unknown, parent: Record<string, unknown> | null, depth: number): void => {
    if (++count > 4096 || depth > 64) throw new Error('VOW_INVALID_TRACE_DATA');
    const call = receiptRecord(rawCall);
    const target = receiptFelt(call.contract_address);
    const selector = receiptFelt(call.entry_point_selector);
    if (!Array.isArray(call.calls)) throw new Error('VOW_INVALID_TRACE_DATA');
    if (target === config.vaultAddress && selector === callbackSelector) {
      if (++matched !== 1 || !parent || call.call_type !== 'CALL' || call.entry_point_type !== 'EXTERNAL' ||
          receiptFelt(call.caller_address) !== config.poolAddress || receiptFelt(call.class_hash) !== config.probeClassHash ||
          receiptFelt(parent.contract_address) !== config.poolAddress || receiptFelt(parent.class_hash) !== POOL_CLASS_HASH ||
          receiptFelt(parent.entry_point_selector) !== invokeSelector || parent.call_type !== 'CALL') throw new Error('VOW_TRACE_MISMATCH');
      const calldata = receiptFelts(call.calldata, 6);
      if (calldata.length !== 6 || !equalFelts(calldata.slice(0, 4), [0x434c41494dn, 1n, noteId, config.signatureDeadline]) ||
          calldata[4] === 0n || calldata[5] === 0n || !equalFelts(receiptFelts(call.result, 4), [1n, noteId, config.token, config.amount])) {
        throw new Error('VOW_TRACE_MISMATCH');
      }
      const siblings = parent.calls;
      if (!Array.isArray(siblings)) throw new Error('VOW_INVALID_TRACE_DATA');
      const pulls = siblings.map(receiptRecord).filter((sibling) => receiptFelt(sibling.contract_address) === config.token &&
        transferSelectors.includes(receiptFelt(sibling.entry_point_selector)) && receiptFelts(sibling.calldata, 4096)[0] === config.vaultAddress);
      if (pulls.length !== 1) throw new Error('VOW_TRACE_MISMATCH');
      const pull = pulls[0]!;
      if (siblings.indexOf(pull) <= siblings.indexOf(call) || pull.call_type !== 'CALL' || pull.entry_point_type !== 'EXTERNAL' ||
          receiptFelt(pull.caller_address) !== config.poolAddress || !equalFelts(receiptFelts(pull.calldata, 4), [config.vaultAddress, config.poolAddress, config.amount, 0n]) ||
          !equalFelts(receiptFelts(pull.result, 1), [1n])) throw new Error('VOW_TRACE_MISMATCH');
    }
    for (const nested of call.calls) walk(nested, call, depth + 1);
  };
  walk(trace.execute_invocation, null, 0);
  if (matched !== 1) throw new Error('VOW_TRACE_MISMATCH');
}

export function assertVaultCollectionTrace(raw: unknown, manifest: VaultDeploymentManifest, reservation: VaultReservation, noteId: bigint, timestamp: bigint): bigint {
  const trace = receiptRecord(raw);
  if (trace.type !== 'INVOKE') throw new Error('VOW_TRACE_MISMATCH');
  const callbackSelector = BigInt(hash.getSelectorFromName('privacy_invoke'));
  const transferSelectors = ['transfer_from', 'transferFrom'].map((name) => BigInt(hash.getSelectorFromName(name)));
  const invokeSelector = BigInt(hash.getSelectorFromName('apply_actions'));
  let count = 0;
  let matched = 0;
  let signatureDeadline = 0n;
  const walk = (rawCall: unknown, parent: Record<string, unknown> | null, depth: number): void => {
    if (++count > 4096 || depth > 64) throw new Error('VOW_INVALID_TRACE_DATA');
    const call = receiptRecord(rawCall);
    const target = receiptFelt(call.contract_address);
    const selector = receiptFelt(call.entry_point_selector);
    if (!Array.isArray(call.calls)) throw new Error('VOW_INVALID_TRACE_DATA');
    if (target === manifest.vaultAddress && selector === callbackSelector) {
      const calldata = receiptFelts(call.calldata, 6);
      if (++matched !== 1 || !parent || call.call_type !== 'CALL' || call.entry_point_type !== 'EXTERNAL' ||
          receiptFelt(call.caller_address) !== manifest.poolAddress || receiptFelt(call.class_hash) !== manifest.vaultClassHash ||
          receiptFelt(parent.contract_address) !== manifest.poolAddress || receiptFelt(parent.class_hash) !== manifest.poolClassHash ||
          receiptFelt(parent.entry_point_selector) !== invokeSelector || parent.call_type !== 'CALL' || calldata.length !== 6 ||
          !equalFelts(calldata.slice(0, 3), [0x434c41494dn, reservation.reservationId, noteId]) || calldata[3] === 0n ||
          calldata[4] === 0n || calldata[5] === 0n || calldata[3]! > reservation.claimBefore || timestamp >= calldata[3]! ||
          !equalFelts(receiptFelts(call.result, 4), [1n, noteId, reservation.token, reservation.amount])) throw new Error('VOW_TRACE_MISMATCH');
      signatureDeadline = calldata[3]!;
      const siblings = parent.calls;
      if (!Array.isArray(siblings)) throw new Error('VOW_INVALID_TRACE_DATA');
      const pulls = siblings.map(receiptRecord).filter((sibling) => receiptFelt(sibling.contract_address) === reservation.token &&
        transferSelectors.includes(receiptFelt(sibling.entry_point_selector)) && receiptFelts(sibling.calldata, 4096)[0] === manifest.vaultAddress);
      if (pulls.length !== 1) throw new Error('VOW_TRACE_MISMATCH');
      const pull = pulls[0]!;
      if (siblings.indexOf(pull) <= siblings.indexOf(call) || pull.call_type !== 'CALL' || pull.entry_point_type !== 'EXTERNAL' ||
          receiptFelt(pull.caller_address) !== manifest.poolAddress || !equalFelts(receiptFelts(pull.calldata, 4), [manifest.vaultAddress, manifest.poolAddress, reservation.amount, 0n]) ||
          !equalFelts(receiptFelts(pull.result, 1), [1n])) throw new Error('VOW_TRACE_MISMATCH');
    }
    for (const nested of call.calls) walk(nested, call, depth + 1);
  };
  walk(trace.execute_invocation, null, 0);
  if (matched !== 1) throw new Error('VOW_TRACE_MISMATCH');
  return signatureDeadline;
}
