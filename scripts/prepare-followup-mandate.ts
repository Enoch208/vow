import { chmod, lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Call } from 'starknet';
import { bounded, U64_MAX } from '../packages/vow-sdk/src/integers.ts';
import { buildCreateMandateCall, buildFundMandateCalls } from '../packages/vow-sdk/src/mandate-calldata.ts';
import { OperatorKey } from '../packages/vow-sdk/src/operator-key.ts';
import { PermissionSet } from '../packages/vow-sdk/src/permission-set.ts';
import { encodePermission, verifyPermissionProof } from '../packages/vow-sdk/src/permissions.ts';
import type { PermissionLeaf } from '../packages/vow-sdk/src/permissions.ts';
import { encodeReserve, hashReserve, validateReserveAgainstPermission } from '../packages/vow-sdk/src/reserve.ts';
import type { ReserveAuthorization } from '../packages/vow-sdk/src/reserve.ts';
import { computeReservationId } from '../packages/vow-sdk/src/reservation-reader.ts';
import { SupplierKey } from '../packages/vow-sdk/src/supplier-key.ts';

const CHAIN = 0x534e5f4d41494en;
const OWNER = 0x3f3cc7727c66634967621dc8d4697f1bfd6c29f81757496a4783bf5c90deb89n;
const VAULT = 0x641ca5237870312273ed2cd693372ee49e103d5c585af6185324f3662e15227n;
const TOKEN = 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938dn;
const MANDATE_ID = 2n;
const AMOUNT_PER_PERMISSION = 10_000_000_000_000_000n;
const PERMISSION_IDS = [0n, 1n] as const;
const LABELS = ['TX-B', 'TX-C'] as const;
const SECRET_DIRECTORY = '.secrets/vow-mandate-2';
const PUBLIC_PATH = 'dist/deployment/vow-mandate-2-public.json';

interface UnsignedReserve {
  readonly label: typeof LABELS[number];
  readonly authorization: ReserveAuthorization;
  readonly authorizationDigest: bigint;
  readonly reservationId: bigint;
  readonly leaf: PermissionLeaf;
  readonly leafHash: bigint;
  readonly proof: readonly bigint[];
}

interface PreparedFollowupMandate {
  readonly publicArtifact: Record<string, unknown>;
  readonly ownerSecret: Record<string, unknown>;
  readonly supplierSecrets: readonly Record<string, unknown>[];
}

export interface FollowupArtifactPaths {
  readonly publicArtifact: string;
  readonly ownerSecret: string;
  readonly supplierSecrets: readonly [string, string];
}

