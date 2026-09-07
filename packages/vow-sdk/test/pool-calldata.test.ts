import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodePoolActions } from '../src/pool-calldata.ts';

const observed = ['0x3', '0x0',
  '0x279b7ac51affcdd2372e5f0f7c046920eb458079968877bb0d26bd0e731e7e1', '0x2',
  '0x100000000000000000000000000000000',
  '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d', '0x7',
  '0x1eed60b8d483b3bede62d1cc0f32874aea30747e6943437c858359b41801bf7',
  '0x2d59361674fbcf66cd07bfaba9e859eabbe2f3079abb8e1cbc343f3589f92fd',
  '0x1131e25a99421fd4125998d64cf921725bf2b188b9b9daf9df18e819c94d32d',
  '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  '0x742e1f7ec6577908b001ec68ae8f516221f2987c20873848c6394bd5b89945f', '0xa',
  '0x641ca5237870312273ed2cd693372ee49e103d5c585af6185324f3662e15227', '0x6',
  '0x434c41494d',
  '0x45cc6c11f29f5fe7b53eee680c0626324e344af8d021ca7af58a1b1ecf2bb2b',
  '0x742e1f7ec6577908b001ec68ae8f516221f2987c20873848c6394bd5b89945f',
  '0x6a9fb000', '0x0', '0x0'];

test('T-015 the observed Ready mainnet preparation decodes without a screening suffix', () => {
  const actions = decodePoolActions(observed);
  assert.equal(actions.length, 3);
  const note = actions.find((action) => action.kind === 'openNote');
  const invoke = actions.find((action) => action.kind === 'invoke');
  assert.ok(note && note.kind === 'openNote');
  assert.ok(invoke && invoke.kind === 'invoke');
  assert.equal(note.note, 0x742e1f7ec6577908b001ec68ae8f516221f2987c20873848c6394bd5b89945fn);
  assert.equal(invoke.target, 0x641ca5237870312273ed2cd693372ee49e103d5c585af6185324f3662e15227n);
  assert.equal(invoke.calldata.length, 6);
  assert.equal(invoke.calldata[2], note.note);
});

test('T-015 observed action and screening suffix truncation fail closed', () => {
  for (let length = 0; length < observed.length; length += 1) {
    assert.throws(() => decodePoolActions(observed.slice(0, length)), /VOW_TRUNCATED_CALLDATA/);
  }
  for (const suffix of [['0x0'], ['0x0', '0x1'], ['0x0', '0x1', '0x2']]) {
    assert.throws(() => decodePoolActions([...observed, ...suffix]), /VOW_TRUNCATED_CALLDATA/);
  }
  assert.equal(decodePoolActions([...observed, '0x1']).length, 3);
  assert.equal(decodePoolActions([...observed, '0x0', '0x1', '0x2', '0x3']).length, 3);
  assert.throws(() => decodePoolActions([...observed, '0x1', '0x0']), /VOW_TRAILING_CALLDATA/);
});
