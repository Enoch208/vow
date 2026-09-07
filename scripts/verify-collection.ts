import { readFile } from 'node:fs/promises';
import { hash } from 'starknet';
import type { CompiledSierra } from 'starknet';
import { createPublicReader } from '../packages/vow-sdk/src/probe-reader.ts';
import { readCollectionReceipt } from '../packages/vow-sdk/src/collection-receipt.ts';
import { parseConfiguration, parsePublicInteger } from './collection/configuration.ts';
import { PUBLIC_MAINNET_RPC } from '../packages/vow-sdk/src/rpc-endpoint.ts';

async function main(): Promise<void> {
  if (process.argv[2] === '--help') {
    process.stdout.write('Usage: node scripts/verify-collection.ts public-configuration.json transaction-hash note-id\nReads public receipt, block, class, configuration and trace from Cartridge mainnet RPC. No signing, transaction submission, balances or note decryption. Outputs a public summary only.\n');
    return;
  }
  if (process.argv.length !== 5) throw new Error('VOW_RECEIPT_ARGUMENTS_REQUIRED');
  const transactionHash = parsePublicInteger(process.argv[3]);
  const noteId = parsePublicInteger(process.argv[4]);
  const source = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_CollectionProbe.contract_class.json', 'utf8')) as CompiledSierra;
  const configuration = parseConfiguration(await readFile(process.argv[2]!, 'utf8'), BigInt(hash.computeContractClassHash(source)));
  const reader = createPublicReader(PUBLIC_MAINNET_RPC);
  const report = await readCollectionReceipt(reader, configuration, transactionHash, noteId);
  process.stdout.write(JSON.stringify(report, (_, value: unknown) => typeof value === 'bigint' ? `0x${value.toString(16)}` : value, 2) + '\n');
  if (report.status !== 'confirmed') process.exitCode = 2;
}

try { await main(); }
catch (error: unknown) {
  const message = error instanceof Error && /^VOW_[A-Z_]+$/.test(error.message) ? error.message : 'VOW_RECEIPT_CHECK_FAILED';
  process.stderr.write(`${message}\n`); process.exitCode = 1;
}
