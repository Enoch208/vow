import { readFile } from 'node:fs/promises';
import { hash } from 'starknet';
import type { CompiledSierra, CompiledSierraCasm } from 'starknet';
import type { ProbeDeploymentTerms } from '../packages/vow-sdk/src/deployment-plan.ts';
import { buildDeployedOwnerFeeQuery, buildPredeploymentFeeQuery } from '../packages/vow-sdk/src/deployment-fee-query.ts';
import { parsePublicInteger } from './collection/configuration.ts';

const fields = ['chainId', 'poolAddress', 'token', 'supplierKey', 'amount', 'claimBefore', 'recipient', 'signatureDeadline', 'feeToken', 'feeCollector', 'maximumFee', 'owner', 'salt', 'principalLimit'];
async function jsonFile(path: string, maximum: number): Promise<unknown> {
  const text = await readFile(path, 'utf8'); if (text.length > maximum) throw new Error('VOW_INPUT_TOO_LARGE'); return JSON.parse(text);
}
try {
  if (process.argv[2] === '--help') process.stdout.write('Usage: node scripts/preview-fees.ts public-account.json public-terms.json block-header.json [--include-funding] [--deployed-owner]\nDeployed-owner input: {address, nonce, version: 0|1, blockHash}; nonce must be read at the same pinned block.\nBuilds an unsigned RPC fee request locally; sends nothing. Output includes full contract class. Funding adds one exact approve-and-fund batch and requires a sufficient public principal balance.\n');
  else {
    const flags = process.argv.slice(5);
    if (process.argv.length < 5 || new Set(flags).size !== flags.length || flags.some((flag) => !['--include-funding', '--deployed-owner'].includes(flag))) throw new Error('VOW_PUBLIC_FILES_REQUIRED');
    const account = await jsonFile(process.argv[2]!, 32_768);
    const input = await jsonFile(process.argv[3]!, 8192);
    const block = await jsonFile(process.argv[4]!, 8192);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== [...fields].sort().join(',')) throw new Error('VOW_INVALID_CONFIGURATION');
    if (!block || typeof block !== 'object' || !('blockHash' in block) || !('starknetVersion' in block) || typeof block.starknetVersion !== 'string') throw new Error('VOW_INVALID_BLOCK');
    const sierra = await jsonFile('contracts/target/dev/vow_collection_probe_CollectionProbe.contract_class.json', 5_000_000) as CompiledSierra;
    const casm = await jsonFile('contracts/target/dev/vow_collection_probe_CollectionProbe.compiled_contract_class.json', 10_000_000) as CompiledSierraCasm;
    const record = input as Record<string, unknown>;
    const terms = { ...Object.fromEntries(fields.map((field) => [field, parsePublicInteger(record[field])])), probeClassHash: BigInt(hash.computeContractClassHash(sierra)) } as unknown as ProbeDeploymentTerms;
    const blockHash = parsePublicInteger(block.blockHash);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const includeFunding = flags.includes('--include-funding');
    let query;
    if (flags.includes('--deployed-owner')) {
      if (!account || typeof account !== 'object' || Array.isArray(account) || Object.keys(account).sort().join(',') !== 'address,blockHash,nonce,version') throw new Error('VOW_INVALID_DEPLOYED_OWNER');
      const owner = account as Record<string, unknown>;
      if (owner.version !== 0 && owner.version !== 1) throw new Error('VOW_INVALID_ACCOUNT_VERSION');
      query = buildDeployedOwnerFeeQuery({ address: parsePublicInteger(owner.address), nonce: parsePublicInteger(owner.nonce),
        version: owner.version, blockHash: parsePublicInteger(owner.blockHash) }, terms, sierra, casm, blockHash, block.starknetVersion, now, includeFunding);
    } else query = buildPredeploymentFeeQuery(account, terms, sierra, casm, blockHash, block.starknetVersion, now, includeFunding);
    process.stdout.write(JSON.stringify(query, null, 2) + '\n');
  }
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error && /^VOW_[A-Z_]+$/.test(error.message) ? error.message : 'VOW_FEE_PREVIEW_FAILED'}\n`); process.exitCode = 1;
}
