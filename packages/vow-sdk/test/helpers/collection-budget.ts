import { DEPLOYMENT_DEPENDENCIES } from '../../src/deployment-readiness.ts';
import { collectionConfigurationFingerprint } from '../../src/collection-budget.ts';
import type { CollectionBudgetReview } from '../../src/collection-budget.ts';
import { TEST_COSTS } from '../../src/test-budget.ts';
import { config } from './collection.ts';

export const budgetConfig = { ...config, chainId: DEPLOYMENT_DEPENDENCIES.chainId, token: DEPLOYMENT_DEPENDENCIES.strk,
  feeToken: DEPLOYMENT_DEPENDENCIES.strk, amount: 100_000_000_000_000_000n, maximumFee: 6_000_000_000_000_000_000n };
export const budgetReview: CollectionBudgetReview = {
  status: 'review-only', claim: { chainId: budgetConfig.chainId, vaultAddress: budgetConfig.vaultAddress, mandateId: 1n, reservationId: 1n,
    token: budgetConfig.token, amount: budgetConfig.amount, outputNoteId: 777n, signatureDeadline: budgetConfig.signatureDeadline },
  reviewDigest: 12345n, payloadSha256: 'a'.repeat(64), expiresAt: 1300n, maximumNetworkFeeSTRK: 500_000_000_000_000_000n,
  maximumPreparedFee: budgetConfig.maximumFee, feeToken: budgetConfig.feeToken, networkFeeEnforcement: 'manual-wallet-confirmation', totalBudget: 'not-assessed',
};

export function budgetManifest() {
  return {
    version: 1, approval: 'approved-for-exact-collection', approvedAt: 1000,
    configuration: Object.fromEntries(Object.entries(budgetConfig).map(([key, value]) => [key, `0x${value.toString(16)}`])),
    configurationFingerprint: collectionConfigurationFingerprint(budgetConfig), approvedReviewDigest: `0x${budgetReview.reviewDigest.toString(16)}`,
    maximumNetworkFeeSTRK: budgetReview.maximumNetworkFeeSTRK.toString(), maximumUSDCents: '500', principalSTRK: budgetConfig.amount.toString(),
    feeCapsSTRK: { ...Object.fromEntries(TEST_COSTS.map((stage) => [stage, '1000000000000000000'])),
      collection: budgetReview.maximumNetworkFeeSTRK.toString(), protocolFee: budgetConfig.maximumFee.toString() } as Record<typeof TEST_COSTS[number], string>,
    quote: { pair: 'STRK/USD', usdPerSTRK: '0.03', observedAt: 990 },
  };
}
