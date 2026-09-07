import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { ec } from 'starknet';
import { initializeOperator } from '../../../scripts/app/operator.ts';
import type { WriteWallet } from '../../../scripts/app/write-flow.ts';
import { PermissionSet } from '../src/permission-set.ts';
import type { PermissionRequest } from '../src/permission-set.ts';
import { createPermissionSetBackup } from '../src/permission-backup.ts';
import { computeReservationId } from '../src/reservation-reader.ts';
import { signReserve } from '../src/reserve.ts';
import type { ReserveAuthorization } from '../src/reserve.ts';
import { mountPage } from './helpers/app-page.ts';
import { chain, deployed, notDeployed, mandateRow, reader, CHAIN, TOKEN, VAULT_ADDRESS, OPERATOR_PRIVATE_KEY } from './helpers/app-vault.ts';

const OPERATOR_KEY = BigInt(ec.starkCurve.getStarkKey(OPERATOR_PRIVATE_KEY));
const SUPPLIER_KEY = BigInt(ec.starkCurve.getStarkKey('0x1234567'));
const OTHER_SUPPLIER = BigInt(ec.starkCurve.getStarkKey('0x7654321'));
const PASSWORD = 'a-sixteen-plus-character-password';
const MANDATE = 1n;

const leaf = (permissionId: bigint, supplier: bigint, maximumAmount: bigint): PermissionRequest => ({
  schemaVersion: 1n, chainId: CHAIN, vaultAddress: VAULT_ADDRESS, mandateId: MANDATE, permissionId,
  supplierClaimPublicKey: supplier, token: TOKEN, maximumAmount, validAfter: 900n,
  approveBefore: 5000n, claimBefore: 6000n, purchaseCommitment: 0x777n + permissionId,
});
const set = PermissionSet.create([leaf(0n, SUPPLIER_KEY, 500n), leaf(1n, OTHER_SUPPLIER, 200n)]);
const backup = JSON.stringify(await createPermissionSetBackup(set, PASSWORD));

async function page(context: TestContext, options: { deployment?: typeof deployed | typeof notDeployed; row?: ReturnType<typeof mandateRow> } = {}) {
  const mounted = await mountPage(context, 'operator');
  const state = chain();
  state.mandates.set(MANDATE.toString(), options.row ?? mandateRow({ root: set.root, operatorKey: OPERATOR_KEY, funded: 1000n }));
  const sent: unknown[] = [];
  const wallet: WriteWallet = { request: async (input) => { sent.push(input); return { transaction_hash: '0xabc' }; } };
  initializeOperator({ reader: reader(state), loadManifest: async () => options.deployment ?? deployed,
    wallet: () => wallet, now: () => 1000n });
  await mounted.settle(() => !mounted.element('unlock-permissions').disabled);
  return { ...mounted, state, sent };
}

async function unlock(p: Awaited<ReturnType<typeof page>>, file = backup, password = PASSWORD) {
  p.set('permission-file', file);
  p.element('permission-password').value = password;
  p.click('unlock-permissions');
  await p.settle(() => !p.element('unlock-permissions').disabled && p.element('unlock-status').textContent !== 'No permission set loaded.');
}

async function review(p: Awaited<ReturnType<typeof page>>, slot: number, amount: string) {
  p.element(`permission-${slot}`).checked = true;
  p.element(`permission-${slot}`).fire('change');
  p.set('requested-amount', amount);
  p.click('review-reserve');
  await p.settle(() => !p.element('review-reserve').disabled || p.element('reserve-review').textContent !== 'No reservation reviewed.');
}

function authorization(p: Awaited<ReturnType<typeof page>>): ReserveAuthorization {
  const review = JSON.parse(p.element('reserve-review').textContent) as Record<string, string>;
  const fields = ['chainId', 'vaultAddress', 'mandateId', 'immutableRoot', 'permissionId', 'leafHash', 'requestedAmount', 'requestId', 'requestDeadline'] as const;
  return Object.fromEntries(fields.map((field) => [field, BigInt(review[field]!)])) as unknown as ReserveAuthorization;
}

async function sign(p: Awaited<ReturnType<typeof page>>, key = OPERATOR_PRIVATE_KEY) {
  const signature = signReserve(authorization(p), key);
  p.element('signature-r').value = `0x${signature.r.toString(16)}`;
  p.element('signature-s').value = `0x${signature.s.toString(16)}`;
  p.click('check-signature');
  await p.settle(() => !p.element('check-signature').disabled && p.element('signature-status').textContent !== 'No operator signature checked.');
}

test('T-OPERATOR-1 the screen offers no field for a supplier key, token or deadline', async (context) => {
  const p = await page(context);
  for (const forbidden of ['supplier-key', 'supplier', 'token', 'claim-before', 'request-deadline', 'deadline', 'approve-before']) {
    assert.equal(p.ids.includes(forbidden), false, forbidden);
  }
  await unlock(p);
  await review(p, 0, '100');
  const review0 = p.element('reserve-review').textContent;
  assert.match(review0, /"requestDeadline": "0x514"/);
  assert.match(review0, /this screen cannot extend it/);
  assert.match(review0, new RegExp(`"supplierClaimPublicKey": "0x${SUPPLIER_KEY.toString(16)}"`));
});

