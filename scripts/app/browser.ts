import { getWallets } from '@wallet-standard/app';
import { CollectionSession } from '../../packages/vow-sdk/src/collection-session.ts';
import { runCollectionDispatch } from '../../packages/vow-sdk/src/collection-dispatch.ts';
import { reviewCollectionSubmission } from '../../packages/vow-sdk/src/collection-submission.ts';
import { CollectionError, walletRequest } from '../../packages/vow-sdk/src/collection-wallet.ts';
import { formatAmount } from '../../packages/vow-sdk/src/integers.ts';
import { createPublicReader } from '../../packages/vow-sdk/src/probe-reader.ts';
import { SubmissionJournal } from '../../packages/vow-sdk/src/submission-journal.ts';
import { discoverProbeWallets } from '../../packages/vow-sdk/src/wallet-discovery.ts';
import type { DiscoveredWallet } from '../../packages/vow-sdk/src/wallet-discovery.ts';
import { assertVaultReservationReady, readVaultReservation } from '../../packages/vow-sdk/src/vault-collection.ts';
import type { VaultCollectionConfiguration, VaultReservationSnapshot } from '../../packages/vow-sdk/src/vault-collection.ts';
import { PUBLIC_MAINNET_RPC } from '../../packages/vow-sdk/src/rpc-endpoint.ts';
import { parseAppDeployment } from './collection-manifest.ts';
import type { AppDeployment } from './collection-manifest.ts';
import { parseAppRoute } from './route.ts';
import { hex, json, publicInteger } from './public-values.ts';
import { initializeVerifier } from './verifier-page.ts';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const reader = createPublicReader(PUBLIC_MAINNET_RPC);
const route = parseAppRoute(window.location.pathname);
const rawManifest: unknown = await fetch('/app/deployment.json', { cache: 'no-store', credentials: 'omit' }).then((response) => {
  if (!response.ok) throw new Error('VOW_DEPLOYMENT_MANIFEST_UNAVAILABLE');
  return response.json() as Promise<unknown>;
});
const manifest = parseAppDeployment(rawManifest);
element('deployment-status').textContent = manifest.status === 'deployed'
  ? `Pinned VowVault: ${hex(manifest.deployment.vaultAddress)}`
  : `Expected VowVault ${hex(manifest.deployment.vaultAddress)} · not deployed`;

if (route.kind === 'verify') initializeVerifier(manifest, reader, route.value);
else await initializeClaim(manifest, route.value);

