import type { Call } from 'starknet';
import { address, bounded, felt, U128_MAX, U64_MAX } from './integers.ts';
import { isStarkPublicKey } from './operator-key.ts';
import type { PermissionSet } from './permission-set.ts';
import type { VaultMandate } from './reservation-reader.ts';

export interface MandateTerms {
  readonly chainId: bigint;
  readonly owner: bigint;
  readonly operatorKey: bigint;
  readonly expiresAt: bigint;
}

export interface MandateCreation {
  readonly call: Readonly<Call>;
  readonly expectedMandateId: bigint;
  readonly root: bigint;
  readonly token: bigint;
  readonly expiresAt: bigint;
}

export function buildCreateMandateCall(
  set: PermissionSet, terms: MandateTerms, now: bigint,
): MandateCreation {
  const { chainId, vaultAddress, mandateId, token } = set.context;
  if (felt(terms.chainId, 'CHAIN', 1n) !== chainId) throw new Error('VOW_WRONG_CHAIN');
  address(terms.owner, 'OWNER');
  if (!isStarkPublicKey(terms.operatorKey)) throw new Error('VOW_INVALID_OPERATOR_KEY');
  const expiresAt = bounded(terms.expiresAt, U64_MAX, 'EXPIRES_AT', 1n);
  if (expiresAt <= bounded(now, U64_MAX, 'NOW')) throw new Error('VOW_MANDATE_CLOSED');
  for (const slot of set.slots) {
    if (slot.kind === 'permission' && set.permission(slot.permissionId).claimBefore > expiresAt) {
      throw new Error('VOW_CLAIM_AFTER_MANDATE_EXPIRY');
    }
  }
  return Object.freeze({
    call: freezeCall({
      contractAddress: hex(vaultAddress), entrypoint: 'create_mandate',
      calldata: [terms.owner, set.root, terms.operatorKey, token, expiresAt].map(hex),
    }),
    expectedMandateId: mandateId, root: set.root, token, expiresAt,
  });
}

export function buildFundMandateCalls(set: PermissionSet, amount: bigint): readonly Readonly<Call>[] {
  const { vaultAddress, mandateId, token } = set.context;
  bounded(amount, U128_MAX, 'AMOUNT', 1n);
  return Object.freeze([
    freezeCall({
      contractAddress: hex(token), entrypoint: 'approve',
      calldata: [hex(vaultAddress), hex(amount), '0x0'],
    }),
    freezeCall({
      contractAddress: hex(vaultAddress), entrypoint: 'fund_mandate',
      calldata: [hex(mandateId), hex(amount)],
    }),
  ]);
}

export function assertMandateMatchesSet(
  mandate: VaultMandate, set: PermissionSet, terms: MandateTerms,
): void {
  const matches = mandate.mandateId === set.context.mandateId && mandate.root === set.root
    && mandate.token === set.context.token && mandate.owner === terms.owner
    && mandate.operatorKey === terms.operatorKey && mandate.expiresAt === terms.expiresAt;
  if (!matches) throw new Error('VOW_MANDATE_MISMATCH');
  if (mandate.revoked) throw new Error('VOW_MANDATE_CLOSED');
}

function freezeCall(call: Call): Readonly<Call> {
  const copied = structuredClone(call);
  if (copied.calldata) Object.freeze(copied.calldata);
  return Object.freeze(copied);
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
