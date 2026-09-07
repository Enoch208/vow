import { hash } from 'starknet';
import { bounded, felt, U128_MAX, U64_MAX } from './integers.ts';
import { retainPreparedProof } from './prepared-proof.ts';
import type { PreparedCollection } from './prepared-proof.ts';
import type { ProbeConfiguration } from './probe-snapshot.ts';
import { validateProbeConfiguration } from './probe-snapshot.ts';
import { decodePreparedClaim, POOL_CLASS_HASH } from './prepared-claim.ts';
import type { VaultCollectionConfiguration } from './vault-collection.ts';
import { validateVaultCollectionConfiguration } from './vault-collection.ts';
import { hashClaim, verifyClaimSignature } from './claims.ts';
import type { ClaimAuthorization, ClaimSignature } from './claims.ts';

export interface PreparedSubmissionRequest {
  readonly type: 'wallet_addInvokeTransaction';
  readonly params: {
    readonly api_version: '0.10.3';
    readonly invoke_transaction: readonly PreparedCollection['call'][];
    readonly proof: PreparedCollection['proof'];
  };
}

export async function reviewCollectionSubmission(input: unknown, configuration: ProbeConfiguration | VaultCollectionConfiguration, noteId: bigint,
  signature: ClaimSignature, maximumNetworkFeeSTRK: bigint, now: bigint) {
  const config = Object.freeze({ ...configuration });
  const vaultMode = 'vaultClassHash' in config;
  if (vaultMode) validateVaultCollectionConfiguration(config as VaultCollectionConfiguration);
  else validateProbeConfiguration(config as ProbeConfiguration);
  felt(noteId, 'NOTE_ID', 1n);
  bounded(maximumNetworkFeeSTRK, U128_MAX, 'NETWORK_FEE_CAP', 1n); bounded(now, U64_MAX, 'NOW');
  if (now >= config.signatureDeadline) throw new Error('VOW_CLAIM_EXPIRED');
  const claim: ClaimAuthorization = { chainId: config.chainId, vaultAddress: config.vaultAddress,
    mandateId: vaultMode ? (config as VaultCollectionConfiguration).mandateId : 1n,
    reservationId: vaultMode ? (config as VaultCollectionConfiguration).reservationId : 1n,
    token: config.token, amount: config.amount, outputNoteId: noteId, signatureDeadline: config.signatureDeadline };
  const supplied = { r: signature.r, s: signature.s };
  if (!verifyClaimSignature(claim, supplied, config.supplierKey)) throw new Error('VOW_BAD_SUPPLIER_SIGNATURE');
  const retained = retainPreparedProof(input);
  if (!retained.proof.output.length || !retained.proof.proof_facts.length) throw new Error('VOW_EMPTY_PROOF_MATERIAL');
  const maximumFee = vaultMode ? (config as VaultCollectionConfiguration).maximumProtocolFee : (config as ProbeConfiguration).maximumFee;
  const contractClassHash = vaultMode ? (config as VaultCollectionConfiguration).vaultClassHash : (config as ProbeConfiguration).probeClassHash;
  decodePreparedClaim(retained, { claim, poolAddress: config.poolAddress, observedPoolClassHash: POOL_CLASS_HASH,
    feeToken: config.feeToken, feeCollector: config.feeCollector, maximumFee }, supplied);
  const request: PreparedSubmissionRequest = { type: 'wallet_addInvokeTransaction', params: { api_version: '0.10.3',
    invoke_transaction: [{ contract_address: hex(config.poolAddress), entry_point: hash.getSelectorFromName('apply_actions'), calldata: retained.call.calldata.map((value) => hex(BigInt(value))) }],
    proof: { data: retained.proof.data, output: retained.proof.output.map((value) => hex(BigInt(value))), proof_facts: retained.proof.proof_facts.map((value) => hex(BigInt(value))) } } };
  const fingerprint = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(request))));
  const payloadSha256 = Array.from(fingerprint, (value) => value.toString(16).padStart(2, '0')).join('');
  const expiresAt = now + 300n < config.signatureDeadline ? now + 300n : config.signatureDeadline;
  const reviewDigest = BigInt(hash.computePoseidonHashOnElements([0x564f575f5355424d49545f5631n, hashClaim(claim), contractClassHash,
    config.poolAddress, config.recipient, config.feeToken, config.feeCollector, maximumFee, maximumNetworkFeeSTRK, expiresAt,
    BigInt(`0x${payloadSha256.slice(0, 32)}`), BigInt(`0x${payloadSha256.slice(32)}`)]));
  let consumed = false;
  let payload: PreparedSubmissionRequest | null = request;
  return Object.freeze({ review: Object.freeze({ status: 'review-only' as const, claim: Object.freeze(claim), reviewDigest, payloadSha256,
    expiresAt, maximumNetworkFeeSTRK, maximumPreparedFee: maximumFee, feeToken: config.feeToken,
    networkFeeEnforcement: 'manual-wallet-confirmation' as const, totalBudget: 'not-assessed' as const }),
    take(approvedReviewDigest: bigint, at: bigint): PreparedSubmissionRequest {
      bounded(at, U64_MAX, 'NOW');
      if (consumed || !payload) throw new Error('VOW_SUBMISSION_ALREADY_RELEASED');
      if (at < now || at >= expiresAt) { payload = null; consumed = true; throw new Error('VOW_REVIEW_EXPIRED'); }
      if (approvedReviewDigest !== reviewDigest) throw new Error('VOW_REVIEW_CHANGED');
      const copy = structuredClone(payload); payload = null; consumed = true; return copy;
    },
    discard(): void { payload = null; consumed = true; },
  });
}

function hex(value: bigint): string { return `0x${felt(value, 'SUBMISSION_FELT').toString(16)}`; }
