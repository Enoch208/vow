import { buildProbeDeploymentPlan } from '../../packages/vow-sdk/src/deployment-plan.ts';
import type { ProbeDeploymentTerms } from '../../packages/vow-sdk/src/deployment-plan.ts';
import { parsePublicInteger } from '../collection/configuration.ts';

const fields = ['chainId', 'poolAddress', 'token', 'supplierKey', 'amount', 'claimBefore', 'recipient', 'signatureDeadline', 'feeToken', 'feeCollector', 'maximumFee', 'owner', 'salt', 'principalLimit'];
export function reviewDeployment(text: string, classHash: bigint, now: bigint) {
  if (text.length > 8192) throw new Error('VOW_INVALID_CONFIGURATION');
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).sort().join(',') !== [...fields].sort().join(',')) throw new Error('VOW_INVALID_CONFIGURATION');
  const input = parsed as Record<string, unknown>;
  const terms = { ...Object.fromEntries(fields.map((field) => [field, parsePublicInteger(input[field])])), probeClassHash: classHash } as unknown as ProbeDeploymentTerms;
  const plan = buildProbeDeploymentPlan(terms, now);
  return { terms, summary: { status: 'Preview only — deployment and funding unverified', chain: 'Starknet mainnet',
    owner: hex(terms.owner), predictedProbe: hex(plan.predictedAddress), probeClassHash: hex(classHash),
    pool: hex(terms.poolAddress), token: hex(terms.token), principalBaseUnits: terms.amount.toString(),
    principalLimitBaseUnits: terms.principalLimit.toString(), supplierPublicKey: hex(terms.supplierKey), recipient: hex(terms.recipient),
    claimBeforeUnixSeconds: terms.claimBefore.toString(), signatureDeadlineUnixSeconds: terms.signatureDeadline.toString(),
    feeToken: hex(terms.feeToken), feeCollector: hex(terms.feeCollector), maximumProtocolFeeBaseUnits: terms.maximumFee.toString(),
    feeStatus: 'Input limit only — deployed fee units and total costs require verification', reviewDigest: hex(plan.reviewDigest) },
    calls: { deployment: plan.deploymentCall, atomicApprovalAndFunding: plan.fundingCalls },
    configuration: plan.collectionConfiguration };
}
export function publicJson(input: unknown): string {
  return JSON.stringify(input, (_, value: unknown) => typeof value === 'bigint' ? hex(value) : value, 2);
}
function hex(value: bigint): string { return `0x${value.toString(16)}`; }

export function initializeDeploymentReview(classHash: bigint, now: () => bigint = () => BigInt(Math.floor(Date.now() / 1000)),
  loadDraft: () => Promise<string> = async () => {
    const response = await fetch('/deployment/draft.json', { credentials: 'omit', cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error('VOW_DRAFT_UNAVAILABLE');
    return response.text();
  }, onReviewed: (terms: ProbeDeploymentTerms | undefined) => void = () => {}) {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const input = element<HTMLTextAreaElement>('deployment-terms');
  const configuration = element<HTMLTextAreaElement>('deployment-configuration');
  const status = element('deployment-status');
  const exportStatus = element('deployment-export-status');
  const copy = element<HTMLButtonElement>('copy-configuration');
  const download = element<HTMLButtonElement>('download-configuration');
  const load = element<HTMLButtonElement>('load-deployment-draft');
  let revision = 0;
  const clear = () => {
    onReviewed(undefined); revision++; configuration.value = ''; copy.disabled = download.disabled = true;
    element('deployment-summary').textContent = 'No deployment reviewed.';
    element('deployment-calls').textContent = 'No calls prepared.';
    exportStatus.textContent = 'No configuration prepared.';
    status.textContent = 'Terms changed. Review again before exporting.';
  };
  input.addEventListener('input', clear);
  element('clear-deployment').addEventListener('click', () => { input.value = ''; clear(); status.textContent = 'Review cleared.'; });
  const applyReview = (text: string) => {
    const result = reviewDeployment(text, classHash, now());
    onReviewed(result.terms);
    element('deployment-summary').textContent = publicJson(result.summary);
    element('deployment-calls').textContent = publicJson(result.calls);
    configuration.value = publicJson(result.configuration);
    copy.disabled = download.disabled = false;
    status.textContent = 'Terms validated against this build. Deployment and funding are still unverified.';
    exportStatus.textContent = 'Public configuration ready. Verify deployment and funding before collection.';
  };
  load.addEventListener('click', async () => {
    clear(); const current = revision; load.disabled = true;
    status.textContent = 'Loading the public draft from this local server…';
    try {
      const text = await loadDraft();
      if (revision !== current) return;
      applyReview(text); input.value = text;
    } catch {
      if (revision === current) status.textContent = 'The local draft is unavailable, expired or invalid. Paste fresh public terms below or request a refreshed draft.';
    } finally { load.disabled = false; }
  });
  element('review-deployment').addEventListener('click', () => {
    clear();
    try {
      applyReview(input.value);
    } catch (error: unknown) {
      status.textContent = error instanceof Error && error.message === 'VOW_CLAIM_EXPIRED'
        ? 'These terms have expired. Request fresh terms and review the new predicted address.'
        : 'Unable to validate these public terms. Check the complete deployment terms JSON. Nothing submitted.';
    }
  });
  copy.addEventListener('click', async () => {
    if (copy.disabled || !configuration.value) return;
    const current = revision;
    try {
      await navigator.clipboard.writeText(configuration.value);
      if (revision === current) exportStatus.textContent = 'Public configuration copied. Paste it into collection review after deployment and funding are verified.';
    } catch {
      if (revision === current) { configuration.focus(); configuration.select(); exportStatus.textContent = 'Clipboard unavailable. The configuration is selected; copy it manually.'; }
    }
  });
  download.addEventListener('click', () => {
    if (download.disabled || !configuration.value) return;
    const url = URL.createObjectURL(new Blob([configuration.value + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'vow-collection-configuration.json';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    exportStatus.textContent = 'Download requested. Confirm the file is saved in your browser.';
  });
  window.addEventListener('pagehide', () => { input.value = ''; clear(); });
  copy.disabled = download.disabled = true;
}
