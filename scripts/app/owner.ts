import { PermissionSet } from '../../packages/vow-sdk/src/permission-set.ts';
import { createPermissionSetBackup, unlockPermissionSetBackup, parsePermissionSetBackup } from '../../packages/vow-sdk/src/permission-backup.ts';
import { isStarkPublicKey } from '../../packages/vow-sdk/src/operator-key.ts';
import { readVaultSnapshot } from '../../packages/vow-sdk/src/reservation-reader.ts';
import type { PublicReader } from '../../packages/vow-sdk/src/probe-reader.ts';
import { address, bounded, felt, parsePublicInteger, U64_MAX } from '../../packages/vow-sdk/src/integers.ts';
import type { VaultDeploymentManifest } from '../../packages/vow-sdk/src/vault-collection.ts';
import { parsePermissionDrafts } from './permission-drafts.ts';
import { publicDisclosure } from './disclosure.ts';
import { createMandateInvoke } from './vault-invoke.ts';
import { readVaultWriteReceipt } from './vault-receipt.ts';
import { WriteFlow } from './write-flow.ts';
import type { WriteWallet } from './write-flow.ts';
import type { ManifestState } from './manifest.ts';
import { element, json, ledger, renderWrite } from './page.ts';

export interface OwnerDependencies {
  readonly reader: PublicReader;
  readonly loadManifest: () => Promise<ManifestState>;
  readonly wallet: () => WriteWallet | undefined;
  readonly download: (filename: string, contents: string) => void;
  readonly now: () => bigint;
}

