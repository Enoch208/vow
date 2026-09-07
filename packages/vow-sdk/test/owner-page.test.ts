import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { ec } from 'starknet';
import { initializeOwner } from '../../../scripts/app/owner.ts';
import type { WriteWallet } from '../../../scripts/app/write-flow.ts';
import { mountPage } from './helpers/app-page.ts';
import { chain, deployed, notDeployed, mandateRow, reader, CHAIN, OWNER, TOKEN, VAULT_ADDRESS, OPERATOR_PRIVATE_KEY } from './helpers/app-vault.ts';

const OPERATOR_KEY = BigInt(ec.starkCurve.getStarkKey(OPERATOR_PRIVATE_KEY));
const SUPPLIER_KEY = BigInt(ec.starkCurve.getStarkKey('0x1234567'));
const PASSWORD = 'a-sixteen-plus-character-password';
const drafts = (count = 2) => JSON.stringify(Array.from({ length: count }, (_, index) => ({
  supplierClaimPublicKey: `0x${SUPPLIER_KEY.toString(16)}`, maximumAmount: String(100 + index),
  validAfter: '900', approveBefore: '5000', claimBefore: '6000', purchaseCommitment: `0x${(index + 1).toString(16)}`,
})));

async function page(context: TestContext, options: { deployment?: typeof deployed | typeof notDeployed; wallet?: WriteWallet } = {}) {
  const mounted = await mountPage(context, 'owner');
  const state = chain();
  const sent: unknown[] = [];
  const downloads: { filename: string; contents: string }[] = [];
  const wallet: WriteWallet = options.wallet ?? { request: async (input) => { sent.push(input); return { transaction_hash: '0xabc' }; } };
  const owner = initializeOwner({ reader: reader(state), loadManifest: async () => options.deployment ?? deployed,
    wallet: () => wallet, download: (filename, contents) => downloads.push({ filename, contents }), now: () => 1000n });
  await mounted.settle(() => mounted.element('deployment-status').textContent !== 'Reading the deployment manifest…');
  return { ...mounted, owner, state, sent, downloads };
}

async function preview(p: Awaited<ReturnType<typeof page>>, permissions = drafts()) {
  await bind(p);
  p.set('owner-address', `0x${OWNER.toString(16)}`);
  p.set('mandate-token', `0x${TOKEN.toString(16)}`);
  p.set('operator-key', `0x${OPERATOR_KEY.toString(16)}`);
  p.set('mandate-expiry', '9000');
  p.set('permission-drafts', permissions);
  p.click('preview-set');
  await p.settle(() => p.element('preview-status').textContent !== 'Building the preview…');
}

async function bind(p: Awaited<ReturnType<typeof page>>) {
  p.click('bind-mandate');
  await p.settle(() => !p.element('bind-mandate').disabled && p.element('bind-status').textContent.includes('mandate id'));
}

async function backupAndVerify(p: Awaited<ReturnType<typeof page>>) {
  p.element('backup-password').value = PASSWORD;
  p.element('backup-password-confirm').value = PASSWORD;
  p.click('download-backup');
  await p.settle(() => p.element('backup-status').textContent !== 'No encrypted backup created.');
  p.click('verify-backup');
  await p.settle(() => p.element('verify-status').textContent !== 'The committed root has not been verified against a downloaded backup.');
}

test('T-OWNER-1 the five mandate totals are five separate values and start unread', async (context) => {
  const p = await page(context);
  for (const total of ['funded', 'available', 'reserved', 'paid', 'reclaimed']) {
    assert.equal(p.element(`ledger-${total}`).textContent, 'unread', total);
  }
  await bind(p);
  p.state.mandates.set('1', mandateRow({ funded: 1000n, reserved: 300n, paid: 200n, reclaimed: 100n }));
  p.click('read-ledger');
  await p.settle(() => p.element('ledger-funded').textContent !== 'unread' && !p.element('read-ledger').disabled);
  assert.equal(p.element('ledger-funded').textContent, '1000');
  assert.equal(p.element('ledger-reserved').textContent, '300');
  assert.equal(p.element('ledger-paid').textContent, '200');
  assert.equal(p.element('ledger-reclaimed').textContent, '100');
  assert.equal(p.element('ledger-available').textContent, '400');
});

test('T-OWNER-2 the public preview is shown before creation and names exactly what stays withheld', async (context) => {
  const p = await page(context);
  assert.equal(p.element('preview-set').disabled, true);
  await preview(p);
  const disclosure = p.element('disclosure').textContent;
  assert.match(disclosure, /"status": "preview-only"/);
  assert.match(disclosure, /permissionCommitmentRoot/);
  assert.match(disclosure, /"committedSlots": "16"/);
  assert.match(disclosure, /every supplier claim public key in this set/);
  assert.match(disclosure, /how many of the 16 committed slots hold a real permission/);
  assert.match(disclosure, /"realPermissions": 2/);
  assert.doesNotMatch(disclosure, new RegExp(SUPPLIER_KEY.toString(16)));
  assert.match(p.element('set-root').textContent, /Committed root 0x[0-9a-f]+/);
  assert.equal(p.sent.length, 0);
  assert.equal(p.element('create-mandate').disabled, true);
});

