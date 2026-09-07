import { ec } from 'starknet';
import { bounded, felt, U64_MAX } from './integers.ts';
import { hashReserve, signReserve } from './reserve.ts';
import type { ReserveAuthorization, ReserveSignature } from './reserve.ts';

export function isStarkPublicKey(value: bigint): boolean {
  try {
    ec.starkCurve.getSharedSecret('1', `02${felt(value, 'PUBLIC_KEY', 1n).toString(16).padStart(64, '0')}`);
    return true;
  } catch { return false; }
}

export class OperatorKey {
  #bytes: Uint8Array;
  #locked = false;
  readonly publicKey: bigint;

  private constructor(bytes: Uint8Array) {
    this.#bytes = new Uint8Array(bytes);
    if (this.#bytes.length !== 32 || !ec.starkCurve.utils.isValidPrivateKey(this.#bytes)) {
      this.#bytes.fill(0); throw new Error('VOW_INVALID_OPERATOR_KEY');
    }
    this.publicKey = BigInt(ec.starkCurve.getStarkKey(this.#bytes));
  }

  static generate(): OperatorKey {
    const bytes = ec.starkCurve.utils.randomPrivateKey();
    try { return new OperatorKey(bytes); } finally { bytes.fill(0); }
  }

  static restore(bytes: Uint8Array): OperatorKey { return new OperatorKey(bytes); }

  get locked(): boolean { return this.#locked; }

  sign(authorization: ReserveAuthorization, expectedKey: bigint, now: bigint): ReserveSignature {
    if (this.#locked) throw new Error('VOW_KEY_LOCKED');
    bounded(now, U64_MAX, 'NOW');
    if (this.publicKey !== felt(expectedKey, 'OPERATOR_KEY', 1n)) throw new Error('VOW_WRONG_OPERATOR_KEY');
    if (now >= authorization.requestDeadline) throw new Error('VOW_APPROVAL_EXPIRED');
    hashReserve(authorization);
    return signReserve(authorization, this.#bytes.reduce((text, byte) => text + byte.toString(16).padStart(2, '0'), ''));
  }

  async encrypt(encryptor: (bytes: Uint8Array) => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
    if (this.#locked) throw new Error('VOW_KEY_LOCKED');
    const copy = new Uint8Array(this.#bytes);
    try { return await encryptor(copy); } finally { copy.fill(0); }
  }

  lock(): void { this.#bytes.fill(0); this.#locked = true; }

  toJSON(): { publicKey: string; locked: boolean } {
    return { publicKey: `0x${this.publicKey.toString(16)}`, locked: this.#locked };
  }
}
