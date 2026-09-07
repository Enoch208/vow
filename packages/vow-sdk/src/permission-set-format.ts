import { felt } from './integers.ts';
import type { PermissionLeaf } from './permissions.ts';
import type { PermissionSetInput } from './permission-set.ts';

const PLAINTEXT_FORMAT = 'vow-permission-set-v1';
const LEAF_FIELDS = [
  'approveBefore', 'chainId', 'claimBefore', 'mandateId', 'maximumAmount', 'permissionId',
  'purchaseCommitment', 'salt', 'schemaVersion', 'supplierClaimPublicKey', 'token', 'validAfter',
  'vaultAddress',
] as const;

export function serializePlaintext(
  permissions: readonly PermissionLeaf[], paddingSalts: readonly bigint[],
): string {
  return JSON.stringify({
    format: PLAINTEXT_FORMAT,
    permissions: permissions.map(
      (leaf) => Object.fromEntries(LEAF_FIELDS.map((field) => [field, hex(leaf[field])])),
    ),
    paddingSalts: paddingSalts.map(hex),
  });
}

export function parsePlaintext(text: string): PermissionSetInput {
  if (text.length > 65_536) throw new Error('VOW_INVALID_PERMISSION_SET');
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new Error('VOW_INVALID_PERMISSION_SET'); }
  const value = record(input);
  if (Object.keys(value).sort().join(',') !== 'format,paddingSalts,permissions'
    || value.format !== PLAINTEXT_FORMAT) throw new Error('VOW_INVALID_PERMISSION_SET');
  if (!Array.isArray(value.permissions) || !Array.isArray(value.paddingSalts)) {
    throw new Error('VOW_INVALID_PERMISSION_SET');
  }
  return {
    permissions: value.permissions.map(parseLeaf), paddingSalts: value.paddingSalts.map(parseFelt),
  };
}

function parseLeaf(input: unknown): PermissionLeaf {
  const value = record(input);
  if (Object.keys(value).sort().join(',') !== LEAF_FIELDS.join(',')) {
    throw new Error('VOW_INVALID_PERMISSION_SET');
  }
  const read = (field: typeof LEAF_FIELDS[number]) => parseFelt(value[field]);
  return {
    schemaVersion: read('schemaVersion'), chainId: read('chainId'), vaultAddress: read('vaultAddress'),
    mandateId: read('mandateId'), permissionId: read('permissionId'),
    supplierClaimPublicKey: read('supplierClaimPublicKey'), token: read('token'),
    maximumAmount: read('maximumAmount'), validAfter: read('validAfter'),
    approveBefore: read('approveBefore'), claimBefore: read('claimBefore'),
    purchaseCommitment: read('purchaseCommitment'), salt: read('salt'),
  };
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('VOW_INVALID_PERMISSION_SET');
  }
  return input as Record<string, unknown>;
}

function parseFelt(input: unknown): bigint {
  if (typeof input !== 'string' || !/^0x[0-9a-f]{1,63}$/.test(input)) {
    throw new Error('VOW_INVALID_PERMISSION_SET');
  }
  return felt(BigInt(input), 'PERMISSION_SET_FELT');
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
