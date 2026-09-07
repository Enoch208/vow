import { hash } from 'starknet';
import { address, bounded, felt, U128_MAX, U64_MAX } from './integers.ts';
import { POOL_CLASS_HASH } from './prepared-claim.ts';
import type { PublicReader } from './probe-reader.ts';
import { receiptFelt, receiptFelts, receiptRecord } from './receipt-values.ts';

export interface VaultDeploymentManifest {
  readonly chainId: bigint;
  readonly vaultAddress: bigint;
  readonly vaultClassHash: bigint;
  readonly poolAddress: bigint;
  readonly poolClassHash: bigint;
  readonly feeToken: bigint;
  readonly feeCollector: bigint;
  readonly maximumProtocolFee: bigint;
  readonly maximumNetworkFee: bigint;
}

export interface VaultReservation {
  readonly reservationId: bigint;
  readonly mandateId: bigint;
  readonly permissionId: bigint;
  readonly leafHash: bigint;
  readonly supplierKey: bigint;
  readonly token: bigint;
  readonly amount: bigint;
  readonly claimBefore: bigint;
  readonly purchaseCommitment: bigint;
  readonly state: bigint;
}

export interface VaultCollectionConfiguration extends VaultDeploymentManifest, VaultReservation {
  readonly recipient: bigint;
  readonly signatureDeadline: bigint;
}

export interface VaultReservationSnapshot extends VaultReservation {
  readonly chainId: bigint;
  readonly blockHash: bigint;
  readonly timestamp: bigint;
  readonly vaultClassHash: bigint;
  readonly poolClassHash: bigint;
  readonly poolAddress: bigint;
  readonly accountedBalance: bigint;
  readonly balance: bigint;
  readonly allowance: bigint;
  readonly poolPaused: bigint;
  readonly feeCollector: bigint;
}

export function validateVaultDeployment(manifest: VaultDeploymentManifest): void {
  for (const value of [manifest.vaultAddress, manifest.poolAddress, manifest.feeToken, manifest.feeCollector]) address(value, 'DEPLOYMENT_ADDRESS');
  for (const value of [manifest.chainId, manifest.vaultClassHash, manifest.poolClassHash]) felt(value, 'DEPLOYMENT_FELT', 1n);
  if (manifest.poolClassHash !== POOL_CLASS_HASH) throw new Error('VOW_POOL_CLASS_CHANGED');
  bounded(manifest.maximumProtocolFee, U128_MAX, 'PROTOCOL_FEE');
  bounded(manifest.maximumNetworkFee, U128_MAX, 'NETWORK_FEE');
}

export function validateVaultCollectionConfiguration(config: VaultCollectionConfiguration): void {
  validateVaultDeployment(config);
  bounded(config.maximumNetworkFee, U128_MAX, 'NETWORK_FEE', 1n);
  address(config.token, 'TOKEN');
  address(config.recipient, 'RECIPIENT');
  for (const value of [config.reservationId, config.mandateId, config.leafHash, config.supplierKey]) felt(value, 'RESERVATION_FELT', 1n);
  felt(config.purchaseCommitment, 'PURCHASE_COMMITMENT');
  bounded(config.permissionId, 0xffffffffn, 'PERMISSION_ID');
  bounded(config.amount, U128_MAX, 'AMOUNT', 1n);
  bounded(config.claimBefore, U64_MAX, 'CLAIM_BEFORE', 1n);
  bounded(config.signatureDeadline, config.claimBefore, 'SIGNATURE_DEADLINE', 1n);
  if (config.state !== 1n) throw new Error('VOW_RESERVATION_NOT_OPEN');
}

