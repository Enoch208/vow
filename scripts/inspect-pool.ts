import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { hash } from 'starknet';
import { PUBLIC_MAINNET_RPC } from '../packages/vow-sdk/src/rpc-endpoint.ts';

const endpoint = PUBLIC_MAINNET_RPC;
const pool = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a';
let sequence = 0;

async function rpc(method: string, params: unknown): Promise<unknown> {
  const id = ++sequence;
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('VOW_RPC_HTTP_ERROR');
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('id' in body) || body.id !== id || !('result' in body)) throw new Error('VOW_RPC_RESPONSE_ERROR');
  return body.result;
}

const chainId = await rpc('starknet_chainId', []);
if (chainId !== '0x534e5f4d41494e') throw new Error('VOW_WRONG_CHAIN');
const block = await rpc('starknet_blockHashAndNumber', []);
if (typeof block !== 'object' || block === null || !('block_hash' in block) || typeof block.block_hash !== 'string') throw new Error('VOW_INVALID_BLOCK');
const blockId = { block_hash: block.block_hash };
const classHash = await rpc('starknet_getClassHashAt', { block_id: blockId, contract_address: pool });
const contract = await rpc('starknet_getClass', { block_id: blockId, class_hash: classHash });
if (typeof contract !== 'object' || contract === null || !('abi' in contract)) throw new Error('VOW_INVALID_CLASS');
const abi: unknown = typeof contract.abi === 'string' ? JSON.parse(contract.abi) : contract.abi;
if (!Array.isArray(abi)) throw new Error('VOW_INVALID_ABI');
const read = (entrypoint: string) => rpc('starknet_call', {
  block_id: blockId, request: { contract_address: pool, entry_point_selector: hash.getSelectorFromName(entrypoint), calldata: [] },
});
const [version, feeAmount, feeCollector, paused] = await Promise.all([
  read('get_version'), read('get_fee_amount'), read('get_fee_collector'), read('is_paused'),
]);
const report = {
  observedAt: new Date().toISOString(), endpoint, chainId, block, poolAddress: pool, classHash,
  abiSha256: createHash('sha256').update(JSON.stringify(abi)).digest('hex'),
  version, feeAmount, feeCollector, paused,
  limitations: ['Single RPC provider observation.', 'No VOW deployment or wallet transaction.', 'Token compatibility and source-to-class match unverified.'],
};
await mkdir('evidence', { recursive: true });
await writeFile('evidence/pool-observation.json', JSON.stringify(report, null, 2) + '\n');
await writeFile('evidence/pool-abi.json', JSON.stringify(abi, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
