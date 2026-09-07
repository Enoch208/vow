import { constants, hash } from 'starknet';
import type { CompiledSierra } from 'starknet';
import { address, bounded, felt, U128_MAX } from './integers.ts';
import { POOL_CLASS_HASH } from './prepared-claim.ts';
import { PublicReadError } from './probe-reader.ts';
import type { PublicReader } from './probe-reader.ts';

export const DEPLOYMENT_DEPENDENCIES = Object.freeze({
  chainId: 0x534e5f4d41494en,
  udc: BigInt(constants.UDC.ADDRESS),
  pool: 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812an,
  strk: 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938dn,
});

export async function readDeploymentReadiness(reader: PublicReader, owner: bigint, probeClassHash: bigint, now: number) {
  address(owner, 'OWNER'); felt(probeClassHash, 'PROBE_CLASS', 1n);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('VOW_INVALID_TIME');
  const chainId = scalar(await reader.request('starknet_chainId', []));
  if (chainId !== DEPLOYMENT_DEPENDENCIES.chainId) throw new Error('VOW_WRONG_CHAIN');
  const raw = await reader.request('starknet_getBlockWithTxHashes', { block_id: 'latest' });
  if (!raw || typeof raw !== 'object' || !('block_hash' in raw) || !('timestamp' in raw) || !('block_number' in raw)) throw new Error('VOW_INVALID_BLOCK');
  if (typeof raw.timestamp !== 'number' || !Number.isSafeInteger(raw.timestamp) || raw.timestamp < 0
    || typeof raw.block_number !== 'number' || !Number.isSafeInteger(raw.block_number) || raw.block_number < 0) throw new Error('VOW_INVALID_BLOCK');
  if (raw.timestamp > now + 30 || now - raw.timestamp > 300) throw new Error('VOW_STALE_BLOCK');
  const blockHash = felt(scalar(raw.block_hash), 'BLOCK', 1n);
  const blockId = { block_hash: hex(blockHash) };
  const classAt = async (target: bigint) => felt(scalar(await reader.request('starknet_getClassHashAt', { block_id: blockId, contract_address: hex(target) })), 'CLASS', 1n);
  const call = async (target: bigint, name: string, calldata: bigint[], length: number) => {
    const result = await reader.request('starknet_call', { block_id: blockId,
      request: { contract_address: hex(target), entry_point_selector: hash.getSelectorFromName(name), calldata: calldata.map(hex) } });
    if (!Array.isArray(result) || result.length !== length) throw new Error('VOW_INVALID_READ');
    return result.map(scalar);
  };
  const declaration = async () => {
    const result = await absentOnly(() => reader.request('starknet_getClass', { block_id: blockId, class_hash: hex(probeClassHash) }), 28);
    if (result === null) return 'not-declared' as const;
    try {
      if (!result || typeof result !== 'object' || !('sierra_program' in result) || !('abi' in result)
        || BigInt(hash.computeContractClassHash({ ...result, abi: typeof result.abi === 'string' ? JSON.parse(result.abi) : result.abi } as CompiledSierra)) !== probeClassHash) throw new Error();
    } catch { throw new Error('VOW_DECLARED_CLASS_MISMATCH'); }
    return 'declared-hash-matched' as const;
  };
  const d = DEPLOYMENT_DEPENDENCIES;
  const [ownerClass, udcClass, poolClass, tokenClass, declared, balance, decimals, paused, collector, fee, privacyKey] = await Promise.all([
    absentOnly(() => classAt(owner), 20), classAt(d.udc), classAt(d.pool), classAt(d.strk), declaration(),
    call(d.strk, 'balance_of', [owner], 2), call(d.strk, 'decimals', [], 1),
    call(d.pool, 'is_paused', [], 1), call(d.pool, 'get_fee_collector', [], 1), call(d.pool, 'get_fee_amount', [], 1),
    call(d.pool, 'get_public_key', [owner], 1),
  ]);
  if (poolClass !== POOL_CLASS_HASH) throw new Error('VOW_POOL_CLASS_CHANGED');
  if (decimals[0] !== 18n) throw new Error('VOW_UNEXPECTED_TOKEN_DECIMALS');
  if (paused[0] !== 0n && paused[0] !== 1n) throw new Error('VOW_INVALID_POOL_STATE');
  address(collector[0]!, 'FEE_COLLECTOR');
  const nonce = ownerClass === null ? null : scalar(await reader.request('starknet_getNonce', { block_id: blockId, contract_address: hex(owner) }));
  const publicSTRKBalance = bounded(balance[0]!, U128_MAX, 'BALANCE_LOW') + (bounded(balance[1]!, U128_MAX, 'BALANCE_HIGH') << 128n);
  return Object.freeze({ status: 'observation-only', chainId, blockHash, blockNumber: raw.block_number, timestamp: raw.timestamp,
    owner, ownerClass, account: ownerClass === null ? 'not-deployed' : 'deployed-contract', nonce, publicSTRKBalance,
    probeClassHash, declaration: declared, udc: d.udc, udcClass, pool: d.pool, poolClass, poolPaused: paused[0] === 1n,
    token: d.strk, tokenClass, tokenDecimals: decimals[0], feeCollector: collector[0], rawPoolFee: fee[0],
    ownerPublicPrivacyKey: privacyKey[0], ownerPrivacyRegistration: privacyKey[0] === 0n ? 'not-registered' : 'public-key-present',
    feeEstimate: 'not-estimated', tokenCollectionCompatibility: 'unverified', deploymentSourceMatch: 'unverified',
  });
}

async function absentOnly<T>(read: () => Promise<T>, code: number): Promise<T | null> {
  try { return await read(); }
  catch (error: unknown) { if (error instanceof PublicReadError && error.errorCode === code) return null; throw error; }
}
function scalar(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 80 || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) throw new Error('VOW_INVALID_READ');
  return felt(BigInt(value), 'READ');
}
function hex(value: bigint): string { return `0x${value.toString(16)}`; }
