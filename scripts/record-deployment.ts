import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { hash } from 'starknet';
import { createPublicReader } from '../packages/vow-sdk/src/probe-reader.ts';
import { PUBLIC_MAINNET_RPC } from '../packages/vow-sdk/src/rpc-endpoint.ts';

const reader = createPublicReader(PUBLIC_MAINNET_RPC);
const manifest = JSON.parse(await readFile('dist/app/deployment.json', 'utf8')) as {
  schemaVersion: number;
  status: string;
  deployment: Record<string, string>;
  tokens: readonly { address: string; symbol: string; decimals: number }[];
  preloadedTransactionHash: string;
  evidence: string;
};

const { vaultAddress, vaultClassHash, poolAddress } = manifest.deployment;
if (!vaultAddress || !vaultClassHash || !poolAddress) throw new Error('VOW_INVALID_DEPLOYMENT_MANIFEST');
const block = await reader.request('starknet_getBlockWithTxHashes', { block_id: 'latest' }) as {
  block_hash: string; block_number: number;
};
const at = { block_hash: block.block_hash };

const deployedClass = await reader.request(
  'starknet_getClassHashAt', { block_id: at, contract_address: vaultAddress },
) as string;
if (BigInt(deployedClass) !== BigInt(vaultClassHash)) throw new Error('VOW_DEPLOYED_CLASS_MISMATCH');

const observedPool = await reader.request('starknet_call', {
  request: {
    contract_address: vaultAddress, entry_point_selector: hash.getSelectorFromName('pool'),
    calldata: [],
  },
  block_id: at,
}) as readonly string[];
if (BigInt(observedPool[0]!) !== BigInt(poolAddress)) throw new Error('VOW_DEPLOYED_POOL_MISMATCH');

const accounted = await reader.request('starknet_call', {
  request: {
    contract_address: vaultAddress,
    entry_point_selector: hash.getSelectorFromName('accounted_balance'),
    calldata: [manifest.tokens[0]!.address],
  },
  block_id: at,
}) as readonly string[];

await mkdir('dist/deployment', { recursive: true });
await writeFile(
  'dist/deployment/manifest.json',
  JSON.stringify({ ...manifest, status: 'deployed' }, null, 2) + '\n',
);

await writeFile('evidence/vault-deployment-observation.json', JSON.stringify({
  observedAt: new Date().toISOString(),
  endpoint: PUBLIC_MAINNET_RPC,
  observationType: 'live-mainnet-state-read',
  chain: 'SN_MAIN',
  pinnedBlock: { blockNumber: block.block_number, blockHash: block.block_hash },
  vaultAddress,
  vaultClassHash,
  deployedClassHash: deployedClass,
  poolAddress,
  observedPool: observedPool[0],
  accountedBalanceSTRK: accounted[0],
  verified: [
    'A contract exists at the predicted vault address.',
    'Its class hash equals the locally built VowVault class hash.',
    'Its pool() view returns the pinned STRK20 pool address.',
  ],
  limitations: [
    'Single provider observation.',
    'Declaration and deployment transaction hashes are not yet recorded in this file.',
    'No mandate has been created, no budget funded, no reservation made and no supplier collection performed.',
    'Deployment proves the contract exists, not that any VOW payment has occurred.',
    'The contract is not audited.',
  ],
}, null, 2) + '\n');

process.stdout.write(`VowVault verified on mainnet at ${vaultAddress}\n`);
process.stdout.write(`  class ${deployedClass}\n`);
process.stdout.write(`  pool  ${observedPool[0]}\n`);
process.stdout.write('Wrote dist/deployment/manifest.json and evidence/vault-deployment-observation.json\n');
