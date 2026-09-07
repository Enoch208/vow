import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { hash, transaction } from 'starknet';
import type { CompiledSierra, CompiledSierraCasm } from 'starknet';
import { buildDeployedOwnerFeeQuery, buildPredeploymentFeeQuery, parseFeeEstimates } from '../src/deployment-fee-query.ts';
import { buildProbeDeploymentPlan } from '../src/deployment-plan.ts';
import { config } from './helpers/collection.ts';
import { FELT_PRIME } from '../src/integers.ts';

const sierra = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_CollectionProbe.contract_class.json', 'utf8')) as CompiledSierra;
const casm = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_CollectionProbe.compiled_contract_class.json', 'utf8')) as CompiledSierraCasm;
const account = { address: hash.calculateContractAddressFromHash('0x12', '0x123', ['0x456'], '0x0'), class_hash: '0x123', salt: '0x12', calldata: ['0x456'], version: 1 };
const terms = { ...config, chainId: 0x534e5f4d41494en, owner: BigInt(account.address), salt: 987n, principalLimit: 100n, probeClassHash: BigInt(hash.computeContractClassHash(sierra)) };

test('Fee query contains only unsigned query-version activation, declaration and exact deployment in nonce order', () => {
  const query = buildPredeploymentFeeQuery(account, terms, sierra, casm, 123n, '0.14.3', 1000n);
  assert.equal(query.method, 'starknet_estimateFee');
  assert.deepEqual(query.params.simulation_flags, ['SKIP_VALIDATE']);
  assert.deepEqual(query.params.block_id, { block_hash: '0x7b' });
  assert.deepEqual(query.params.request.map((row) => [row.type, row.nonce]), [['DEPLOY_ACCOUNT', '0x0'], ['DECLARE', '0x1'], ['INVOKE', '0x2']]);
  for (const row of query.params.request) {
    assert.equal(row.version, '0x100000000000000000000000000000003'); assert.deepEqual(row.signature, []);
  }
  const plan = buildProbeDeploymentPlan(terms, 1000n);
  const invocation = query.params.request[2]!;
  assert.ok('calldata' in invocation);
  assert.deepEqual(invocation.calldata, transaction.getExecuteCalldata([plan.deploymentCall], '1').map((value) => `0x${BigInt(value).toString(16)}`));
  for (const value of invocation.calldata) assert.match(value, /^0x[0-9a-f]{1,63}$/);
  assert.equal(query.review.predictedProbe, `0x${plan.predictedAddress.toString(16)}`);
  assert.equal(query.review.sourceDisclosure, 'full-contract-class');
  const declaration = query.params.request[1]!;
  assert.ok('contract_class' in declaration);
  assert.equal(declaration.contract_class.abi, hash.formatSpaces(JSON.stringify(sierra.abi)));
  assert.ok(query.review.omitted.includes('funding'));
});

test('Fee query rejects wrong account or build, expired terms and invalid block or chain version', () => {
  assert.throws(() => buildPredeploymentFeeQuery({ ...account, address: '0x123' }, terms, sierra, casm, 123n, '0.14.3', 1000n), /WRONG_DEPLOYMENT_ACCOUNT/);
  assert.throws(() => buildPredeploymentFeeQuery(account, { ...terms, probeClassHash: 1n }, sierra, casm, 123n, '0.14.3', 1000n), /WRONG_PROBE_BUILD/);
  assert.throws(() => buildPredeploymentFeeQuery(account, terms, sierra, casm, 123n, '0.14.3', 2000n), /EXPIRED/);
  assert.throws(() => buildPredeploymentFeeQuery(account, terms, sierra, casm, 0n, '0.14.3', 1000n));
  assert.throws(() => buildPredeploymentFeeQuery(account, terms, sierra, casm, 123n, 'unknown', 1000n), /UNSUPPORTED_CHAIN_VERSION/);
});

const fee = { unit: 'FRI', overall_fee: '0x20', l1_gas_consumed: '0x2', l1_gas_price: '0x3', l2_gas_consumed: '0x4', l2_gas_price: '0x5', l1_data_gas_consumed: '0x1', l1_data_gas_price: '0x6' };
test('Fee parser checks integer resource totals while keeping skipped validation distinct from a spending cap', () => {
  const result = parseFeeEstimates([fee], 1)[0]!;
  assert.equal(result.overallFeeFRI, 32n); assert.equal(result.spendingCap, null); assert.equal(result.validation, 'skipped');
});

