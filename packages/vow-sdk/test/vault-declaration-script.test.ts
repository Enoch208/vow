import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('T-VAULT-DECLARE wrong non-interactive confirmation cannot reach the network', () => {
  const result = spawnSync('sh', ['scripts/declare-vault.sh', '--submit', '0x1'], {
    encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Confirmation did not match\. Nothing submitted\./);
  assert.doesNotMatch(result.stdout + result.stderr, /VowVault class hash|Account:|RPC:/);
});