export async function readVaultReservation(reader: PublicReader, manifest: VaultDeploymentManifest, reservationId: bigint): Promise<VaultReservationSnapshot> {
  validateVaultDeployment(manifest);
  felt(reservationId, 'RESERVATION', 1n);
  const chainId = receiptFelt(await reader.request('starknet_chainId', []));
  if (chainId !== manifest.chainId) throw new Error('VOW_WRONG_CHAIN');
  const rawBlock = receiptRecord(await reader.request('starknet_getBlockWithTxHashes', { block_id: 'latest' }));
  const blockHash = felt(receiptFelt(rawBlock.block_hash), 'BLOCK_HASH', 1n);
  if (typeof rawBlock.timestamp !== 'number' || !Number.isSafeInteger(rawBlock.timestamp) || rawBlock.timestamp < 0) throw new Error('VOW_INVALID_BLOCK');
  const blockId = { block_hash: hex(blockHash) };
  const classAt = async (target: bigint) => receiptFelt(await reader.request('starknet_getClassHashAt', { block_id: blockId, contract_address: hex(target) }));
  const call = async (target: bigint, name: string, calldata: bigint[], maximum: number) => receiptFelts(await reader.request('starknet_call', { block_id: blockId, request: {
    contract_address: hex(target), entry_point_selector: hash.getSelectorFromName(name), calldata: calldata.map(hex),
  } }), maximum);
  const [vaultClassHash, poolClassHash, pool, reservationRaw, accountedRaw, balanceRaw, allowanceRaw, pausedRaw, collectorRaw] = await Promise.all([
    classAt(manifest.vaultAddress), classAt(manifest.poolAddress), call(manifest.vaultAddress, 'pool', [], 1),
    call(manifest.vaultAddress, 'reservation', [reservationId], 9), call(manifest.vaultAddress, 'accounted_balance', [manifest.feeToken], 1),
    call(manifest.feeToken, 'balance_of', [manifest.vaultAddress], 2), call(manifest.feeToken, 'allowance', [manifest.vaultAddress, manifest.poolAddress], 2),
    call(manifest.poolAddress, 'is_paused', [], 1), call(manifest.poolAddress, 'get_fee_collector', [], 1),
  ]);
  if (reservationRaw.length !== 9) throw new Error('VOW_INVALID_RESERVATION');
  const reservation = decodeReservation(reservationId, reservationRaw);
  const accounted = reservation.token === manifest.feeToken ? accountedRaw : await call(manifest.vaultAddress, 'accounted_balance', [reservation.token], 1);
  const balance = reservation.token === manifest.feeToken ? balanceRaw : await call(reservation.token, 'balance_of', [manifest.vaultAddress], 2);
  const allowance = reservation.token === manifest.feeToken ? allowanceRaw : await call(reservation.token, 'allowance', [manifest.vaultAddress, manifest.poolAddress], 2);
  return Object.freeze({ ...reservation, chainId, blockHash, timestamp: BigInt(rawBlock.timestamp), vaultClassHash, poolClassHash,
    poolAddress: pool[0] ?? 0n, accountedBalance: single(accounted), balance: uint256(balance), allowance: uint256(allowance),
    poolPaused: single(pausedRaw), feeCollector: single(collectorRaw) });
}

export function assertVaultReservationReady(config: VaultCollectionConfiguration, snapshot: VaultReservationSnapshot, now: bigint): void {
  validateVaultCollectionConfiguration(config);
  bounded(now, U64_MAX, 'NOW');
  bounded(snapshot.timestamp, U64_MAX, 'BLOCK_TIME');
  if (snapshot.timestamp > now + 30n || now > snapshot.timestamp + 300n) throw new Error('VOW_STALE_BLOCK');
  if (snapshot.chainId !== config.chainId) throw new Error('VOW_WRONG_CHAIN');
  if (snapshot.vaultClassHash !== config.vaultClassHash || snapshot.poolClassHash !== config.poolClassHash) throw new Error('VOW_CLASS_CHANGED');
  if (snapshot.poolAddress !== config.poolAddress || snapshot.feeCollector !== config.feeCollector) throw new Error('VOW_CONFIGURATION_CHANGED');
  for (const field of ['reservationId', 'mandateId', 'permissionId', 'leafHash', 'supplierKey', 'token', 'amount', 'claimBefore', 'purchaseCommitment'] as const) {
    if (snapshot[field] !== config[field]) throw new Error('VOW_RESERVATION_CHANGED');
  }
  if (snapshot.state !== 1n) throw new Error('VOW_RESERVATION_NOT_OPEN');
  if (snapshot.accountedBalance < config.amount || snapshot.balance < config.amount) throw new Error('VOW_NOT_FUNDED');
  if (snapshot.allowance !== 0n) throw new Error('VOW_STALE_ALLOWANCE');
  if (snapshot.poolPaused !== 0n) throw new Error('VOW_POOL_PAUSED');
  if (now >= config.signatureDeadline || snapshot.timestamp >= config.signatureDeadline) throw new Error('VOW_CLAIM_EXPIRED');
}

export function decodeReservation(reservationId: bigint, values: readonly bigint[]): VaultReservation {
  if (values.length !== 9) throw new Error('VOW_INVALID_RESERVATION');
  return Object.freeze({ reservationId, mandateId: values[0]!, permissionId: values[1]!, leafHash: values[2]!, supplierKey: values[3]!,
    token: values[4]!, amount: values[5]!, claimBefore: values[6]!, purchaseCommitment: values[7]!, state: values[8]! });
}

function single(values: readonly bigint[]): bigint {
  if (values.length !== 1) throw new Error('VOW_INVALID_READ');
  return values[0]!;
}

function uint256(values: readonly bigint[]): bigint {
  if (values.length !== 2) throw new Error('VOW_INVALID_READ');
  return bounded(values[0]!, U128_MAX, 'U128') + (bounded(values[1]!, U128_MAX, 'U128') << 128n);
}

function hex(value: bigint): string { return `0x${felt(value, 'RPC_FELT').toString(16)}`; }
