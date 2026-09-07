import { readFile } from 'node:fs/promises';
import { hash } from 'starknet';
import type { CompiledSierra } from 'starknet';
import { createPublicReader } from '../packages/vow-sdk/src/probe-reader.ts';
import { readDeploymentReadiness } from '../packages/vow-sdk/src/deployment-readiness.ts';
import { parsePublicInteger } from './collection/configuration.ts';
import { PUBLIC_MAINNET_RPC } from '../packages/vow-sdk/src/rpc-endpoint.ts';

try {
  if (process.argv[2] === '--help') {
    process.stdout.write('Usage: node scripts/inspect-deployment.ts PUBLIC_OWNER_ADDRESS\nReads public mainnet account, class, token and pool state at one block. No wallet, keys, signing, estimation or transactions.\n');
  } else {
    if (process.argv.length !== 3) throw new Error('VOW_OWNER_ADDRESS_REQUIRED');
    const owner = parsePublicInteger(process.argv[2]);
    const source = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_CollectionProbe.contract_class.json', 'utf8')) as CompiledSierra;
    const endpoint = PUBLIC_MAINNET_RPC;
    const report = await readDeploymentReadiness(createPublicReader(endpoint), owner, BigInt(hash.computeContractClassHash(source)), Math.floor(Date.now() / 1000));
    process.stdout.write(JSON.stringify({ observedAt: new Date().toISOString(), endpoint, ...report,
      limitations: ['Single RPC observation; no storage proof.', 'Code observed at dependency addresses is not source-verified.',
        'Raw pool fee units and applicable asset remain unverified.', 'No actual fee estimate, declaration, deployment or collection.'] },
    (_, value: unknown) => typeof value === 'bigint' ? `0x${value.toString(16)}` : value, 2) + '\n');
  }
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error && /^VOW_[A-Z_]+$/.test(error.message) ? error.message : 'VOW_DEPLOYMENT_READ_FAILED'}\n`);
  process.exitCode = 1;
}
