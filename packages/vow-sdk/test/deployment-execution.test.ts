import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { hash } from 'starknet';
import type { CompiledSierra, CompiledSierraCasm } from 'starknet';
import { DeploymentExecution } from '../src/deployment-execution.ts';
import { DEPLOYMENT_DEPENDENCIES as d } from '../src/deployment-readiness.ts';
import { hex, executeCalldata, validateDeploymentArtifact } from '../src/deployment-execution-state.ts';
import type { DeploymentWallet, DeploymentStage } from '../src/deployment-execution-state.ts';
import { PublicReadError } from '../src/probe-reader.ts';
import type { PublicReader } from '../src/probe-reader.ts';
import { POOL_CLASS_HASH } from '../src/prepared-claim.ts';
import { buildProbeDeploymentPlan } from '../src/deployment-plan.ts';
import { config } from './helpers/collection.ts';

const source = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_CollectionProbe.contract_class.json', 'utf8')) as CompiledSierra;
const casm = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_CollectionProbe.compiled_contract_class.json', 'utf8')) as CompiledSierraCasm;
const artifact = { classHash: hash.computeContractClassHash(source), compiledClassHash: hash.computeCompiledClassHash(casm, '0.14.3'), starknetVersion: '0.14.3', contractClass: source };
const terms = { ...config, owner: 77n, chainId: d.chainId, token: d.strk, poolAddress: d.pool, feeToken: d.strk, salt: 987n, principalLimit: 100n, probeClassHash: BigInt(artifact.classHash) };
const ceilings = { declare: 20n * 10n ** 18n, deploy: 25n * 10n ** 16n, fund: 20n * 10n ** 16n };
const plan = buildProbeDeploymentPlan(terms, 1000n);
function fixture() {
  const data = { stage: 'declare' as DeploymentStage | 'complete', nonce: 17n, walletOwner: terms.owner, walletChain: d.chainId,
    returnedClass: terms.probeClassHash, actualProbeClass: terms.probeClassHash, failed: false, actualFee: 1n, alteredTx: false, sends: 0 };
  const storage = new Map<string, string>();
  let lastTx: Record<string, unknown> = {};
  let lastHash = 123n;
  const reader: PublicReader = { async request(method, params) {
    const p = params as { contract_address?: string; request?: { entry_point_selector: string; calldata: string[] } };
    if (method === 'starknet_chainId') return hex(d.chainId);
    if (method === 'starknet_getBlockWithTxHashes') return { block_hash: '0xabc', block_number: 50, timestamp: 1000, starknet_version: '0.14.3', transactions: [hex(lastHash)] };
    if (method === 'starknet_getNonce') return hex(data.nonce);
    if (method === 'starknet_getClass') { if (data.stage === 'declare') throw new PublicReadError(28); return source; }
    if (method === 'starknet_getClassHashAt') {
      if (p.contract_address === hex(plan.predictedAddress)) { if (['declare', 'deploy'].includes(data.stage)) throw new PublicReadError(20); return hex(data.actualProbeClass); }
      return p.contract_address === hex(d.pool) ? hex(POOL_CLASS_HASH) : p.contract_address === hex(d.udc)
        ? '0x1b2df6d8861670d4a8ca4670433b2418d78169c2947f46dc614e69f333745c8' : p.contract_address === hex(d.strk)
          ? '0x2e77ee61d4df3d988ee1f42ea5442e913862cc82c2584d212ecda76666498fc' : '0x123';
    }
    if (method === 'starknet_getTransactionReceipt') return { transaction_hash: hex(lastHash), block_hash: '0xabc', block_number: 50,
      finality_status: 'ACCEPTED_ON_L2', actual_fee: { unit: 'FRI', amount: hex(data.actualFee) }, execution_status: data.failed ? 'REVERTED' : 'SUCCEEDED' };
    if (method === 'starknet_getTransactionByHash') return data.alteredTx ? { ...lastTx, sender_address: '0x1' } : lastTx;
    if (method === 'starknet_call') {
      const name = p.request!.entry_point_selector;
      const results: Record<string, bigint[]> = { balance_of: p.request!.calldata[0] === hex(terms.owner) ? [1000n, 0n] : [data.stage === 'complete' ? terms.amount : 0n, 0n],
        decimals: [18n], is_paused: [0n], get_fee_collector: [terms.feeCollector], get_fee_amount: [terms.maximumFee], get_public_key: [1n],
        configuration: [terms.owner, terms.poolAddress, terms.token, terms.supplierKey, terms.amount, terms.claimBefore], state: [data.stage === 'complete' ? 1n : 0n], allowance: [0n, 0n] };
      const found = Object.entries(results).find(([key]) => hash.getSelectorFromName(key) === name); return found?.[1].map(hex);
    }
    throw new Error('TEST_UNEXPECTED_READ');
  } };
  const writes: unknown[] = [];
  let dispatch: (() => Promise<unknown>) | undefined;
  const wallet: DeploymentWallet = { async request(input) {
    if (input.type === 'wallet_supportedWalletApi') return ['0.10.3'];
    if (input.type === 'wallet_requestChainId') return hex(data.walletChain);
    if (input.type === 'wallet_requestAccounts') return [hex(data.walletOwner)];
    writes.push(input); data.sends++;
    assert.equal(JSON.parse([...storage.values()][0]!).attempts.at(-1).status, 'unknown');
    if (dispatch) return dispatch();
    const stage = data.stage as DeploymentStage;
    lastHash++;
    lastTx = { transaction_hash: hex(lastHash), sender_address: hex(terms.owner), nonce: hex(data.nonce),
      ...(stage === 'declare' ? { type: 'DECLARE', class_hash: artifact.classHash, compiled_class_hash: artifact.compiledClassHash }
        : { type: 'INVOKE', calldata: executeCalldata(stage, plan).map(hex) }) };
    data.nonce++; data.stage = ({ declare: 'deploy', deploy: 'fund', fund: 'complete' } as const)[stage];
    return { transaction_hash: hex(lastHash), ...(stage === 'declare' ? { class_hash: hex(data.returnedClass) } : {}) };
  } };
  const open = (readerOverride = reader) => new DeploymentExecution(terms, artifact, BigInt(artifact.compiledClassHash), readerOverride,
    { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } }, navigator.locks, ceilings, () => 1000n);
  return { data, reader, wallet, storage, writes, open, dispatch: (value: () => Promise<unknown>) => { dispatch = value; } };
}

