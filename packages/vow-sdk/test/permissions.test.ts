import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PERMISSION_TREE_DEPTH, hashPermission, paddingLeafHash, permissionProof, permissionRoot,
  rootFromProof, verifyPermissionProof,
} from '../src/permissions.ts';
import type { PermissionLeaf } from '../src/permissions.ts';
import { REAL_PERMISSIONS, paddedLeafHashes } from './permission-fixture.ts';

test('T-001 permission leaf digest and root match the Cairo interoperability vector', () => {
  const hashes = paddedLeafHashes();
  assert.equal(hashes[0], 0x5e3a4b1c5a610d43d66077cddaddf3f076e2c057d3dba85dd8967cdf162deben);
  assert.equal(
    permissionRoot(hashes), 0x10a9870e430c351eda1c8801c47ab6f28ef6bfd4228d4c94a76ca5e3c355893n,
  );
});

test('T-002 every real permission proves against the committed root', () => {
  const hashes = paddedLeafHashes();
  const root = permissionRoot(hashes);
  for (const permission of REAL_PERMISSIONS) {
    const proof = permissionProof(hashes, permission.permissionId);
    assert.equal(proof.length, PERMISSION_TREE_DEPTH);
    assert.equal(
      verifyPermissionProof(hashPermission(permission), permission.permissionId, proof, root), true,
    );
  }
});

test('T-002 modifying any permission field invalidates the Merkle proof', () => {
  const hashes = paddedLeafHashes();
  const root = permissionRoot(hashes);
  const original = REAL_PERMISSIONS[0]!;
  const proof = permissionProof(hashes, original.permissionId);
  const mutable: (keyof PermissionLeaf)[] = [
    'schemaVersion', 'chainId', 'vaultAddress', 'mandateId', 'supplierClaimPublicKey', 'token',
    'maximumAmount', 'purchaseCommitment', 'salt',
  ];
  for (const field of mutable) {
    const altered = { ...original, [field]: original[field] + 1n };
    assert.equal(
      verifyPermissionProof(hashPermission(altered), original.permissionId, proof, root), false,
      field,
    );
  }
  for (const field of ['validAfter', 'approveBefore'] as const) {
    const altered = { ...original, [field]: original[field] - 1n };
    assert.equal(
      verifyPermissionProof(hashPermission(altered), original.permissionId, proof, root), false,
      field,
    );
  }
  const laterClaim = { ...original, claimBefore: original.claimBefore + 1n };
  assert.equal(
    verifyPermissionProof(hashPermission(laterClaim), original.permissionId, proof, root), false,
  );
});

test('T-002 a permission cannot be replayed into another slot or another tree', () => {
  const hashes = paddedLeafHashes();
  const root = permissionRoot(hashes);
  const permission = REAL_PERMISSIONS[0]!;
  const proof = permissionProof(hashes, permission.permissionId);
  assert.equal(verifyPermissionProof(hashPermission(permission), 1n, proof, root), false);
  assert.equal(
    verifyPermissionProof(hashPermission(permission), permission.permissionId, proof, root + 1n),
    false,
  );
  const shuffled = [...proof].reverse();
  assert.equal(
    verifyPermissionProof(hashPermission(permission), permission.permissionId, shuffled, root),
    false,
  );
});

test('T-002 padding leaves are indistinguishable commitments that carry no permission', () => {
  const first = paddingLeafHash(9003n);
  assert.notEqual(first, paddingLeafHash(9004n));
  assert.equal(first, paddedLeafHashes()[3]);
});

test('T-002 malformed proofs, slots and windows fail closed', () => {
  const hashes = paddedLeafHashes();
  const permission = REAL_PERMISSIONS[0]!;
  const proof = permissionProof(hashes, 0n);
  assert.throws(() => rootFromProof(hashPermission(permission), 0n, proof.slice(1)), /PROOF_LENGTH/);
  assert.throws(() => rootFromProof(hashPermission(permission), 16n, proof), /PERMISSION_ID/);
  assert.throws(() => permissionRoot(hashes.slice(1)), /SLOT_COUNT/);
  assert.throws(() => hashPermission({ ...permission, permissionId: 16n }), /PERMISSION_ID/);
  assert.throws(() => hashPermission({ ...permission, validAfter: 1800n }), /WINDOW/);
  assert.throws(() => hashPermission({ ...permission, claimBefore: 1700n }), /WINDOW/);
  assert.throws(() => hashPermission({ ...permission, maximumAmount: 0n }), /MAXIMUM_AMOUNT/);
  assert.throws(() => hashPermission({ ...permission, salt: 0n }), /SALT/);
});
