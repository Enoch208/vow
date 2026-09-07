import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { hash } from 'starknet';
import type { CompiledSierra } from 'starknet';
import { DEPLOYMENT_DEPENDENCIES as d, readDeploymentReadiness } from '../src/deployment-readiness.ts';
import { POOL_CLASS_HASH } from '../src/prepared-claim.ts';
import { PublicReadError } from '../src/probe-reader.ts';
import type { PublicReader, PublicReadMethod } from '../src/probe-reader.ts';

const source = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_CollectionProbe.contract_class.json', 'utf8')) as CompiledSierra;
const probeClass = BigInt(hash.computeContractClassHash(source));
const owner = 77n;
function fixture(deployed = false) {
  const calls: { method: PublicReadMethod; params: unknown }[] = [];
  const results = Object.fromEntries(Object.entries({ balance_of: ['10', '0'], decimals: ['18'], is_paused: ['0'],
    get_fee_collector: ['99'], get_fee_amount: ['123'], get_public_key: ['0'] }).map(([name, value]) => [hash.getSelectorFromName(name), value]));
  const reader: PublicReader = { async request(method, params) {
    calls.push({ method, params });
    if (method === 'starknet_chainId') return `0x${d.chainId.toString(16)}`;
    if (method === 'starknet_getBlockWithTxHashes') return { block_hash: '0xabc', timestamp: 1000, block_number: 50 };
    if (method === 'starknet_getClass') { if (deployed) return { ...source, abi: hash.formatSpaces(JSON.stringify(source.abi)) }; throw new PublicReadError(28); }
    if (method === 'starknet_getNonce') return '0x3';
    const p = params as { contract_address?: string; request?: { entry_point_selector: string } };
    if (method === 'starknet_getClassHashAt') {
      if (p.contract_address === '0x4d' && !deployed) throw new PublicReadError(20);
      return p.contract_address === `0x${d.pool.toString(16)}` ? String(POOL_CLASS_HASH) : '0x123';
    }
    return results[p.request!.entry_point_selector];
  } };
  return { reader, calls };
}

test('Deployment readiness pins every dependency read and distinguishes explicit absence from unknown', async () => {
  const f = fixture();
  const result = await readDeploymentReadiness(f.reader, owner, probeClass, 1000);
  assert.equal(result.account, 'not-deployed'); assert.equal(result.declaration, 'not-declared');
  assert.equal(result.nonce, null); assert.equal(result.publicSTRKBalance, 10n);
  assert.equal(result.feeEstimate, 'not-estimated'); assert.equal(result.tokenCollectionCompatibility, 'unverified');
  assert.equal(result.ownerPublicPrivacyKey, 0n); assert.equal(result.ownerPrivacyRegistration, 'not-registered');
  for (const call of f.calls.slice(2)) assert.deepEqual((call.params as { block_id: unknown }).block_id, { block_hash: '0xabc' });
  assert.equal(f.calls.some((call) => call.method === 'starknet_getNonce'), false);
});

test('Deployment readiness validates a returned class hash and reads nonce only for a deployed owner', async () => {
  const f = fixture(true);
  const result = await readDeploymentReadiness(f.reader, owner, probeClass, 1000);
  assert.equal(result.account, 'deployed-contract'); assert.equal(result.declaration, 'declared-hash-matched');
  assert.equal(result.nonce, 3n);
  assert.deepEqual((f.calls.at(-1)!.params as { block_id: unknown }).block_id, { block_hash: '0xabc' });
  const mismatch: PublicReader = { request: async (method, params) => method === 'starknet_getClass' ? { ...source, sierra_program: ['0x1'] } : f.reader.request(method, params) };
  await assert.rejects(readDeploymentReadiness(mismatch, owner, probeClass, 1000), /DECLARED_CLASS_MISMATCH/);
});

test('Deployment readiness does not turn transport failures or unrelated RPC errors into absence', async () => {
  for (const target of ['starknet_getClass', 'starknet_getClassHashAt']) {
    for (const error of [new PublicReadError(), new PublicReadError(24), new Error('unavailable')]) {
      const f = fixture();
      await assert.rejects(readDeploymentReadiness({ request: async (method, params) => {
        if (method === target) throw error;
        return f.reader.request(method, params);
      } }, owner, probeClass, 1000), (actual) => actual === error);
    }
  }
});

test('Deployment readiness rejects wrong chain and stale or pending blocks before dependent reads', async () => {
  let count = 0;
  await assert.rejects(readDeploymentReadiness({ request: async () => { count++; return '0x1'; } }, owner, probeClass, 1000), /WRONG_CHAIN/);
  assert.equal(count, 1);
  for (const block of [{ timestamp: 1000, block_number: 50 }, { block_hash: '0xabc', timestamp: 600, block_number: 50 },
    { block_hash: '0xabc', timestamp: 1040, block_number: 50 }, { block_hash: '0x0', timestamp: 1000, block_number: 50 }]) {
    const f = fixture();
    await assert.rejects(readDeploymentReadiness({ request: async (method, params) => method === 'starknet_getBlockWithTxHashes' ? block : f.reader.request(method, params) }, owner, probeClass, 1000));
    assert.equal(f.calls.length, 1);
  }
});

test('Deployment readiness rejects changed pool code, token decimals and malformed public reads', async () => {
  for (const [name, values] of [['decimals', ['6']], ['balance_of', ['1']], ['balance_of', [String(1n << 128n), '0']], ['is_paused', ['2']], ['get_fee_collector', ['0']], ['get_public_key', []], ['get_public_key', ['invalid']]] as const) {
    const f = fixture();
    await assert.rejects(readDeploymentReadiness({ request: async (method, params) => {
      const p = params as { request?: { entry_point_selector: string } };
      return method === 'starknet_call' && p.request?.entry_point_selector === hash.getSelectorFromName(name) ? values : f.reader.request(method, params);
    } }, owner, probeClass, 1000));
  }
  const f = fixture(true);
  await assert.rejects(readDeploymentReadiness({ request: async (method, params) => method === 'starknet_getClassHashAt' ? '0x123' : f.reader.request(method, params) }, owner, probeClass, 1000), /POOL_CLASS_CHANGED/);
});

test('Public registration reads only the owner public key and does not infer collection support or hide RPC failures', async () => {
  const f = fixture();
  const registration = hash.getSelectorFromName('get_public_key');
  const read = (value: unknown): PublicReader => ({ request: async (method, params) => {
    const p = params as { request?: { entry_point_selector: string; contract_address: string; calldata: string[] }; block_id?: unknown };
    if (method === 'starknet_call' && p.request?.entry_point_selector === registration) {
      assert.equal(p.request.contract_address, `0x${d.pool.toString(16)}`);
      assert.deepEqual(p.request.calldata, ['0x4d']);
      assert.deepEqual(p.block_id, { block_hash: '0xabc' });
      if (value instanceof Error) throw value;
      return value;
    }
    return f.reader.request(method, params);
  } });
  const report = await readDeploymentReadiness(read(['0x123']), owner, probeClass, 1000);
  assert.equal(report.ownerPrivacyRegistration, 'public-key-present');
  assert.equal(report.tokenCollectionCompatibility, 'unverified');
  assert.equal(report.ownerPublicPrivacyKey, 0x123n);
  await assert.rejects(readDeploymentReadiness(read(new PublicReadError()), owner, probeClass, 1000));
  assert.equal(JSON.stringify(f.calls).includes(hash.getSelectorFromName('get_enc_private_key')), false);
});
