import { hash, transaction } from 'starknet';
import type { Call, CompiledSierra } from 'starknet';
import { readDeploymentReadiness, DEPLOYMENT_DEPENDENCIES as d } from './deployment-readiness.ts';
import { PublicReadError, readProbeSnapshot } from './probe-reader.ts';
import type { PublicReader } from './probe-reader.ts';
import { buildProbeDeploymentPlan } from './deployment-plan.ts';
import type { ProbeDeploymentTerms } from './deployment-plan.ts';
import { receiptFelt as scalar, receiptRecord } from './receipt-values.ts';

export type DeploymentStage = 'declare' | 'deploy' | 'fund';
export interface DeploymentArtifact { classHash: string; compiledClassHash: string; starknetVersion: string; contractClass: Omit<CompiledSierra, 'abi'> & { abi: CompiledSierra['abi'] | string } }
export interface DeploymentWallet { request(input: { type: string; params?: unknown }): Promise<unknown> }
export function validateDeploymentArtifact(artifact: DeploymentArtifact, terms: ProbeDeploymentTerms): void {
  if (!artifact || typeof artifact !== 'object' || Object.keys(artifact).sort().join(',') !== 'classHash,compiledClassHash,contractClass,starknetVersion') throw new Error('VOW_INVALID_DEPLOYMENT_ARTIFACT');
  if (scalar(artifact.classHash) !== terms.probeClassHash || BigInt(hash.computeContractClassHash({ ...artifact.contractClass, abi: typeof artifact.contractClass.abi === 'string' ? JSON.parse(artifact.contractClass.abi) : artifact.contractClass.abi })) !== terms.probeClassHash) throw new Error('VOW_WRONG_PROBE_BUILD');
  if (scalar(artifact.compiledClassHash) === 0n || artifact.starknetVersion !== '0.14.3') throw new Error('VOW_INVALID_COMPILED_BUILD');
}
export async function checkDeploymentWallet(wallet: DeploymentWallet, owner: bigint): Promise<void> {
  const versions = await wallet.request({ type: 'wallet_supportedWalletApi' });
  if (!Array.isArray(versions) || !versions.includes('0.10.3')) throw new Error('VOW_UNSUPPORTED_WALLET');
  const chain = await wallet.request({ type: 'wallet_requestChainId' });
  if (scalar(chain) !== d.chainId) throw new Error('VOW_WRONG_WALLET_CHAIN');
  const accounts = await wallet.request({ type: 'wallet_requestAccounts', params: { silent_mode: false, api_version: '0.10.3' } });
  if (!Array.isArray(accounts) || accounts.length !== 1 || scalar(accounts[0]) !== owner) throw new Error('VOW_WRONG_DEPLOYMENT_ACCOUNT');
}
export async function readDeploymentStage(reader: PublicReader, terms: ProbeDeploymentTerms, now: bigint, allowExpired = false) {
  const plan = buildProbeDeploymentPlan(terms, allowExpired && now >= terms.signatureDeadline ? terms.signatureDeadline - 1n : now);
  if (terms.poolAddress !== d.pool || terms.token !== d.strk || terms.feeToken !== d.strk) throw new Error('VOW_WRONG_DEPENDENCY');
  const readiness = await readDeploymentReadiness(reader, terms.owner, terms.probeClassHash, Number(now));
  if (readiness.account !== 'deployed-contract' || readiness.nonce === null || readiness.poolPaused || readiness.ownerPrivacyRegistration !== 'public-key-present') throw new Error('VOW_SETUP_NOT_READY');
  if (readiness.feeCollector !== terms.feeCollector || readiness.rawPoolFee! > terms.maximumFee) throw new Error('VOW_POOL_FEE_CHANGED');
  if (readiness.udcClass !== 0x1b2df6d8861670d4a8ca4670433b2418d78169c2947f46dc614e69f333745c8n ||
      readiness.tokenClass !== 0x2e77ee61d4df3d988ee1f42ea5442e913862cc82c2584d212ecda76666498fcn) throw new Error('VOW_DEPENDENCY_CLASS_CHANGED');
  const block = { block_hash: hex(readiness.blockHash), timestamp: readiness.timestamp, block_number: readiness.blockNumber };
  const canonical = receiptRecord(await reader.request('starknet_getBlockWithTxHashes', { block_id: { block_number: readiness.blockNumber } }));
  if (scalar(canonical.block_hash) !== readiness.blockHash || canonical.starknet_version !== '0.14.3') throw new Error('VOW_BLOCK_CHANGED');
  let probeClass: bigint | null;
  try { probeClass = scalar(await reader.request('starknet_getClassHashAt', { block_id: { block_hash: block.block_hash }, contract_address: hex(plan.predictedAddress) })); }
  catch (error: unknown) { if (error instanceof PublicReadError && error.errorCode === 20) probeClass = null; else throw error; }
  let state: bigint | null = null;
  if (probeClass !== null) {
    if (probeClass !== terms.probeClassHash) throw new Error('VOW_UNEXPECTED_PROBE_CLASS');
    const pinned: PublicReader = { request: (method, args) => method === 'starknet_getBlockWithTxHashes' ? Promise.resolve(block) : reader.request(method, args) };
    const snapshot = await readProbeSnapshot(pinned, plan.collectionConfiguration);
    for (const field of ['owner', 'poolAddress', 'token', 'supplierKey', 'amount', 'claimBefore', 'feeCollector'] as const) {
      if (snapshot[field] !== terms[field]) throw new Error('VOW_CONFIGURATION_CHANGED');
    }
    if (snapshot.allowance !== 0n || snapshot.poolPaused !== 0n || ![0n, 1n].includes(snapshot.state)) throw new Error('VOW_UNEXPECTED_PROBE_STATE');
    if (snapshot.state === 0n && snapshot.balance !== 0n || snapshot.state === 1n && snapshot.balance < terms.amount) throw new Error('VOW_UNEXPECTED_PROBE_BALANCE');
    state = snapshot.state;
  }
  const stage: DeploymentStage | 'complete' = readiness.declaration === 'not-declared' ? 'declare' : probeClass === null ? 'deploy' : state === 0n ? 'fund' : 'complete';
  if (stage === 'fund' && readiness.publicSTRKBalance < terms.amount) throw new Error('VOW_INSUFFICIENT_PRINCIPAL');
  return { stage, nonce: readiness.nonce, blockHash: readiness.blockHash, timestamp: readiness.timestamp,
    fingerprint: [readiness.ownerClass, readiness.nonce, readiness.udcClass, readiness.poolClass, readiness.tokenClass, readiness.rawPoolFee, readiness.publicSTRKBalance, readiness.ownerPublicPrivacyKey, probeClass, state].map(String).join(':'), plan };
}
export function deploymentRequest(stage: DeploymentStage, plan: ReturnType<typeof buildProbeDeploymentPlan>, artifact: DeploymentArtifact) {
  if (stage === 'declare') return { type: 'wallet_addDeclareTransaction', params: { api_version: '0.10.3',
    class_hash: artifact.classHash, compiled_class_hash: artifact.compiledClassHash, contract_class: { sierra_program: artifact.contractClass.sierra_program,
      contract_class_version: artifact.contractClass.contract_class_version, entry_points_by_type: artifact.contractClass.entry_points_by_type,
      abi: typeof artifact.contractClass.abi === 'string' ? artifact.contractClass.abi : hash.formatSpaces(JSON.stringify(artifact.contractClass.abi)) } } };
  const calls = stage === 'deploy' ? [plan.deploymentCall] : [...plan.fundingCalls];
  return { type: 'wallet_addInvokeTransaction', params: { api_version: '0.10.3', invoke_transaction: calls.map((call) => ({
    contract_address: call.contractAddress, entry_point: hash.getSelectorFromName(call.entrypoint), calldata: calldata(call) })) } };
}
export function executeCalldata(stage: DeploymentStage, plan: ReturnType<typeof buildProbeDeploymentPlan>): bigint[] {
  const calls: Call[] = stage === 'deploy' ? [plan.deploymentCall] : [...plan.fundingCalls];
  return transaction.getExecuteCalldata(calls, '1').map(BigInt);
}
export function hex(value: bigint): string { return `0x${value.toString(16)}`; }

function calldata(call: Call): string[] {
  if (!Array.isArray(call.calldata)) throw new Error('VOW_INVALID_DEPLOYMENT_CALL');
  return call.calldata.map((value: unknown) => {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw new Error('VOW_INVALID_DEPLOYMENT_CALL');
    return hex(BigInt(value));
  });
}