async function initializeClaim(app: AppDeployment, reservationId: bigint): Promise<void> {
  element('claim-page').hidden = false;
  const reservationStatus = element<HTMLElement>('reservation-status');
  const details = element<HTMLDListElement>('reservation-details');
  const walletSelect = element<HTMLSelectElement>('wallet');
  const prepareButton = element<HTMLButtonElement>('wallet-check');
  const walletStatus = element<HTMLElement>('wallet-status');
  const claimReview = element<HTMLPreElement>('claim-review');
  const signatureR = element<HTMLInputElement>('signature-r');
  const signatureS = element<HTMLInputElement>('signature-s');
  const bindButton = element<HTMLButtonElement>('bind-signature');
  const signatureStatus = element<HTMLElement>('signature-status');
  const submissionReview = element<HTMLPreElement>('submission-review');
  const approve = element<HTMLInputElement>('approve');
  const submit = element<HTMLButtonElement>('submit');
  const submissionStatus = element<HTMLElement>('submission-status');
  const verifyLink = element<HTMLAnchorElement>('verify-link');
  if (app.status !== 'deployed') {
    reservationStatus.textContent = 'No VowVault deployment is pinned. The expected address is not presented as live, and no signature will be requested.';
    details.replaceChildren(term('Reservation', hex(reservationId)), term('Deployment', 'Not deployed'));
    return;
  }
  let snapshot: VaultReservationSnapshot;
  try {
    snapshot = await readVaultReservation(reader, app.deployment, reservationId);
    const token = app.tokens.find((candidate) => candidate.address === snapshot.token);
    if (!token) throw new Error('VOW_TOKEN_NOT_PINNED');
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (snapshot.state !== 1n || now >= snapshot.claimBefore) throw new Error('VOW_RESERVATION_NOT_OPEN');
    reservationStatus.textContent = 'Open reservation read from the pinned VowVault at one recent block. Wallet actions are now available.';
    details.replaceChildren(term('Reservation', hex(snapshot.reservationId)), term('Mandate', hex(snapshot.mandateId)),
      term('Amount', `${formatAmount(snapshot.amount, token.decimals)} ${token.symbol}`), term('Token', `${token.symbol} · ${hex(token.address)}`),
      term('Claim before', new Date(Number(snapshot.claimBefore) * 1000).toISOString()), term('Block', hex(snapshot.blockHash)));
  } catch (error: unknown) {
    reservationStatus.textContent = publicFailure(error, 'The reservation could not be verified against the pinned VowVault. No signature will be requested.');
    return;
  }
  const registry = getWallets();
  let wallets: DiscoveredWallet[] = [];
  let session: CollectionSession | undefined;
  let config: VaultCollectionConfiguration | undefined;
  let reviewed: Awaited<ReturnType<typeof reviewCollectionSubmission>> | undefined;
  let signature: { readonly r: bigint; readonly s: bigint } | undefined;
  let busy = false;
  const scan = () => {
    let injected: unknown;
    try { injected = Reflect.get(window, 'starknet_argentX'); } catch { injected = undefined; }
    wallets = discoverProbeWallets(registry.get(), injected);
    walletSelect.replaceChildren(...wallets.map((wallet, index) => {
      const option = document.createElement('option'); option.value = String(index); option.textContent = `${wallet.name} · ${wallet.version}`; return option;
    }));
    walletSelect.disabled = busy || wallets.length === 0;
    prepareButton.disabled = busy || wallets.length === 0;
    walletStatus.textContent = wallets.length ? 'Wallet found. The next action checks advertised STRK20 0.10.3 support before preparing a note.' : 'No compatible Starknet wallet discovered.';
  };
  const discard = () => {
    session?.invalidate(); reviewed?.discard(); session = undefined; reviewed = undefined; config = undefined; signature = undefined;
    signatureR.value = signatureS.value = ''; signatureR.disabled = signatureS.disabled = bindButton.disabled = approve.disabled = submit.disabled = true;
    approve.checked = false; claimReview.textContent = 'Preparation discarded. No supplier signature requested.'; submissionReview.textContent = 'No exact submission prepared.';
  };
  prepareButton.addEventListener('click', () => {
    const wallet = wallets[Number(walletSelect.value)];
    if (!wallet || busy) return;
    void (async () => {
      busy = true; prepareButton.disabled = walletSelect.disabled = true; discard();
      try {
        walletStatus.textContent = 'Checking advertised STRK20 Wallet API support. This does not request a signature.';
        const versions = await walletRequest(wallet.probe, { type: 'wallet_supportedWalletApi' });
        if (!Array.isArray(versions) || !versions.includes('0.10.3')) throw new Error('VOW_API_UNSUPPORTED');
        const chain = await walletRequest(wallet.probe, { type: 'wallet_requestChainId' });
        if (publicInteger(chain) !== app.deployment.chainId) throw new Error('VOW_WRONG_WALLET_CHAIN');
        const accounts = await walletRequest(wallet.probe, { type: 'wallet_requestAccounts', params: { silent_mode: true, api_version: '0.10.3' } });
        if (!Array.isArray(accounts) || accounts.length !== 1) throw new Error('VOW_WRONG_WALLET_ACCOUNT');
        const recipient = publicInteger(accounts[0]);
        const now = BigInt(Math.floor(Date.now() / 1000));
        const signatureDeadline = now + 600n < snapshot.claimBefore ? now + 600n : snapshot.claimBefore;
        const nextConfig: VaultCollectionConfiguration = Object.freeze({ ...app.deployment, ...snapshot, recipient, signatureDeadline });
        config = nextConfig;
        session = new CollectionSession(nextConfig, { wallet: wallet.probe, readSnapshot: () => readVaultReservation(reader, app.deployment, reservationId), now: () => BigInt(Math.floor(Date.now() / 1000)) });
        walletStatus.textContent = 'STRK20 0.10.3 advertised. Rechecking the reservation, then asking the wallet to prepare one destination note.';
        const candidate = await session.prepare();
        claimReview.textContent = json({ claim: candidate.claim, digest: candidate.digest, recipient: candidate.recipient, chainBlock: candidate.blockHash });
        signatureR.disabled = signatureS.disabled = bindButton.disabled = false;
        walletStatus.textContent = 'Note prepared and bound to the chain-read reservation. Review it before producing the supplier signature.';
        signatureStatus.textContent = 'Enter only the public r and s values from the separate supplier-key tool.';
      } catch (error: unknown) { discard(); walletStatus.textContent = publicFailure(error, 'Wallet support or exact note preparation failed. No transaction was sent.'); }
      finally { busy = false; walletSelect.disabled = wallets.length === 0; prepareButton.disabled = wallets.length === 0; }
    })();
  });
  bindButton.addEventListener('click', () => {
    const current = session; const terms = config; const wallet = wallets[Number(walletSelect.value)];
    if (!current || !terms || !wallet || busy) return;
    void (async () => {
      busy = true; bindButton.disabled = true;
      try {
        signature = Object.freeze({ r: publicInteger(signatureR.value), s: publicInteger(signatureS.value) });
        signatureR.value = signatureS.value = '';
        signatureStatus.textContent = 'Verifying the supplier signature against the exact note, then preparing proof material. Nothing is submitted.';
        await current.prove(signature);
        const payload = await current.releasePreparedCall();
        reviewed = await reviewCollectionSubmission(payload, terms, current.review!.claim.outputNoteId, signature, terms.maximumNetworkFee, BigInt(Math.floor(Date.now() / 1000)));
        submissionReview.textContent = json(reviewed.review);
        approve.disabled = false;
        signatureR.disabled = signatureS.disabled = true;
        signatureStatus.textContent = 'Supplier signature and prepared proof preserve the exact note. Proof validity remains unverified until chain confirmation.';
      } catch (error: unknown) { discard(); signatureStatus.textContent = publicFailure(error, 'Signature binding or proof preparation failed. No transaction was sent.'); }
      finally { busy = false; }
    })();
  });
  approve.addEventListener('change', () => { submit.disabled = !approve.checked || !reviewed; });
  submit.addEventListener('click', () => {
    const candidate = reviewed; const terms = config; const wallet = wallets[Number(walletSelect.value)];
    if (!candidate || !terms || !wallet || !approve.checked || busy) return;
    submit.disabled = approve.disabled = true; busy = true;
    submissionStatus.textContent = 'Rechecking the reservation and wallet identity. If submitted, the returned hash is not confirmation.';
    void (async () => {
      try {
        const journal = new SubmissionJournal({ chainId: terms.chainId, vaultAddress: terms.vaultAddress, reservationId: terms.reservationId }, window.localStorage, navigator.locks, 'vault');
        const result = await runCollectionDispatch({ reviewed: candidate, approvedReviewDigest: candidate.review.reviewDigest,
          expectedAccount: terms.recipient, wallet: { request: (request) => wallet.probe.request(request), subscribeInvalidation: wallet.subscribeInvalidation },
          journal, now: () => BigInt(Math.floor(Date.now() / 1000)), timeoutMs: 180_000,
          preflight: async () => assertVaultReservationReady(terms, await readVaultReservation(reader, app.deployment, reservationId), BigInt(Math.floor(Date.now() / 1000))) });
        if (result.transactionHash) {
          verifyLink.href = `/verify/${hex(result.transactionHash)}`; verifyLink.hidden = false;
          submissionStatus.textContent = 'Transaction submitted. Confirmation is still pending; verify the public receipt before treating the collection as complete.';
        } else submissionStatus.textContent = 'Submission outcome is unknown. Do not retry; reconcile the saved attempt and wallet activity first.';
      } catch { submissionStatus.textContent = 'Submission stopped or remains unresolved. Do not retry until the saved attempt and wallet activity are reconciled.'; }
      finally { busy = false; }
    })();
  });
  walletSelect.addEventListener('change', discard);
  registry.on('register', scan); registry.on('unregister', scan);
  window.addEventListener('pagehide', () => { session?.invalidate(); reviewed?.discard(); });
  scan();
}

