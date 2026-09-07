import { encodeClaim, hashClaim } from '../../packages/vow-sdk/src/claims.ts';
import type { ClaimAuthorization } from '../../packages/vow-sdk/src/claims.ts';
import { parsePublicInteger } from '../collection/configuration.ts';

const fields = ['chainId', 'vaultAddress', 'mandateId', 'reservationId', 'token', 'amount', 'outputNoteId', 'signatureDeadline'] as const;

export function parseClaimReview(text: string, now: bigint): { readonly claim: Readonly<ClaimAuthorization>; readonly supplierKey: bigint } {
  if (text.length > 8192) throw new Error('VOW_INVALID_CLAIM');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('VOW_INVALID_CLAIM'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('VOW_INVALID_CLAIM');
  const input = parsed as Record<string, unknown>;
  if (!input.claim || typeof input.claim !== 'object' || Array.isArray(input.claim)) throw new Error('VOW_INVALID_CLAIM');
  const values = input.claim as Record<string, unknown>;
  if (Object.keys(values).sort().join(',') !== [...fields].sort().join(',')) throw new Error('VOW_INVALID_CLAIM');
  if (Object.keys(input).some((key) => !['claim', 'digest', 'blockHash', 'recipient', 'supplierKey'].includes(key))) throw new Error('VOW_INVALID_CLAIM');
  const claim = Object.fromEntries(fields.map((field) => [field, parsePublicInteger(values[field])])) as unknown as ClaimAuthorization;
  encodeClaim(claim);
  if (claim.chainId !== 0x534e5f4d41494en || claim.mandateId !== 1n || claim.reservationId !== 1n) throw new Error('VOW_WRONG_CLAIM_CONTEXT');
  if (now >= claim.signatureDeadline) throw new Error('VOW_CLAIM_EXPIRED');
  if (hashClaim(claim) !== parsePublicInteger(input.digest)) throw new Error('VOW_CLAIM_DIGEST_MISMATCH');
  const supplierKey = parsePublicInteger(input.supplierKey);
  if (supplierKey === 0n) throw new Error('VOW_WRONG_SUPPLIER_KEY');
  return Object.freeze({ claim: Object.freeze(claim), supplierKey });
}
