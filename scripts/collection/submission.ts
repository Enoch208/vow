import { reviewCollectionSubmission } from '../../packages/vow-sdk/src/collection-submission.ts';
import { runCollectionDispatch } from '../../packages/vow-sdk/src/collection-dispatch.ts';
import type { CollectionDispatchWallet } from '../../packages/vow-sdk/src/collection-dispatch.ts';
import { SubmissionJournal } from '../../packages/vow-sdk/src/submission-journal.ts';
import { readProbeSnapshot } from '../../packages/vow-sdk/src/probe-reader.ts';
import type { PublicReader } from '../../packages/vow-sdk/src/probe-reader.ts';
import { assertProbeReady } from '../../packages/vow-sdk/src/probe-snapshot.ts';
import type { ProbeConfiguration } from '../../packages/vow-sdk/src/probe-snapshot.ts';
import type { CollectionSession } from '../../packages/vow-sdk/src/collection-session.ts';
import type { ClaimSignature } from '../../packages/vow-sdk/src/claims.ts';
import { parseAmount, formatAmount } from '../../packages/vow-sdk/src/integers.ts';
import { collectionConfigurationFingerprint } from '../../packages/vow-sdk/src/collection-budget.ts';
import type { CollectionBudgetReview } from '../../packages/vow-sdk/src/collection-budget.ts';

interface SubmissionPreparation {
  readonly configuration: ProbeConfiguration;
  readonly session: CollectionSession;
  readonly signature: ClaimSignature;
  readonly wallet: CollectionDispatchWallet;
}

