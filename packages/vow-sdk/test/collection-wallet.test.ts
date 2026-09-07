import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CollectionError, walletRequest } from '../src/collection-wallet.ts';
import type { CollectionWallet } from '../src/collection-wallet.ts';

const request = { type: 'wallet_supportedWalletApi' } as const;

test('wallet preparation exposes only a bounded code and an allowlisted failure reason', async () => {
  await assert.rejects(walletRequest({ request: async () => {
    throw { code: 163, message: 'An error occurred (INSUFFICIENT_PRIVATE_BALANCE)', data: { private: 'secret' } };
  } }, request), (error: unknown) => {
    assert.ok(error instanceof CollectionError);
    assert.equal(error.walletCode, 163);
    assert.equal(error.walletReason, 'INSUFFICIENT_PRIVATE_BALANCE');
    assert.equal(JSON.stringify(error).includes('secret'), false);
    return true;
  });
  await assert.rejects(walletRequest({ request: async () => {
    throw { code: '-32602' };
  } }, request), (error: unknown) => {
    assert.ok(error instanceof CollectionError);
    assert.equal(error.walletCode, -32602);
    return true;
  });
  await assert.rejects(walletRequest({ request: async () => {
    throw 'An error occurred (NOT_REGISTERED)';
  } }, request), (error: unknown) => {
    assert.ok(error instanceof CollectionError);
    assert.equal(error.walletReason, 'NOT_REGISTERED');
    return true;
  });
});

test('wallet preparation never exposes arbitrary error names or payloads', async () => {
  for (const message of ['sensitive', 'An error occurred (PRIVATE_KEY)', 'An error occurred (NOT_REGISTERED) extra']) {
    await assert.rejects(walletRequest({ request: async () => { throw { message, data: 'secret' }; } }, request), (error: unknown) => {
      assert.ok(error instanceof CollectionError);
      assert.equal(error.walletCode, undefined);
      assert.equal(error.walletReason, undefined);
      assert.equal(JSON.stringify(error).includes('secret'), false);
      assert.equal(JSON.stringify(error).includes(message), false);
      return true;
    });
  }
});

test('G0 a wallet reason is recovered from nested data, cause and reason fields', async () => {
  const shapes: readonly [unknown, string][] = [
    [Object.assign(new Error('An error occurred (NOT_REGISTERED)'), {}), 'NOT_REGISTERED'],
    [Object.assign(new Error('boom'), { data: { message: 'NOT_REGISTERED' } }), 'NOT_REGISTERED'],
    [Object.assign(new Error('boom'), { cause: { reason: 'PRIVACY_LEAK' } }), 'PRIVACY_LEAK'],
    [Object.assign(new Error('boom'), { error: { message: 'USER_REFUSED_OP' } }), 'USER_REFUSED_OP'],
    [Object.assign(new Error('boom'), { data: { reason: 'INVALID_REQUEST_PAYLOAD' } }), 'INVALID_REQUEST_PAYLOAD'],
  ];
  for (const [thrown, expected] of shapes) {
    const wallet = { request: async () => { throw thrown; } } as unknown as CollectionWallet;
    await assert.rejects(() => walletRequest(wallet, { type: 'wallet_requestChainId' }), (error: unknown) => {
      assert.ok(error instanceof CollectionError);
      assert.equal(error.walletReason, expected);
      return true;
    });
  }
});

test('G0 a numeric wallet code is recovered from nested data without leaking text', async () => {
  const wallet = { request: async () => { throw Object.assign(new Error('secret note detail'), { data: { code: 163 } }); } } as unknown as CollectionWallet;
  await assert.rejects(() => walletRequest(wallet, { type: 'wallet_requestChainId' }), (error: unknown) => {
    assert.ok(error instanceof CollectionError);
    assert.equal(error.walletCode, 163);
    assert.equal(error.message, 'VOW_WALLET_REQUEST_FAILED');
    assert.equal(JSON.stringify(error).includes('secret note detail'), false);
    return true;
  });
});

test('G0 an unrecognised failure still exposes no wallet text', async () => {
  const wallet = { request: async () => { throw new Error('Ready internal path /Users/someone/secret'); } } as unknown as CollectionWallet;
  await assert.rejects(() => walletRequest(wallet, { type: 'wallet_requestChainId' }), (error: unknown) => {
    assert.ok(error instanceof CollectionError);
    assert.equal(error.walletReason, undefined);
    assert.equal(error.walletCode, undefined);
    assert.equal(error.message, 'VOW_WALLET_REQUEST_FAILED');
    return true;
  });
});

test('G0 a reason embedded in surrounding text stays untrusted', async () => {
  for (const message of ['An error occurred (NOT_REGISTERED) extra', 'rpc: NOT_REGISTERED received']) {
    const wallet = { request: async () => { throw { message }; } } as unknown as CollectionWallet;
    await assert.rejects(() => walletRequest(wallet, { type: 'wallet_requestChainId' }), (error: unknown) => {
      assert.ok(error instanceof CollectionError);
      assert.equal(error.walletReason, undefined);
      return true;
    });
  }
});
