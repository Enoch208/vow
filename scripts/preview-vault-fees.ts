import { readFile } from 'node:fs/promises';
import type { CompiledSierra, CompiledSierraCasm } from 'starknet';
import { buildVaultFeeQuery } from '../packages/vow-sdk/src/vault-fee-query.ts';
import type { VaultDeploymentTerms } from '../packages/vow-sdk/src/vault-deployment.ts';
import { parsePublicInteger } from './collection/configuration.ts';

const fields = [
  'chainId', 'owner', 'salt', 'poolAddress', 'token', 'feeToken', 'maximumFee',
];

async function jsonFile(path: string, maximum: number): Promise<unknown> {
  const text = await readFile(path, 'utf8');
  if (text.length > maximum) throw new Error('VOW_INPUT_TOO_LARGE');
  return JSON.parse(text);
}

try {
  if (process.argv[2] === '--help') {
    process.stdout.write(
      'Usage: node scripts/preview-vault-fees.ts public-account.json public-terms.json block-header.json\n'
      + 'Account input: {address, nonce, version: 0|1, blockHash}; nonce must be read at the same pinned block.\n'
      + 'Builds an unsigned DECLARE + deployment fee request locally and sends nothing.\n'
      + 'Output includes the full VowVault contract class.\n',
    );
  } else {
    if (process.argv.length !== 5) throw new Error('VOW_PUBLIC_FILES_REQUIRED');
    const account = await jsonFile(process.argv[2]!, 32_768);
    const input = await jsonFile(process.argv[3]!, 8192);
    const block = await jsonFile(process.argv[4]!, 8192);
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).sort().join(',') !== [...fields].sort().join(',')) {
      throw new Error('VOW_INVALID_CONFIGURATION');
    }
    if (!block || typeof block !== 'object' || !('blockHash' in block)
      || !('starknetVersion' in block) || typeof block.starknetVersion !== 'string') {
      throw new Error('VOW_INVALID_BLOCK');
    }
    if (!account || typeof account !== 'object' || Array.isArray(account)
      || Object.keys(account).sort().join(',') !== 'address,blockHash,nonce,version') {
      throw new Error('VOW_INVALID_DEPLOYED_OWNER');
    }
    const artifact = await jsonFile('dist/deployment/vault.json', 20_000_000) as {
      classHash: string; compiledClassHash: string;
    };
    const sierra = await jsonFile(
      'contracts/target/dev/vow_collection_probe_VowVault.contract_class.json', 20_000_000,
    ) as CompiledSierra;
    const casm = await jsonFile(
      'contracts/target/dev/vow_collection_probe_VowVault.compiled_contract_class.json', 40_000_000,
    ) as CompiledSierraCasm;
    const record = input as Record<string, unknown>;
    const terms = {
      ...Object.fromEntries(fields.map((field) => [field, parsePublicInteger(record[field])])),
      vaultClassHash: BigInt(artifact.classHash),
      compiledClassHash: BigInt(artifact.compiledClassHash),
    } as unknown as VaultDeploymentTerms;
    const owner = account as Record<string, unknown>;
    if (owner.version !== 0 && owner.version !== 1) throw new Error('VOW_INVALID_ACCOUNT_VERSION');
    const query = buildVaultFeeQuery(
      {
        address: parsePublicInteger(owner.address), nonce: parsePublicInteger(owner.nonce),
        version: owner.version, blockHash: parsePublicInteger(owner.blockHash),
      },
      terms, sierra, casm, parsePublicInteger(block.blockHash), block.starknetVersion,
      BigInt(Math.floor(Date.now() / 1000)),
    );
    process.stdout.write(JSON.stringify(query, null, 2) + '\n');
  }
} catch (error: unknown) {
  process.stderr.write(
    `${error instanceof Error && /^VOW_[A-Z_]+$/.test(error.message) ? error.message : 'VOW_VAULT_FEE_PREVIEW_FAILED'}\n`,
  );
  process.exitCode = 1;
}
