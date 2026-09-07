import { hash } from 'starknet';
import { bounded, felt, U128_MAX } from './integers.ts';
import { assessTestBudget, TEST_COSTS } from './test-budget.ts';
import type { TestCost } from './test-budget.ts';
import type { reviewCollectionSubmission } from './collection-submission.ts';
import { validateProbeConfiguration } from './probe-snapshot.ts';
import type { ProbeConfiguration } from './probe-snapshot.ts';
import { DEPLOYMENT_DEPENDENCIES } from './deployment-readiness.ts';

export type CollectionBudgetReview = Awaited<ReturnType<typeof reviewCollectionSubmission>>['review'];
export const COLLECTION_BUDGET_FIELDS = ['chainId', 'vaultAddress', 'probeClassHash', 'poolAddress', 'token', 'supplierKey', 'amount',
  'claimBefore', 'recipient', 'signatureDeadline', 'feeToken', 'feeCollector', 'maximumFee'] as const;

export interface CollectionBudgetManifest {
  readonly version: 1;
  readonly approval: 'approved-for-exact-collection';
  readonly approvedAt: number;
  readonly configuration: Readonly<Record<typeof COLLECTION_BUDGET_FIELDS[number], string>>;
  readonly configurationFingerprint: string;
  readonly approvedReviewDigest: string;
  readonly maximumNetworkFeeSTRK: string;
  readonly maximumUSDCents: '500';
  readonly principalSTRK: string;
  readonly feeCapsSTRK: Readonly<Record<TestCost, string>>;
  readonly quote: { readonly pair: 'STRK/USD'; readonly usdPerSTRK: string; readonly observedAt: number };
}

export function collectionConfigurationFingerprint(configuration: ProbeConfiguration): string {
  validateProbeConfiguration(configuration);
  return hash.computePoseidonHashOnElements([0x564f575f4255444745545f5631n, ...COLLECTION_BUDGET_FIELDS.map((field) => configuration[field])]);
}

