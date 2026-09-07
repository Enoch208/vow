import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { runCollectionDispatch } from '../src/collection-dispatch.ts';
import type { CollectionDispatchRequest } from '../src/collection-dispatch.ts';
import { reviewCollectionSubmission } from '../src/collection-submission.ts';
import { SubmissionJournal } from '../src/submission-journal.ts';
import { signClaim } from '../src/claims.ts';
import { buildProbeClaimActions } from '../src/prepared-claim.ts';
import { config, prepared, syntheticKey } from './helpers/collection.ts';

const mainnet = 0x534e5f4d41494en;
async function fixture() {
  const terms = { ...config, chainId: mainnet };
  const claim = { chainId: mainnet, vaultAddress: terms.vaultAddress, mandateId: 1n, reservationId: 1n,
    token: terms.token, amount: terms.amount, outputNoteId: 777n, signatureDeadline: terms.signatureDeadline };
  const signature = signClaim(claim, syntheticKey);
  const raw = prepared({ type: 'wallet_strk20PrepareInvoke', params: {
    actions: buildProbeClaimActions(claim, terms.recipient, signature), simulate: false, api_version: '0.10.3',
  } });
  const reviewed = await reviewCollectionSubmission(raw, terms, 777n, signature, 100n, 1000n);
  const values = new Map<string, string>();
  const journal = new SubmissionJournal({ chainId: mainnet, vaultAddress: terms.vaultAddress, reservationId: 1n }, {
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
  }, navigator.locks);
  let listener = () => {};
  let unsubscribed = 0;
  const requests: CollectionDispatchRequest[] = [];
  const respond = async (request: CollectionDispatchRequest): Promise<unknown> => {
    if (request.type === 'wallet_supportedWalletApi') return ['0.10.3'];
    if (request.type === 'wallet_requestChainId') return `0x${mainnet.toString(16)}`;
    if (request.type === 'wallet_requestAccounts') return ['0x14d'];
    assert.equal(values.size, 1);
    return { transaction_hash: '0xabc' };
  };
  const wallet = {
    request: async (request: CollectionDispatchRequest): Promise<unknown> => { requests.push(request); return respond(request); },
    subscribeInvalidation: (callback: () => void) => { listener = callback; return () => { unsubscribed++; }; },
  };
  const input = { reviewed, approvedReviewDigest: reviewed.review.reviewDigest, expectedAccount: 333n,
    wallet, journal, preflight: async () => {}, now: () => 1001n, timeoutMs: 1000 };
  return { input, requests, respond, values, invalidate: () => listener(), unsubscribed: () => unsubscribed };
}

test('T-006 dispatch checks selected mainnet account and sends the exact reviewed single-use request after journaling', async () => {
  const f = await fixture(); const result = await runCollectionDispatch(f.input);
  assert.deepEqual(result, { status: 'submitted', transactionHash: 0xabcn, recovery: 'saved', walletOutcome: 'submitted', retryAllowed: false });
  assert.deepEqual(f.requests.map((request) => request.type), ['wallet_supportedWalletApi', 'wallet_requestChainId', 'wallet_requestAccounts', 'wallet_requestChainId', 'wallet_addInvokeTransaction']);
  const request = f.requests[4]!;
  assert.equal(request.type, 'wallet_addInvokeTransaction');
  if (request.type !== 'wallet_addInvokeTransaction') throw new Error('TEST_WRONG_REQUEST');
  assert.equal(request.params.calls.length, 1);
  assert.equal(request.params.proof.data, 'synthetic-not-a-real-proof');
  assert.equal(createHash('sha256').update(JSON.stringify(request)).digest('hex'), f.input.reviewed.review.payloadSha256);
  assert.deepEqual(f.requests[2], { type: 'wallet_requestAccounts', params: { silent_mode: true, api_version: '0.10.3' } });
  assert.equal(f.unsubscribed(), 1);
  await assert.rejects(runCollectionDispatch(f.input), /EXISTING_SUBMISSION/);
  assert.equal(f.requests.filter((item) => item.type === 'wallet_addInvokeTransaction').length, 1);
});

test('T-006 wrong approval, wallet account, multiple accounts, unsupported API and changed network prevent wallet write', async () => {
  const wrongApproval = await fixture();
  await assert.rejects(runCollectionDispatch({ ...wrongApproval.input, approvedReviewDigest: 1n }), /REVIEW_CHANGED/);
  assert.equal(wrongApproval.requests.length, 0); assert.equal(wrongApproval.values.size, 0);
  for (const mode of ['account', 'multiple', 'api', 'chain', 'final-chain'] as const) {
    const f = await fixture(); let chainCalls = 0;
    f.input.wallet.request = async (request) => {
      f.requests.push(request);
      if (request.type === 'wallet_requestAccounts' && mode === 'account') return ['0x14e'];
      if (request.type === 'wallet_requestAccounts' && mode === 'multiple') return ['0x14d', '0x14e'];
      if (request.type === 'wallet_supportedWalletApi' && mode === 'api') return ['0.7.2'];
      if (request.type === 'wallet_requestChainId') {
        chainCalls++;
        if (mode === 'chain' || (mode === 'final-chain' && chainCalls === 2)) return '0x1';
      }
      return f.respond(request);
    };
    const result = await runCollectionDispatch(f.input);
    assert.equal(result.walletOutcome, 'not-dispatched'); assert.equal(result.status, 'unknown');
    assert.equal(f.requests.some((item) => item.type === 'wallet_addInvokeTransaction'), false);
  }
});

