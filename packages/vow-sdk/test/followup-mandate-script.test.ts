import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PermissionSet } from '../src/permission-set.ts';
import { hashReserve } from '../src/reserve.ts';
import type { ReserveAuthorization } from '../src/reserve.ts';
import { writeFollowupMandateArtifacts } from '../../../scripts/prepare-followup-mandate.ts';

test('mandate 2 generator separates two fresh supplier keys and emits no public witness', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'vow-followup-'));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const paths = await writeFollowupMandateArtifacts(directory, 1_788_800_000n);
  const publicText = await readFile(paths.publicArtifact, 'utf8');
  const publicArtifact = JSON.parse(publicText) as Record<string, unknown>;
  const owner = JSON.parse(await readFile(paths.ownerSecret, 'utf8')) as {
    permissionSetPlaintext: string;
    unsignedReservations: readonly { authorization: Record<string, string>; authorizationDigest: string }[];
  };
  const suppliers = await Promise.all(paths.supplierSecrets.map(async (path) => JSON.parse(await readFile(path, 'utf8')) as {
    privateKey: string;
    publicKey: string;
  }));
  assert.equal(publicArtifact.status, 'unsigned-local-preparation');
  assert.equal(publicArtifact.mandateId, '0x2');
  assert.equal(publicArtifact.permissionCount, 2);
  assert.equal(publicArtifact.amountPerPermission, '10000000000000000');
  assert.equal(publicArtifact.totalFunding, '20000000000000000');
  assert.doesNotMatch(publicText, /privateKey|permissionSetPlaintext|encodedPermission|purchaseCommitment|supplierPublicKey|"proof"/);
  assert.notEqual(suppliers[0]!.privateKey, suppliers[1]!.privateKey);
  assert.notEqual(suppliers[0]!.publicKey, suppliers[1]!.publicKey);
  const set = PermissionSet.restore(new TextEncoder().encode(owner.permissionSetPlaintext));
  assert.equal(set.context.mandateId, 2n);
  assert.equal(set.permission(0n).supplierClaimPublicKey, BigInt(suppliers[0]!.publicKey));
  assert.equal(set.permission(1n).supplierClaimPublicKey, BigInt(suppliers[1]!.publicKey));
  for (const reserve of owner.unsignedReservations) {
    const authorization = Object.fromEntries(Object.entries(reserve.authorization).map(([key, value]) => [key, BigInt(value)])) as unknown as ReserveAuthorization;
    assert.equal(`0x${hashReserve(authorization).toString(16)}`, reserve.authorizationDigest);
  }
  assert.equal((await stat(join(directory, '.secrets'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(directory, '.secrets/vow-mandate-2'))).mode & 0o777, 0o700);
  assert.equal((await stat(paths.ownerSecret)).mode & 0o777, 0o600);
  assert.equal((await stat(paths.supplierSecrets[0])).mode & 0o777, 0o600);
  assert.equal((await stat(paths.supplierSecrets[1])).mode & 0o777, 0o600);
  assert.equal((await stat(paths.publicArtifact)).mode & 0o777, 0o600);
});

test('mandate 2 generator refuses every existing target without replacing it', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'vow-followup-existing-'));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const paths = await writeFollowupMandateArtifacts(directory, 1_788_800_000n);
  const before = await readFile(paths.publicArtifact, 'utf8');
  await assert.rejects(
    writeFollowupMandateArtifacts(directory, 1_788_800_001n),
    /VOW_FOLLOWUP_TARGET_EXISTS/,
  );
  assert.equal(await readFile(paths.publicArtifact, 'utf8'), before);
});

test('mandate 2 execution refuses to bypass the created-state preflight', async () => {
  const script = await readFile('scripts/run-mandate-2.sh', 'utf8');
  assert.match(script, /verify-mandate-2\.ts" --expect-created/);
  assert.doesNotMatch(script, /verify-mandate-2\.ts"\s*\|\|\s*true/);
});
