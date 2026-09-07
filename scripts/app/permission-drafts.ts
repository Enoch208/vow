import { bounded, felt, parsePublicInteger, U128_MAX, U64_MAX } from '../../packages/vow-sdk/src/integers.ts';
import { PERMISSION_SLOTS, encodePermission } from '../../packages/vow-sdk/src/permissions.ts';
import type { PermissionRequest } from '../../packages/vow-sdk/src/permission-set.ts';
import { isStarkPublicKey } from '../../packages/vow-sdk/src/operator-key.ts';

const DRAFT_FIELDS = ['supplierClaimPublicKey', 'maximumAmount', 'validAfter', 'approveBefore', 'claimBefore', 'purchaseCommitment'] as const;

export interface DraftContext {
  readonly chainId: bigint;
  readonly vaultAddress: bigint;
  readonly mandateId: bigint;
  readonly token: bigint;
  readonly expiresAt: bigint;
}

export function parsePermissionDrafts(text: unknown, context: DraftContext): PermissionRequest[] {
  if (typeof text !== 'string' || text.length > 32_768) throw new Error('VOW_INVALID_PERMISSION_DRAFT');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('VOW_INVALID_PERMISSION_DRAFT'); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > PERMISSION_SLOTS) throw new Error('VOW_INVALID_PERMISSION_COUNT');
  return parsed.map((entry: unknown, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== DRAFT_FIELDS.length ||
        Object.keys(entry).some((key) => !DRAFT_FIELDS.some((field) => field === key))) throw new Error('VOW_INVALID_PERMISSION_DRAFT');
    const draft = entry as Record<string, unknown>;
    const value = (field: typeof DRAFT_FIELDS[number]) => {
      try { return parsePublicInteger(draft[field]); } catch { throw new Error('VOW_INVALID_PERMISSION_DRAFT'); }
    };
    const supplierClaimPublicKey = felt(value('supplierClaimPublicKey'), 'SUPPLIER_KEY', 1n);
    if (!isStarkPublicKey(supplierClaimPublicKey)) throw new Error('VOW_INVALID_SUPPLIER_KEY');
    const claimBefore = bounded(value('claimBefore'), U64_MAX, 'CLAIM_BEFORE', 1n);
    if (claimBefore > context.expiresAt) throw new Error('VOW_PERMISSION_OUTLIVES_MANDATE');
    const request: PermissionRequest = { schemaVersion: 1n, chainId: context.chainId, vaultAddress: context.vaultAddress,
      mandateId: context.mandateId, permissionId: BigInt(index), supplierClaimPublicKey, token: context.token,
      maximumAmount: bounded(value('maximumAmount'), U128_MAX, 'MAXIMUM_AMOUNT', 1n), validAfter: value('validAfter'),
      approveBefore: value('approveBefore'), claimBefore, purchaseCommitment: felt(value('purchaseCommitment'), 'PURCHASE_COMMITMENT') };
    encodePermission({ ...request, salt: 1n });
    return request;
  });
}
