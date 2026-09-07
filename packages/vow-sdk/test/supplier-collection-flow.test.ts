import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CollectionSession } from '../src/collection-session.ts';
import { SupplierKey } from '../src/supplier-key.ts';
import { createSupplierBackup, unlockSupplierBackup } from '../src/supplier-backup.ts';
import { parseClaimReview } from '../../../scripts/supplier/claim-review.ts';
import { config, snapshot, prepared } from './helpers/collection.ts';

test('G0 local integration restores a supplier backup, reviews the client claim and binds the final preparation', async () => {
  const bytes = new Uint8Array(32); bytes.set([0x12, 0x34, 0x56], 29);
  const original = SupplierKey.restore(bytes); bytes.fill(0);
  const password = 'synthetic integration password';
  const encrypted = await createSupplierBackup(original, password); original.lock();
  const key = await unlockSupplierBackup(encrypted, password);
  const chainId = 0x534e5f4d41494en;
  const client = new CollectionSession({ ...config, chainId }, {
    wallet: { request: async (request) => request.type === 'wallet_requestChainId' ? '0x534e5f4d41494e' : prepared(request) },
    now: () => 1000n, readSnapshot: async () => ({ ...snapshot, chainId }),
  });
  try {
    const candidate = await client.prepare();
    const transfer = JSON.stringify(candidate, (_, value: unknown) => typeof value === 'bigint' ? `0x${value.toString(16)}` : value);
    const reviewed = parseClaimReview(transfer, 1000n);
    const signature = key.sign(reviewed.claim, reviewed.supplierKey, 1000n);
    key.lock();
    await client.prove(signature);
    assert.equal(client.hasPreparedCall(), true);
    assert.equal((await client.releasePreparedCall()).call.contract_address, '0x37');
  } finally { key.lock(); }
});
