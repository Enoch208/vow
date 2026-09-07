import { retainPreparedProof } from './prepared-proof.ts';
import type { PreparedCollection } from './prepared-proof.ts';
import { hashClaim, verifyClaimSignature } from './claims.ts';
import type { ClaimAuthorization, ClaimSignature } from './claims.ts';
import { buildClaimActions, decodePreparedClaim, POOL_CLASS_HASH } from './prepared-claim.ts';
import { assertProbeReady, validateProbeConfiguration } from './probe-snapshot.ts';
import type { ProbeConfiguration, ProbeSnapshot } from './probe-snapshot.ts';
import { assertVaultReservationReady, validateVaultCollectionConfiguration } from './vault-collection.ts';
import type { VaultCollectionConfiguration, VaultReservationSnapshot } from './vault-collection.ts';
import { CollectionError, walletRequest } from './collection-wallet.ts';
import type { CollectionWallet } from './collection-wallet.ts';

export interface CollectionReview {
  readonly claim: Readonly<ClaimAuthorization>;
  readonly digest: bigint;
  readonly blockHash: bigint;
  readonly recipient: bigint;
  readonly supplierKey: bigint;
}
export interface CollectionDependencies {
  readonly wallet: CollectionWallet;
  readSnapshot(): Promise<ProbeSnapshot | VaultReservationSnapshot>;
  now(): bigint;
  readonly timeoutMs?: number;
}
export type CollectionState = 'idle' | 'preparing' | 'awaiting-signature' | 'proving' | 'prepared' | 'invalidated' | 'failed' | 'released';

interface SessionConfiguration {
  readonly chainId: bigint;
  readonly vaultAddress: bigint;
  readonly poolAddress: bigint;
  readonly token: bigint;
  readonly supplierKey: bigint;
  readonly amount: bigint;
  readonly claimBefore: bigint;
  readonly recipient: bigint;
  readonly signatureDeadline: bigint;
  readonly feeToken: bigint;
  readonly feeCollector: bigint;
  readonly maximumFee: bigint;
  readonly mandateId: bigint;
  readonly reservationId: bigint;
}

export class CollectionSession {
  private readonly config: Readonly<SessionConfiguration>;
  private readonly sourceConfig: Readonly<ProbeConfiguration | VaultCollectionConfiguration>;
  private readonly vaultMode: boolean;
  private readonly dependencies: CollectionDependencies;
  private revision = 0;
  private busy = false;
  private current: CollectionState = 'idle';
  private candidate: CollectionReview | undefined;
  private verified: PreparedCollection | undefined;

