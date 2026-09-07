import { hash } from 'starknet';
import { bounded, felt, U128_MAX } from './integers.ts';
import { validateProbeConfiguration } from './probe-snapshot.ts';
import type { ProbeConfiguration, ProbeSnapshot } from './probe-snapshot.ts';

const PUBLIC_READ_METHODS = ['starknet_chainId', 'starknet_getBlockWithTxHashes', 'starknet_getClassHashAt', 'starknet_call', 'starknet_getClass', 'starknet_getNonce', 'starknet_getTransactionByHash', 'starknet_getTransactionReceipt', 'starknet_traceTransaction'] as const;
export type PublicReadMethod = typeof PUBLIC_READ_METHODS[number];
export class PublicReadError extends Error {
  readonly errorCode: number | null;
  constructor(errorCode: number | null = null) { super('VOW_RPC_READ_FAILED'); this.errorCode = errorCode; }
}
export interface PublicReader {
  request(method: PublicReadMethod, params: unknown): Promise<unknown>;
}

export async function readProbeSnapshot(reader: PublicReader, config: ProbeConfiguration): Promise<ProbeSnapshot> {
  validateProbeConfiguration(config);
  const chainId = scalar(await reader.request('starknet_chainId', []));
  if (chainId !== config.chainId) throw new Error('VOW_WRONG_CHAIN');
  const raw = await reader.request('starknet_getBlockWithTxHashes', { block_id: 'latest' });
  if (!raw || typeof raw !== 'object' || !('block_hash' in raw) || !('timestamp' in raw)) throw new Error('VOW_INVALID_BLOCK');
  if (typeof raw.timestamp !== 'number' || !Number.isSafeInteger(raw.timestamp) || raw.timestamp < 0) throw new Error('VOW_INVALID_BLOCK');
  const blockHash = scalar(raw.block_hash);
  const blockId = { block_hash: hex(blockHash) };
  const classAt = async (target: bigint) => scalar(await reader.request('starknet_getClassHashAt', { block_id: blockId, contract_address: hex(target) }));
  const call = async (target: bigint, name: string, args: bigint[], length: number) => {
    const response = await reader.request('starknet_call', { block_id: blockId, request: {
      contract_address: hex(target), entry_point_selector: hash.getSelectorFromName(name), calldata: args.map(hex),
    } });
    if (!Array.isArray(response) || response.length !== length) throw new Error('VOW_INVALID_READ');
    return response.map(scalar);
  };
  const [probeClassHash, poolClassHash, terms, state, balance, allowance, paused, collector] = await Promise.all([
    classAt(config.vaultAddress), classAt(config.poolAddress), call(config.vaultAddress, 'configuration', [], 6),
    call(config.vaultAddress, 'state', [], 1), call(config.token, 'balance_of', [config.vaultAddress], 2),
    call(config.token, 'allowance', [config.vaultAddress, config.poolAddress], 2),
    call(config.poolAddress, 'is_paused', [], 1), call(config.poolAddress, 'get_fee_collector', [], 1),
  ]);
  return {
    chainId, blockHash, timestamp: BigInt(raw.timestamp), probeClassHash, poolClassHash,
    owner: terms[0]!, poolAddress: terms[1]!, token: terms[2]!, supplierKey: terms[3]!, amount: terms[4]!, claimBefore: terms[5]!,
    state: state[0]!, balance: uint256(balance), allowance: uint256(allowance), poolPaused: paused[0]!, feeCollector: collector[0]!,
  };
}

export function createPublicReader(endpoint: string, transport: typeof fetch = fetch): PublicReader {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('VOW_INVALID_RPC_URL');
  let sequence = 0;
  return { async request(method, params) {
    if (!PUBLIC_READ_METHODS.includes(method)) throw new Error('VOW_READ_ONLY_RPC');
    const id = ++sequence;
    try {
      const response = await transport(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(20_000), redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new Error();
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('id' in body) || body.id !== id || !('jsonrpc' in body) || body.jsonrpc !== '2.0') throw new Error();
      if ('error' in body && !('result' in body)) {
        const error = body.error;
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        throw new PublicReadError(typeof code === 'number' && Number.isSafeInteger(code) && Math.abs(code) <= 1_000_000 ? code : null);
      }
      if (!('result' in body) || 'error' in body) throw new Error();
      return body.result;
    } catch (error: unknown) { throw error instanceof PublicReadError ? error : new PublicReadError(); }
  } };
}

function scalar(input: unknown): bigint {
  if (typeof input !== 'string' || input.length > 80 || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(input)) throw new Error('VOW_INVALID_READ');
  return felt(BigInt(input), 'READ');
}
function uint256(parts: bigint[]): bigint { return bounded(parts[0]!, U128_MAX, 'U128') + (bounded(parts[1]!, U128_MAX, 'U128') << 128n); }
function hex(input: bigint): string { return `0x${input.toString(16)}`; }