test('Fee parser rejects wrong units, response counts, inconsistent totals, missing or overflowing gas fields', () => {
  for (const changed of [{ ...fee, unit: 'WEI' }, { ...fee, overall_fee: '0x21' }, { ...fee, l1_gas_price: -1 },
    { ...fee, overall_fee: '0x0' }, { ...fee, l2_gas_consumed: String(1n << 128n) }, { unit: 'FRI' }]) {
    assert.throws(() => parseFeeEstimates([changed], 1));
  }
  assert.throws(() => parseFeeEstimates([fee], 2)); assert.throws(() => parseFeeEstimates([], 0));
});

test('Four-stage estimate keeps exact approval and funding atomic without changing deployment terms or granting spending authority', () => {
  const query = buildPredeploymentFeeQuery(account, terms, sierra, casm, 123n, '0.14.3', 1000n, true);
  const plan = buildProbeDeploymentPlan(terms, 1000n);
  const funding = query.params.request[3]!;
  assert.equal(funding.type, 'INVOKE'); assert.equal(funding.nonce, '0x3');
  assert.equal(funding.version, '0x100000000000000000000000000000003');
  assert.deepEqual(funding.signature, []);
  assert.ok('calldata' in funding);
  assert.deepEqual(funding.calldata, transaction.getExecuteCalldata([...plan.fundingCalls], '1').map((value) => `0x${BigInt(value).toString(16)}`));
  assert.notDeepEqual(funding.calldata, transaction.getExecuteCalldata([plan.fundingCalls[0]!], '1'));
  assert.equal(query.review.requiresPrincipalBalance, true);
  assert.equal(query.review.totalBudgetVerified, false);
  assert.deepEqual(query.review.stages, ['accountActivation', 'classDeclaration', 'probeDeployment', 'funding']);
  assert.deepEqual(query.review.omitted, ['privacyRegistration', 'collection', 'protocolFee', 'recoveryReserve']);
  assert.throws(() => buildPredeploymentFeeQuery(account, { ...terms, principalLimit: terms.amount - 1n }, sierra, casm, 123n, '0.14.3', 1000n, true), /PRINCIPAL_LIMIT/);
});

test('Four-stage response cannot silently omit funding or accept its inconsistent fee or denomination', () => {
  assert.equal(parseFeeEstimates([fee, fee, fee, fee], 4).reduce((sum, row) => sum + row.overallFeeFRI, 0n), 128n);
  assert.throws(() => parseFeeEstimates([fee, fee, fee], 4));
  assert.throws(() => parseFeeEstimates([fee, fee, fee, { ...fee, unit: 'WEI' }], 4));
  assert.throws(() => parseFeeEstimates([fee, fee, fee, { ...fee, overall_fee: '0x21' }], 4));
  assert.throws(() => parseFeeEstimates([fee, fee, fee, fee, fee], 5));
});

const deployedOwner = { address: terms.owner, nonce: 17n, version: 1 as const, blockHash: 123n };

test('Deployed owner query binds current nonce and block without simulating activation again', () => {
  const query = buildDeployedOwnerFeeQuery(deployedOwner, terms, sierra, casm, 123n, '0.14.3', 1000n, true);
  assert.deepEqual(query.params.request.map((row) => [row.type, row.nonce]), [['DECLARE', '0x11'], ['INVOKE', '0x12'], ['INVOKE', '0x13']]);
  assert.equal(query.review.requiresUndeployedOwner, false);
  assert.equal(query.review.requiresDeployedOwner, true);
  assert.equal(query.review.ownerNonce, '0x11');
  assert.equal(query.review.ownerNonceBlock, '0x7b');
  assert.deepEqual(query.review.stages, ['classDeclaration', 'probeDeployment', 'funding']);
  assert.equal(query.review.totalBudgetVerified, false);
  assert.deepEqual(query.params.simulation_flags, ['SKIP_VALIDATE']);
  const plan = buildProbeDeploymentPlan(terms, 1000n);
  const funding = query.params.request[2]!;
  assert.ok('calldata' in funding);
  assert.deepEqual(funding.calldata, transaction.getExecuteCalldata([...plan.fundingCalls], '1').map((value) => `0x${BigInt(value).toString(16)}`));
  for (const row of query.params.request) {
    assert.equal(row.version, '0x100000000000000000000000000000003');
    assert.deepEqual(row.signature, []);
    assert.ok('sender_address' in row);
    assert.equal(row.sender_address, account.address);
  }
});

