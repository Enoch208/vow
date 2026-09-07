import { ec } from 'starknet';
import { OperatorKey } from '../../src/operator-key.ts';
import { PermissionSet } from '../../src/permission-set.ts';
import type { PermissionRequest } from '../../src/permission-set.ts';
import { PERMISSION_SLOTS } from '../../src/permissions.ts';
import type { PermissionLeaf } from '../../src/permissions.ts';

export const CHAIN = 0x534e5f4d41494en;
export const VAULT = 201n;
export const TOKEN = 202n;
export const OWNER = 100n;
export const MANDATE = 1n;
export const NOW = 1000n;
export const EXPIRES_AT = 3000n;
export const SUPPLIER_KEY = BigInt(ec.starkCurve.getStarkKey('0x123456'));
export const OPERATOR_SECRET = '0xabcdef';
export const OPERATOR_KEY = BigInt(ec.starkCurve.getStarkKey(OPERATOR_SECRET));
export const FIXTURE_ROOT = 0x10a9870e430c351eda1c8801c47ab6f28ef6bfd4228d4c94a76ca5e3c355893n;
export const FIXTURE_LEAF = 0x5e3a4b1c5a610d43d66077cddaddf3f076e2c057d3dba85dd8967cdf162deben;
export const FIXTURE_RESERVATION_ID = 0x45cc6c11f29f5fe7b53eee680c0626324e344af8d021ca7af58a1b1ecf2bb2bn;
export const FIXTURE_PROOF = [
  0x45e574b2625bdf40ea2cd2f91c2fca2135849b6515c940dd78ca5f638299c79n,
  0x15211de2b44c7bb5dce9b9d1c76d2749fa6d11de47606e8db819402c06a9d7en,
  0x5437fe13d42721639cb2a76d07295db7b307d4c7d72e5d15dbf86800dde9f4n,
  0x9243736cdc563a1d308a864a0c751de7eae7d30689e82feedc832e24fa84a0n,
];

export function request(permissionId: bigint, maximumAmount: bigint): PermissionRequest {
  return {
    schemaVersion: 1n, chainId: CHAIN, vaultAddress: VAULT, mandateId: MANDATE, permissionId,
    supplierClaimPublicKey: SUPPLIER_KEY, token: TOKEN, maximumAmount, validAfter: 500n,
    approveBefore: 1800n, claimBefore: 2000n, purchaseCommitment: 777n,
  };
}

export const REQUESTS = [request(0n, 40n), request(1n, 30n), request(2n, 25n)];

export function fixturePermissions(): PermissionLeaf[] {
  return REQUESTS.map((entry) => ({ ...entry, salt: 900n + entry.permissionId }));
}

export function fixturePaddingSalts(): bigint[] {
  return Array.from(
    { length: PERMISSION_SLOTS - REQUESTS.length }, (_, index) => 9000n + BigInt(index + REQUESTS.length),
  );
}

export function fixtureSet(): PermissionSet {
  return PermissionSet.assemble({
    permissions: fixturePermissions(), paddingSalts: fixturePaddingSalts(),
  });
}

export function operator(secret = 0xabcdefn): OperatorKey {
  const bytes = new Uint8Array(32);
  for (let index = 31; index >= 0; index -= 1) bytes[index] = Number((secret >> BigInt((31 - index) * 8)) & 0xffn);
  try { return OperatorKey.restore(bytes); } finally { bytes.fill(0); }
}
