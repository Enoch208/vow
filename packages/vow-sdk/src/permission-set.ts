import { address, felt, bounded } from './integers.ts';
import { isStarkPublicKey } from './operator-key.ts';
import { parsePlaintext, serializePlaintext } from './permission-set-format.ts';
import {
  PERMISSION_SLOTS, hashPermission, paddingLeafHash, permissionProof, permissionRoot,
} from './permissions.ts';
import type { PermissionLeaf } from './permissions.ts';

export type PermissionRequest = Omit<PermissionLeaf, 'salt'>;
export const SALT_BYTES = 31;

export interface PermissionContext {
  readonly schemaVersion: bigint;
  readonly chainId: bigint;
  readonly vaultAddress: bigint;
  readonly mandateId: bigint;
  readonly token: bigint;
}

export interface PermissionSlot {
  readonly permissionId: bigint;
  readonly kind: 'permission' | 'padding';
  readonly leafHash: bigint;
  readonly proof: readonly bigint[];
}

export interface PermissionSetInput {
  readonly permissions: readonly PermissionLeaf[];
  readonly paddingSalts: readonly bigint[];
}

export class PermissionSet {
  readonly root: bigint;
  readonly context: PermissionContext;
  readonly slots: readonly PermissionSlot[];
  #permissions: ReadonlyMap<bigint, PermissionLeaf>;
  #paddingSalts: readonly bigint[];

  private constructor(input: PermissionSetInput) {
    const permissions = new Map<bigint, PermissionLeaf>();
    for (const leaf of input.permissions) {
      const slot = bounded(leaf.permissionId, BigInt(PERMISSION_SLOTS - 1), 'PERMISSION_ID');
      if (permissions.has(slot)) throw new Error('VOW_DUPLICATE_PERMISSION_SLOT');
      permissions.set(slot, leaf);
    }
    if (permissions.size < 1) throw new RangeError('VOW_INVALID_SLOT_COUNT');
    if (input.paddingSalts.length !== PERMISSION_SLOTS - permissions.size) {
      throw new RangeError('VOW_INVALID_SLOT_COUNT');
    }
    const salts = new Set<bigint>();
    for (const leaf of permissions.values()) {
      if (!isStarkPublicKey(leaf.supplierClaimPublicKey)) throw new Error('VOW_INVALID_SUPPLIER_KEY');
      salts.add(felt(leaf.salt, 'SALT', 1n));
    }
    for (const salt of input.paddingSalts) salts.add(felt(salt, 'SALT', 1n));
    if (salts.size !== PERMISSION_SLOTS) throw new Error('VOW_DUPLICATE_SALT');
    this.context = context(permissions);
    const padding = [...input.paddingSalts];
    const kinds: ('permission' | 'padding')[] = [];
    const hashes: bigint[] = [];
    let nextPadding = 0;
    for (let slot = 0; slot < PERMISSION_SLOTS; slot += 1) {
      const leaf = permissions.get(BigInt(slot));
      kinds.push(leaf ? 'permission' : 'padding');
      hashes.push(leaf ? hashPermission(leaf) : paddingLeafHash(padding[nextPadding++]!));
    }
    this.root = permissionRoot(hashes);
    this.slots = Object.freeze(hashes.map((leafHash, slot) => Object.freeze({
      permissionId: BigInt(slot), kind: kinds[slot]!, leafHash,
      proof: Object.freeze(permissionProof(hashes, BigInt(slot))),
    })));
    this.#permissions = permissions;
    this.#paddingSalts = Object.freeze(padding);
  }

  static assemble(input: PermissionSetInput): PermissionSet {
    return new PermissionSet(input);
  }

  static create(requests: readonly PermissionRequest[]): PermissionSet {
    const permissions = requests.map((request) => ({ ...request, salt: randomSalt() }));
    const padding = PERMISSION_SLOTS - permissions.length;
    return new PermissionSet({
      permissions, paddingSalts: Array.from({ length: Math.max(padding, 0) }, randomSalt),
    });
  }

  static restore(plaintext: Uint8Array): PermissionSet {
    return new PermissionSet(parsePlaintext(new TextDecoder().decode(plaintext)));
  }

  permission(permissionId: bigint): PermissionLeaf {
    const leaf = this.#permissions.get(slotIndex(permissionId));
    if (!leaf) throw new Error('VOW_NOT_A_PERMISSION_SLOT');
    return leaf;
  }

  slot(permissionId: bigint): PermissionSlot {
    return this.slots[Number(slotIndex(permissionId))]!;
  }

  async encrypt(encryptor: (plaintext: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
    const plaintext = new TextEncoder()
      .encode(serializePlaintext([...this.#permissions.values()], this.#paddingSalts));
    try { return await encryptor(plaintext); } finally { plaintext.fill(0); }
  }

  toJSON(): { root: string; slotCount: number } {
    return { root: hex(this.root), slotCount: PERMISSION_SLOTS };
  }
}

function context(permissions: ReadonlyMap<bigint, PermissionLeaf>): PermissionContext {
  const [first] = permissions.values();
  const shared = Object.freeze({
    schemaVersion: felt(first!.schemaVersion, 'SCHEMA', 1n), chainId: felt(first!.chainId, 'CHAIN', 1n),
    vaultAddress: address(first!.vaultAddress, 'VAULT'), mandateId: felt(first!.mandateId, 'MANDATE', 1n),
    token: address(first!.token, 'TOKEN'),
  });
  for (const leaf of permissions.values()) {
    const same = leaf.schemaVersion === shared.schemaVersion && leaf.chainId === shared.chainId
      && leaf.vaultAddress === shared.vaultAddress && leaf.mandateId === shared.mandateId
      && leaf.token === shared.token;
    if (!same) throw new Error('VOW_MIXED_PERMISSION_CONTEXT');
  }
  return shared;
}

function randomSalt(): bigint {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    let salt = 0n;
    for (const byte of bytes) salt = (salt << 8n) | BigInt(byte);
    bytes.fill(0);
    if (salt > 0n) return salt;
  }
}

function slotIndex(permissionId: bigint): bigint {
  return bounded(permissionId, BigInt(PERMISSION_SLOTS - 1), 'PERMISSION_ID');
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
