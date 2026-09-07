import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WriteFlow } from '../../../scripts/app/write-flow.ts';
import type { SettledState, WriteState } from '../../../scripts/app/write-flow.ts';
import { createMandateInvoke } from '../../../scripts/app/vault-invoke.ts';

const request = createMandateInvoke({ vaultAddress: 0x201n, owner: 0x303n, root: 0x99n, operatorKey: 0x3n, token: 0x202n, expiresAt: 5000n });
const never = new Promise<never>(() => {});
const flow = (states: WriteState[]) => new WriteFlow((outcome) => states.push(outcome.state));
const settle = (value: SettledState) => async () => value;

test('T-WRITE-1 a wallet hash reaches SUBMITTED, a matching receipt reaches CONFIRMED, and no dispatch may repeat', async () => {
  const states: WriteState[] = [];
  const write = flow(states);
  let calls = 0;
  assert.equal(write.outcome.state, 'READY');
  assert.equal(write.outcome.retryAllowed, false);
  const submitted = await write.submit({ wallet: { request: async () => { calls++; return { transaction_hash: '0xabc' }; } },
    request, preflight: async () => {}, timeoutMs: 1000 });
  assert.equal(submitted.state, 'SUBMITTED');
  assert.equal(submitted.transactionHash, '0xabc');
  assert.equal(calls, 1);
  await assert.rejects(() => write.submit({ wallet: { request: async () => { calls++; return { transaction_hash: '0xabc' }; } },
    request, preflight: async () => {}, timeoutMs: 1000 }), /VOW_WRITE_NOT_RETRYABLE/);
  assert.equal(calls, 1);
  assert.equal((await write.reconcile(settle('CONFIRMED'))).state, 'CONFIRMED');
  await assert.rejects(() => write.reconcile(settle('UNKNOWN')), /VOW_WRITE_ALREADY_SETTLED/);
  assert.deepEqual(states, ['SUBMITTED', 'CONFIRMED']);
});

test('T-WRITE-2 an explicit wallet refusal is REJECTED, keeps no hash and is never reconciled or resent', async () => {
  const write = new WriteFlow();
  let calls = 0;
  const outcome = await write.submit({ wallet: { request: async () => { calls++; throw { code: 113, data: 'sensitive-wallet-error' }; } },
    request, preflight: async () => {}, timeoutMs: 1000 });
  assert.equal(outcome.state, 'REJECTED');
  assert.equal(outcome.transactionHash, null);
  assert.doesNotMatch(outcome.detail, /sensitive-wallet-error/);
  await assert.rejects(() => write.reconcile(settle('CONFIRMED')), /VOW_WRITE_ALREADY_SETTLED/);
  await assert.rejects(() => write.submit({ wallet: { request: async () => { calls++; return { transaction_hash: '0x1' }; } },
    request, preflight: async () => {}, timeoutMs: 1000 }), /VOW_WRITE_NOT_RETRYABLE/);
  assert.equal(calls, 1);
});

test('T-WRITE-3 a timeout is UNKNOWN, never a retry, and a late wallet hash stays UNKNOWN until reconciled', async () => {
  const states: WriteState[] = [];
  const write = flow(states);
  let resolve: (value: unknown) => void = () => {};
  const outcome = await write.submit({ wallet: { request: () => new Promise((done) => { resolve = done; }) },
    request, preflight: async () => {}, timeoutMs: 5 });
  assert.equal(outcome.state, 'UNKNOWN');
  assert.equal(outcome.transactionHash, null);
  assert.match(outcome.detail, /not permission to retry/);
  await assert.rejects(() => write.submit({ wallet: { request: async () => ({ transaction_hash: '0x1' }) },
    request, preflight: async () => {}, timeoutMs: 1000 }), /VOW_WRITE_NOT_RETRYABLE/);
  resolve({ transaction_hash: '0xfeed' });
  await delay(10);
  assert.equal(write.outcome.state, 'UNKNOWN');
  assert.equal(write.outcome.transactionHash, '0xfeed');
  assert.equal((await write.reconcile(settle('REVERTED'))).state, 'REVERTED');
  assert.deepEqual(states, ['UNKNOWN', 'UNKNOWN', 'REVERTED']);
});

test('T-WRITE-4 an unresolved wallet outcome without a hash blocks reconciliation until one is recovered', async () => {
  const write = new WriteFlow();
  const outcome = await write.submit({ wallet: { request: async () => { throw { code: 163, data: 'sensitive-wallet-error' }; } },
    request, preflight: async () => {}, timeoutMs: 1000 });
  assert.equal(outcome.state, 'UNKNOWN');
  assert.equal(write.reconcilable, false);
  await assert.rejects(() => write.reconcile(settle('CONFIRMED')), /VOW_NO_TRANSACTION_HASH/);
  assert.equal(write.attachTransactionHash(0xbeefn).transactionHash, '0xbeef');
  assert.throws(() => write.attachTransactionHash(0xd00dn), /VOW_TRANSACTION_HASH_CHANGED/);
  assert.equal(write.reconcilable, true);
  assert.equal((await write.reconcile(settle('CONFIRMED'))).state, 'CONFIRMED');
});

test('T-WRITE-5 a malformed wallet result is UNKNOWN, never SUBMITTED', async () => {
  for (const response of [{ transaction_hash: '0x0' }, { transaction_hash: 'nope' }, { hash: '0x1' }, { transaction_hash: '0x1', extra: 1 }, null]) {
    const write = new WriteFlow();
    const outcome = await write.submit({ wallet: { request: async () => response }, request, preflight: async () => {}, timeoutMs: 1000 });
    assert.equal(outcome.state, 'UNKNOWN', JSON.stringify(response));
    assert.equal(outcome.transactionHash, null);
  }
});

test('T-WRITE-6 a failed preflight never signs or sends and leaves the flow dispatchable', async () => {
  const write = new WriteFlow();
  let calls = 0;
  const outcome = await write.submit({ wallet: { request: async () => { calls++; return { transaction_hash: '0x1' }; } },
    request, preflight: async () => { throw new Error('VOW_PERMISSION_USED'); }, timeoutMs: 1000 });
  assert.equal(outcome.state, 'READY');
  assert.equal(calls, 0);
  assert.match(outcome.detail, /VOW_PERMISSION_USED/);
  assert.equal(write.dispatchable, true);
  assert.equal((await write.submit({ wallet: { request: async () => { calls++; return { transaction_hash: '0x7' }; } },
    request, preflight: async () => {}, timeoutMs: 1000 })).state, 'SUBMITTED');
  assert.equal(calls, 1);
});

test('T-WRITE-7 a reconciliation that throws stays UNKNOWN instead of claiming an outcome', async () => {
  const write = new WriteFlow();
  await write.submit({ wallet: { request: async () => ({ transaction_hash: '0xabc' }) }, request, preflight: async () => {}, timeoutMs: 1000 });
  const outcome = await write.reconcile(async () => { throw new Error('rpc down'); });
  assert.equal(outcome.state, 'UNKNOWN');
  assert.equal(outcome.transactionHash, '0xabc');
  assert.equal(write.reconcilable, true);
});

test('T-WRITE-8 a rejected timeout value is refused before anything is signed', async () => {
  const write = new WriteFlow();
  for (const timeoutMs of [0, -1, 600_001, 1.5, Number.NaN]) {
    await assert.rejects(() => write.submit({ wallet: { request: () => never }, request, preflight: async () => {}, timeoutMs }), /VOW_INVALID_WRITE_TIMEOUT/);
  }
  assert.equal(write.outcome.state, 'READY');
});
