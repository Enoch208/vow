import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { ec } from 'starknet';
import { OperatorKey } from '../src/operator-key.ts';
import { PermissionSet } from '../src/permission-set.ts';
import { buildCreateMandateCall, buildFundMandateCalls } from '../src/mandate-calldata.ts';
import { buildReserveRequest } from '../src/reserve-request.ts';
import type { PermissionLeaf } from '../src/permissions.ts';

const CHAIN = 0x534e5f4d41494en;
const VAULT = 201n;
const TOKEN = 202n;
const OWNER = 100n;
const MANDATE = 1n;
const CAIRO_FIXTURE = 'contracts/tests/test_sdk_calldata.cairo';

const supplierKey = BigInt(ec.starkCurve.getStarkKey('0x123456'));
const secret = new Uint8Array(32);
const material = 'abcdef'.padStart(64, '0');
for (let index = 0; index < 32; index += 1) {
  secret[index] = Number.parseInt(material.slice(index * 2, index * 2 + 2), 16);
}

function buildSet(): PermissionSet {
  const leaf = (permissionId: bigint, maximumAmount: bigint): PermissionLeaf => ({
    schemaVersion: 1n, chainId: CHAIN, vaultAddress: VAULT, mandateId: MANDATE, permissionId,
    supplierClaimPublicKey: supplierKey, token: TOKEN, maximumAmount, validAfter: 500n,
    approveBefore: 1800n, claimBefore: 2000n, purchaseCommitment: 777n, salt: 900n + permissionId,
  });
  return PermissionSet.assemble({
    permissions: [leaf(0n, 40n), leaf(1n, 30n), leaf(2n, 25n)],
    paddingSalts: Array.from({ length: 13 }, (_unused, index) => 9000n + BigInt(index + 3)),
  });
}

async function cairoFelts(marker: string): Promise<string[]> {
  const source = await readFile(CAIRO_FIXTURE, 'utf8');
  const start = source.indexOf(`fn ${marker}`);
  assert.notEqual(start, -1, `missing ${marker} in the Cairo fixture`);
  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/0x[0-9a-f]+/g)].map((match) => match[0]);
}

const operator = OperatorKey.restore(secret);
const set = buildSet();

test('the Cairo fixture pins the exact create_mandate calldata this SDK builds', async () => {
  const call = buildCreateMandateCall(
    set, { chainId: CHAIN, owner: OWNER, operatorKey: operator.publicKey, expiresAt: 3000n }, 1000n,
  ).call;
  assert.deepEqual(call.calldata, await cairoFelts('create_mandate_calldata'));
});

test('the Cairo fixture pins the exact fund_mandate calldata this SDK builds', async () => {
  const calls = buildFundMandateCalls(set, 100n);
  const fund = calls.find((entry) => entry.entrypoint === 'fund_mandate');
  assert.ok(fund);
  assert.deepEqual(fund.calldata, await cairoFelts('fund_mandate_calldata'));
});

test('the Cairo fixture pins the exact reserve calldata this SDK builds', async () => {
  const request = buildReserveRequest({
    set, operatorKey: operator.publicKey, permissionId: 0n, requestedAmount: 40n, requestId: 55n,
    requestDeadline: 1700n, now: 1000n,
  }, operator);
  const calldata = request.call.calldata as readonly string[];
  assert.equal(calldata.length, 29);
  assert.deepEqual(calldata, await cairoFelts('reserve_calldata'));
  assert.equal(
    request.reservationId,
    0x45cc6c11f29f5fe7b53eee680c0626324e344af8d021ca7af58a1b1ecf2bb2bn,
  );
});

test('the reserve calldata is exactly authorization, leaf, proof and signature in order', () => {
  const request = buildReserveRequest({
    set, operatorKey: operator.publicKey, permissionId: 0n, requestedAmount: 40n, requestId: 55n,
    requestDeadline: 1700n, now: 1000n,
  }, operator);
  const calldata = (request.call.calldata as readonly string[]).map(BigInt);
  assert.equal(calldata.length, 9 + 13 + 1 + 4 + 2);
  assert.equal(calldata[0], CHAIN);
  assert.equal(calldata[1], VAULT);
  assert.equal(calldata[6], 40n);
  assert.equal(calldata[9], 1n);
  assert.equal(calldata[22], 4n);
  assert.equal(calldata[27], request.signature.r);
  assert.equal(calldata[28], request.signature.s);
});