  constructor(config: ProbeConfiguration | VaultCollectionConfiguration, dependencies: CollectionDependencies) {
    this.vaultMode = 'vaultClassHash' in config;
    if (this.vaultMode) validateVaultCollectionConfiguration(config as VaultCollectionConfiguration);
    else validateProbeConfiguration(config as ProbeConfiguration);
    const timeout = dependencies.timeoutMs ?? 180_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600_000) throw new CollectionError('VOW_INVALID_TIMEOUT');
    this.sourceConfig = Object.freeze({ ...config });
    this.config = Object.freeze({ ...config, mandateId: this.vaultMode ? (config as VaultCollectionConfiguration).mandateId : 1n,
      reservationId: this.vaultMode ? (config as VaultCollectionConfiguration).reservationId : 1n,
      maximumFee: this.vaultMode ? (config as VaultCollectionConfiguration).maximumProtocolFee : (config as ProbeConfiguration).maximumFee });
    this.dependencies = dependencies;
  }
  get state(): CollectionState { return this.current; }
  get review(): CollectionReview | undefined { return this.candidate; }
  invalidate(): void {
    this.revision++; this.current = 'invalidated'; this.candidate = undefined; this.verified = undefined;
  }
  async prepare(): Promise<CollectionReview> {
    return this.operation('preparing', async (revision) => {
      const snapshot = await this.preflight(revision);
      const claim: ClaimAuthorization = {
        chainId: this.config.chainId, vaultAddress: this.config.vaultAddress, mandateId: this.config.mandateId, reservationId: this.config.reservationId,
        token: this.config.token, amount: this.config.amount, outputNoteId: 1n, signatureDeadline: this.config.signatureDeadline,
      };
      const prepared = await walletRequest(this.dependencies.wallet, { type: 'wallet_strk20PrepareInvoke', params: {
        actions: buildClaimActions(claim, this.config.recipient), simulate: true, api_version: '0.10.3',
      } });
      this.active(revision);
      const resolved = decodePreparedClaim(prepared, this.expectation(claim));
      await this.preflight(revision);
      const review = Object.freeze({ claim: Object.freeze(resolved), digest: hashClaim(resolved), blockHash: snapshot.blockHash, recipient: this.config.recipient, supplierKey: this.config.supplierKey });
      this.candidate = review; this.current = 'awaiting-signature';
      return review;
    });
  }
  async prove(signature: ClaimSignature): Promise<CollectionReview> {
    if (this.current !== 'awaiting-signature' || !this.candidate) throw new CollectionError('VOW_NO_PREPARATION');
    const review = this.candidate;
    const supplied = Object.freeze({ r: signature.r, s: signature.s });
    return this.operation('proving', async (revision) => {
      if (!verifyClaimSignature(review.claim, supplied, this.config.supplierKey)) throw new CollectionError('VOW_BAD_SUPPLIER_SIGNATURE');
      await this.preflight(revision);
      const prepared = await walletRequest(this.dependencies.wallet, { type: 'wallet_strk20PrepareInvoke', params: {
        actions: buildClaimActions(review.claim, this.config.recipient, supplied), simulate: false, api_version: '0.10.3',
      } });
      this.active(revision);
      const retained = retainPreparedProof(prepared);
      decodePreparedClaim(retained, this.expectation(review.claim), supplied);
      await this.preflight(revision);
      this.verified = retained; this.current = 'prepared';
      return review;
    });
  }
  hasPreparedCall(): boolean { return this.current === 'prepared' && this.verified !== undefined; }
  async releasePreparedCall(): Promise<PreparedCollection> {
    if (!this.hasPreparedCall() || !this.verified || this.busy) throw new CollectionError('VOW_NO_PREPARED_CALL');
    const prepared = this.verified;
    return this.operation('prepared', async (revision) => {
      await this.preflight(revision);
      this.current = 'released';
      return structuredClone(prepared);
    });
  }
  private expectation(claim: ClaimAuthorization) {
    return { claim, poolAddress: this.config.poolAddress, observedPoolClassHash: POOL_CLASS_HASH,
      feeToken: this.config.feeToken, feeCollector: this.config.feeCollector, maximumFee: this.config.maximumFee };
  }
  private async preflight(revision: number): Promise<ProbeSnapshot | VaultReservationSnapshot> {
    this.active(revision);
    const versions = await walletRequest(this.dependencies.wallet, { type: 'wallet_supportedWalletApi' });
    this.active(revision);
    if (!Array.isArray(versions) || !versions.includes('0.10.3')) throw new CollectionError('VOW_API_UNSUPPORTED');
    const chain = await walletRequest(this.dependencies.wallet, { type: 'wallet_requestChainId' });
    this.active(revision);
    if (typeof chain !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(chain) || BigInt(chain) !== this.config.chainId) throw new CollectionError('VOW_WRONG_WALLET_CHAIN');
    const snapshot = await this.dependencies.readSnapshot();
    this.active(revision);
    if (this.vaultMode) assertVaultReservationReady(this.sourceConfig as VaultCollectionConfiguration, snapshot as VaultReservationSnapshot, this.dependencies.now());
    else assertProbeReady(this.sourceConfig as ProbeConfiguration, snapshot as ProbeSnapshot, this.dependencies.now());
    return snapshot;
  }
  private active(revision: number): void {
    if (this.revision !== revision) throw new CollectionError('VOW_SESSION_INVALIDATED');
  }
  private async operation<T>(state: CollectionState, action: (revision: number) => Promise<T>): Promise<T> {
    if (this.busy) throw new CollectionError('VOW_REQUEST_IN_PROGRESS');
    this.busy = true; this.current = state; this.verified = undefined;
    const revision = ++this.revision;
    if (state === 'preparing') this.candidate = undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.revision++; this.current = 'failed'; this.candidate = undefined; this.verified = undefined;
        reject(new CollectionError('VOW_PREPARATION_TIMEOUT'));
      }, this.dependencies.timeoutMs ?? 180_000);
    });
    const pending = action(revision).finally(() => { this.busy = false; });
    try { return await Promise.race([pending, timeout]); }
    catch (error: unknown) {
      if (revision === this.revision) { this.current = 'failed'; this.candidate = undefined; }
      if (error instanceof CollectionError) throw error;
      if (error instanceof Error && /^VOW_[A-Z_]+$/.test(error.message)) throw new CollectionError(error.message);
      throw new CollectionError('VOW_PREPARATION_FAILED');
    } finally { clearTimeout(timer); }
  }
}
