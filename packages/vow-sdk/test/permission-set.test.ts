import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PermissionSet } from '../src/permission-set.ts';
import { PERMISSION_SLOTS, PERMISSION_TREE_DEPTH, rootFromProof, verifyPermissionProof } from '../src/permissions.ts';
import {
  FIXTURE_LEAF, FIXTURE_PROOF, FIXTURE_ROOT, MANDATE, REQUESTS, fixturePaddingSalts,
  fixturePermissions, fixtureSet, request,
} from './helpers/vault-client.ts';

test('T-001 the built 16-slot padded tree matches the Cairo root, leaf and proof vectors', () => {
  const set = fixtureSet();
  assert.equal(set.root, FIXTURE_ROOT);
  assert.equal(set.slots.length, PERMISSION_SLOTS);
  assert.equal(set.slot(0n).leafHash, FIXTURE_LEAF);
  assert.deepEqual([...set.slot(0n).proof], FIXTURE_PROOF);
  assert.deepEqual(set.context, {
    schemaVersion: 1n, chainId: REQUESTS[0]!.chainId, vaultAddress: REQUESTS[0]!.vaultAddress,
    mandateId: MANDATE, token: REQUESTS[0]!.token,
  });
  for (const slot of set.slots) {
    assert.equal(slot.proof.length, PERMISSION_TREE_DEPTH);
    assert.equal(verifyPermissionProof(slot.leafHash, slot.permissionId, slot.proof, set.root), true);
  }
  assert.equal(set.slots.filter((slot) => slot.kind === 'permission').length, REQUESTS.length);
});

test('T-002 every created set draws independent random salts for real and padding leaves', () => {
  const first = PermissionSet.create(REQUESTS);
  const second = PermissionSet.create(REQUESTS);
  assert.notEqual(first.root, second.root);
  const salts = new Set<bigint>();
  for (const set of [first, second]) {
    for (const slot of set.slots) {
      if (slot.kind !== 'permission') continue;
      const { salt } = set.permission(slot.permissionId);
      assert.ok(salt > 0n && salt < 1n << 248n);
      salts.add(salt);
    }
  }
  assert.equal(salts.size, REQUESTS.length * 2);
  const paddingHashes = new Set([first, second].flatMap(
    (set) => set.slots.filter((slot) => slot.kind === 'padding').map((slot) => slot.leafHash),
  ));
  assert.equal(paddingHashes.size, (PERMISSION_SLOTS - REQUESTS.length) * 2);
});

test('T-002 a reused salt is rejected for real and padding leaves alike', () => {
  const padding = fixturePaddingSalts();
  assert.throws(
    () => PermissionSet.assemble({ permissions: fixturePermissions(), paddingSalts: [900n, ...padding.slice(1)] }),
    /DUPLICATE_SALT/,
  );
  const permissions = fixturePermissions();
  permissions[1] = { ...permissions[1]!, salt: permissions[0]!.salt };
  assert.throws(() => PermissionSet.assemble({ permissions, paddingSalts: padding }), /DUPLICATE_SALT/);
  assert.throws(
    () => PermissionSet.assemble({ permissions: fixturePermissions(), paddingSalts: [padding[0]!, ...padding] }),
    /SLOT_COUNT/,
  );
  const collided = fixturePermissions();
  collided[1] = { ...collided[1]!, permissionId: 0n };
  assert.throws(
    () => PermissionSet.assemble({ permissions: collided, paddingSalts: padding }),
    /DUPLICATE_PERMISSION_SLOT/,
  );
});

test('T-002 a proof issued for one slot never proves another slot', () => {
  const set = fixtureSet();
  const [first, second, , padding] = set.slots;
  assert.notEqual(rootFromProof(first!.leafHash, first!.permissionId, second!.proof), set.root);
  assert.equal(verifyPermissionProof(first!.leafHash, second!.permissionId, first!.proof, set.root), false);
  assert.equal(verifyPermissionProof(first!.leafHash, first!.permissionId, padding!.proof, set.root), false);
  assert.equal(verifyPermissionProof(padding!.leafHash, first!.permissionId, padding!.proof, set.root), false);
  assert.equal(verifyPermissionProof(first!.leafHash, first!.permissionId, first!.proof, set.root + 1n), false);
});

test('T-002 mixed mandate contexts, slot counts and padding slots fail closed', () => {
  const padding = fixturePaddingSalts();
  for (const field of ['chainId', 'vaultAddress', 'mandateId', 'token', 'schemaVersion'] as const) {
    const permissions = fixturePermissions();
    permissions[2] = { ...permissions[2]!, [field]: permissions[2]![field] + 1n };
    assert.throws(
      () => PermissionSet.assemble({ permissions, paddingSalts: padding }), /MIXED_PERMISSION_CONTEXT/, field,
    );
  }
  assert.throws(() => PermissionSet.assemble({ permissions: [], paddingSalts: padding }), /SLOT_COUNT/);
  const offCurve = fixturePermissions();
  offCurve[1] = { ...offCurve[1]!, supplierClaimPublicKey: 5n };
  assert.throws(
    () => PermissionSet.assemble({ permissions: offCurve, paddingSalts: padding }), /INVALID_SUPPLIER_KEY/,
  );
  assert.throws(
    () => PermissionSet.create(Array.from({ length: PERMISSION_SLOTS + 1 }, (_, slot) => request(BigInt(slot), 5n))),
    /PERMISSION_ID/,
  );
  const set = fixtureSet();
  assert.throws(() => set.permission(3n), /NOT_A_PERMISSION_SLOT/);
  assert.throws(() => set.slot(BigInt(PERMISSION_SLOTS)), /PERMISSION_ID/);
});

test('T-002 serializing a set exposes only the public root, never salts or real slot positions', () => {
  const set = PermissionSet.create(REQUESTS);
  const text = JSON.stringify(set);
  assert.equal(text, `{"root":"0x${set.root.toString(16)}","slotCount":${PERMISSION_SLOTS}}`);
  assert.equal(text.includes('padding'), false);
  for (const slot of set.slots) {
    if (slot.kind !== 'permission') continue;
    assert.equal(text.includes(set.permission(slot.permissionId).salt.toString(16)), false);
    assert.equal(text.includes(slot.leafHash.toString(16)), false);
  }
});
