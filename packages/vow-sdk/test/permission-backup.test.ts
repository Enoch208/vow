import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPermissionSetBackup, parsePermissionSetBackup, unlockPermissionSetBackup,
} from '../src/permission-backup.ts';
import { PermissionSet } from '../src/permission-set.ts';
import { PERMISSION_SLOTS } from '../src/permissions.ts';
import { REQUESTS, fixtureSet, request } from './helpers/vault-client.ts';

const password = 'synthetic owner test password';

test('T-002 an owner backup restores the exact set, salts and padding after re-encryption', async () => {
  const original = PermissionSet.create(REQUESTS);
  const restored = await unlockPermissionSetBackup(
    parsePermissionSetBackup(JSON.stringify(await createPermissionSetBackup(original, password))), password,
  );
  assert.equal(restored.root, original.root);
  assert.deepEqual(restored.context, original.context);
  assert.deepEqual([...restored.slots], [...original.slots]);
  for (const slot of original.slots) {
    if (slot.kind !== 'permission') continue;
    assert.deepEqual(restored.permission(slot.permissionId), original.permission(slot.permissionId));
  }
  const full = PermissionSet.create(
    Array.from({ length: PERMISSION_SLOTS }, (_, slot) => request(BigInt(slot), 5n + BigInt(slot))),
  );
  const reopened = await unlockPermissionSetBackup(
    parsePermissionSetBackup(JSON.stringify(await createPermissionSetBackup(full, password))), password,
  );
  assert.equal(reopened.root, full.root);
  assert.equal(reopened.slots.filter((slot) => slot.kind === 'permission').length, PERMISSION_SLOTS);
});

test('T-002 a backup never carries a salt, a real slot position or a reusable plaintext', async () => {
  const set = PermissionSet.create(REQUESTS);
  const text = JSON.stringify(await createPermissionSetBackup(set, password));
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['ciphertext', 'format', 'iterations', 'iv', 'root', 'salt']);
  assert.equal(text.includes(`0x${set.root.toString(16)}`), true);
  for (const slot of set.slots) {
    if (slot.kind !== 'permission') continue;
    assert.equal(text.includes(set.permission(slot.permissionId).salt.toString(16)), false);
    assert.equal(text.includes(slot.leafHash.toString(16)), false);
  }
});

test('T-002 backup encryption is randomized and authenticates the committed root and ciphertext', async () => {
  const set = fixtureSet();
  const first = await createPermissionSetBackup(set, password);
  const second = await createPermissionSetBackup(set, password);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  const flipped = (first.ciphertext[0] === '0' ? '1' : '0') + first.ciphertext.slice(1);
  for (const changed of [{ ...first, ciphertext: flipped }, { ...first, root: '0x1' }]) {
    await assert.rejects(unlockPermissionSetBackup(changed, password), { message: 'VOW_BACKUP_UNLOCK_FAILED' });
  }
  await assert.rejects(unlockPermissionSetBackup(first, 'another synthetic password'), {
    message: 'VOW_BACKUP_UNLOCK_FAILED',
  });
});

test('T-002 malformed backups and weak passwords are refused before any decryption', async () => {
  const set = fixtureSet();
  const backup = await createPermissionSetBackup(set, password);
  await assert.rejects(createPermissionSetBackup(set, 'short'), /PASSWORD_LENGTH/);
  for (const changed of [
    { ...backup, iterations: 1 }, { ...backup, format: 'vow-supplier-key-v1' },
    { ...backup, root: '0x0' }, { ...backup, iv: `${backup.iv}00` },
    { ...backup, salt: backup.salt.toUpperCase() }, { ...backup, ciphertext: '00' },
    { ...backup, permissions: 'forbidden' },
  ]) {
    assert.throws(() => parsePermissionSetBackup(JSON.stringify(changed)), /INVALID_BACKUP/);
  }
  assert.throws(() => parsePermissionSetBackup('not json'), /INVALID_BACKUP/);
});
