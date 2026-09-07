import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { config } from './helpers/collection.ts';

async function run(input: Record<string, unknown>) {
  const folder = await mkdtemp(join(tmpdir(), 'vow-public-preview-'));
  try {
    const path = join(folder, 'public-terms.json');
    await writeFile(path, JSON.stringify(input));
    return spawnSync(process.execPath, ['scripts/preview-deployment.ts', path], { encoding: 'utf8', timeout: 10_000 });
  } finally { await rm(folder, { recursive: true, force: true }); }
}
function terms(): Record<string, string> {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const { vaultAddress: _vaultAddress, probeClassHash: _probeClassHash, ...publicFields } = config;
  return Object.fromEntries(Object.entries({ ...publicFields, chainId: 0x534e5f4d41494en, claimBefore: now + 7200n,
    signatureDeadline: now + 3600n, owner: 100n, salt: 987n, principalLimit: 100n }).map(([key, value]) => [key, value.toString()]));
}

test('G0 public preview CLI produces a review package from synthetic public terms and the local class', async () => {
  const result = await run(terms());
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout) as { status: string; networkFees: string; principal: string; fundingCalls: unknown[] };
  assert.equal(plan.status, 'preview-only'); assert.equal(plan.networkFees, 'not-estimated');
  assert.equal(plan.principal, '0x64'); assert.equal(plan.fundingCalls.length, 2);
});

test('G0 preview CLI rejects unexpected secret-like fields without echoing input', async () => {
  const result = await run({ ...terms(), privateKey: 'sensitive-test-marker' });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'VOW_INVALID_CONFIGURATION\n');
  assert.equal(result.stderr.includes('sensitive-test-marker'), false);
});