export function initializeSubmission(reader: PublicReader, onBusy: (busy: boolean) => void,
  now = () => BigInt(Math.floor(Date.now() / 1000)),
  budgetAllowsSubmission: (review: CollectionBudgetReview, configuration: ProbeConfiguration) => boolean = () => false,
  refreshBudget: (review: CollectionBudgetReview, configuration: ProbeConfiguration) => Promise<void> = async () => {}) {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const fee = element<HTMLInputElement>('network-fee-cap');
  const build = element<HTMLButtonElement>('review-submission');
  const approve = element<HTMLInputElement>('approve-submission');
  const budgetStatus = element<HTMLOutputElement>('submission-budget-status');
  const refresh = element<HTMLButtonElement>('refresh-collection-budget');
  const submit = element<HTMLButtonElement>('submit-collection');
  const status = element<HTMLOutputElement>('submission-status');
  const output = element<HTMLPreElement>('submission-review');
  const result = element<HTMLPreElement>('submission-result');
  const attempted = new Set<string>();
  let preparation: SubmissionPreparation | undefined;
  let reviewed: Awaited<ReturnType<typeof reviewCollectionSubmission>> | undefined;
  let revision = 0;
  let busy = false;
  let checkingRecovery = false;
  let feeAtReview = '';
  const scope = (config: ProbeConfiguration) => `${config.chainId}:${config.vaultAddress}:1`;
  const expired = () => !reviewed || now() >= reviewed.review.expiresAt;
  const budgetReady = () => {
    try { return !!reviewed && !!preparation && budgetAllowsSubmission(reviewed.review, preparation.configuration) === true; } catch { return false; }
  };
  const render = () => {
    const blocked = checkingRecovery || !preparation || attempted.has(scope(preparation.configuration));
    fee.disabled = busy || blocked;
    build.disabled = busy || blocked || !!reviewed || !fee.value.trim();
    approve.disabled = busy || blocked || expired();
    refresh.disabled = busy || blocked || expired();
    budgetStatus.textContent = budgetReady() ? 'Approved local budget gate passed. Verify the actual network fee in the wallet.'
      : 'Total budget: UNVERIFIED. Submission is disabled until an approved local budget is validated.';
    submit.disabled = busy || blocked || expired() || !approve.checked || !budgetReady() || fee.value.trim() !== feeAtReview;
  };
  const clear = () => {
    revision++; reviewed?.discard(); reviewed = undefined; preparation = undefined;
    checkingRecovery = false;
    approve.checked = false; feeAtReview = '';
    output.textContent = 'No submission reviewed.'; render();
  };
  build.addEventListener('click', () => {
    const current = preparation; const generation = revision;
    if (busy || checkingRecovery || !current || reviewed || attempted.has(scope(current.configuration))) return;
    void (async () => {
      busy = true; onBusy(true); render();
      try {
        const cap = parseAmount(fee.value.trim(), 18);
        if (cap === 0n) throw new Error('VOW_INVALID_NETWORK_FEE_CAP');
        const candidate = current.session.review;
        if (!candidate) throw new Error('VOW_NO_PREPARATION');
        const payload = await current.session.releasePreparedCall();
        if (generation !== revision) return;
        const next = await reviewCollectionSubmission(payload, current.configuration, candidate.claim.outputNoteId, current.signature, cap, now());
        await refreshBudget(next.review, current.configuration);
        if (generation !== revision) { next.discard(); return; }
        reviewed = next; feeAtReview = fee.value.trim();
        output.textContent = json({ ...next.review, recipient: current.configuration.recipient,
          configurationFingerprint: collectionConfigurationFingerprint(current.configuration),
          expectedWalletAccount: current.configuration.recipient, amountBaseUnits: current.configuration.amount.toString(),
          expiresAtUTC: new Date(Number(next.review.expiresAt) * 1000).toISOString(),
          maximumNetworkFeeSTRK: formatAmount(cap, 18), maximumPreparedProtocolFeeBaseUnits: current.configuration.maximumFee.toString() });
        status.textContent = 'Review the exact claim and fees. Full test-budget compliance remains unverified; network limits must be checked in the wallet.';
      } catch {
        if (generation === revision) { clear(); status.textContent = 'Submission review failed. Prepare and sign a fresh destination before continuing.'; }
      } finally { busy = false; onBusy(false); render(); }
    })();
  });
  submit.addEventListener('click', () => {
    const current = preparation; const candidate = reviewed; const generation = revision;
    if (busy || checkingRecovery || !current || !candidate || expired() || !approve.checked || !budgetReady() || fee.value.trim() !== feeAtReview || attempted.has(scope(current.configuration))) return;
    attempted.add(scope(current.configuration));
    void (async () => {
      busy = true; onBusy(true); render();
      status.textContent = 'Checking current contract state, then opening the wallet. Compare the wallet fee with your reviewed cap before approving.';
      try {
        const journal = new SubmissionJournal({ chainId: current.configuration.chainId, vaultAddress: current.configuration.vaultAddress, reservationId: 1n }, window.localStorage, navigator.locks);
        const response = await runCollectionDispatch({ reviewed: candidate, approvedReviewDigest: candidate.review.reviewDigest,
          expectedAccount: current.configuration.recipient, wallet: current.wallet, journal, now, timeoutMs: 180_000,
          preflight: async () => {
            assertProbeReady(current.configuration, await readProbeSnapshot(reader, current.configuration), now());
            await refreshBudget(candidate.review, current.configuration);
            if (generation !== revision || !approve.checked || !budgetReady() || fee.value.trim() !== feeAtReview) throw new Error('VOW_REVIEW_CHANGED');
          } });
        if (generation !== revision) return;
        result.textContent = json(response);
        status.textContent = response.walletOutcome === 'submitted' ? 'Wallet returned a transaction hash. Check its public receipt below; submission is not confirmation.'
          : response.walletOutcome === 'refused' ? 'Wallet reported refusal. The attempt remains recorded. Resolve it before attempting another payment.'
            : 'Outcome remains unresolved. Do not retry. Read the saved attempt or find its hash in the wallet, then check the public receipt.';
      } catch {
        if (generation === revision) status.textContent = 'Submission stopped. This page will not retry. Check saved recovery and wallet activity before taking another action.';
      } finally { busy = false; onBusy(false); render(); }
    })();
  });
  fee.addEventListener('input', () => {
    if (reviewed) { clear(); status.textContent = 'Fee cap changed. Prepare a new destination and review it again.'; }
    approve.checked = false; render();
  });
  approve.addEventListener('change', render);
  refresh.addEventListener('click', () => {
    const current = preparation; const candidate = reviewed; const generation = revision;
    if (busy || !current || !candidate || expired() || attempted.has(scope(current.configuration))) return;
    void (async () => {
      busy = true; onBusy(true); render();
      try { await refreshBudget(candidate.review, current.configuration); }
      catch { if (generation === revision) { clear(); status.textContent = 'Budget verification failed. Prepare and review again.'; } }
      finally { busy = false; onBusy(false); render(); }
    })();
  });
  render();
  return {
    clear(): void { clear(); status.textContent = 'No active submission review. Any saved attempt remains available below.'; },
    setPreparation(value: SubmissionPreparation): void {
      clear(); preparation = { ...value, configuration: Object.freeze({ ...value.configuration }), signature: Object.freeze({ ...value.signature }) };
      const generation = revision; checkingRecovery = true;
      result.textContent = 'No transaction submitted by this review.';
      status.textContent = 'Checking saved recovery before enabling a new submission review…';
      render();
      void (async () => {
        try {
          const journal = new SubmissionJournal({ chainId: value.configuration.chainId, vaultAddress: value.configuration.vaultAddress, reservationId: 1n }, window.localStorage, navigator.locks);
          const record = await journal.read();
          if (generation !== revision) return;
          if (record) attempted.add(scope(value.configuration));
          status.textContent = attempted.has(scope(value.configuration)) ? 'An attempt already exists for this reservation. Use recovery below.'
            : 'Proof preparation is ready. Enter the maximum network fee you will accept and review the exact submission.';
        } catch {
          if (generation !== revision) return;
          attempted.add(scope(value.configuration)); status.textContent = 'Recovery storage could not be checked. Submission remains disabled.';
        } finally { if (generation === revision) { checkingRecovery = false; render(); } }
      })();
    },
  };
}

function json(value: unknown): string {
  return JSON.stringify(value, (_, item: unknown) => typeof item === 'bigint' ? `0x${item.toString(16)}` : item, 2);
}
