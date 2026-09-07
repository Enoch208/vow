import { ec } from 'starknet';
import { bounded, U64_MAX } from './integers.ts';
import { signClaim } from './claims.ts';
import type { ClaimAuthorization, ClaimSignature } from './claims.ts';

export class SupplierKey {
  #bytes: Uint8Array;
  #locked = false;
  readonly publicKey: bigint;

  private constructor(bytes: Uint8Array) {
    this.#bytes = new Uint8Array(bytes);
    if (this.#bytes.length !== 32 || !ec.starkCurve.utils.isValidPrivateKey(this.#bytes)) {
      this.#bytes.fill(0); throw new Error('VOW_INVALID_SUPPLIER_KEY');
    }
    this.publicKey = BigInt(ec.starkCurve.getStarkKey(this.#bytes));
  }
  static generate(): SupplierKey {
    const bytes = ec.starkCurve.utils.randomPrivateKey();
    try { return new SupplierKey(bytes); } finally { bytes.fill(0); }
  }
  static restore(bytes: Uint8Array): SupplierKey { return new SupplierKey(bytes); }
  get locked(): boolean { return this.#locked; }
  sign(claim: ClaimAuthorization, expectedKey: bigint, now: bigint): ClaimSignature {
    if (this.#locked) throw new Error('VOW_KEY_LOCKED');
    bounded(now, U64_MAX, 'NOW');
    if (this.publicKey !== expectedKey) throw new Error('VOW_WRONG_SUPPLIER_KEY');
    if (now >= claim.signatureDeadline) throw new Error('VOW_CLAIM_EXPIRED');
    return signClaim(claim, this.#bytes.reduce((text, byte) => text + byte.toString(16).padStart(2, '0'), ''));
  }
  async encrypt(encryptor: (bytes: Uint8Array) => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
    if (this.#locked) throw new Error('VOW_KEY_LOCKED');
    const copy = new Uint8Array(this.#bytes);
    try { return await encryptor(copy); } finally { copy.fill(0); }
  }
  lock(): void { this.#bytes.fill(0); this.#locked = true; }
  toJSON(): { publicKey: string; locked: boolean } { return { publicKey: `0x${this.publicKey.toString(16)}`, locked: this.#locked }; }
}