test('T-018 account invalidation and expiry during preflight prevent release and write', async () => {
  for (const mode of ['invalidation', 'expiry'] as const) {
    const f = await fixture(); let now = 1001n;
    f.input.now = () => now;
    f.input.wallet.request = async (request) => {
      f.requests.push(request);
      if (request.type === 'wallet_requestAccounts') {
        if (mode === 'invalidation') f.invalidate(); else now = 1400n;
      }
      return f.respond(request);
    };
    assert.equal((await runCollectionDispatch(f.input)).walletOutcome, 'not-dispatched');
    assert.equal(f.requests.some((item) => item.type === 'wallet_addInvokeTransaction'), false);
  }
});

test('T-018 preflight timeout fences late reads so they never trigger a wallet write', async () => {
  const f = await fixture(); let finish: (value: unknown) => void = () => {};
  f.input.wallet.request = async (request) => { f.requests.push(request); return new Promise((resolve) => { finish = resolve; }); };
  const result = await runCollectionDispatch({ ...f.input, timeoutMs: 5 });
  assert.equal(result.status, 'unknown'); assert.equal(result.walletOutcome, 'not-dispatched');
  finish(['0.10.3']); await delay(10);
  assert.equal(f.requests.length, 1); assert.equal(f.unsubscribed(), 1);
});

test('T-018 timed-out wallet write retains a late public hash even after wallet invalidation', async () => {
  const f = await fixture(); let finish: (value: unknown) => void = () => {};
  f.input.wallet.request = async (request) => {
    f.requests.push(request);
    if (request.type === 'wallet_addInvokeTransaction') return new Promise((resolve) => { finish = resolve; });
    return f.respond(request);
  };
  const result = await runCollectionDispatch({ ...f.input, timeoutMs: 5 });
  assert.equal(result.status, 'unknown'); assert.equal(result.walletOutcome, 'unknown');
  f.invalidate(); finish({ transaction_hash: '0xabc' }); await delay(10);
  assert.equal((await f.input.journal.read())?.checkpoint.transactionHash, '0xabc');
  await assert.rejects(runCollectionDispatch(f.input), /EXISTING_SUBMISSION/);
});

test('T-018 explicit refusal is distinguished from unknown errors without clearing the attempt or exposing error data', async () => {
  for (const code of [113, 163, 4001]) {
    const f = await fixture();
    f.input.wallet.request = async (request) => {
      if (request.type === 'wallet_addInvokeTransaction') throw { code, message: 'sensitive-error-payload', data: 'hidden' };
      return f.respond(request);
    };
    const result = await runCollectionDispatch(f.input);
    assert.equal(result.walletOutcome, code === 113 ? 'refused' : 'unknown');
    assert.equal(result.status, 'unknown'); assert.equal(result.retryAllowed, false);
    assert.equal(JSON.stringify(result).includes('sensitive'), false);
    await assert.rejects(runCollectionDispatch(f.input), /EXISTING_SUBMISSION/);
  }
});

test('T-018 malformed write results remain unknown and storage failure prevents dispatch', async () => {
  for (const response of [{ transaction_hash: '0x0' }, { transaction_hash: '123' }, { transaction_hash: '0xabc', extra: true }, '0xabc', null]) {
    const f = await fixture();
    f.input.wallet.request = async (request) => request.type === 'wallet_addInvokeTransaction' ? response : f.respond(request);
    const result = await runCollectionDispatch(f.input);
    assert.equal(result.status, 'unknown'); assert.equal(result.transactionHash, null);
  }
  const f = await fixture();
  f.input.journal.reserve = async () => { throw new Error('VOW_RECOVERY_STORAGE_UNAVAILABLE'); };
  await assert.rejects(runCollectionDispatch(f.input), /STORAGE_UNAVAILABLE/);
  assert.equal(f.requests.length, 0); assert.equal(f.unsubscribed(), 1);
});

test('T-018 invalidation subscription failure never exposes wallet errors or dispatches a request', async () => {
  const f = await fixture();
  f.input.wallet.subscribeInvalidation = () => { throw new Error('sensitive-wallet-event-data'); };
  await assert.rejects(runCollectionDispatch(f.input), /^Error: VOW_WALLET_EVENTS_UNAVAILABLE$/);
  assert.equal(f.requests.length, 0); assert.equal(f.values.size, 0);
});

test('T-018 fresh contract and budget preflight runs before final chain check and blocks rejected readiness', async () => {
  const f = await fixture(); let checked = false;
  f.input.preflight = async () => {
    assert.deepEqual(f.requests.map((request) => request.type), ['wallet_supportedWalletApi', 'wallet_requestChainId', 'wallet_requestAccounts']);
    checked = true;
    throw new Error('VOW_NOT_FUNDED');
  };
  const result = await runCollectionDispatch(f.input);
  assert.equal(checked, true); assert.equal(result.walletOutcome, 'not-dispatched');
  assert.equal(f.requests.some((request) => request.type === 'wallet_addInvokeTransaction'), false);
});

test('T-018 delayed contract preflight cannot resume into a write after timeout', async () => {
  const f = await fixture(); let finish = () => {};
  f.input.preflight = () => new Promise<void>((resolve) => { finish = resolve; });
  const result = await runCollectionDispatch({ ...f.input, timeoutMs: 5 });
  assert.equal(result.status, 'unknown'); assert.equal(result.walletOutcome, 'not-dispatched');
  finish(); await delay(10);
  assert.deepEqual(f.requests.map((request) => request.type), ['wallet_supportedWalletApi', 'wallet_requestChainId', 'wallet_requestAccounts']);
});
