import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeRecovery } from '../../../scripts/collection/recovery.ts';
import { receiptFixture, receiptConfig as config, noteId, txHash, hex } from './helpers/receipt.ts';

class Element {
  value = '';
  textContent = '';
  disabled = false;
  readonly handlers = new Map<string, () => void>();
  addEventListener(name: string, handler: () => void): void { this.handlers.set(name, handler); }
  fire(name: string): void { if (name !== 'click' || !this.disabled) this.handlers.get(name)?.(); }
}
function page(t: TestContext) {
  const elements = new Map(['read-recovery', 'verify-receipt', 'transaction-hash', 'receipt-note', 'recovery-status', 'receipt-report'].map((name) => [name, new Element()]));
  const documentBefore = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const windowBefore = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: (name: string) => elements.get(name) } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } } });
  t.after(() => {
    if (documentBefore) Object.defineProperty(globalThis, 'document', documentBefore); else Reflect.deleteProperty(globalThis, 'document');
    if (windowBefore) Object.defineProperty(globalThis, 'window', windowBefore); else Reflect.deleteProperty(globalThis, 'window');
  });
  return { element: (name: string) => elements.get(name)!, storage };
}

test('T-018 recovery page gates reads on validated terms, clears old confirmation on edits and stores no inputs', async (t) => {
  const p = page(t); const f = receiptFixture(); const ui = initializeRecovery(f.reader);
  assert.equal(p.element('verify-receipt').disabled, true); assert.equal(p.element('read-recovery').disabled, true);
  ui.setConfiguration(config);
  p.element('transaction-hash').value = hex(txHash); p.element('receipt-note').value = hex(noteId);
  p.element('receipt-note').fire('input');
  assert.equal(p.element('verify-receipt').disabled, false);
  p.element('verify-receipt').fire('click'); await delay(10);
  assert.match(p.element('recovery-status').textContent, /events and call path matched/);
  assert.match(p.element('receipt-report').textContent, /"status": "confirmed"/);
  p.element('transaction-hash').fire('input');
  assert.doesNotMatch(p.element('recovery-status').textContent, /matched/);
  assert.equal(p.element('receipt-report').textContent, 'No receipt checked.');
  assert.equal(p.storage.size, 0);
  p.element('read-recovery').fire('click'); await delay(10);
  assert.equal(p.element('receipt-report').textContent, 'No saved attempt.');
});

test('T-018 changing terms during an asynchronous receipt check discards its late result', async (t) => {
  const p = page(t); const f = receiptFixture();
  let resolve: (value: unknown) => void = () => { throw new Error('TEST_NOT_STARTED'); };
  const ui = initializeRecovery({ request: (method, args) => method === 'starknet_chainId' ? new Promise((done) => { resolve = done; }) : f.reader.request(method, args) });
  ui.setConfiguration(config);
  p.element('transaction-hash').value = hex(txHash); p.element('receipt-note').value = hex(noteId);
  p.element('receipt-note').fire('input'); p.element('verify-receipt').fire('click');
  ui.setConfiguration(undefined); resolve(hex(config.chainId)); await delay(10);
  assert.equal(p.element('receipt-report').textContent, 'No receipt checked.');
  assert.equal(p.element('verify-receipt').disabled, true);
  assert.match(p.element('recovery-status').textContent, /Validate public terms/);
});

test('T-018 malformed public inputs never reach RPC and do not appear in error output', async (t) => {
  const p = page(t); let calls = 0;
  const ui = initializeRecovery({ request: async () => { calls++; throw new Error(); } });
  ui.setConfiguration(config);
  p.element('transaction-hash').value = 'test-invalid-input'; p.element('receipt-note').value = hex(noteId);
  p.element('receipt-note').fire('input'); p.element('verify-receipt').fire('click'); await delay(10);
  assert.equal(calls, 0);
  assert.doesNotMatch(p.element('receipt-report').textContent, /test-invalid-input/);
  assert.match(p.element('recovery-status').textContent, /could not complete/);
});
