import { hash, shortString } from 'starknet';
import { address, bounded, felt, U128_MAX, U64_MAX } from './integers.ts';

export const PERMISSION_DOMAIN = BigInt(shortString.encodeShortString('VOW_PERMISSION_V1'));
export const PERMISSION_TREE_DEPTH = 4;
export const PERMISSION_SLOTS = 1 << PERMISSION_TREE_DEPTH;

export interface PermissionLeaf {
  readonly schemaVersion: bigint;
  readonly chainId: bigint;
  readonly vaultAddress: bigint;
  readonly mandateId: bigint;
  readonly permissionId: bigint;
  readonly supplierClaimPublicKey: bigint;
  readonly token: bigint;
  readonly maximumAmount: bigint;
  readonly validAfter: bigint;
  readonly approveBefore: bigint;
  readonly claimBefore: bigint;
  readonly purchaseCommitment: bigint;
  readonly salt: bigint;
}

export function encodePermission(leaf: PermissionLeaf): bigint[] {
  const permissionId = bounded(leaf.permissionId, BigInt(PERMISSION_SLOTS - 1), 'PERMISSION_ID');
  const validAfter = bounded(leaf.validAfter, U64_MAX, 'VALID_AFTER');
  const approveBefore = bounded(leaf.approveBefore, U64_MAX, 'APPROVE_BEFORE', 1n);
  const claimBefore = bounded(leaf.claimBefore, U64_MAX, 'CLAIM_BEFORE', 1n);
  if (validAfter >= approveBefore) throw new RangeError('VOW_INVALID_WINDOW');
  if (approveBefore > claimBefore) throw new RangeError('VOW_INVALID_WINDOW');
  return [
    PERMISSION_DOMAIN,
    felt(leaf.schemaVersion, 'SCHEMA', 1n),
    felt(leaf.chainId, 'CHAIN', 1n),
    address(leaf.vaultAddress, 'VAULT'),
    felt(leaf.mandateId, 'MANDATE', 1n),
    permissionId,
    felt(leaf.supplierClaimPublicKey, 'SUPPLIER_KEY', 1n),
    address(leaf.token, 'TOKEN'),
    bounded(leaf.maximumAmount, U128_MAX, 'MAXIMUM_AMOUNT', 1n),
    validAfter,
    approveBefore,
    claimBefore,
    felt(leaf.purchaseCommitment, 'PURCHASE_COMMITMENT'),
    felt(leaf.salt, 'SALT', 1n),
  ];
}

export function hashPermission(leaf: PermissionLeaf): bigint {
  return BigInt(hash.computePoseidonHashOnElements(encodePermission(leaf)));
}

export function hashNode(left: bigint, right: bigint): bigint {
  return BigInt(hash.computePoseidonHashOnElements([felt(left, 'NODE'), felt(right, 'NODE')]));
}

export function paddingLeafHash(salt: bigint): bigint {
  return BigInt(hash.computePoseidonHashOnElements([PERMISSION_DOMAIN, felt(salt, 'SALT', 1n)]));
}

export function permissionRoot(leafHashes: readonly bigint[]): bigint {
  if (leafHashes.length !== PERMISSION_SLOTS) throw new RangeError('VOW_INVALID_SLOT_COUNT');
  let level = leafHashes.map((value) => felt(value, 'LEAF'));
  while (level.length > 1) {
    const next: bigint[] = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(hashNode(level[index]!, level[index + 1]!));
    }
    level = next;
  }
  return level[0]!;
}

export function permissionProof(leafHashes: readonly bigint[], permissionId: bigint): bigint[] {
  const slot = Number(bounded(permissionId, BigInt(PERMISSION_SLOTS - 1), 'PERMISSION_ID'));
  if (leafHashes.length !== PERMISSION_SLOTS) throw new RangeError('VOW_INVALID_SLOT_COUNT');
  const proof: bigint[] = [];
  let level = leafHashes.map((value) => felt(value, 'LEAF'));
  let index = slot;
  while (level.length > 1) {
    proof.push(level[index ^ 1]!);
    const next: bigint[] = [];
    for (let position = 0; position < level.length; position += 2) {
      next.push(hashNode(level[position]!, level[position + 1]!));
    }
    level = next;
    index >>= 1;
  }
  return proof;
}

export function rootFromProof(
  leafHash: bigint, permissionId: bigint, proof: readonly bigint[],
): bigint {
  const slot = Number(bounded(permissionId, BigInt(PERMISSION_SLOTS - 1), 'PERMISSION_ID'));
  if (proof.length !== PERMISSION_TREE_DEPTH) throw new RangeError('VOW_INVALID_PROOF_LENGTH');
  let node = felt(leafHash, 'LEAF');
  let index = slot;
  for (const sibling of proof) {
    node = (index & 1) === 0 ? hashNode(node, felt(sibling, 'SIBLING'))
      : hashNode(felt(sibling, 'SIBLING'), node);
    index >>= 1;
  }
  return node;
}

export function verifyPermissionProof(
  leafHash: bigint, permissionId: bigint, proof: readonly bigint[], root: bigint,
): boolean {
  try {
    return rootFromProof(leafHash, permissionId, proof) === felt(root, 'ROOT', 1n);
  } catch {
    return false;
  }
}
