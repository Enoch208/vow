import { hash, transaction } from 'starknet';
import type { CompiledSierra, CompiledSierraCasm } from 'starknet';
import { validateAccountDeployment } from './account-deployment.ts';
import { buildProbeDeploymentPlan } from './deployment-plan.ts';
import type { ProbeDeploymentTerms } from './deployment-plan.ts';
import { address, felt, bounded, U128_MAX } from './integers.ts';

export type DeployedOwnerFeeContext = Readonly<{ address: bigint; nonce: bigint; version: 0 | 1; blockHash: bigint }>;

export function buildPredeploymentFeeQuery(account: unknown, terms: ProbeDeploymentTerms, sierra: CompiledSierra,
  casm: CompiledSierraCasm, blockHash: bigint, starknetVersion: string, now: bigint, includeFunding = false) {
  const owner = validateAccountDeployment(account, terms.owner);
  return buildFeeQuery(owner, terms, sierra, casm, blockHash, starknetVersion, now, includeFunding, 1n, owner);
}

export function buildDeployedOwnerFeeQuery(owner: DeployedOwnerFeeContext, terms: ProbeDeploymentTerms, sierra: CompiledSierra,
  casm: CompiledSierraCasm, blockHash: bigint, starknetVersion: string, now: bigint, includeFunding = false) {
  address(owner.address, 'OWNER');
  if (owner.address !== terms.owner) throw new Error('VOW_WRONG_DEPLOYMENT_ACCOUNT');
  if (owner.version !== 0 && owner.version !== 1) throw new Error('VOW_INVALID_ACCOUNT_VERSION');
  felt(owner.blockHash, 'OWNER_BLOCK', 1n);
  if (owner.blockHash !== blockHash) throw new Error('VOW_OWNER_BLOCK_MISMATCH');
  felt(owner.nonce, 'OWNER_NONCE');
  felt(owner.nonce + (includeFunding ? 2n : 1n), 'FINAL_NONCE');
  return buildFeeQuery({ address: hex(owner.address), version: owner.version }, terms, sierra, casm,
    blockHash, starknetVersion, now, includeFunding, owner.nonce);
}

function buildFeeQuery(owner: Readonly<{ address: string; version: 0 | 1 }>, terms: ProbeDeploymentTerms, sierra: CompiledSierra,
  casm: CompiledSierraCasm, blockHash: bigint, starknetVersion: string, now: bigint, includeFunding: boolean, nonce: bigint,
  activation?: ReturnType<typeof validateAccountDeployment>) {
  felt(blockHash, 'BLOCK', 1n);
  if (!/^0\.(?:1[4-9]|[2-9][0-9])\.[0-9]+$/.test(starknetVersion)) throw new Error('VOW_UNSUPPORTED_CHAIN_VERSION');
  if (BigInt(hash.computeContractClassHash(sierra)) !== terms.probeClassHash) throw new Error('VOW_WRONG_PROBE_BUILD');
  const plan = buildProbeDeploymentPlan(terms, now);
  const zero = { max_amount: '0x0', max_price_per_unit: '0x0' };
  const common = { version: '0x100000000000000000000000000000003', signature: [] as string[],
    resource_bounds: { l1_gas: zero, l2_gas: zero, l1_data_gas: zero }, tip: '0x0', paymaster_data: [] as string[],
    nonce_data_availability_mode: 'L1', fee_data_availability_mode: 'L1' };
  const compiledClassHash = hash.computeCompiledClassHash(casm, starknetVersion);
  const request = [
    ...(activation ? [{ ...common, type: 'DEPLOY_ACCOUNT', nonce: '0x0', class_hash: activation.class_hash,
      contract_address_salt: activation.salt, constructor_calldata: activation.calldata }] : []),
    { ...common, type: 'DECLARE', nonce: hex(nonce), sender_address: owner.address, account_deployment_data: [],
      compiled_class_hash: compiledClassHash, contract_class: { sierra_program: sierra.sierra_program,
        contract_class_version: sierra.contract_class_version, entry_points_by_type: sierra.entry_points_by_type,
        abi: typeof sierra.abi === 'string' ? sierra.abi : hash.formatSpaces(JSON.stringify(sierra.abi)) } },
    { ...common, type: 'INVOKE', nonce: hex(nonce + 1n), sender_address: owner.address, account_deployment_data: [],
      calldata: transaction.getExecuteCalldata([plan.deploymentCall], String(owner.version) as '0' | '1').map((value) => hex(BigInt(value))) },
  ];
  if (includeFunding) request.push({ ...common, type: 'INVOKE', nonce: hex(nonce + 2n), sender_address: owner.address, account_deployment_data: [],
    calldata: transaction.getExecuteCalldata([...plan.fundingCalls], String(owner.version) as '0' | '1').map((value) => hex(BigInt(value))) });
  return { method: 'starknet_estimateFee' as const,
    params: { request, simulation_flags: ['SKIP_VALIDATE'], block_id: { block_hash: hex(blockHash) } },
    review: { status: 'unsigned-estimate-only', requiresUndeployedOwner: Boolean(activation), requiresUndeclaredProbe: true,
      ...(!activation ? { requiresDeployedOwner: true, ownerNonce: hex(nonce), ownerNonceBlock: hex(blockHash) } : {}),
      owner: owner.address, probeClassHash: hex(terms.probeClassHash), compiledClassHash,
      predictedProbe: hex(plan.predictedAddress), validation: 'skipped', sourceDisclosure: 'full-contract-class',
      stages: [...(activation ? ['accountActivation'] : []), 'classDeclaration', 'probeDeployment', ...(includeFunding ? ['funding'] : [])],
      omitted: [...(includeFunding ? [] : ['funding']), 'privacyRegistration', 'collection', 'protocolFee', 'recoveryReserve'],
      requiresPrincipalBalance: includeFunding, totalBudgetVerified: false } };
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }

export function parseFeeEstimates(input: unknown, expectedCount: number) {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > 4 || !Array.isArray(input) || input.length !== expectedCount) throw new Error('VOW_INVALID_FEE_ESTIMATE');
  return input.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('VOW_INVALID_FEE_ESTIMATE');
    const row = item as Record<string, unknown>;
    if (row.unit !== 'FRI') throw new Error('VOW_WRONG_FEE_UNIT');
    const overall = number(row.overall_fee);
    const resources = ['l1_gas', 'l2_gas', 'l1_data_gas'].map((name) => ({ name,
      consumed: number(row[`${name}_consumed`]), price: number(row[`${name}_price`]) }));
    if (overall === 0n || resources.reduce((sum, part) => sum + part.consumed * part.price, 0n) !== overall) throw new Error('VOW_INCONSISTENT_FEE_ESTIMATE');
    return Object.freeze({ overallFeeFRI: overall, resources: Object.freeze(resources), validation: 'skipped', spendingCap: null });
  });
}
function number(input: unknown): bigint {
  if (typeof input !== 'string' || input.length > 80 || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(input)) throw new Error('VOW_INVALID_FEE_ESTIMATE');
  return bounded(BigInt(input), U128_MAX, 'FEE_ESTIMATE');
}