test('T-OWNER-3 creation stays blocked until a downloaded backup restores the previewed root', async (context) => {
  const p = await page(context);
  await preview(p);
  assert.equal(p.element('verify-backup').disabled, true);
  assert.equal(p.element('create-mandate').disabled, true);
  p.click('create-mandate');
  await p.settle(() => true);
  assert.equal(p.sent.length, 0);
  await backupAndVerify(p);
  assert.equal(p.downloads.length, 1);
  assert.match(p.downloads[0]!.filename, /^vow-permission-set-0x[0-9a-f]+\.json$/);
  assert.doesNotMatch(p.downloads[0]!.contents, new RegExp(SUPPLIER_KEY.toString(16)));
  const root = /Committed root (0x[0-9a-f]+)/.exec(p.element('set-root').textContent)![1];
  assert.match(p.element('verify-status').textContent, new RegExp(`restores to the previewed root ${root}`));
  assert.equal(p.element('create-mandate').disabled, false);
});

test('T-OWNER-4 a wrong backup password fails the root check and keeps creation blocked', async (context) => {
  const p = await page(context);
  await preview(p);
  p.element('backup-password').value = PASSWORD;
  p.element('backup-password-confirm').value = PASSWORD;
  p.click('download-backup');
  await p.settle(() => p.element('backup-status').textContent !== 'No encrypted backup created.');
  p.set('backup-password', 'a-different-sixteen-character-password');
  p.element('backup-password').value = 'a-different-sixteen-character-password';
  assert.equal(p.element('verify-backup').disabled, true);
  p.click('create-mandate');
  await p.settle(() => true);
  assert.equal(p.sent.length, 0);
});

test('T-OWNER-5 an editing change after verification discards the set and re-blocks creation', async (context) => {
  const p = await page(context);
  await preview(p);
  await backupAndVerify(p);
  assert.equal(p.element('create-mandate').disabled, false);
  p.set('mandate-expiry', '9500');
  assert.equal(p.element('create-mandate').disabled, true);
  assert.equal(p.element('disclosure').textContent, 'No permission set previewed.');
  p.click('create-mandate');
  await p.settle(() => true);
  assert.equal(p.sent.length, 0);
});

test('T-OWNER-6 an approved creation walks READY to SUBMITTED to CONFIRMED and never sends twice', async (context) => {
  const p = await page(context);
  await preview(p);
  await backupAndVerify(p);
  assert.equal(p.element('write-state').textContent, 'READY');
  p.click('create-mandate');
  await p.settle(() => p.element('write-state').textContent === 'SUBMITTED');
  assert.equal(p.sent.length, 1);
  const request = p.sent[0] as { type: string; params: { invoke_transaction: { entry_point: string; calldata: string[] }[] } };
  assert.equal(request.type, 'wallet_addInvokeTransaction');
  assert.equal(request.params.invoke_transaction[0]!.calldata.length, 5);
  assert.equal(p.element('write-hash').textContent, '0xabc');
  assert.equal(p.element('create-mandate').disabled, true);
  p.element('create-mandate').handlers.get('click')?.();
  await p.settle(() => true);
  assert.equal(p.sent.length, 1);
});

test('T-OWNER-7 without a deployment manifest every write control stays disabled', async (context) => {
  const p = await page(context, { deployment: notDeployed });
  assert.match(p.element('deployment-status').textContent, /No VowVault deployment manifest exists/);
  assert.match(p.element('deployment-status').textContent, /stays disabled/);
  for (const id of ['bind-mandate', 'preview-set', 'permission-drafts', 'download-backup', 'verify-backup', 'create-mandate', 'read-ledger']) {
    assert.equal(p.element(id).disabled, true, id);
  }
  p.click('preview-set'); p.click('create-mandate');
  await p.settle(() => true);
  assert.equal(p.sent.length, 0);
  assert.equal(p.element('write-state').textContent, 'READY');
});

test('T-OWNER-8 a permission that outlives its mandate or names an off-curve supplier is refused', async (context) => {
  const p = await page(context);
  await preview(p, drafts().replace('"claimBefore":"6000"', '"claimBefore":"99000"'));
  assert.match(p.element('preview-status').textContent, /VOW_PERMISSION_OUTLIVES_MANDATE/);
  assert.equal(p.element('disclosure').textContent, 'No permission set previewed.');
  await preview(p, JSON.stringify([{ supplierClaimPublicKey: '0x5', maximumAmount: '10', validAfter: '900',
    approveBefore: '5000', claimBefore: '6000', purchaseCommitment: '0x1' }]));
  assert.match(p.element('preview-status').textContent, /VOW_INVALID_SUPPLIER_KEY/);
  assert.equal(p.element('create-mandate').disabled, true);
});

test('T-OWNER-9 the mandate id is read from chain, never typed, and is warned to be a prediction', async (context) => {
  const p = await page(context);
  p.state.mandates.set('1', mandateRow());
  p.state.mandates.set('2', mandateRow());
  assert.equal(p.ids.includes('mandate-id'), false);
  await bind(p);
  assert.match(p.element('bind-status').textContent, new RegExp(`Vault 0x${VAULT_ADDRESS.toString(16)} · next unassigned mandate id 3`));
  assert.match(p.element('bind-status').textContent, /prediction/);
  assert.equal(p.element('deployment-status').textContent.includes(CHAIN.toString(16)), false);
});
