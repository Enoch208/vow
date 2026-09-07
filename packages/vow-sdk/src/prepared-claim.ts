import { hash, shortString } from 'starknet';
import type { STRK20_ACTION } from 'starknet';
import { encodeClaim } from './claims.ts';
import type { ClaimAuthorization, ClaimSignature } from './claims.ts';
import { address, felt } from './integers.ts';
import { decodePoolActions } from './pool-calldata.ts';

export const POOL_CLASS_HASH = 0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554dn;
const CLAIM_OPERATION = BigInt(shortString.encodeShortString('CLAIM'));

export interface ProbeClaimExpectation {
  readonly poolAddress: bigint;
  readonly observedPoolClassHash: bigint;
  readonly claim: ClaimAuthorization;
  readonly feeToken: bigint;
  readonly feeCollector: bigint;
  readonly maximumFee: bigint;
}

export interface PreparedClaimExpectation extends ProbeClaimExpectation {}

export function decodePreparedClaim(
  prepared: unknown, expected: PreparedClaimExpectation, signature?: ClaimSignature,
): ClaimAuthorization {
  encodeClaim(expected.claim);
  address(expected.poolAddress, 'POOL');
  if (expected.observedPoolClassHash !== POOL_CLASS_HASH) throw new Error('VOW_POOL_CLASS_CHANGED');
  const result = record(prepared);
  const call = record(result.call);
  if (asFelt(call.contract_address) !== expected.poolAddress) throw new Error('VOW_BAD_POOL');
  if (call.entry_point !== 'apply_actions' && asFelt(call.entry_point) !== BigInt(hash.getSelectorFromName('apply_actions'))) {
    throw new Error('VOW_BAD_SELECTOR');
  }
  const actions = decodePoolActions(call.calldata);
  const notes = actions.filter((action) => action.kind === 'openNote');
  const invokes = actions.filter((action) => action.kind === 'invoke');
  if (notes.length !== 1 || invokes.length !== 1) throw new Error('VOW_AMBIGUOUS_COLLECTION');
  const note = notes[0]!;
  const invoke = invokes[0]!;
  if (invoke.kind !== 'invoke') throw new Error('VOW_AMBIGUOUS_COLLECTION');
  if (note.token !== expected.claim.token || invoke.target !== expected.claim.vaultAddress) throw new Error('VOW_TARGET_MISMATCH');
  const required = [CLAIM_OPERATION, expected.claim.reservationId, note.note, expected.claim.signatureDeadline, signature?.r ?? 0n, signature?.s ?? 0n];
  if (invoke.calldata.length !== required.length || required.some((value, i) => invoke.calldata[i] !== value)) {
    throw new Error('VOW_CLAIM_CALL_MISMATCH');
  }
  if (signature && note.note !== expected.claim.outputNoteId) throw new Error('VOW_NOTE_CHANGED');
  let fee = 0n;
  for (const action of actions) {
    if (action.kind === 'transferTo') {
      if (action.token !== expected.feeToken || action.recipient !== expected.feeCollector) throw new Error('VOW_UNEXPECTED_TRANSFER');
      fee += action.amount;
    } else if (['transferFrom', 'deposit', 'withdrawal', 'computation', 'viewingKey'].includes(action.kind)) {
      throw new Error('VOW_UNEXPECTED_ACTION');
    }
  }
  if (expected.maximumFee < 0n || fee > expected.maximumFee) throw new Error('VOW_FEE_LIMIT');
  return { ...expected.claim, outputNoteId: note.note };
}

export function decodePreparedProbeClaim(
  prepared: unknown, expected: ProbeClaimExpectation, signature?: ClaimSignature,
): ClaimAuthorization {
  if (expected.claim.mandateId !== 1n || expected.claim.reservationId !== 1n) throw new Error('VOW_PROBE_IDS');
  return decodePreparedClaim(prepared, expected, signature);
}

export function buildClaimActions(
  claim: ClaimAuthorization, recipient: bigint, signature?: ClaimSignature,
): STRK20_ACTION[] {
  encodeClaim(claim);
  address(recipient, 'RECIPIENT');
  return [
    { type: 'transfer', token: hex(claim.token), amount: 'OPEN', recipient: hex(recipient) },
    { type: 'invoke', contract: hex(claim.vaultAddress), calldata: [
      hex(CLAIM_OPERATION), hex(claim.reservationId),
      '${openNoteIds[0]}',
      hex(claim.signatureDeadline), hex(signature?.r ?? 0n), hex(signature?.s ?? 0n),
    ] },
  ];
}

export function buildProbeClaimActions(
  claim: ClaimAuthorization, recipient: bigint, signature?: ClaimSignature,
): STRK20_ACTION[] {
  if (claim.mandateId !== 1n || claim.reservationId !== 1n) throw new Error('VOW_PROBE_IDS');
  return buildClaimActions(claim, recipient, signature);
}

function record(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('VOW_MALFORMED_PREPARATION');
  return input as Record<string, unknown>;
}

function asFelt(input: unknown): bigint {
  if (typeof input !== 'string' || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(input) || input.length > 80) throw new Error('VOW_INVALID_FELT');
  return felt(BigInt(input), 'FELT');
}

function hex(input: bigint): string { return `0x${felt(input, 'FELT').toString(16)}`; }
