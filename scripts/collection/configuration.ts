import { parsePublicInteger } from '../../packages/vow-sdk/src/integers.ts';
import { validateProbeConfiguration } from '../../packages/vow-sdk/src/probe-snapshot.ts';
import type { ProbeConfiguration } from '../../packages/vow-sdk/src/probe-snapshot.ts';

export { parsePublicInteger };

const fields = ['chainId', 'vaultAddress', 'probeClassHash', 'poolAddress', 'token', 'supplierKey', 'amount', 'claimBefore', 'recipient', 'signatureDeadline', 'feeToken', 'feeCollector', 'maximumFee'] as const;

export function parseConfiguration(text: string, expectedClassHash: bigint): ProbeConfiguration {
  if (text.length > 8192) throw new Error('VOW_INVALID_CONFIGURATION');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('VOW_INVALID_CONFIGURATION'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('VOW_INVALID_CONFIGURATION');
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== fields.length || Object.keys(record).some((key) => !fields.some((field) => field === key))) throw new Error('VOW_INVALID_CONFIGURATION');
  const result = Object.fromEntries(fields.map((field) => [field, parsePublicInteger(record[field])])) as unknown as ProbeConfiguration;
  validateProbeConfiguration(result);
  if (result.probeClassHash !== expectedClassHash) throw new Error('VOW_WRONG_PROBE_BUILD');
  if (result.chainId !== 0x534e5f4d41494en) throw new Error('VOW_WRONG_CHAIN');
  return Object.freeze(result);
}