export function validateCollectionBudgetManifest(input: unknown, configuration: ProbeConfiguration, review: CollectionBudgetReview,
  now: number, minimumCosts: Readonly<Partial<Record<TestCost, bigint>>> = {}) {
  const config = Object.freeze({ ...configuration }); validateProbeConfiguration(config);
  felt(review.reviewDigest, 'BUDGET_REVIEW_DIGEST', 1n); bounded(review.maximumNetworkFeeSTRK, U128_MAX, 'NETWORK_FEE_CAP', 1n);
  if (config.chainId !== DEPLOYMENT_DEPENDENCIES.chainId || config.token !== DEPLOYMENT_DEPENDENCIES.strk || config.feeToken !== DEPLOYMENT_DEPENDENCIES.strk) throw new Error('VOW_BUDGET_ASSET_MISMATCH');
  if (!Number.isSafeInteger(now) || now < 0 || BigInt(now) >= review.expiresAt || BigInt(now) >= config.signatureDeadline) throw new Error('VOW_BUDGET_EXPIRED');
  const manifest = object(input, ['version', 'approval', 'approvedAt', 'configuration', 'configurationFingerprint', 'approvedReviewDigest',
    'maximumNetworkFeeSTRK', 'maximumUSDCents', 'principalSTRK', 'feeCapsSTRK', 'quote']);
  if (manifest.version !== 1 || manifest.approval !== 'approved-for-exact-collection' || manifest.maximumUSDCents !== '500') throw new Error('VOW_BUDGET_NOT_APPROVED');
  if (typeof manifest.approvedAt !== 'number' || !Number.isSafeInteger(manifest.approvedAt) || manifest.approvedAt < 0 || manifest.approvedAt > now || now - manifest.approvedAt > 300) throw new Error('VOW_BUDGET_EXPIRED');
  const declared = object(manifest.configuration, COLLECTION_BUDGET_FIELDS);
  for (const field of COLLECTION_BUDGET_FIELDS) if (integer(declared[field]) !== config[field]) throw new Error('VOW_BUDGET_TERMS_CHANGED');
  if (integer(manifest.configurationFingerprint) !== BigInt(collectionConfigurationFingerprint(config))) throw new Error('VOW_BUDGET_TERMS_CHANGED');
  if (integer(manifest.approvedReviewDigest) !== review.reviewDigest || money(manifest.maximumNetworkFeeSTRK) !== review.maximumNetworkFeeSTRK) throw new Error('VOW_BUDGET_REVIEW_CHANGED');
  const claim = review.claim;
  if (claim.chainId !== config.chainId || claim.vaultAddress !== config.vaultAddress || claim.token !== config.token || claim.amount !== config.amount ||
      claim.signatureDeadline !== config.signatureDeadline || claim.mandateId !== 1n || claim.reservationId !== 1n ||
      review.feeToken !== config.feeToken || review.maximumPreparedFee !== config.maximumFee) throw new Error('VOW_BUDGET_REVIEW_CHANGED');
  const principalSTRK = money(manifest.principalSTRK);
  const caps = object(manifest.feeCapsSTRK, TEST_COSTS);
  const feeCapsSTRK = Object.fromEntries(TEST_COSTS.map((stage) => [stage, money(caps[stage])])) as Record<TestCost, bigint>;
  if (principalSTRK < config.amount || feeCapsSTRK.collection < review.maximumNetworkFeeSTRK || feeCapsSTRK.protocolFee < config.maximumFee) throw new Error('VOW_BUDGET_COMPONENT_UNDER_CAP');
  for (const stage of TEST_COSTS) if (feeCapsSTRK[stage] < bounded(minimumCosts[stage] ?? 0n, U128_MAX, 'MINIMUM_COST')) throw new Error('VOW_BUDGET_COMPONENT_UNDER_CAP');
  bounded(principalSTRK + TEST_COSTS.reduce((sum, stage) => sum + feeCapsSTRK[stage], 0n), U128_MAX, 'TOTAL_COST');
  const quoted = object(manifest.quote, ['pair', 'usdPerSTRK', 'observedAt']);
  if (quoted.pair !== 'STRK/USD' || typeof quoted.usdPerSTRK !== 'string' || typeof quoted.observedAt !== 'number' ||
      !Number.isSafeInteger(quoted.observedAt) || quoted.observedAt < 0 || quoted.observedAt > manifest.approvedAt) throw new Error('VOW_BUDGET_QUOTE_MISMATCH');
  const quote = { pair: 'STRK/USD' as const, usdPerSTRK: quoted.usdPerSTRK, observedAt: quoted.observedAt };
  const result = assessTestBudget({ maximumUSDCents: 500n, principalSTRK, feeCapsSTRK, quote }, now);
  if (result.status !== 'within-quoted-cap') throw new Error('VOW_BUDGET_EXCEEDS_CAP');
  return Object.freeze({ ...result, approvedReviewDigest: review.reviewDigest, configurationFingerprint: collectionConfigurationFingerprint(config),
    quoteObservedAt: quote.observedAt, expiresAt: Math.min(quote.observedAt + 300, manifest.approvedAt + 300, Number(review.expiresAt)),
    networkFeeEnforcement: 'manual-wallet-confirmation' as const });
}

export function parseCollectionBudgetManifest(text: string, configuration: ProbeConfiguration, review: CollectionBudgetReview, now: number,
  minimumCosts: Readonly<Partial<Record<TestCost, bigint>>> = {}) {
  if (typeof text !== 'string' || text.length > 16_384) throw new Error('VOW_INVALID_BUDGET_MANIFEST');
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new Error('VOW_INVALID_BUDGET_MANIFEST'); }
  return validateCollectionBudgetManifest(input, configuration, review, now, minimumCosts);
}

function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('VOW_INVALID_BUDGET_MANIFEST');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error('VOW_INVALID_BUDGET_MANIFEST');
  return value;
}

function integer(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(value)) throw new Error('VOW_INVALID_BUDGET_INTEGER');
  return felt(BigInt(value), 'BUDGET_INTEGER');
}

function money(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,38})$/.test(value)) throw new Error('VOW_INVALID_BUDGET_AMOUNT');
  return bounded(BigInt(value), U128_MAX, 'BUDGET_AMOUNT');
}