test('Reviewed deployment executes declaration, deployment and atomic funding only after matching receipts', async () => {
  const f = fixture(); const execution = f.open();
  for (const stage of ['declare', 'deploy', 'fund']) {
    const review = await execution.prepare(f.wallet); assert.equal(review.stage, stage); assert.equal(execution.observedTransactionHash, null);
    assert.equal(review.maximumNetworkFeeSTRK, ceilings[stage as DeploymentStage].toString());
    await assert.rejects(execution.execute(f.wallet, review.reviewDigest, false), /NOT_APPROVED/);
    const sent = await execution.execute(f.wallet, review.reviewDigest, true);
    assert.equal(sent.attempts.at(-1)?.status, 'unknown');
    await assert.rejects(f.open().prepare(f.wallet), /RECONCILE_REQUIRED/);
    assert.equal((await execution.reconcile()).attempts.at(-1)?.status, 'confirmed');
  }
  assert.equal((await f.open().prepare(f.wallet)).stage, 'complete'); assert.equal(f.data.sends, 3);
  const declaration = f.writes[0] as { type: string; params: Record<string, unknown> };
  assert.equal(declaration.type, 'wallet_addDeclareTransaction'); assert.ok('contract_class' in declaration.params);
  assert.equal('declare_transaction' in declaration.params, false);
  const funding = f.writes[2] as { params: { calls: unknown[] } };
  assert.equal(funding.params.calls.length, 2);
});

test('Wrong wallet identity, changed nonce, build hash and unexpected deployed class fail closed before writes', async () => {
  for (const field of ['walletOwner', 'walletChain', 'nonce'] as const) {
    const f = fixture(); const execution = f.open(); const review = await execution.prepare(f.wallet);
    f.data[field]++;
    await assert.rejects(execution.execute(f.wallet, review.reviewDigest, true)); assert.equal(f.data.sends, 0);
  }
  const f = fixture(); f.data.stage = 'fund'; f.data.actualProbeClass = 1n;
  await assert.rejects(f.open().prepare(f.wallet), /UNEXPECTED_PROBE_CLASS/);
  assert.throws(() => new DeploymentExecution(terms, { ...artifact, compiledClassHash: '0x1' }, BigInt(artifact.compiledClassHash), f.reader,
    { getItem: () => null, setItem: () => {} }, navigator.locks, ceilings), /WRONG_COMPILED_BUILD/);
});

