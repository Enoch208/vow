import { hash, transaction } from 'starknet';
import type { CompiledSierra, CompiledSierraCasm } from 'starknet';
import { address, felt } from './integers.ts';
import { buildVaultDeploymentPlan } from './vault-deployment.ts';
import type { VaultDeploymentTerms } from './vault-deployment.ts';

export type VaultOwnerContext = Readonly<{
  address: bigint; nonce: bigint; version: 0 | 1; blockHash: bigint;
}>;

export function buildVaultFeeQuery(
  owner: VaultOwnerContext,
  terms: VaultDeploymentTerms,
  sierra: CompiledSierra,
  casm: CompiledSierraCasm,
  blockHash: bigint,
  starknetVersion: string,
  now: bigint,
) {
  address(owner.address, 'OWNER');
  if (owner.address !== terms.owner) throw new Error('VOW_WRONG_DEPLOYMENT_ACCOUNT');
  if (owner.version !== 0 && owner.version !== 1) throw new Error('VOW_INVALID_ACCOUNT_VERSION');
  felt(owner.blockHash, 'OWNER_BLOCK', 1n);
  if (owner.blockHash !== blockHash) throw new Error('VOW_OWNER_BLOCK_MISMATCH');
  felt(owner.nonce, 'OWNER_NONCE');
  felt(blockHash, 'BLOCK', 1n);
  if (!/^0\.(?:1[4-9]|[2-9][0-9])\.[0-9]+$/.test(starknetVersion)) {
    throw new Error('VOW_UNSUPPORTED_CHAIN_VERSION');
  }
  if (BigInt(hash.computeContractClassHash(sierra)) !== terms.vaultClassHash) {
    throw new Error('VOW_WRONG_VAULT_BUILD');
  }
  const compiledClassHash = hash.computeCompiledClassHash(casm, starknetVersion);
  if (BigInt(compiledClassHash) !== terms.compiledClassHash) {
    throw new Error('VOW_WRONG_VAULT_BUILD');
  }
  const plan = buildVaultDeploymentPlan(terms, now);
  const zero = { max_amount: '0x0', max_price_per_unit: '0x0' };
  const common = {
    version: '0x100000000000000000000000000000003', signature: [] as string[],
    resource_bounds: { l1_gas: zero, l2_gas: zero, l1_data_gas: zero }, tip: '0x0',
    paymaster_data: [] as string[], nonce_data_availability_mode: 'L1',
    fee_data_availability_mode: 'L1',
  };
  const sender = hex(owner.address);
  const request = [
    {
      ...common, type: 'DECLARE', nonce: hex(owner.nonce), sender_address: sender,
      account_deployment_data: [], compiled_class_hash: compiledClassHash,
      contract_class: {
        sierra_program: sierra.sierra_program,
        contract_class_version: sierra.contract_class_version,
        entry_points_by_type: sierra.entry_points_by_type,
        abi: typeof sierra.abi === 'string' ? sierra.abi : hash.formatSpaces(JSON.stringify(sierra.abi)),
      },
    },
    {
      ...common, type: 'INVOKE', nonce: hex(owner.nonce + 1n), sender_address: sender,
      account_deployment_data: [],
      calldata: transaction
        .getExecuteCalldata([plan.deploymentCall], String(owner.version) as '0' | '1')
        .map((value) => hex(BigInt(value))),
    },
  ];
  return {
    method: 'starknet_estimateFee' as const,
    params: {
      request, simulation_flags: ['SKIP_VALIDATE'], block_id: { block_hash: hex(blockHash) },
    },
    review: {
      status: 'unsigned-estimate-only', requiresDeployedOwner: true, requiresUndeclaredVault: true,
      owner: sender, ownerNonce: hex(owner.nonce), ownerNonceBlock: hex(blockHash),
      vaultClassHash: hex(terms.vaultClassHash), compiledClassHash,
      predictedVault: hex(plan.predictedAddress), pool: hex(terms.poolAddress),
      reviewDigest: hex(plan.reviewDigest), validation: 'skipped',
      sourceDisclosure: 'full-contract-class',
      stages: ['classDeclaration', 'vaultDeployment'],
      omitted: [
        'mandateCreation', 'funding', 'reservation', 'collection', 'protocolFee', 'recoveryReserve',
      ],
      totalBudgetVerified: false,
    },
  };
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
