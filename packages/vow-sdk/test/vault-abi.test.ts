import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { auditVaultAbi, VOW_VAULT_ENTRYPOINTS } from '../src/vault-abi.ts';

const artifactPath = 'contracts/target/dev/vow_collection_probe_VowVault.contract_class.json';

test('the deployed-class ABI allowlist has no generic drain, arbitrary call, root replacement or upgrade path', async () => {
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as { abi: unknown };
  const audit = auditVaultAbi(artifact.abi);
  assert.deepEqual(audit.entrypoints, Object.keys(VOW_VAULT_ENTRYPOINTS).sort());
  assert.deepEqual([audit.genericDrain, audit.arbitraryExternalCall, audit.rootReplacement, audit.upgrade], [false, false, false, false]);
});

test('the ABI allowlist rejects added, removed, renamed and remutated entrypoints', async () => {
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as { abi: unknown[] };
  const changed = structuredClone(artifact.abi) as Record<string, unknown>[];
  const contract = changed.find((entry) => entry.type === 'interface')!;
  const items = contract.items as Record<string, unknown>[];
  const mutations = [
    [...items, { type: 'function', name: 'upgrade', state_mutability: 'external' }],
    items.slice(1),
    items.map((entry, index) => index === 0 ? { ...entry, name: 'drain' } : entry),
    items.map((entry, index) => index === 0 ? { ...entry, state_mutability: 'view' } : entry),
  ];
  for (const value of mutations) assert.throws(() => auditVaultAbi([{ ...contract, items: value }]), /VOW_VAULT_ABI_CHANGED/);
});