function term(name: string, value: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const title = document.createElement('dt'); title.textContent = name;
  const detail = document.createElement('dd'); detail.textContent = value;
  fragment.append(title, detail); return fragment;
}

function publicFailure(error: unknown, fallback: string): string {
  if (error instanceof CollectionError && error.walletReason) {
    const reasons = {
      INVALID_REQUEST_PAYLOAD: 'Ready rejected the STRK20 preparation shape as invalid. No transaction was sent.',
      NOT_REGISTERED: 'This Ready account is not registered for private tokens. Complete Ready private-token setup, then reload this reservation.',
      INSUFFICIENT_PRIVATE_BALANCE: 'Ready reports insufficient private balance for this STRK20 preparation and its fees. No transaction was sent.',
      PRIVACY_LEAK: 'Ready refused the preparation because it would violate its privacy checks. No transaction was sent.',
      USER_REFUSED_OP: 'The wallet request was refused. No transaction was sent.',
      UNKNOWN_ERROR: 'Ready could not prepare this STRK20 action. No transaction was sent.',
    } as const;
    return reasons[error.walletReason];
  }
  if (error instanceof CollectionError && error.walletCode !== undefined) return `Wallet request stopped with public code ${error.walletCode}. No transaction was sent.`;
  if (error instanceof Error) {
    const messages: Record<string, string> = {
      VOW_API_UNSUPPORTED: 'This wallet does not advertise STRK20 Wallet API 0.10.3. No signature or transaction was requested.',
      VOW_RESERVATION_NOT_OPEN: 'The reservation is not open or its claim window ended. No signature will be requested.',
      VOW_CLASS_CHANGED: 'The chain classes do not match the pinned deployment. No signature will be requested.',
      VOW_WRONG_WALLET_CHAIN: 'The wallet is not on the pinned Starknet network. No transaction was sent.',
      VOW_BAD_SUPPLIER_SIGNATURE: 'The signature does not authorize this exact note and reservation. Nothing was submitted.',
      VOW_NOTE_CHANGED: 'The wallet changed the signed note. The preparation was discarded.',
    };
    if (messages[error.message]) return messages[error.message]!;
    if (/^VOW_[A-Z_]+$/.test(error.message)) {
      return `Preparation stopped at ${error.message}. No transaction was sent.`;
    }
  }
  return fallback;
}
