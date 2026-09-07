import { PERMISSION_SLOTS } from '../../packages/vow-sdk/src/permissions.ts';
import type { PermissionSet } from '../../packages/vow-sdk/src/permission-set.ts';

export interface MandatePublicTerms {
  readonly owner: bigint;
  readonly operatorKey: bigint;
  readonly token: bigint;
  readonly expiresAt: bigint;
}

export interface PublicDisclosure {
  readonly status: 'preview-only';
  readonly publishedByCreation: Readonly<Record<string, string>>;
  readonly withheldByCreation: readonly string[];
  readonly publicOnceFunded: readonly string[];
  readonly publicOncePermissionExercised: readonly string[];
  readonly stillPrivateAfterUse: readonly string[];
  readonly notProvenByThisPreview: readonly string[];
  readonly localOnly: { readonly realPermissions: number; readonly paddingSlots: number };
}

export function publicDisclosure(set: PermissionSet, terms: MandatePublicTerms): PublicDisclosure {
  const real = set.slots.filter((slot) => slot.kind === 'permission').length;
  return Object.freeze({
    status: 'preview-only',
    publishedByCreation: Object.freeze({
      ownerAddress: hex(terms.owner),
      permissionCommitmentRoot: hex(set.root),
      operatorPublicKey: hex(terms.operatorKey),
      tokenAddress: hex(terms.token),
      mandateExpiresAt: terms.expiresAt.toString(),
      committedSlots: String(PERMISSION_SLOTS),
      sendingAccount: 'the account that sends create_mandate, which the contract requires to be the owner',
    }),
    withheldByCreation: Object.freeze([
      'every supplier claim public key in this set',
      'every per-permission maximum amount',
      'every purchase commitment',
      'every per-permission valid-after, approve-before and claim-before window',
      'every leaf salt',
      `how many of the ${PERMISSION_SLOTS} committed slots hold a real permission rather than padding`,
    ]),
    publicOnceFunded: Object.freeze([
      'each funding amount and the running funded total',
      "the vault's token balance and its accounted balance for this token",
      'the Funded, Available, Reserved, Paid and Reclaimed totals of this mandate',
    ]),
    publicOncePermissionExercised: Object.freeze([
      'the reservation id, mandate id, permission slot index and leaf hash',
      "that permission's supplier claim public key, reserved amount and claim deadline",
      "that permission's purchase commitment, readable from the public reservation view",
      'the reservation timestamp and the account that sent the reserve transaction',
      'the settled amount and the output note id once the supplier collects',
    ]),
    stillPrivateAfterUse: Object.freeze([
      "an exercised permission's valid-after and approve-before windows, which the vault never writes",
      'every unexercised permission committed in the same set',
    ]),
    notProvenByThisPreview: Object.freeze([
      'note ownership privacy depends on the STRK20 pool and wallet, not on VOW',
      'an observer can link every reservation of this mandate to each other and to the owner address',
      'nothing has been created, signed or sent while this preview is on screen',
    ]),
    localOnly: Object.freeze({ realPermissions: real, paddingSlots: PERMISSION_SLOTS - real }),
  });
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
