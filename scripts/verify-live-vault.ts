import { readFile } from 'node:fs/promises';
import { hash } from 'starknet';
import type { CompiledSierra } from 'starknet';
import { auditVaultAbi } from '../packages/vow-sdk/src/vault-abi.ts';
import { createPublicReader } from '../packages/vow-sdk/src/probe-reader.ts';
import { receiptFelt, receiptFelts, receiptRecord } from '../packages/vow-sdk/src/receipt-values.ts';
import { PUBLIC_MAINNET_RPC } from '../packages/vow-sdk/src/rpc-endpoint.ts';

const CHAIN_ID = 0x534e5f4d41494en;
const VAULT = 0x641ca5237870312273ed2cd693372ee49e103d5c585af6185324f3662e15227n;
const VAULT_CLASS = 0x3c85f692be0a2280bc85fc9802019121a8b52ef4de0db9273c3806f7355ce14n;
const POOL = 0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812an;
const artifact = JSON.parse(await readFile(
  'contracts/target/dev/vow_collection_probe_VowVault.contract_class.json', 'utf8',
)) as CompiledSierra;
const locallyBuiltClass = BigInt(hash.computeContractClassHash(artifact));
if (locallyBuiltClass !== VAULT_CLASS) throw new Error('VOW_LOCAL_VAULT_CLASS_CHANGED');
const reader = createPublicReader(PUBLIC_MAINNET_RPC);
const latest = receiptRecord(await reader.request('starknet_getBlockWithTxHashes', { block_id: 'latest' }));
const blockHash = receiptFelt(latest.block_hash);
if (receiptFelt(await reader.request('starknet_chainId', [])) !== CHAIN_ID) throw new Error('VOW_WRONG_CHAIN');
const blockId = { block_hash: hex(blockHash) };
const deployedClass = receiptFelt(await reader.request('starknet_getClassHashAt', { block_id: blockId, contract_address: hex(VAULT) }));
if (deployedClass !== VAULT_CLASS) throw new Error('VOW_VAULT_CLASS_CHANGED');
const contractClass = receiptRecord(await reader.request('starknet_getClass', { block_id: blockId, class_hash: hex(VAULT_CLASS) }));
const pool = receiptFelts(await reader.request('starknet_call', { block_id: blockId, request: {
  contract_address: hex(VAULT), entry_point_selector: hash.getSelectorFromName('pool'), calldata: [],
} }), 1);
if (pool.length !== 1 || pool[0] !== POOL) throw new Error('VOW_VAULT_POOL_CHANGED');
const audit = auditVaultAbi(contractClass.abi);
process.stdout.write(`${JSON.stringify({ status: 'matched', source: 'single-rpc-observation', blockHash: hex(blockHash), vaultAddress: hex(VAULT),
  localClassHash: hex(locallyBuiltClass), vaultClassHash: hex(deployedClass), poolAddress: hex(POOL), ...audit }, null, 2)}\n`);

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
