import { readFile } from 'node:fs/promises';
import { hash } from 'starknet';
import type { CompiledSierra } from 'starknet';

const artifact = JSON.parse(await readFile(
  'contracts/target/dev/vow_collection_probe_VowVault.contract_class.json', 'utf8',
)) as CompiledSierra;
process.stdout.write(`${hash.computeContractClassHash(artifact)}\n`);
