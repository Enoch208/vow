import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { POOL_CLASS_HASH } from '../src/prepared-claim.ts';

interface AbiEntry {
  type: string;
  name: string;
  members?: { name: string; type: string }[];
  variants?: { name: string; type: string }[];
}

test('T-015 decoder schema matches the recorded live pool ABI and class', async () => {
  const abi: AbiEntry[] = JSON.parse(await readFile(new URL('../../../evidence/pool-abi.json', import.meta.url), 'utf8'));
  const observation: { classHash: string; abiSha256: string } = JSON.parse(await readFile(new URL('../../../evidence/pool-observation.json', import.meta.url), 'utf8'));
  assert.equal(BigInt(observation.classHash), POOL_CLASS_HASH);
  assert.equal(createHash('sha256').update(JSON.stringify(abi)).digest('hex'), observation.abiSha256);
  const variants = abi.find((item) => item.name === 'privacy::actions::ServerAction')?.variants;
  assert.deepEqual(variants?.map((item) => item.name), [
    'WriteOnce', 'Append', 'TransferFrom', 'TransferTo', 'EmitViewingKeySet', 'EmitWithdrawal',
    'EmitDeposit', 'EmitOpenNoteCreated', 'EmitEncNoteCreated', 'EmitNoteUsed', 'Invoke', 'InvokeWithComputation',
  ]);
  const widths: Record<string, number> = {
    'core::felt252': 1, 'core::integer::u128': 1, 'core::integer::u64': 1,
    'core::starknet::contract_address::ContractAddress': 1,
  };
  const width = (name: string): number => {
    if (widths[name]) return widths[name];
    const struct = abi.find((item) => item.type === 'struct' && item.name === name);
    assert.ok(struct?.members, name);
    return struct.members.reduce((sum, member) => sum + width(member.type), 0);
  };
  for (const [name, size] of Object.entries({ Append: 4, TransferFrom: 3, TransferTo: 3, EmitViewingKeySet: 5, EmitWithdrawal: 6, EmitDeposit: 3, EmitOpenNoteCreated: 5, EmitEncNoteCreated: 2, EmitNoteUsed: 1 })) {
    assert.equal(width(variants!.find((item) => item.name === name)!.type), size, name);
  }
  assert.deepEqual(abi.find((item) => item.name === 'privacy::actions::InvokeInput')?.members?.map((member) => member.name), ['contract_address', 'calldata']);
  assert.deepEqual(abi.find((item) => item.name === 'privacy::events::OpenNoteCreated' && item.type === 'struct')?.members?.map((member) => member.name), ['enc_recipient_addr', 'token', 'note_id']);
});
