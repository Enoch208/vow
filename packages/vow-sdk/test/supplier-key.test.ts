import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SupplierKey } from '../src/supplier-key.ts';
import { createSupplierBackup, parseSupplierBackup, unlockSupplierBackup } from '../src/supplier-backup.ts';
import { verifyClaimSignature, hashClaim } from '../src/claims.ts';
import { parseClaimReview } from '../../../scripts/supplier/claim-review.ts';
import { config } from './helpers/collection.ts';

const syntheticPassword = 'synthetic test password only';
const claim = { chainId: 0x534e5f4d41494en, vaultAddress: config.vaultAddress, mandateId: 1n, reservationId: 1n,
  token: config.token, amount: config.amount, outputNoteId: 777n, signatureDeadline: 1900n };
function syntheticKey(): SupplierKey {
  const bytes = new Uint8Array(32); bytes.set([0x12, 0x34, 0x56], 29);
  try { return SupplierKey.restore(bytes); } finally { bytes.fill(0); }
}

test('Supplier backup restore signs the exact claim and lock disables further signing', async () => {
  const original = syntheticKey();
  const backup = await createSupplierBackup(original, syntheticPassword);
  original.lock();
  const restored = await unlockSupplierBackup(parseSupplierBackup(JSON.stringify(backup)), syntheticPassword);
  try {
    const signature = restored.sign(claim, config.supplierKey, 1000n);
    assert.equal(verifyClaimSignature(claim, signature, config.supplierKey), true);
    assert.equal(verifyClaimSignature({ ...claim, outputNoteId: 778n }, signature, config.supplierKey), false);
    assert.throws(() => restored.sign(claim, config.supplierKey + 1n, 1000n), /WRONG_SUPPLIER/);
    assert.throws(() => restored.sign(claim, config.supplierKey, 1900n), /EXPIRED/);
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(restored))), ['publicKey', 'locked']);
    restored.lock(); assert.throws(() => restored.sign(claim, config.supplierKey, 1000n), /KEY_LOCKED/);
  } finally { restored.lock(); }
});

test('Supplier backup randomizes encryption and authenticates key metadata, ciphertext and password', async () => {
  const key = syntheticKey();
  try {
    const first = await createSupplierBackup(key, syntheticPassword);
    const second = await createSupplierBackup(key, syntheticPassword);
    assert.notEqual(first.salt, second.salt); assert.notEqual(first.iv, second.iv); assert.notEqual(first.ciphertext, second.ciphertext);
    for (const changed of [{ ...first, publicKey: '0x123' }, { ...first, ciphertext: (first.ciphertext[0] === '0' ? '1' : '0') + first.ciphertext.slice(1) }]) {
      await assert.rejects(unlockSupplierBackup(changed, syntheticPassword), { message: 'VOW_BACKUP_UNLOCK_FAILED' });
    }
    await assert.rejects(unlockSupplierBackup(first, 'another synthetic password'), { message: 'VOW_BACKUP_UNLOCK_FAILED' });
    assert.throws(() => parseSupplierBackup(JSON.stringify({ ...first, iterations: 1 })), /INVALID_BACKUP/);
    assert.throws(() => parseSupplierBackup(JSON.stringify({ ...first, privateKey: 'forbidden' })), /INVALID_BACKUP/);
  } finally { key.lock(); }
});

test('Supplier key generation stays opaque and invalid keys and weak-length passwords are refused', async () => {
  const key = SupplierKey.generate();
  try {
    assert.ok(key.publicKey > 0n);
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(key))), ['publicKey', 'locked']);
    await assert.rejects(createSupplierBackup(key, 'short'), /PASSWORD_LENGTH/);
  } finally { key.lock(); }
  assert.throws(() => SupplierKey.restore(new Uint8Array(32)), /INVALID_SUPPLIER/);
});

test('Offline review rejects digest substitution, extra claim fields and wrong claim contexts', () => {
  const review = { claim, digest: hashClaim(claim), supplierKey: config.supplierKey, recipient: config.recipient, blockHash: 123n };
  const json = (input: unknown) => JSON.stringify(input, (_, value: unknown) => typeof value === 'bigint' ? `0x${value.toString(16)}` : value);
  assert.equal(parseClaimReview(json(review), 1000n).claim.outputNoteId, 777n);
  assert.throws(() => parseClaimReview(json({ ...review, digest: 1n }), 1000n), /DIGEST_MISMATCH/);
  assert.throws(() => parseClaimReview(json({ ...review, claim: { ...claim, privateKey: 'forbidden' } }), 1000n), /INVALID_CLAIM/);
  assert.throws(() => parseClaimReview(json(review), 1900n), /EXPIRED/);
  assert.throws(() => parseClaimReview(json({ ...review, claim: { ...claim, chainId: 1n } }), 1000n), /WRONG_CLAIM_CONTEXT/);
});
