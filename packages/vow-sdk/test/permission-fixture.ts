import { ec } from 'starknet';
import { PERMISSION_SLOTS, hashPermission, paddingLeafHash } from '../src/permissions.ts';
import type { PermissionLeaf } from '../src/permissions.ts';

export const CHAIN = 0x534e5f4d41494en;
export const VAULT = 201n;
export const TOKEN = 202n;
export const SUPPLIER_KEY = BigInt(ec.starkCurve.getStarkKey('0x123456'));

const leaf = (permissionId: bigint, maximumAmount: bigint): PermissionLeaf => ({
  schemaVersion: 1n, chainId: CHAIN, vaultAddress: VAULT, mandateId: 1n, permissionId,
  supplierClaimPublicKey: SUPPLIER_KEY, token: TOKEN, maximumAmount, validAfter: 500n,
  approveBefore: 1800n, claimBefore: 2000n, purchaseCommitment: 777n, salt: 900n + permissionId,
});

export const REAL_PERMISSIONS = [leaf(0n, 40n), leaf(1n, 30n), leaf(2n, 25n)];

export function paddedLeafHashes(): bigint[] {
  const hashes: bigint[] = [];
  for (let slot = 0; slot < PERMISSION_SLOTS; slot += 1) {
    const match = REAL_PERMISSIONS.find((entry) => entry.permissionId === BigInt(slot));
    hashes.push(match ? hashPermission(match) : paddingLeafHash(9000n + BigInt(slot)));
  }
  return hashes;
}
