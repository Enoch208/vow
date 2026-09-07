import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

class Element {
  value = '';
  textContent = '';
  disabled = false;
  checked = false;
  type = 'password';
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  fill(value: string): void { this.value = value; this.handlers.get('input')?.(); }
  handlers = new Map<string, () => void>();
  addEventListener(event: string, handler: () => void): void { this.handlers.set(event, handler); }
  click(): void { assert.equal(this.disabled, false); this.handlers.get('click')?.(); }
}

async function page(browserCrypto: unknown = globalThis.crypto) {
  const elements = new Map<string, Element>();
  const element = (id: string): Element => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  const context = { document: { getElementById: element }, window: { addEventListener() {} },
    crypto: browserCrypto, TextEncoder, TextDecoder, Uint8Array, Uint16Array, Uint32Array,
    Int32Array, ArrayBuffer, DataView, Blob, URL, setTimeout: () => 1, clearTimeout() {} };
  runInNewContext(await readFile(new URL('../../../dist/supplier/browser.js', import.meta.url), 'utf8'), context);
  return element;
}

async function settled(element: (id: string) => Element): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (element('unlock').disabled && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(element('unlock').disabled, false, 'The create operation must finish');
}

test('Supplier bundled page validates length and matching live before enabling Create', async () => {
  const element = await page();
  assert.match(element('password-length').textContent, /0 \/ 16/);
  assert.equal(element('create').disabled, true);
  element('new-password').fill('a'.repeat(15));
  assert.match(element('password-length').textContent, /Add 1 more/);
  element('confirm-password').fill('a'.repeat(15));
  assert.equal(element('create').disabled, true);
  element('new-password').fill('a'.repeat(16));
  assert.match(element('password-length').textContent, /Minimum length met/);
  assert.match(element('password-match').textContent, /do not match yet/);
  element('confirm-password').fill('a'.repeat(16));
  assert.match(element('password-match').textContent, /Passwords match/);
  assert.equal(element('create').disabled, false);
  element('new-password').fill('b'.repeat(16));
  assert.equal(element('create').disabled, true);
  for (const length of [1024, 1025]) {
    element('new-password').fill('a'.repeat(length));
    element('confirm-password').fill('a'.repeat(length));
    assert.equal(element('create').disabled, length > 1024);
  }
  assert.match(element('password-length').textContent, /too long/);
  assert.equal(element('download').disabled, true);
});

test('Supplier bundled page encrypts a disposable backup and enables Download after completion', async () => {
  const element = await page();
  element('new-password').fill('synthetic test password only');
  element('confirm-password').fill('synthetic test password only');
  element('create').click();
  assert.match(element('backup-status').textContent, /Creating your encrypted backup/);
  assert.equal(element('download').disabled, true);
  await settled(element);
  assert.match(element('backup-status').textContent, /Encrypted backup ready/);
  assert.equal(element('download').disabled, false);
  assert.equal(element('new-password').value, '');
  assert.equal(element('confirm-password').value, '');
  assert.equal(element('public-key').value, '');
  assert.equal(element('create').disabled, true);
  element('new-password').fill('short');
  assert.equal(element('download').disabled, false);
  element('lock').click();
  assert.equal(element('download').disabled, true);
});

test('Supplier bundled page reports missing browser encryption beside Create and keeps Download disabled', async () => {
  const element = await page({});
  element('new-password').fill('synthetic test password only');
  element('confirm-password').fill('synthetic test password only');
  element('create').click();
  await settled(element);
  assert.match(element('backup-status').textContent, /browser cannot encrypt/);
  assert.equal(element('download').disabled, true);
});

test('Supplier bundled page discards an encryption result when the user locks during creation', async () => {
  const element = await page();
  element('new-password').fill('synthetic test password only');
  element('confirm-password').fill('synthetic test password only');
  element('create').click();
  element('lock').click();
  await settled(element);
  assert.equal(element('download').disabled, true);
  assert.equal(element('status').textContent, 'Key locked.');
  assert.match(element('backup-status').textContent, /Session cleared/);
});

test('Supplier password eyes toggle independently and mask all fields after lock', async () => {
  const element = await page();
  for (const id of ['new-password', 'confirm-password', 'unlock-password']) {
    assert.equal(element(`${id}-toggle`).disabled, true);
    element(id).fill('synthetic test password only');
    element(`${id}-toggle`).click();
    assert.equal(element(id).type, 'text');
    assert.equal(element(`${id}-toggle`).attributes.get('aria-pressed'), 'true');
    assert.match(element(`${id}-toggle`).attributes.get('aria-label')!, /^Hide /);
    element(`${id}-toggle`).click();
    assert.equal(element(id).type, 'password');
    element(`${id}-toggle`).click();
  }
  element('lock').click();
  for (const id of ['new-password', 'confirm-password', 'unlock-password']) {
    assert.equal(element(id).type, 'password');
    assert.equal(element(id).value, '');
    assert.equal(element(`${id}-toggle`).disabled, true);
    assert.equal(element(`${id}-toggle`).attributes.get('aria-pressed'), 'false');
  }
});
