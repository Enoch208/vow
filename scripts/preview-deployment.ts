import { readFile } from 'node:fs/promises';
import { hash } from 'starknet';
import type { CompiledSierra } from 'starknet';
import { buildProbeDeploymentPlan } from '../packages/vow-sdk/src/deployment-plan.ts';
import type { ProbeDeploymentTerms } from '../packages/vow-sdk/src/deployment-plan.ts';
import { parsePublicInteger } from './collection/configuration.ts';

const fields = ['chainId', 'poolAddress', 'token', 'supplierKey', 'amount', 'claimBefore', 'recipient', 'signatureDeadline', 'feeToken', 'feeCollector', 'maximumFee', 'owner', 'salt', 'principalLimit'] as const;

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path === '--help') {
    process.stdout.write(`Usage: node scripts/preview-deployment.ts public-terms.json\nRequired integer-string fields: ${fields.join(', ')}\nClass hash is calculated from the locally built Cairo artifact. No keys, network requests, signing, deployment or funding.\n`);
    return;
  }
  if (!path || process.argv.length !== 3) throw new Error('VOW_PUBLIC_TERMS_FILE_REQUIRED');
  const contents = await readFile(path, 'utf8');
  if (contents.length > 8192) throw new Error('VOW_INVALID_CONFIGURATION');
  const parsed: unknown = JSON.parse(contents);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('VOW_INVALID_CONFIGURATION');
  const input = parsed as Record<string, unknown>;
  if (Object.keys(input).length !== fields.length || Object.keys(input).some((key) => !fields.some((field) => field === key))) throw new Error('VOW_INVALID_CONFIGURATION');
  const source = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_CollectionProbe.contract_class.json', 'utf8')) as CompiledSierra;
  const terms = { ...Object.fromEntries(fields.map((field) => [field, parsePublicInteger(input[field])])), probeClassHash: BigInt(hash.computeContractClassHash(source)) } as unknown as ProbeDeploymentTerms;
  const plan = buildProbeDeploymentPlan(terms, BigInt(Math.floor(Date.now() / 1000)));
  process.stdout.write(JSON.stringify(plan, (_, value: unknown) => typeof value === 'bigint' ? `0x${value.toString(16)}` : value, 2) + '\n');
}

try { await main(); }
catch (error: unknown) {
  const message = error instanceof Error && /^VOW_[A-Z_]+$/.test(error.message) ? error.message : 'VOW_PREVIEW_FAILED';
  process.stderr.write(`${message}\n`); process.exitCode = 1;
}