test('Timeout, refresh and duplicate clicks never dispatch a second attempt; late hash remains recoverable', async () => {
  const f = fixture(); let resolve: (value: unknown) => void = () => {};
  f.dispatch(() => new Promise((done) => { resolve = done; }));
  const execution = f.open(); const review = await execution.prepare(f.wallet);
  const first = execution.execute(f.wallet, review.reviewDigest, true, 1);
  await assert.rejects(execution.execute(f.wallet, review.reviewDigest, true, 1), /NOT_REVIEWED/);
  assert.equal((await first).attempts[0]?.hash, null);
  await assert.rejects(f.open().prepare(f.wallet), /RECONCILE_REQUIRED/);
  resolve({ transaction_hash: '0x777', class_hash: artifact.classHash }); await delay(10);
  assert.equal((await f.open().read()).attempts[0]?.hash, '0x777'); assert.equal(f.data.sends, 1);
});

test('Wrong returned declaration class, unrelated receipt transaction and reverted execution cannot unlock next stage', async () => {
  for (const changed of ['returnedClass', 'alteredTx', 'failed', 'actualFee'] as const) {
    const f = fixture(); if (changed === 'returnedClass') f.data.returnedClass = 1n; else if (changed === 'actualFee') f.data.actualFee = ceilings.declare + 1n; else f.data[changed] = true;
    const execution = f.open(); const review = await execution.prepare(f.wallet);
    await execution.execute(f.wallet, review.reviewDigest, true);
    const record = await execution.reconcile(); assert.notEqual(record.attempts[0]?.status, 'confirmed');
    await assert.rejects(f.open().prepare(f.wallet), /RECONCILE_REQUIRED/);
  }
});

test('Blocked storage and invalidation during a chain check prevent wallet dispatch', async () => {
  const f = fixture(); const execution = f.open(); const review = await execution.prepare(f.wallet);
  execution.invalidate(); await assert.rejects(execution.execute(f.wallet, review.reviewDigest, true), /NOT_REVIEWED/);
  const invalidStorage = new DeploymentExecution(terms, artifact, BigInt(artifact.compiledClassHash), f.reader,
    { getItem: () => null, setItem: () => {} }, navigator.locks, ceilings, () => 1000n);
  const prepared = await invalidStorage.prepare(f.wallet);
  await assert.rejects(invalidStorage.execute(f.wallet, prepared.reviewDigest, true), /RECOVERY_STORAGE_UNAVAILABLE/);
  assert.equal(f.data.sends, 0);
});


test('Changing a fee ceiling invalidates existing recovery and the reviewed cap is persisted before dispatch', async () => {
  const f = fixture(); const execution = f.open(); const review = await execution.prepare(f.wallet);
  await execution.execute(f.wallet, review.reviewDigest, true);
  assert.equal((await execution.read()).attempts[0]?.maximumNetworkFeeSTRK, ceilings.declare.toString());
  const changed = new DeploymentExecution(terms, artifact, BigInt(artifact.compiledClassHash), f.reader,
    { getItem: (key) => f.storage.get(key) ?? null, setItem: (key, value) => { f.storage.set(key, value); } }, navigator.locks,
    { ...ceilings, declare: ceilings.declare + 1n }, () => 1000n);
  await assert.rejects(changed.prepare(f.wallet), /CORRUPT_DEPLOYMENT_RECORD/);
});


test('Canonical RPC ABI strings validate against the local Sierra build and reject altered or extra artifact fields', () => {
  const wire = { ...artifact, contractClass: { ...source, abi: hash.formatSpaces(JSON.stringify(source.abi)) } };
  assert.doesNotThrow(() => validateDeploymentArtifact(wire, terms));
  assert.throws(() => validateDeploymentArtifact({ ...wire, unexpected: true } as typeof wire, terms), /INVALID_DEPLOYMENT_ARTIFACT/);
  assert.throws(() => validateDeploymentArtifact({ ...wire, contractClass: { ...wire.contractClass, abi: '[]' } }, terms), /WRONG_PROBE_BUILD/);
});

test('Native Web Locks prevent duplicate dispatch by two separate sessions sharing the same draft', async () => {
  const f = fixture(); f.dispatch(async () => ({ transaction_hash: '0x777', class_hash: artifact.classHash }));
  const first = f.open(); const second = f.open();
  const [a, b] = await Promise.all([first.prepare(f.wallet), second.prepare(f.wallet)]);
  const result = await Promise.allSettled([first.execute(f.wallet, a.reviewDigest, true), second.execute(f.wallet, b.reviewDigest, true)]);
  assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(f.data.sends, 1);
});