export async function writeFollowupMandateArtifacts(
  baseDirectory: string, preparedAt = BigInt(Math.floor(Date.now() / 1000)),
): Promise<FollowupArtifactPaths> {
  const base = resolve(baseDirectory);
  const publicPath = join(base, PUBLIC_PATH);
  const secretRoot = join(base, '.secrets');
  const secretDirectory = join(base, SECRET_DIRECTORY);
  const ownerPath = join(secretDirectory, 'owner-operator.json');
  const supplierPaths = [join(secretDirectory, 'supplier-tx-b.json'), join(secretDirectory, 'supplier-tx-c.json')] as const;
  await ensureMissing(publicPath);
  await ensureMissing(secretDirectory);
  await secureSecretRoot(secretRoot);
  const prepared = await prepareFollowupMandate(preparedAt);
  await mkdir(secretDirectory, { mode: 0o700 });
  await writeSecret(ownerPath, prepared.ownerSecret);
  await writeSecret(supplierPaths[0], prepared.supplierSecrets[0]!);
  await writeSecret(supplierPaths[1], prepared.supplierSecrets[1]!);
  await mkdir(dirname(publicPath), { recursive: true });
  await writeFile(publicPath, json(prepared.publicArtifact), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await chmod(publicPath, 0o600);
  return Object.freeze({ publicArtifact: publicPath, ownerSecret: ownerPath, supplierSecrets: supplierPaths });
}

export async function prepareFollowupMandate(preparedAt: bigint): Promise<PreparedFollowupMandate> {
  const now = bounded(preparedAt, U64_MAX, 'PREPARED_AT', 60n);
  const validAfter = now - 60n;
  const approveBefore = now + 21_600n;
  const claimBefore = now + 43_200n;
  const expiresAt = now + 86_400n;
  bounded(expiresAt, U64_MAX, 'EXPIRES_AT');
  const operator = OperatorKey.generate();
  const suppliers = [SupplierKey.generate(), SupplierKey.generate()] as const;
  if (suppliers[0].publicKey === suppliers[1].publicKey) throw new Error('VOW_DUPLICATE_SUPPLIER_KEY');
  const set = PermissionSet.create(PERMISSION_IDS.map((permissionId, index) => ({
    schemaVersion: 1n, chainId: CHAIN, vaultAddress: VAULT, mandateId: MANDATE_ID,
    permissionId, supplierClaimPublicKey: suppliers[index]!.publicKey, token: TOKEN,
    maximumAmount: AMOUNT_PER_PERMISSION, validAfter, approveBefore, claimBefore,
    purchaseCommitment: randomFelt(),
  })));
  const creation = buildCreateMandateCall(set, {
    chainId: CHAIN, owner: OWNER, operatorKey: operator.publicKey, expiresAt,
  }, now);
  const reserves = PERMISSION_IDS.map((permissionId, index) => unsignedReserve(
    set, LABELS[index]!, permissionId, randomFelt(), approveBefore, now,
  ));
  let operatorPrivateKey = '';
  let permissionSetPlaintext = '';
  const supplierPrivateKeys = ['', ''];
  try {
    operatorPrivateKey = await keyHex(operator);
    permissionSetPlaintext = await permissionPlaintext(set);
    supplierPrivateKeys[0] = await keyHex(suppliers[0]);
    supplierPrivateKeys[1] = await keyHex(suppliers[1]);
  } finally {
    operator.lock();
    suppliers[0].lock();
    suppliers[1].lock();
  }
  const publicArtifact = Object.freeze({
    version: 1,
    status: 'unsigned-local-preparation',
    preparedAt: now.toString(),
    executionPrecondition: 'Require mandate 0x1 to exist and mandate 0x2 to have the default zero owner immediately before creation; mandate IDs are sequential and never deleted.',
    chainId: hex(CHAIN), owner: hex(OWNER), vaultAddress: hex(VAULT), token: hex(TOKEN),
    mandateId: hex(MANDATE_ID), root: hex(set.root), operatorPublicKey: hex(operator.publicKey),
    permissionCount: 2, amountPerPermission: AMOUNT_PER_PERMISSION.toString(),
    totalFunding: (AMOUNT_PER_PERMISSION * 2n).toString(),
    validAfter: validAfter.toString(), approveBefore: approveBefore.toString(),
    claimBefore: claimBefore.toString(), expiresAt: expiresAt.toString(),
    createMandate: publicCall(creation.call),
    fundMandate: buildFundMandateCalls(set, AMOUNT_PER_PERMISSION * 2n).map(publicCall),
    reservations: reserves.map((reserve) => Object.freeze({
      label: reserve.label, permissionId: hex(reserve.authorization.permissionId),
      reservationId: hex(reserve.reservationId), requestedAmount: reserve.authorization.requestedAmount.toString(),
      claimBefore: reserve.leaf.claimBefore.toString(), leafHash: hex(reserve.leafHash),
      authorizationDigest: hex(reserve.authorizationDigest),
      reserveCallShape: Object.freeze({
        contractAddress: hex(VAULT), entrypoint: 'reserve', calldataItems: 29,
        authorizationItemsWithoutDomain: 9, permissionItemsWithoutDomain: 13,
        proofLengthItems: 1, proofItems: reserve.proof.length, operatorSignatureItems: 2,
        signatureStatus: 'not-created',
      }),
    })),
  });
  const ownerSecret = Object.freeze({
    version: 1, mandateId: hex(MANDATE_ID), operatorPrivateKey, operatorPublicKey: hex(operator.publicKey),
    permissionSetPlaintext,
    unsignedReservations: reserves.map((reserve) => Object.freeze({
      label: reserve.label, reservationId: hex(reserve.reservationId),
      authorizationDigest: hex(reserve.authorizationDigest),
      authorization: bigintRecord(reserve.authorization),
      encodedAuthorization: encodeReserve(reserve.authorization).map(hex),
      encodedPermission: encodePermission(reserve.leaf).map(hex),
      proof: reserve.proof.map(hex),
    })),
  });
  const supplierSecrets = suppliers.map((supplier, index) => Object.freeze({
    version: 1, label: LABELS[index]!, mandateId: hex(MANDATE_ID),
    permissionId: hex(PERMISSION_IDS[index]!), publicKey: hex(supplier.publicKey),
    privateKey: supplierPrivateKeys[index]!,
    custody: 'Transfer this file through a secure channel to its separately controlled supplier before collection.',
  }));
  operatorPrivateKey = '';
  permissionSetPlaintext = '';
  supplierPrivateKeys.fill('');
  return Object.freeze({ publicArtifact, ownerSecret, supplierSecrets: Object.freeze(supplierSecrets) });
}

function unsignedReserve(
  set: PermissionSet, label: typeof LABELS[number], permissionId: bigint,
  requestId: bigint, requestDeadline: bigint, now: bigint,
): UnsignedReserve {
  const leaf = set.permission(permissionId);
  const slot = set.slot(permissionId);
  if (!verifyPermissionProof(slot.leafHash, permissionId, slot.proof, set.root)) throw new Error('VOW_BAD_PROOF');
  const authorization = Object.freeze({
    chainId: set.context.chainId, vaultAddress: set.context.vaultAddress,
    mandateId: set.context.mandateId, immutableRoot: set.root, permissionId,
    leafHash: slot.leafHash, requestedAmount: AMOUNT_PER_PERMISSION,
    requestId, requestDeadline,
  });
  validateReserveAgainstPermission({
    authorization, maximumAmount: leaf.maximumAmount,
    validAfter: leaf.validAfter, approveBefore: leaf.approveBefore, now,
  });
  return Object.freeze({
    label, authorization, authorizationDigest: hashReserve(authorization),
    reservationId: computeReservationId(MANDATE_ID, permissionId), leaf,
    leafHash: slot.leafHash, proof: slot.proof,
  });
}

async function secureSecretRoot(path: string): Promise<void> {
  try {
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('VOW_UNSAFE_SECRET_ROOT');
  } catch (error: unknown) {
    if (!isMissing(error)) throw error;
    await mkdir(path, { mode: 0o700 });
  }
  await chmod(path, 0o700);
}

async function ensureMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error: unknown) {
    if (isMissing(error)) return;
    throw error;
  }
  throw new Error('VOW_FOLLOWUP_TARGET_EXISTS');
}

