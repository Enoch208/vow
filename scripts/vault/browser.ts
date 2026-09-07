import { getWallets } from '@wallet-standard/app';
import { discoverProbeWallets } from '../../packages/vow-sdk/src/wallet-discovery.ts';
import type { DiscoveredWallet } from '../../packages/vow-sdk/src/wallet-discovery.ts';
import { createPublicReader } from '../../packages/vow-sdk/src/probe-reader.ts';
import { PUBLIC_MAINNET_RPC } from '../../packages/vow-sdk/src/rpc-endpoint.ts';
import { parsePublicInteger } from '../../packages/vow-sdk/src/integers.ts';
import { buildVaultDeploymentPlan } from '../../packages/vow-sdk/src/vault-deployment.ts';
import type { VaultDeploymentTerms } from '../../packages/vow-sdk/src/vault-deployment.ts';
import {
  checkVaultWallet, readVaultStage, vaultStageRequest, vaultWalletErrorCode,
} from '../../packages/vow-sdk/src/vault-execution.ts';
import type { VaultStageReading } from '../../packages/vow-sdk/src/vault-execution.ts';
import type { DeploymentArtifact } from '../../packages/vow-sdk/src/deployment-execution-state.ts';

const FIELDS = ['chainId', 'owner', 'salt', 'poolAddress', 'token', 'feeToken', 'maximumFee'];

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const hex = (value: bigint) => `0x${value.toString(16)}`;
const publicJson = (input: unknown) => JSON.stringify(
  input, (_key, value: unknown) => (typeof value === 'bigint' ? hex(value) : value), 2,
);

let terms: VaultDeploymentTerms | undefined;
let reading: VaultStageReading | undefined;
let wallets: DiscoveredWallet[] = [];
let busy = false;
let revision = 0;

const now = () => BigInt(Math.floor(Date.now() / 1000));

function parseTerms(text: string, artifact: DeploymentArtifact): VaultDeploymentTerms {
  if (text.length > 8192) throw new Error('VOW_INVALID_CONFIGURATION');
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(',') !== [...FIELDS].sort().join(',')) {
    throw new Error('VOW_INVALID_CONFIGURATION');
  }
  const record = parsed as Record<string, unknown>;
  return {
    ...Object.fromEntries(FIELDS.map((field) => [field, parsePublicInteger(record[field])])),
    vaultClassHash: BigInt(artifact.classHash),
    compiledClassHash: BigInt(artifact.compiledClassHash),
  } as unknown as VaultDeploymentTerms;
}

async function loadArtifact(): Promise<DeploymentArtifact> {
  const response = await fetch('/vault/contract.json', {
    cache: 'no-store', credentials: 'omit', redirect: 'error',
  });
  if (!response.ok) throw new Error('VOW_BUILD_UNAVAILABLE');
  return await response.json() as DeploymentArtifact;
}

function invalidate() {
  revision += 1;
  terms = undefined;
  reading = undefined;
  element('vault-summary').textContent = 'No deployment reviewed.';
  element('vault-stage').textContent = 'No chain stage checked.';
  element<HTMLInputElement>('approve-vault-stage').checked = false;
  render();
}

function render() {
  element<HTMLButtonElement>('review-vault').disabled = busy;
  element<HTMLButtonElement>('check-vault-stage').disabled = busy || !terms;
  element<HTMLInputElement>('approve-vault-stage').disabled = busy || !reading
    || reading.stage === 'complete';
  element<HTMLButtonElement>('request-vault-stage').disabled = busy || !reading
    || reading.stage === 'complete' || !element<HTMLInputElement>('approve-vault-stage').checked
    || wallets.length === 0;
  element<HTMLSelectElement>('vault-wallet').disabled = busy || wallets.length === 0;
}

async function review(text: string) {
  const artifact = await loadArtifact();
  const parsed = parseTerms(text, artifact);
  const plan = buildVaultDeploymentPlan(parsed, now());
  terms = parsed;
  reading = undefined;
  element('vault-summary').textContent = publicJson({
    status: 'Preview only — declaration and deployment unverified',
    chain: 'Starknet mainnet',
    owner: hex(parsed.owner),
    predictedVault: hex(plan.predictedAddress),
    vaultClassHash: hex(parsed.vaultClassHash),
    compiledClassHash: hex(parsed.compiledClassHash),
    pool: hex(parsed.poolAddress),
    token: hex(parsed.token),
    constructorCalldata: plan.constructorCalldata,
    stageFeeCeilingBaseUnits: parsed.maximumFee.toString(),
    reviewDigest: hex(plan.reviewDigest),
    note: 'This deployment creates no mandate and moves no budget.',
  });
  element('vault-stage').textContent = 'Terms reviewed. Check the chain stage before executing.';
  element('vault-status').textContent
    = 'Terms validated against this build. Declaration and deployment are still unverified.';
  render();
}

element('load-vault-draft').addEventListener('click', async () => {
  invalidate();
  const current = revision;
  busy = true;
  render();
  element('vault-status').textContent = 'Loading the public draft from this local server…';
  try {
    const response = await fetch('/vault/draft.json', {
      cache: 'no-store', credentials: 'omit', redirect: 'error',
    });
    if (!response.ok) throw new Error('VOW_DRAFT_UNAVAILABLE');
    const text = await response.text();
    if (revision !== current) return;
    element<HTMLTextAreaElement>('vault-terms').value = text;
    await review(text);
  } catch {
    if (revision === current) {
      element('vault-status').textContent
        = 'The local draft is unavailable or invalid. Paste fresh public terms below.';
    }
  } finally {
    busy = false;
    render();
  }
});