export function initializeOwner(deps: OwnerDependencies) {
  const ids = ['owner-address', 'mandate-token', 'operator-key', 'mandate-expiry', 'permission-drafts'] as const;
  let manifest: VaultDeploymentManifest | undefined;
  let mandateId: bigint | undefined;
  let previewed: { set: PermissionSet; owner: bigint; token: bigint; operatorKey: bigint; expiresAt: bigint } | undefined;
  let backup: string | undefined;
  let verifiedRoot: bigint | undefined;
  let flow = new WriteFlow(() => render());
  let busy = false;

  const render = () => {
    const bound = !!manifest && mandateId !== undefined;
    element('bind-mandate').disabled = busy || !manifest;
    for (const id of ids) element(id).disabled = busy || !bound;
    element('preview-set').disabled = busy || !bound;
    element('backup-password').disabled = element('backup-password-confirm').disabled = busy || !previewed;
    element('download-backup').disabled = busy || !previewed;
    element('verify-backup').disabled = busy || !backup;
    element('create-mandate').disabled = busy || !previewed || verifiedRoot !== previewed.set.root || !flow.dispatchable;
    element('recovered-hash').disabled = element('reconcile-mandate').disabled = busy || !flow.reconcilable;
    element('read-ledger').disabled = busy || !bound;
    renderWrite(flow.outcome);
  };
  const discard = (reason: string) => {
    previewed = undefined; backup = undefined; verifiedRoot = undefined;
    element('disclosure').textContent = 'No permission set previewed.';
    element('set-root').textContent = 'No committed root computed.';
    element('backup-status').textContent = 'No encrypted backup created.';
    element('verify-status').textContent = 'The committed root has not been verified against a downloaded backup.';
    element('preview-status').textContent = reason;
    render();
  };
  const run = async (action: () => Promise<void>) => {
    busy = true; render();
    try { await action(); } finally { busy = false; render(); }
  };

  for (const id of ids) element(id).addEventListener('input', () => discard('Terms changed. Preview the permission set again.'));
  element('backup-password').addEventListener('input', () => { backup = undefined; verifiedRoot = undefined; render(); });

  element('bind-mandate').addEventListener('click', () => void run(async () => {
    mandateId = undefined; discard('Bind a mandate id before previewing.');
    const deployment = manifest;
    if (!deployment) return;
    try {
      mandateId = await nextMandateId(deps.reader, deployment);
      element('bind-status').textContent = `Vault ${hex(deployment.vaultAddress)} · next unassigned mandate id ${mandateId}. This id is a prediction: another create_mandate landing first takes it, and a set committed to the wrong id can never be reserved against.`;
    } catch { element('bind-status').textContent = 'The next mandate id could not be read. Nothing was created.'; }
  }));

  element('preview-set').addEventListener('click', () => void run(async () => {
    discard('Building the preview…');
    const deployment = manifest;
    if (!deployment || mandateId === undefined) return;
    try {
      const owner = address(publicValue('owner-address'), 'OWNER');
      const token = address(publicValue('mandate-token'), 'TOKEN');
      const operatorKey = felt(publicValue('operator-key'), 'OPERATOR_KEY', 1n);
      if (!isStarkPublicKey(operatorKey)) throw new Error('VOW_INVALID_OPERATOR_KEY');
      const expiresAt = bounded(publicValue('mandate-expiry'), U64_MAX, 'MANDATE_EXPIRY', 1n);
      if (expiresAt <= deps.now()) throw new Error('VOW_MANDATE_CLOSED');
      const drafts = parsePermissionDrafts(element('permission-drafts').value, {
        chainId: deployment.chainId, vaultAddress: deployment.vaultAddress, mandateId, token, expiresAt });
      const set = PermissionSet.create(drafts);
      previewed = { set, owner, token, operatorKey, expiresAt };
      element('disclosure').textContent = json(publicDisclosure(set, { owner, operatorKey, token, expiresAt }));
      element('set-root').textContent = `Committed root ${hex(set.root)}`;
      element('preview-status').textContent = 'Nothing has been created. Download the encrypted backup, then verify the root it restores to.';
    } catch (error: unknown) { discard(`The permission set was rejected (${code(error)}). Nothing was created.`); }
  }));

  element('download-backup').addEventListener('click', () => void run(async () => {
    const current = previewed;
    if (!current) return;
    backup = undefined; verifiedRoot = undefined;
    const password = element('backup-password').value;
    if (password !== element('backup-password-confirm').value) {
      element('backup-status').textContent = 'The two passwords do not match. No backup was created.'; return;
    }
    try {
      const text = JSON.stringify(await createPermissionSetBackup(current.set, password), null, 2);
      backup = text;
      deps.download(`vow-permission-set-${hex(current.set.root).slice(0, 10)}.json`, text);
      element('backup-status').textContent = 'Encrypted backup downloaded. It holds every supplier key, cap and salt in this set. Without this file and its password the set can never be proved again.';
    } catch (error: unknown) { element('backup-status').textContent = `The backup was not created (${code(error)}).`; }
  }));

  element('verify-backup').addEventListener('click', () => void run(async () => {
    const current = previewed; const text = backup;
    verifiedRoot = undefined;
    if (!current || !text) return;
    try {
      const restored = await unlockPermissionSetBackup(parsePermissionSetBackup(text), element('backup-password').value);
      if (restored.root !== current.set.root) throw new Error('VOW_ROOT_MISMATCH');
      verifiedRoot = restored.root;
      element('verify-status').textContent = `The downloaded backup restores to the previewed root ${hex(restored.root)}. Creation is now allowed.`;
    } catch (error: unknown) {
      element('verify-status').textContent = `The downloaded backup did not restore to the previewed root (${code(error)}). Creation stays blocked.`;
    }
  }));

  element('create-mandate').addEventListener('click', () => void run(async () => {
    const current = previewed; const deployment = manifest; const wallet = deps.wallet();
    if (!current || !deployment || verifiedRoot !== current.set.root || !wallet || !flow.dispatchable) return;
    const request = createMandateInvoke({ vaultAddress: deployment.vaultAddress, owner: current.owner,
      root: current.set.root, operatorKey: current.operatorKey, token: current.token, expiresAt: current.expiresAt });
    element('write-request').textContent = json(request);
    await flow.submit({ wallet, request, timeoutMs: 90_000, preflight: async () => {
      if (deps.now() >= current.expiresAt) throw new Error('VOW_MANDATE_CLOSED');
      if (verifiedRoot !== current.set.root) throw new Error('VOW_ROOT_MISMATCH');
    } });
  }));

  element('reconcile-mandate').addEventListener('click', () => void run(async () => {
    const deployment = manifest;
    if (!deployment || !flow.reconcilable) return;
    const recovered = element('recovered-hash').value.trim();
    try { if (recovered) flow.attachTransactionHash(parsePublicInteger(recovered)); }
    catch { element('write-detail').textContent = 'That transaction hash is not usable for this attempt.'; return; }
    await flow.reconcile(async (transactionHash) => {
      const receipt = await readVaultWriteReceipt(deps.reader, deployment, transactionHash, 'MandateCreated');
      element('write-result').textContent = json(receipt);
      return receipt.state;
    });
  }));

  element('read-ledger').addEventListener('click', () => void run(async () => {
    const deployment = manifest;
    if (!deployment || mandateId === undefined) return;
    ledger(undefined);
    try {
      const snapshot = await readVaultSnapshot(deps.reader, { chainId: deployment.chainId,
        vaultAddress: deployment.vaultAddress, mandateId, permissionIds: [] });
      ledger(snapshot.mandate);
      element('ledger-status').textContent = `Read at block ${hex(snapshot.blockHash)}. Root ${hex(snapshot.mandate.root)}${previewed && snapshot.mandate.root === previewed.set.root ? ' matches the previewed set.' : '.'}`;
    } catch (error: unknown) {
      element('ledger-status').textContent = `No mandate state was read (${code(error)}). All five totals stay unread.`;
    }
  }));

  ledger(undefined); discard('No permission set previewed.');
  void run(async () => {
    const state = await deps.loadManifest();
    manifest = state.status === 'deployed' ? state.manifest : undefined;
    element('deployment-status').textContent = state.status === 'deployed'
      ? `Pinned VowVault ${hex(state.manifest.vaultAddress)} on mainnet.`
      : `${state.detail} Every write control on this page stays disabled.`;
  });
  return { render, get outcome() { return flow.outcome; },
    reset(): void { flow = new WriteFlow(() => render()); discard('No permission set previewed.'); } };
}

async function nextMandateId(reader: PublicReader, deployment: VaultDeploymentManifest): Promise<bigint> {
  for (let candidate = 1n; candidate <= 64n; candidate += 1n) {
    try {
      await readVaultSnapshot(reader, { chainId: deployment.chainId, vaultAddress: deployment.vaultAddress,
        mandateId: candidate, permissionIds: [] });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'VOW_MANDATE_NOT_FOUND') return candidate;
      throw error;
    }
  }
  throw new Error('VOW_MANDATE_SCAN_LIMIT');
}

function publicValue(id: string): bigint { return parsePublicInteger(element(id).value.trim()); }
function code(error: unknown): string {
  return error instanceof Error && /^VOW_[A-Z_]+$/.test(error.message) ? error.message : 'VOW_REJECTED';
}
function hex(value: bigint): string { return `0x${value.toString(16)}`; }
