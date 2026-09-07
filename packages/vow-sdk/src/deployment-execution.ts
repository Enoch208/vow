import { hash } from 'starknet';
import { bounded, formatAmount, U128_MAX } from './integers.ts';
import { buildProbeDeploymentPlan as buildPlan } from './deployment-plan.ts';
import type { ProbeDeploymentTerms } from './deployment-plan.ts';
import type { PublicReader } from './probe-reader.ts';
import type { RecoveryStorage } from './submission-journal.ts';
import { receiptFelt as scalar, receiptFelts, receiptRecord, equalFelts } from './receipt-values.ts';
import { checkDeploymentWallet, deploymentRequest, executeCalldata, hex, readDeploymentStage, validateDeploymentArtifact } from './deployment-execution-state.ts';
import type { DeploymentArtifact, DeploymentStage, DeploymentWallet } from './deployment-execution-state.ts';

export type DeploymentFeeCeilings = Readonly<Record<DeploymentStage, bigint>>;
type Attempt = { actualNetworkFeeSTRK: string | null; maximumNetworkFeeSTRK: string; stage: DeploymentStage; nonce: string; hash: string | null; status: 'unknown' | 'confirmed' | 'reverted'; problem: boolean };
interface Journal { version: 1; digest: string; attempts: Attempt[] }
export class DeploymentExecution {
  readonly #terms: ProbeDeploymentTerms;
  readonly #artifact: DeploymentArtifact;
  readonly #reader: PublicReader;
  readonly #storage: RecoveryStorage;
  readonly #locks: Pick<LockManager, 'request'>;
  readonly #now: () => bigint;
  readonly #key: string;
  readonly #digest: string;
  readonly #ceilings: DeploymentFeeCeilings;
  #review: Awaited<ReturnType<typeof readDeploymentStage>> | null = null;
  #busy = false;
  #revision = 0;
  #observedHash: string | null = null;
  constructor(terms: ProbeDeploymentTerms, artifact: DeploymentArtifact, compiledClassHash: bigint, reader: PublicReader,
    storage: RecoveryStorage, locks: Pick<LockManager, 'request'>, ceilings: DeploymentFeeCeilings, now: () => bigint = () => BigInt(Math.floor(Date.now() / 1000))) {
    validateDeploymentArtifact(artifact, terms);
    if (scalar(artifact.compiledClassHash) !== compiledClassHash) throw new Error('VOW_WRONG_COMPILED_BUILD');
    if (!ceilings || Object.keys(ceilings).sort().join(',') !== 'declare,deploy,fund') throw new Error('VOW_NETWORK_CEILINGS_REQUIRED');
    for (const value of Object.values(ceilings)) bounded(value, U128_MAX, 'NETWORK_FEE_CEILING', 1n);
    this.#ceilings = Object.freeze({ ...ceilings });
    this.#terms = Object.freeze({ ...terms }); this.#artifact = structuredClone(artifact);
    this.#reader = reader; this.#storage = storage; this.#locks = locks; this.#now = now;
    const plan = buildPlan(terms, now()); this.#digest = hash.computePoseidonHashOnElements([plan.reviewDigest, ceilings.declare, ceilings.deploy, ceilings.fund]);
    this.#key = `vow:deployment:v1:${hex(terms.chainId)}:${hex(plan.predictedAddress)}`;
  }
  get observedTransactionHash(): string | null { return this.#observedHash; }
  invalidate(): void { this.#revision++; this.#review = null; }
  async prepare(wallet: DeploymentWallet) {
    if (this.#busy) throw new Error('VOW_DEPLOYMENT_BUSY');
    this.#review = null; const revision = this.#revision;
    const journal = await this.#locked(() => this.#load());
    if (journal.attempts.some((attempt) => attempt.status !== 'confirmed' || attempt.problem)) throw new Error('VOW_RECONCILE_REQUIRED');
    await checkDeploymentWallet(wallet, this.#terms.owner);
    const state = await readDeploymentStage(this.#reader, this.#terms, this.#now());
    if (journal.attempts.some((attempt) => attempt.stage === state.stage)) throw new Error('VOW_EXISTING_DEPLOYMENT_ATTEMPT');
    if (revision !== this.#revision) throw new Error('VOW_SELECTION_CHANGED');
    this.#observedHash = null; this.#review = state;
    return { stage: state.stage, nonce: hex(state.nonce), blockHash: hex(state.blockHash), reviewDigest: this.#digest,
      maximumNetworkFeeSTRK: state.stage === 'complete' ? null : this.#ceilings[state.stage].toString(),
      networkFeeCeiling: state.stage === 'complete' ? null : `${formatAmount(this.#ceilings[state.stage], 18)} STRK`,
      request: state.stage === 'complete' ? null : deploymentRequest(state.stage, state.plan, this.#artifact), networkFees: 'Reject the wallet transaction if its shown network fee exceeds this ceiling. This API cannot enforce a fee cap; the wallet confirmation is required.' };
  }
  async execute(wallet: DeploymentWallet, approvedDigest: string, feeConfirmation: boolean, timeoutMs = 90_000): Promise<Journal> {
    const review = this.#review;
    if (this.#busy || !review || review.stage === 'complete') throw new Error('VOW_DEPLOYMENT_NOT_REVIEWED');
    if (approvedDigest !== this.#digest || !feeConfirmation) throw new Error('VOW_DEPLOYMENT_NOT_APPROVED');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90_000) throw new Error('VOW_INVALID_TIMEOUT');
    this.#busy = true; this.#review = null; const revision = this.#revision;
    try {
      await checkDeploymentWallet(wallet, this.#terms.owner);
      const fresh = await readDeploymentStage(this.#reader, this.#terms, this.#now());
      if (revision !== this.#revision) throw new Error('VOW_SELECTION_CHANGED');
      if (fresh.stage !== review.stage || fresh.fingerprint !== review.fingerprint) throw new Error('VOW_DEPLOYMENT_STATE_CHANGED');
      await this.#locked(() => {
        if (revision !== this.#revision) throw new Error('VOW_SELECTION_CHANGED');
        const journal = this.#load();
        if (journal.attempts.some((attempt) => attempt.status !== 'confirmed' || attempt.stage === fresh.stage || attempt.problem)) throw new Error('VOW_EXISTING_DEPLOYMENT_ATTEMPT');
        journal.attempts.push({ actualNetworkFeeSTRK: null, maximumNetworkFeeSTRK: this.#ceilings[review.stage as DeploymentStage].toString(), stage: review.stage as DeploymentStage, nonce: hex(fresh.nonce), hash: null, status: 'unknown', problem: false }); this.#save(journal);
      });
      if (revision !== this.#revision) throw new Error('VOW_SELECTION_CHANGED');
      const stage = review.stage;
      const operation = wallet.request(deploymentRequest(stage, fresh.plan, this.#artifact)).then(async (response) => {
        const row = receiptRecord(response); const txHash = scalar(row.transaction_hash);
        if (txHash === 0n) throw new Error('VOW_INVALID_TRANSACTION_HASH');
        this.#observedHash = hex(txHash);
        await this.#locked(() => {
          const journal = this.#load(); const attempt = journal.attempts.at(-1)!;
          if (attempt.stage !== stage || attempt.hash !== null && scalar(attempt.hash) !== txHash) attempt.problem = true;
          else attempt.hash = hex(txHash);
          if (stage === 'declare') {
            try { if (scalar(row.class_hash) !== this.#terms.probeClassHash) attempt.problem = true; } catch { attempt.problem = true; }
          }
          this.#save(journal);
        });
      }).catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([operation, new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
      if (timer) clearTimeout(timer);
      return await this.#locked(() => this.#load());
    } finally { this.#busy = false; }
  }
  async reconcile(recoveredHash?: string): Promise<Journal> {
    if (this.#busy) throw new Error('VOW_DEPLOYMENT_BUSY');
    return this.#locked(async () => {
      const journal = this.#load(); const attempt = journal.attempts.at(-1);
      if (!attempt) throw new Error('VOW_NO_DEPLOYMENT_ATTEMPT');
      if (recoveredHash) {
        if (scalar(recoveredHash) === 0n || attempt.hash !== null && scalar(attempt.hash) !== scalar(recoveredHash)) throw new Error('VOW_TRANSACTION_HASH_CHANGED');
        attempt.hash = hex(scalar(recoveredHash)); this.#save(journal);
      }
      attempt.status = 'unknown'; this.#save(journal);
      if (!attempt.hash || attempt.problem) return journal;
      try {
        const receipt = receiptRecord(await this.#reader.request('starknet_getTransactionReceipt', { transaction_hash: attempt.hash }));
        if (scalar(receipt.transaction_hash) !== scalar(attempt.hash) || !['ACCEPTED_ON_L1', 'ACCEPTED_ON_L2'].includes(String(receipt.finality_status))) return journal;
        const block = receiptRecord(await this.#reader.request('starknet_getBlockWithTxHashes', { block_id: { block_number: receipt.block_number } }));
        if (scalar(block.block_hash) !== scalar(receipt.block_hash) || !receiptFelts(block.transactions, 100_000).includes(scalar(attempt.hash))) return journal;
        const tx = receiptRecord(await this.#reader.request('starknet_getTransactionByHash', { transaction_hash: attempt.hash }));
        if (scalar(tx.transaction_hash) !== scalar(attempt.hash) || scalar(tx.sender_address) !== this.#terms.owner || scalar(tx.nonce) !== scalar(attempt.nonce)) return journal;
        const plan = buildPlan(this.#terms, this.#terms.signatureDeadline - 1n);
        if (attempt.stage === 'declare') {
          if (tx.type !== 'DECLARE' || scalar(tx.class_hash) !== this.#terms.probeClassHash || scalar(tx.compiled_class_hash) !== scalar(this.#artifact.compiledClassHash)) return journal;
        } else if (tx.type !== 'INVOKE' || !equalFelts(receiptFelts(tx.calldata, 4096), executeCalldata(attempt.stage, plan))) return journal;
        const fee = receiptRecord(receipt.actual_fee);
        if (fee.unit !== 'FRI') return journal;
        attempt.actualNetworkFeeSTRK = scalar(fee.amount).toString();
        if (scalar(fee.amount) > this.#ceilings[attempt.stage]) { attempt.problem = true; this.#save(journal); return journal; }
        if (receipt.execution_status === 'REVERTED') attempt.status = 'reverted';
        else if (receipt.execution_status === 'SUCCEEDED') {
          const state = await readDeploymentStage(this.#reader, this.#terms, this.#now(), true);
          const order = ['declare', 'deploy', 'fund', 'complete'];
          const after = receiptRecord(await this.#reader.request('starknet_getBlockWithTxHashes', { block_id: { block_number: receipt.block_number } }));
          if (scalar(after.block_hash) === scalar(receipt.block_hash) && order.indexOf(state.stage) > order.indexOf(attempt.stage)) attempt.status = 'confirmed';
        }
      } catch { attempt.status = 'unknown'; }
      this.#save(journal); return journal;
    });
  }
  async read(): Promise<Journal> { return this.#locked(() => this.#load()); }
  #load(): Journal {
    const raw = this.#storage.getItem(this.#key);
    if (raw === null) return { version: 1, digest: this.#digest, attempts: [] };
    try {
      if (raw.length > 4096) throw new Error();
      const row = receiptRecord(JSON.parse(raw));
      if (row.version !== 1 || row.digest !== this.#digest || !Array.isArray(row.attempts) || row.attempts.length > 3 || Object.keys(row).sort().join(',') !== 'attempts,digest,version') throw new Error();
      let previous = -1;
      for (const item of row.attempts) {
        const attempt = receiptRecord(item); const position = ['declare', 'deploy', 'fund'].indexOf(String(attempt.stage));
        if (position <= previous || !['unknown', 'confirmed', 'reverted'].includes(String(attempt.status)) || typeof attempt.problem !== 'boolean' || Object.keys(attempt).sort().join(',') !== 'actualNetworkFeeSTRK,hash,maximumNetworkFeeSTRK,nonce,problem,stage,status') throw new Error();
        if (attempt.actualNetworkFeeSTRK !== null && (typeof attempt.actualNetworkFeeSTRK !== 'string' || !/^[0-9]{1,78}$/.test(attempt.actualNetworkFeeSTRK))) throw new Error();
        if (attempt.maximumNetworkFeeSTRK !== this.#ceilings[attempt.stage as DeploymentStage].toString()) throw new Error();
        scalar(attempt.nonce); if (attempt.hash !== null && scalar(attempt.hash) === 0n || attempt.status === 'confirmed' && attempt.hash === null) throw new Error();
        previous = position;
      }
      return row as unknown as Journal;
    } catch { throw new Error('VOW_CORRUPT_DEPLOYMENT_RECORD'); }
  }
  #save(journal: Journal): void {
    const value = JSON.stringify(journal); this.#storage.setItem(this.#key, value);
    if (this.#storage.getItem(this.#key) !== value) throw new Error('VOW_RECOVERY_STORAGE_UNAVAILABLE');
  }
  async #locked<T>(action: () => T | Promise<T>): Promise<T> { return this.#locks.request(this.#key, { mode: 'exclusive' }, async () => action()); }
}
