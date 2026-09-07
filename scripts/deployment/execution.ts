import { getWallets } from '@wallet-standard/app';
import { discoverProbeWallets } from '../../packages/vow-sdk/src/wallet-discovery.ts';
import type { DiscoveredWallet } from '../../packages/vow-sdk/src/wallet-discovery.ts';
import { DeploymentExecution } from '../../packages/vow-sdk/src/deployment-execution.ts';
import type { DeploymentArtifact, DeploymentWallet } from '../../packages/vow-sdk/src/deployment-execution-state.ts';
import { createPublicReader } from '../../packages/vow-sdk/src/probe-reader.ts';
import { PUBLIC_MAINNET_RPC } from '../../packages/vow-sdk/src/rpc-endpoint.ts';
import type { ProbeDeploymentTerms } from '../../packages/vow-sdk/src/deployment-plan.ts';
import { parsePublicInteger } from '../collection/configuration.ts';
import { publicJson } from './review.ts';

export function initializeDeploymentExecution(compiledClassHash: bigint) {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const list = element<HTMLSelectElement>('deployment-wallet');
  const approve = element<HTMLInputElement>('approve-deployment-stage');
  const prepare = element<HTMLButtonElement>('prepare-deployment-stage');
  const execute = element<HTMLButtonElement>('execute-deployment-stage');
  const reconcile = element<HTMLButtonElement>('reconcile-deployment-stage');
  const status = element('deployment-execution-status');
  const registry = getWallets();
  let wallets: DiscoveredWallet[] = []; let terms: ProbeDeploymentTerms | undefined;
  let session: DeploymentExecution | undefined; let digest: string | undefined;
  let busy = false; let revision = 0; let unsubscribe = () => {};
  const render = () => { prepare.disabled = busy || !terms || wallets.length === 0; list.disabled = busy || wallets.length === 0;
    execute.disabled = busy || !digest || !approve.checked; approve.disabled = busy || !digest; reconcile.disabled = busy || !terms; };
  const invalidate = () => { revision++; session?.invalidate(); digest = undefined; approve.checked = false;
    element('deployment-stage-review').textContent = 'No transaction stage reviewed.'; render(); };
  const scan = () => {
    invalidate(); let injected: unknown;
    try { injected = Reflect.get(window, 'starknet_argentX'); } catch { injected = undefined; }
    wallets = discoverProbeWallets(registry.get(), injected);
    list.replaceChildren(...wallets.map((wallet, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = `${wallet.name} · ${wallet.version}`; return option; })); render();
  };
  const engine = async () => {
    if (!terms) throw new Error('VOW_DEPLOYMENT_NOT_REVIEWED');
    if (!session) {
      const captured = terms; const current = revision;
      const response = await fetch('/deployment/contract.json', { cache: 'no-store', credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error('VOW_BUILD_UNAVAILABLE');
      const text = await response.text(); if (text.length > 5_000_000) throw new Error('VOW_INVALID_BUILD');
      const artifact: unknown = JSON.parse(text);
      if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact) || Object.keys(artifact).sort().join(',') !== 'classHash,compiledClassHash,contractClass,starknetVersion') throw new Error('VOW_INVALID_BUILD');
      if (current !== revision || captured !== terms) throw new Error('VOW_SELECTION_CHANGED');
      const budgetResponse = await fetch('/deployment/budget.json', { cache: 'no-store', credentials: 'omit', redirect: 'error' });
      if (!budgetResponse.ok) throw new Error('VOW_NETWORK_CEILINGS_REQUIRED');
      const budgetText = await budgetResponse.text(); if (budgetText.length > 4096) throw new Error('VOW_INVALID_FEE_CEILINGS');
      const budget: unknown = JSON.parse(budgetText);
      if (!budget || typeof budget !== 'object' || Array.isArray(budget) || Object.keys(budget).sort().join(',') !== 'declare,deploy,fund') throw new Error('VOW_INVALID_FEE_CEILINGS');
      const limits = budget as Record<string, unknown>;
      if (current !== revision || captured !== terms) throw new Error('VOW_SELECTION_CHANGED');
      session = new DeploymentExecution(captured, artifact as DeploymentArtifact, compiledClassHash, createPublicReader(PUBLIC_MAINNET_RPC), window.localStorage, navigator.locks,
        { declare: parsePublicInteger(limits.declare), deploy: parsePublicInteger(limits.deploy), fund: parsePublicInteger(limits.fund) });
    }
    return session;
  };
  const run = async (work: (current: number) => Promise<void>) => {
    if (busy) return; busy = true; render(); const current = revision;
    try { await work(current); }
    catch (error: unknown) { if (revision === current) status.textContent = `${error instanceof Error && /^VOW_[A-Z_]+$/.test(error.message) ? error.message : 'VOW_DEPLOYMENT_CHECK_FAILED'}. No automatic retry. Reconcile any saved attempt before continuing.`; }
    finally {
      if (session?.observedTransactionHash) element<HTMLInputElement>('deployment-recovery-hash').value = session.observedTransactionHash;
      busy = false; render();
    }
  };
  prepare.addEventListener('click', () => void run(async (current) => {
    const wallet = wallets[Number(list.value)]; if (!wallet) return;
    const active = await engine(); unsubscribe(); unsubscribe = wallet.subscribeInvalidation(invalidate);
    const review = await active.prepare(wallet.probe as unknown as DeploymentWallet);
    if (revision !== current) return;
    element<HTMLInputElement>('deployment-recovery-hash').value = '';
    digest = review.stage === 'complete' ? undefined : review.reviewDigest; approve.checked = false;
    element('deployment-stage-review').textContent = publicJson({ ...review, request: review.stage === 'declare'
      ? { type: 'wallet_addDeclareTransaction', classHash: terms!.probeClassHash, compiledClassHash, source: 'Complete locally compiled class; no constructor or funding in this stage' } : review.request });
    status.textContent = review.stage === 'complete' ? 'Probe deployment and funding matched current public chain state. Continue to collection review.' : 'Check the exact stage, then approve it to open Ready. No transaction requested yet.';
    element('deployment-attempt').textContent = publicJson(await active.read());
  }));
  execute.addEventListener('click', () => void run(async (current) => {
    const wallet = wallets[Number(list.value)]; const approvedDigest = digest;
    if (!wallet || !session || !approvedDigest || !approve.checked) return;
    digest = undefined; approve.checked = false;
    status.textContent = 'Review the transaction and network fee in Ready. A missing response must be reconciled before continuing.';
    const record = await session.execute(wallet.probe as unknown as DeploymentWallet, approvedDigest, true);
    if (revision !== current) return;
    element('deployment-attempt').textContent = publicJson(record);
    status.textContent = 'Attempt outcome recorded. Keep the displayed transaction hash. Click Reconcile saved attempt to verify its exact transaction and chain result. Do not repeat it.';
  }));
  reconcile.addEventListener('click', () => void run(async (current) => {
    digest = undefined; approve.checked = false; session?.invalidate(); const active = await engine();
    const record = await active.reconcile(element<HTMLInputElement>('deployment-recovery-hash').value.trim() || undefined);
    if (revision !== current) return;
    element('deployment-attempt').textContent = publicJson(record);
    status.textContent = record.attempts.at(-1)?.status === 'confirmed' ? 'Exact transaction and resulting chain state verified. Check the next stage.' : 'Outcome remains unresolved or reverted. Do not retry. Keep the transaction hash for investigation.';
  }));
  approve.addEventListener('change', render); list.addEventListener('change', invalidate);
  element('scan-deployment-wallet').addEventListener('click', scan); registry.on('register', scan); registry.on('unregister', scan);
  window.addEventListener('pagehide', () => { invalidate(); unsubscribe(); }); scan();
  return { setTerms(value: ProbeDeploymentTerms | undefined) { invalidate(); terms = value; session = undefined; element('deployment-attempt').textContent = 'No saved attempt loaded.'; render(); } };
}
