import { hash, shortString } from 'starknet';
import { PERMISSION_SLOTS } from '../../packages/vow-sdk/src/permissions.ts';
import type { PermissionLeaf } from '../../packages/vow-sdk/src/permissions.ts';
import { PermissionSet } from '../../packages/vow-sdk/src/permission-set.ts';
import { unlockPermissionSetBackup, parsePermissionSetBackup } from '../../packages/vow-sdk/src/permission-backup.ts';
import { validateReserveAgainstPermission, verifyReserveSignature } from '../../packages/vow-sdk/src/reserve.ts';
import type { ReserveAuthorization } from '../../packages/vow-sdk/src/reserve.ts';
import { readVaultSnapshot, mandateAvailable } from '../../packages/vow-sdk/src/reservation-reader.ts';
import type { VaultMandate } from '../../packages/vow-sdk/src/reservation-reader.ts';
import type { PublicReader } from '../../packages/vow-sdk/src/probe-reader.ts';
import { bounded, felt, parsePublicInteger, U128_MAX } from '../../packages/vow-sdk/src/integers.ts';
import type { VaultDeploymentManifest } from '../../packages/vow-sdk/src/vault-collection.ts';
import { reserveInvoke } from './vault-invoke.ts';
import { readVaultWriteReceipt } from './vault-receipt.ts';
import { WriteFlow } from './write-flow.ts';
import type { WriteWallet } from './write-flow.ts';
import type { ManifestState } from './manifest.ts';
import { element, json, ledger, renderWrite } from './page.ts';

const REQUEST_DOMAIN = BigInt(shortString.encodeShortString('VOW_RESERVE_REQUEST'));
const REQUEST_WINDOW = 300n;

export interface OperatorDependencies {
  readonly reader: PublicReader;
  readonly loadManifest: () => Promise<ManifestState>;
  readonly wallet: () => WriteWallet | undefined;
  readonly now: () => bigint;
}

interface Delegation {
  readonly set: PermissionSet;
  readonly mandate: VaultMandate;
  readonly available: bigint;
  readonly consumed: readonly bigint[];
}