element('review-vault').addEventListener('click', async () => {
  invalidate();
  const current = revision;
  busy = true;
  render();
  try {
    await review(element<HTMLTextAreaElement>('vault-terms').value);
  } catch {
    if (revision === current) {
      element('vault-status').textContent
        = 'Unable to validate these public terms. Nothing submitted.';
    }
  } finally {
    busy = false;
    render();
  }
});

element('clear-vault').addEventListener('click', () => {
  element<HTMLTextAreaElement>('vault-terms').value = '';
  invalidate();
  element('vault-status').textContent = 'Review cleared.';
});

element<HTMLTextAreaElement>('vault-terms').addEventListener('input', () => {
  invalidate();
  element('vault-status').textContent = 'Terms changed. Review again before executing.';
});

element('check-vault-stage').addEventListener('click', async () => {
  if (!terms) return;
  const current = revision;
  const captured = terms;
  busy = true;
  render();
  element('vault-stage').textContent = 'Reading public chain state…';
  try {
    const result = await readVaultStage(createPublicReader(PUBLIC_MAINNET_RPC), captured, now());
    if (revision !== current) return;
    reading = result;
    element('vault-stage').textContent = publicJson({
      nextStage: result.stage,
      classDeclared: result.declared,
      vaultDeployed: result.deployed,
      predictedVault: hex(result.predictedVault),
      ownerNonce: hex(result.nonce),
      atBlock: hex(result.blockHash),
      note: result.stage === 'complete'
        ? 'This vault is already deployed. No further deployment stage is required.'
        : 'Stage reading is a snapshot. It can change before your wallet submits.',
    });
  } catch {
    if (revision === current) {
      reading = undefined;
      element('vault-stage').textContent
        = 'Chain state is unavailable. This is not proof that the class is undeclared. Try again.';
    }
  } finally {
    busy = false;
    render();
  }
});

element('scan-vault-wallets').addEventListener('click', () => {
  let injected: unknown;
  try {
    injected = Reflect.get(window, 'starknet_argentX');
  } catch {
    injected = undefined;
  }
  wallets = discoverProbeWallets(getWallets().get(), injected);
  const list = element<HTMLSelectElement>('vault-wallet');
  list.replaceChildren(...wallets.map((wallet, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${wallet.name} · ${wallet.version}`;
    return option;
  }));
  element('vault-execution-status').textContent = wallets.length === 0
    ? 'No compatible wallet detected.'
    : `${wallets.length} wallet(s) detected. Review the stage before requesting it.`;
  render();
});

element<HTMLInputElement>('approve-vault-stage').addEventListener('change', render);

element('request-vault-stage').addEventListener('click', async () => {
  if (!terms || !reading || reading.stage === 'complete') return;
  const current = revision;
  const captured = terms;
  const reviewed = reading;
  const stage = reviewed.stage as Exclude<VaultStageReading['stage'], 'complete'>;
  let phase: 'wallet-identity' | 'fresh-chain' | 'wallet-request' = 'wallet-identity';
  busy = true;
  render();
  element('vault-execution-status').textContent = `Requesting the ${stage} stage in Ready…`;
  try {
    const artifact = await loadArtifact();
    const selected = wallets[Number(element<HTMLSelectElement>('vault-wallet').value)];
    if (!selected) throw new Error('VOW_NO_WALLET');
    const wallet = {
      request: (input: { type: string; params?: unknown }) =>
        selected.probe.request(input as never),
    };
    await checkVaultWallet(wallet, captured.owner);
    phase = 'fresh-chain';
    const fresh = await readVaultStage(createPublicReader(PUBLIC_MAINNET_RPC), captured, now());
    if (fresh.stage !== stage || fresh.nonce !== reviewed.nonce) {
      throw new Error('VOW_DEPLOYMENT_STATE_CHANGED');
    }
    const request = vaultStageRequest(stage, captured, artifact, now());
    phase = 'wallet-request';
    const response = await wallet.request(request);
    if (revision !== current) return;
    element('vault-execution-status').textContent
      = 'Ready returned a response. A transaction hash is not confirmation. Check its public receipt.';
    element('vault-result').textContent = publicJson({ stage, response });
  } catch (error: unknown) {
    if (revision === current) {
      const walletCode = vaultWalletErrorCode(error);
      const rejected = error instanceof Error && /reject|denied|VOW_/i.test(error.message);
      element('vault-execution-status').textContent = walletCode !== null
        ? `Ready returned wallet error code ${walletCode} during ${phase}. No hash was returned.`
        : rejected
          ? `The ${phase} step was rejected or refused locally. Nothing was submitted.`
          : `The ${phase} step failed without a hash. Nothing was submitted; check the chain before retrying.`;
      element('vault-result').textContent = walletCode === null
        ? 'No transaction hash returned.'
        : publicJson({ stage, status: 'wallet-error', walletErrorCode: walletCode });
    }
  } finally {
    busy = false;
    render();
  }
});

invalidate();