test('Deployed owner fee query supports nonce zero and the selected Cairo execution encoding', () => {
  const query = buildDeployedOwnerFeeQuery({ ...deployedOwner, nonce: 0n, version: 0 }, terms, sierra, casm, 123n, '0.14.3', 1000n);
  assert.deepEqual(query.params.request.map((row) => [row.type, row.nonce]), [['DECLARE', '0x0'], ['INVOKE', '0x1']]);
  assert.deepEqual(query.review.stages, ['classDeclaration', 'probeDeployment']);
  assert.ok(query.review.omitted.includes('funding'));
  const invocation = query.params.request[1]!;
  assert.ok('calldata' in invocation);
  assert.deepEqual(invocation.calldata, transaction.getExecuteCalldata([buildProbeDeploymentPlan(terms, 1000n).deploymentCall], '0').map((value) => `0x${BigInt(value).toString(16)}`));
});

test('Deployed owner estimate rejects stale block context, wrong owner, invalid nonce and overflow of later transaction nonces', () => {
  for (const owner of [{ ...deployedOwner, address: 1n }, { ...deployedOwner, blockHash: 124n }, { ...deployedOwner, nonce: -1n },
    { ...deployedOwner, nonce: FELT_PRIME - 2n }, { ...deployedOwner, version: 2 as 1 }]) {
    assert.throws(() => buildDeployedOwnerFeeQuery(owner, terms, sierra, casm, 123n, '0.14.3', 1000n, true));
  }
  assert.throws(() => buildDeployedOwnerFeeQuery(deployedOwner, { ...terms, probeClassHash: 1n }, sierra, casm, 123n, '0.14.3', 1000n), /WRONG_PROBE_BUILD/);
  assert.throws(() => buildDeployedOwnerFeeQuery(deployedOwner, terms, sierra, casm, 123n, '0.14.3', 2000n), /EXPIRED/);
});

test('Deployed three-stage response rejects activation-sized results and malformed funding resources', () => {
  assert.equal(parseFeeEstimates([fee, fee, fee], 3).length, 3);
  for (const response of [[fee, fee], [fee, fee, fee, fee], [fee, fee, null], [fee, fee, { ...fee, l1_data_gas_price: 'NaN' }]]) {
    assert.throws(() => parseFeeEstimates(response, 3));
  }
});

test('Local deployed-owner CLI serializes three unsigned stages and rejects ambiguous or mismatched inputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vow-fee-query-'));
  try {
    const { probeClassHash: ignored, vaultAddress: ignoredVault, ...publicTerms } = terms;
    assert.ok(ignored > 0n && ignoredVault > 0n);
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
    const accountPath = join(directory, 'account.json');
    const termsPath = join(directory, 'terms.json');
    const blockPath = join(directory, 'block.json');
    const encode = (value: unknown) => JSON.stringify(value, (_, item: unknown) => typeof item === 'bigint' ? `0x${item.toString(16)}` : item);
    await writeFile(accountPath, encode(deployedOwner));
    await writeFile(termsPath, encode({ ...publicTerms, claimBefore: deadline, signatureDeadline: deadline }));
    await writeFile(blockPath, encode({ blockHash: 123n, starknetVersion: '0.14.3' }));
    const args = ['scripts/preview-fees.ts', accountPath, termsPath, blockPath, '--deployed-owner', '--include-funding'];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as { review: { stages: string[]; ownerNonce: string } };
    assert.deepEqual(output.review.stages, ['classDeclaration', 'probeDeployment', 'funding']);
    assert.equal(output.review.ownerNonce, '0x11');
    const duplicate = spawnSync(process.execPath, [...args, '--deployed-owner'], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(duplicate.status, 1);
    assert.equal(duplicate.stdout, '');
    await writeFile(accountPath, encode({ ...deployedOwner, blockHash: 124n }));
    const mismatch = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10_000 });
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /VOW_OWNER_BLOCK_MISMATCH/);
    assert.equal(mismatch.stdout, '');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
