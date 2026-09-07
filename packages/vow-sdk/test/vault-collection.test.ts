import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hash } from 'starknet';
import type { PublicReader } from '../src/probe-reader.ts';
import { POOL_CLASS_HASH } from '../src/prepared-claim.ts';
import { assertVaultReservationReady, readVaultReservation } from '../src/vault-collection.ts';
import type { VaultCollectionConfiguration, VaultDeploymentManifest } from '../src/vault-collection.ts';

const manifest: VaultDeploymentManifest = { chainId: 0x534e5f4d41494en, vaultAddress: 56n, vaultClassHash: 1234n, poolAddress: 55n,
  poolClassHash: POOL_CLASS_HASH, feeToken: 57n, feeCollector: 58n, maximumProtocolFee: 6n, maximumNetworkFee: 1n };
const reservationId = 987n;
const hex = (value: bigint) => `0x${value.toString(16)}`;

function reader(changes: Partial<Record<string, bigint[]>> = {}) {
  const reads: string[] = [];
  const values: Record<string, bigint[]> = { pool: [manifest.poolAddress], reservation: [4n, 2n, 3n, 5n, 57n, 100n, 2000n, 6n, 1n],
    accounted_balance: [100n], balance_of: [100n, 0n], allowance: [0n, 0n], is_paused: [0n], get_fee_collector: [manifest.feeCollector], ...changes };
  const publicReader: PublicReader = { async request(method, params) {
    reads.push(method);
    if (method === 'starknet_chainId') return hex(manifest.chainId);
    if (method === 'starknet_getBlockWithTxHashes') return { block_hash: '0x99', timestamp: 1000 };
    if (method === 'starknet_getClassHashAt') return (params as { contract_address: string }).contract_address === hex(manifest.vaultAddress) ? hex(manifest.vaultClassHash) : hex(manifest.poolClassHash);
    if (method === 'starknet_call') {
      const selector = (params as { request: { entry_point_selector: string } }).request.entry_point_selector;
      const name = Object.keys(values).find((candidate) => hash.getSelectorFromName(candidate) === selector);
      if (!name) throw new Error('UNEXPECTED_TEST_READ');
      return values[name]!.map(hex);
    }
    throw new Error('UNEXPECTED_TEST_READ');
  } };
  return { publicReader, reads };
}

test('claim reservation read pins chain, block, VowVault, pool and exact on-chain reservation before wallet work', async () => {
  const f = reader();
  const snapshot = await readVaultReservation(f.publicReader, manifest, reservationId);
  const config: VaultCollectionConfiguration = { ...manifest, ...snapshot, recipient: 88n, signatureDeadline: 1900n };
  assertVaultReservationReady(config, snapshot, 1000n);
  assert.equal(snapshot.reservationId, reservationId); assert.equal(snapshot.amount, 100n); assert.equal(snapshot.token, 57n);
  assert.equal(f.reads[0], 'starknet_chainId'); assert.equal(f.reads[1], 'starknet_getBlockWithTxHashes');
});

test('closed, altered, underfunded and stale-allowance reservations cannot reach preparation', async () => {
  for (const changes of [{ reservation: [4n, 2n, 3n, 5n, 57n, 100n, 2000n, 6n, 2n] }, { accounted_balance: [99n] }, { balance_of: [99n, 0n] }, { allowance: [1n, 0n] }]) {
    const snapshot = await readVaultReservation(reader(changes).publicReader, manifest, reservationId);
    const config: VaultCollectionConfiguration = { ...manifest, ...snapshot, state: 1n, recipient: 88n, signatureDeadline: 1900n };
    assert.throws(() => assertVaultReservationReady(config, snapshot, 1000n));
  }
});