async function writeSecret(path: string, value: unknown): Promise<void> {
  await writeFile(path, json(value), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await chmod(path, 0o600);
}

async function keyHex(key: OperatorKey | SupplierKey): Promise<string> {
  let result = '';
  await key.encrypt(async (bytes) => {
    result = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return new ArrayBuffer(0);
  });
  return result;
}

async function permissionPlaintext(set: PermissionSet): Promise<string> {
  let result = '';
  await set.encrypt(async (bytes) => {
    result = new TextDecoder().decode(bytes);
    return new ArrayBuffer(0);
  });
  return result;
}

function publicCall(call: Readonly<Call>): Record<string, unknown> {
  if (!Array.isArray(call.calldata)) throw new Error('VOW_INVALID_FOLLOWUP_CALL');
  return Object.freeze({
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    calldata: Object.freeze(call.calldata.map(String)),
  });
}

function bigintRecord(value: ReserveAuthorization): Record<string, string> {
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hex(item)])));
}

function randomFelt(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  bytes.fill(0);
  return value === 0n ? 1n : value;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function hex(value: bigint): string { return `0x${value.toString(16)}`; }

async function main(): Promise<void> {
  const paths = await writeFollowupMandateArtifacts(process.cwd());
  const prepared = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(paths.publicArtifact, 'utf8'))) as {
    root: string;
    reservations: readonly { label: string; authorizationDigest: string }[];
  };
  process.stdout.write([
    `Prepared unsigned mandate 2 review at ${paths.publicArtifact}.`,
    `Root: ${prepared.root}`,
    ...prepared.reservations.map((entry) => `${entry.label} authorization digest: ${entry.authorizationDigest}`),
    'No network request, transaction signature, wallet request, or submission was performed.',
  ].join('\n') + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
