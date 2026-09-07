import { address, bounded, felt, U128_MAX, U64_MAX } from './integers.ts';
import { POOL_CLASS_HASH } from './prepared-claim.ts';

export interface ProbeConfiguration {
  readonly chainId: bigint;
  readonly vaultAddress: bigint;
  readonly probeClassHash: bigint;
  readonly poolAddress: bigint;
  readonly token: bigint;
  readonly supplierKey: bigint;
  readonly amount: bigint;
  readonly claimBefore: bigint;
  readonly recipient: bigint;
  readonly signatureDeadline: bigint;
  readonly feeToken: bigint;
  readonly feeCollector: bigint;
  readonly maximumFee: bigint;
}

export interface ProbeSnapshot {
  readonly chainId: bigint;
  readonly blockHash: bigint;
  readonly timestamp: bigint;
  readonly probeClassHash: bigint;
  readonly poolClassHash: bigint;
  readonly owner: bigint;
  readonly poolAddress: bigint;
  readonly token: bigint;
  readonly supplierKey: bigint;
  readonly amount: bigint;
  readonly claimBefore: bigint;
  readonly state: bigint;
  readonly balance: bigint;
  readonly allowance: bigint;
  readonly poolPaused: bigint;
  readonly feeCollector: bigint;
}

export function validateProbeConfiguration(config: ProbeConfiguration): void {
  for (const value of [config.vaultAddress, config.poolAddress, config.token, config.recipient, config.feeToken, config.feeCollector]) address(value, 'CONFIG_ADDRESS');
  for (const value of [config.chainId, config.probeClassHash, config.supplierKey]) felt(value, 'CONFIG_FELT', 1n);
  bounded(config.amount, U128_MAX, 'AMOUNT', 1n);
  bounded(config.maximumFee, U128_MAX, 'FEE');
  bounded(config.claimBefore, U64_MAX, 'CLAIM_BEFORE', 1n);
  bounded(config.signatureDeadline, config.claimBefore, 'SIGNATURE_DEADLINE', 1n);
}

export function assertProbeReady(config: ProbeConfiguration, snapshot: ProbeSnapshot, now: bigint): void {
  validateProbeConfiguration(config);
  bounded(now, U64_MAX, 'NOW');
  bounded(snapshot.timestamp, U64_MAX, 'BLOCK_TIME');
  felt(snapshot.blockHash, 'BLOCK', 1n);
  if (snapshot.timestamp > now + 30n || now > snapshot.timestamp + 300n) throw new Error('VOW_STALE_BLOCK');
  if (snapshot.chainId !== config.chainId) throw new Error('VOW_WRONG_CHAIN');
  if (snapshot.probeClassHash !== config.probeClassHash || snapshot.poolClassHash !== POOL_CLASS_HASH) throw new Error('VOW_CLASS_CHANGED');
  for (const field of ['poolAddress', 'token', 'supplierKey', 'amount', 'claimBefore', 'feeCollector'] as const) {
    if (snapshot[field] !== config[field]) throw new Error('VOW_CONFIGURATION_CHANGED');
  }
  address(snapshot.owner, 'OWNER');
  if (snapshot.state !== 1n || snapshot.balance < config.amount) throw new Error('VOW_NOT_FUNDED');
  if (snapshot.allowance !== 0n) throw new Error('VOW_STALE_ALLOWANCE');
  if (snapshot.poolPaused !== 0n) throw new Error('VOW_POOL_PAUSED');
  if (now >= config.signatureDeadline || snapshot.timestamp >= config.signatureDeadline) throw new Error('VOW_CLAIM_EXPIRED');
}