test('T-OPERATOR-2 only unused committed permission objects can be selected and padding slots stay hidden', async (context) => {
  const p = await page(context);
  p.state.reservations.set(computeReservationId(MANDATE, 1n).toString(),
    [MANDATE, 1n, set.slot(1n).leafHash, OTHER_SUPPLIER, TOKEN, 50n, 6000n, 0x778n, 1n]);
  await unlock(p);
  assert.match(p.element('unlock-status').textContent, /2 permission objects loaded/);
  assert.equal(p.element('permission-0-slot').hidden, false);
  assert.equal(p.element('permission-1-slot').hidden, false);
  assert.equal(p.element('permission-2-slot').hidden, true);
  assert.equal(p.element('permission-15-slot').hidden, true);
  assert.equal(p.element('permission-0').disabled, false);
  assert.equal(p.element('permission-1').disabled, true);
  assert.match(p.element('permission-1-terms').textContent, /"onChain": "already reserved"/);
  assert.match(p.element('permission-0-terms').textContent, /"onChain": "unused"/);
  assert.equal(p.element('ledger-funded').textContent, '1000');
});

test('T-OPERATOR-3 a permission set that does not match the on-chain mandate root is refused', async (context) => {
  const p = await page(context, { row: mandateRow({ root: 0xdeadn, operatorKey: OPERATOR_KEY }) });
  await unlock(p);
  assert.match(p.element('unlock-status').textContent, /VOW_ROOT_MISMATCH/);
  assert.equal(p.element('permission-0-slot').hidden, true);
  assert.equal(p.element('requested-amount').disabled, true);
  assert.equal(p.element('review-reserve').disabled, true);
});

test('T-OPERATOR-4 an amount over the committed cap or over Available never reaches a review', async (context) => {
  const p = await page(context);
  await unlock(p);
  await review(p, 0, '501');
  assert.match(p.element('reserve-status').textContent, /VOW_OVER_CAP/);
  assert.equal(p.element('reserve-review').textContent, 'No reservation reviewed.');
  const tight = await page(context, { row: mandateRow({ root: set.root, operatorKey: OPERATOR_KEY, funded: 1000n, reserved: 950n }) });
  await unlock(tight);
  await review(tight, 0, '100');
  assert.match(tight.element('reserve-status').textContent, /VOW_INSUFFICIENT_AVAILABLE/);
  assert.equal(tight.sent.length, 0);
});

test('T-OPERATOR-5 a reservation needs a matching operator signature, then sends exactly one reserve call', async (context) => {
  const p = await page(context);
  await unlock(p);
  await review(p, 0, '100');
  assert.equal(p.element('submit-reserve').disabled, true);
  await sign(p, '0x9999999999999999999999999999999999999999999999999999999999');
  assert.match(p.element('signature-status').textContent, /VOW_BAD_OPERATOR_SIG/);
  assert.equal(p.element('submit-reserve').disabled, true);
  p.click('submit-reserve');
  await p.settle(() => true);
  assert.equal(p.sent.length, 0);
  await sign(p);
  assert.match(p.element('signature-status').textContent, /matches this exact authorization/);
  assert.equal(p.element('submit-reserve').disabled, false);
  p.click('submit-reserve');
  await p.settle(() => p.element('write-state').textContent === 'SUBMITTED');
  assert.equal(p.sent.length, 1);
  const request = p.sent[0] as { params: { invoke_transaction: { calldata: string[] }[] } };
  const calldata = request.params.invoke_transaction[0]!.calldata;
  assert.equal(calldata.length, 9 + 13 + 1 + 4 + 2);
  assert.equal(BigInt(calldata[3]!), set.root);
  assert.equal(BigInt(calldata[14]!), SUPPLIER_KEY);
  assert.equal(BigInt(calldata[15]!), TOKEN);
  p.element('submit-reserve').handlers.get('click')?.();
  await p.settle(() => true);
  assert.equal(p.sent.length, 1);
});

test('T-OPERATOR-6 a permission consumed between review and dispatch stops the write at READY', async (context) => {
  const p = await page(context);
  await unlock(p);
  await review(p, 0, '100');
  await sign(p);
  p.state.reservations.set(computeReservationId(MANDATE, 0n).toString(),
    [MANDATE, 0n, set.slot(0n).leafHash, SUPPLIER_KEY, TOKEN, 100n, 6000n, 0x777n, 1n]);
  p.click('submit-reserve');
  await p.settle(() => p.element('write-detail').textContent.includes('VOW_PERMISSION_USED'));
  assert.equal(p.sent.length, 0);
  assert.equal(p.element('write-state').textContent, 'READY');
});

test('T-OPERATOR-7 changing the selection or the amount discards the review and its checked signature', async (context) => {
  const p = await page(context);
  await unlock(p);
  await review(p, 0, '100');
  await sign(p);
  assert.equal(p.element('submit-reserve').disabled, false);
  p.element('permission-0').checked = false;
  p.element('permission-1').checked = true;
  p.element('permission-1').fire('change');
  assert.equal(p.element('submit-reserve').disabled, true);
  assert.equal(p.element('reserve-review').textContent, 'No reservation reviewed.');
  assert.equal(p.element('signature-r').value, '');
  p.click('submit-reserve');
  await p.settle(() => true);
  assert.equal(p.sent.length, 0);
});

test('T-OPERATOR-8 without a deployment manifest no permission set is trusted and no write is possible', async (context) => {
  const p = await page(context, { deployment: notDeployed });
  assert.match(p.element('deployment-status').textContent, /stays disabled/);
  await unlock(p);
  assert.match(p.element('unlock-status').textContent, /No deployed vault/);
  for (const id of ['requested-amount', 'review-reserve', 'check-signature', 'submit-reserve', 'reconcile-reserve']) {
    assert.equal(p.element(id).disabled, true, id);
  }
  assert.equal(p.sent.length, 0);
});