export function initializeOperator(deps: OperatorDependencies) {
  let manifest: VaultDeploymentManifest | undefined;
  let delegation: Delegation | undefined;
  let reviewed: { authorization: ReserveAuthorization; leaf: PermissionLeaf; proof: readonly bigint[] } | undefined;
  let signature: { r: bigint; s: bigint } | undefined;
  let flow = new WriteFlow(() => render());
  let busy = false;

  const chosen = (): bigint | undefined => {
    for (let slot = 0; slot < PERMISSION_SLOTS; slot += 1) if (element(`permission-${slot}`).checked) return BigInt(slot);
    return undefined;
  };
  const selectable = (slot: bigint): boolean =>
    !!delegation && delegation.set.slots[Number(slot)]!.kind === 'permission' && !delegation.consumed.includes(slot);
  const render = () => {
    const selected = chosen();
    element('permission-file').disabled = element('permission-password').disabled = element('unlock-permissions').disabled = busy;
    for (let slot = 0; slot < PERMISSION_SLOTS; slot += 1) {
      element(`permission-${slot}-slot`).hidden = !delegation || delegation.set.slots[slot]!.kind !== 'permission';
      element(`permission-${slot}`).disabled = busy || !!reviewed || !selectable(BigInt(slot));
    }
    element('requested-amount').disabled = busy || !!reviewed || selected === undefined;
    element('review-reserve').disabled = busy || !!reviewed || selected === undefined || !element('requested-amount').value.trim();
    element('signature-r').disabled = element('signature-s').disabled = element('check-signature').disabled = busy || !reviewed;
    element('submit-reserve').disabled = busy || !reviewed || !signature || !manifest || !flow.dispatchable;
    element('recovered-hash').disabled = element('reconcile-reserve').disabled = busy || !flow.reconcilable;
    renderWrite(flow.outcome);
  };
  const clearReview = (reason: string) => {
    reviewed = undefined; signature = undefined;
    element('reserve-review').textContent = 'No reservation reviewed.';
    element('signature-status').textContent = 'No operator signature checked.';
    element('signature-r').value = element('signature-s').value = '';
    element('reserve-status').textContent = reason;
    render();
  };
  const run = async (action: () => Promise<void>) => {
    busy = true; render();
    try { await action(); } finally { busy = false; render(); }
  };

  for (let slot = 0; slot < PERMISSION_SLOTS; slot += 1) {
    element(`permission-${slot}`).addEventListener('change', () => clearReview('Selection changed. Review the reservation again.'));
  }
  element('requested-amount').addEventListener('input', () => clearReview('Amount changed. Review the reservation again.'));
  for (const id of ['permission-file', 'permission-password']) {
    element(id).addEventListener('input', () => { delegation = undefined; clearReview('Reload the permission set before reviewing.'); });
  }

  element('unlock-permissions').addEventListener('click', () => void run(async () => {
    delegation = undefined; clearReview('No reservation reviewed.'); ledger(undefined);
    for (let slot = 0; slot < PERMISSION_SLOTS; slot += 1) {
      element(`permission-${slot}`).checked = false;
      element(`permission-${slot}-terms`).textContent = '';
    }
    const deployment = manifest;
    if (!deployment) { element('unlock-status').textContent = 'No deployed vault. The permission set cannot be checked against a mandate.'; return; }
    try {
      const set = await unlockPermissionSetBackup(parsePermissionSetBackup(element('permission-file').value), element('permission-password').value);
      if (set.context.chainId !== deployment.chainId || set.context.vaultAddress !== deployment.vaultAddress) throw new Error('VOW_WRONG_VAULT');
      const permissionIds = set.slots.filter((slot) => slot.kind === 'permission').map((slot) => slot.permissionId);
      const snapshot = await readVaultSnapshot(deps.reader, { chainId: deployment.chainId,
        vaultAddress: deployment.vaultAddress, mandateId: set.context.mandateId, permissionIds });
      const mandate = snapshot.mandate;
      if (mandate.root !== set.root) throw new Error('VOW_ROOT_MISMATCH');
      if (mandate.token !== set.context.token) throw new Error('VOW_TOKEN_MISMATCH');
      if (mandate.revoked) throw new Error('VOW_MANDATE_CLOSED');
      const available = mandateAvailable(mandate);
      delegation = { set, mandate, available, consumed: snapshot.reservations.map((entry) => entry.permissionId) };
      for (const slot of permissionIds) {
        element(`permission-${Number(slot)}-terms`).textContent = json({ ...set.permission(slot),
          leafHash: set.slot(slot).leafHash, onChain: delegation.consumed.includes(slot) ? 'already reserved' : 'unused' });
      }
      ledger(mandate);
      element('ledger-status').textContent = `Read at block ${hex(snapshot.blockHash)}.`;
      element('mandate-status').textContent = `Mandate ${mandate.mandateId} · root ${hex(mandate.root)} matches this set · operator key ${hex(mandate.operatorKey)} · expires ${mandate.expiresAt}.`;
      element('unlock-status').textContent = `${permissionIds.length} permission objects loaded. Every field below comes from the committed set; this screen has no field for a different supplier, token or deadline.`;
    } catch (error: unknown) {
      element('unlock-status').textContent = `The permission set was not accepted (${code(error)}). No reservation is possible.`;
    }
  }));

  element('review-reserve').addEventListener('click', () => void run(async () => {
    const current = delegation; const selected = chosen();
    clearReview('Reviewing…');
    if (!current || selected === undefined || !selectable(selected)) { element('reserve-status').textContent = 'Select an unused permission object first.'; return; }
    try {
      const leaf = current.set.permission(selected);
      const now = deps.now();
      const requestedAmount = bounded(parsePublicInteger(element('requested-amount').value.trim()), U128_MAX, 'REQUESTED_AMOUNT', 1n);
      if (requestedAmount > current.available) throw new Error('VOW_INSUFFICIENT_AVAILABLE');
      const requestDeadline = leaf.approveBefore < now + REQUEST_WINDOW ? leaf.approveBefore : now + REQUEST_WINDOW;
      const slot = current.set.slot(selected);
      const authorization: ReserveAuthorization = { chainId: current.set.context.chainId, vaultAddress: current.set.context.vaultAddress,
        mandateId: current.set.context.mandateId, immutableRoot: current.set.root, permissionId: selected, leafHash: slot.leafHash,
        requestedAmount, requestId: requestId(current.set.context.mandateId, selected, requestedAmount, requestDeadline), requestDeadline };
      validateReserveAgainstPermission({ authorization, maximumAmount: leaf.maximumAmount,
        validAfter: leaf.validAfter, approveBefore: leaf.approveBefore, now });
      if (now >= leaf.claimBefore) throw new Error('VOW_CLAIM_EXPIRED');
      reviewed = { authorization, leaf, proof: slot.proof };
      element('reserve-review').textContent = json({ ...authorization, supplierClaimPublicKey: leaf.supplierClaimPublicKey,
        token: leaf.token, permissionMaximumAmount: leaf.maximumAmount, claimBefore: leaf.claimBefore,
        requestDeadlineDerived: 'min(approveBefore, now + 300s); this screen cannot extend it',
        availableBudgetAtReview: current.available.toString() });
      element('reserve-status').textContent = 'Sign this exact authorization with the operator key in a separate tool, then enter only the public signature.';
    } catch (error: unknown) { clearReview(`The reservation was rejected (${code(error)}). Nothing was sent.`); }
  }));

  element('check-signature').addEventListener('click', () => void run(async () => {
    const current = reviewed; const bundle = delegation;
    signature = undefined;
    if (!current || !bundle) return;
    try {
      const candidate = { r: parsePublicInteger(element('signature-r').value.trim()), s: parsePublicInteger(element('signature-s').value.trim()) };
      if (!verifyReserveSignature(current.authorization, candidate, bundle.mandate.operatorKey)) throw new Error('VOW_BAD_OPERATOR_SIG');
      signature = candidate;
      element('signature-status').textContent = 'The signature matches this exact authorization and the operator key recorded on chain.';
    } catch (error: unknown) { element('signature-status').textContent = `The signature was rejected (${code(error)}).`; }
  }));

  element('submit-reserve').addEventListener('click', () => void run(async () => {
    const current = reviewed; const bundle = delegation; const wallet = deps.wallet(); const deployment = manifest;
    if (!current || !bundle || !wallet || !deployment || !signature || !flow.dispatchable) return;
    const request = reserveInvoke(current.authorization, current.leaf, current.proof, signature);
    element('write-request').textContent = json(request);
    await flow.submit({ wallet, request, timeoutMs: 90_000, preflight: async () => {
      const now = deps.now();
      if (now >= current.authorization.requestDeadline) throw new Error('VOW_APPROVAL_EXPIRED');
      const snapshot = await readVaultSnapshot(deps.reader, { chainId: deployment.chainId, vaultAddress: deployment.vaultAddress,
        mandateId: current.authorization.mandateId, permissionIds: [current.authorization.permissionId] });
      if (snapshot.mandate.root !== current.authorization.immutableRoot || snapshot.mandate.revoked) throw new Error('VOW_MANDATE_CHANGED');
      if (snapshot.reservations.length !== 0) throw new Error('VOW_PERMISSION_USED');
      if (mandateAvailable(snapshot.mandate) < current.authorization.requestedAmount) throw new Error('VOW_INSUFFICIENT_AVAILABLE');
      ledger(snapshot.mandate);
    } });
  }));

  element('reconcile-reserve').addEventListener('click', () => void run(async () => {
    const deployment = manifest;
    if (!deployment || !flow.reconcilable) return;
    const recovered = element('recovered-hash').value.trim();
    try { if (recovered) flow.attachTransactionHash(parsePublicInteger(recovered)); }
    catch { element('write-detail').textContent = 'That transaction hash is not usable for this attempt.'; return; }
    await flow.reconcile(async (transactionHash) => {
      const receipt = await readVaultWriteReceipt(deps.reader, deployment, transactionHash, 'PurchaseReserved');
      element('write-result').textContent = json(receipt);
      return receipt.state;
    });
  }));

  ledger(undefined); clearReview('No reservation reviewed.');
  void run(async () => {
    const state = await deps.loadManifest();
    manifest = state.status === 'deployed' ? state.manifest : undefined;
    element('deployment-status').textContent = state.status === 'deployed'
      ? `Pinned VowVault ${hex(state.manifest.vaultAddress)} on mainnet.`
      : `${state.detail} Every write control on this page stays disabled.`;
  });
  return { render, get outcome() { return flow.outcome; },
    reset(): void { flow = new WriteFlow(() => render()); clearReview('No reservation reviewed.'); } };
}

function requestId(mandateId: bigint, permissionId: bigint, amount: bigint, deadline: bigint): bigint {
  return felt(BigInt(hash.computePoseidonHashOnElements([REQUEST_DOMAIN, mandateId, permissionId, amount, deadline])), 'REQUEST_ID', 1n);
}
function code(error: unknown): string {
  return error instanceof Error && /^VOW_[A-Z_]+$/.test(error.message) ? error.message : 'VOW_REJECTED';
}
function hex(value: bigint): string { return `0x${value.toString(16)}`; }
