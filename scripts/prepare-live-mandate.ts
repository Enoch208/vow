import { mkdir, writeFile } from 'node:fs/promises';
import { OperatorKey } from '../packages/vow-sdk/src/operator-key.ts';
import { PermissionSet } from '../packages/vow-sdk/src/permission-set.ts';
import { buildCreateMandateCall, buildFundMandateCalls } from '../packages/vow-sdk/src/mandate-calldata.ts';
import { buildReserveRequest } from '../packages/vow-sdk/src/reserve-request.ts';
import { SupplierKey } from '../packages/vow-sdk/src/supplier-key.ts';

const CHAIN = 0x534e5f4d41494en;
const OWNER = 0x3f3cc7727c66634967621dc8d4697f1bfd6c29f81757496a4783bf5c90deb89n;
const VAULT = 0x641ca5237870312273ed2cd693372ee49e103d5c585af6185324f3662e15227n;
const TOKEN = 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938dn;
const AMOUNT = 100_000_000_000_000_000n;
const SECRET_PATH = '.secrets/live-mandate.json';
const PUBLIC_PATH = 'dist/deployment/live-mandate.json';

const now = BigInt(Math.floor(Date.now() / 1000));
const operator = OperatorKey.generate();
const supplier = SupplierKey.generate();
const validAfter = now - 60n;
const approveBefore = now + 21_600n;
const claimBefore = now + 43_200n;
const expiresAt = now + 86_400n;
const purchaseCommitment = randomFelt();
const requestId = randomFelt();
const set = PermissionSet.create([{
  schemaVersion: 1n, chainId: CHAIN, vaultAddress: VAULT, mandateId: 1n,
  permissionId: 0n, supplierClaimPublicKey: supplier.publicKey, token: TOKEN,
  maximumAmount: AMOUNT, validAfter, approveBefore, claimBefore, purchaseCommitment,
}]);
const creation = buildCreateMandateCall(set, {
  chainId: CHAIN, owner: OWNER, operatorKey: operator.publicKey, expiresAt,
}, now);
const reserve = buildReserveRequest({
  set, operatorKey: operator.publicKey, permissionId: 0n, requestedAmount: AMOUNT,
  requestId, requestDeadline: now + 3_600n, now,
}, operator);

let operatorPrivateKey = '';
let supplierPrivateKey = '';
let permissionSet = '';
await operator.encrypt(async (bytes) => {
  operatorPrivateKey = bytesToHex(bytes);
  return new ArrayBuffer(0);
});
await supplier.encrypt(async (bytes) => {
  supplierPrivateKey = bytesToHex(bytes);
  return new ArrayBuffer(0);
});
await set.encrypt(async (bytes) => {
  permissionSet = new TextDecoder().decode(bytes);
  return new ArrayBuffer(0);
});

await mkdir('.secrets', { recursive: true, mode: 0o700 });
await mkdir('dist/deployment', { recursive: true });
await writeFile(SECRET_PATH, JSON.stringify({
  version: 1, operatorPrivateKey, supplierPrivateKey, permissionSet,
}, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
await writeFile(PUBLIC_PATH, JSON.stringify({
  version: 1, chainId: hex(CHAIN), owner: hex(OWNER), vaultAddress: hex(VAULT),
  token: hex(TOKEN), amount: AMOUNT.toString(), mandateId: '0x1',
  operatorKey: hex(operator.publicKey), supplierKey: hex(supplier.publicKey),
  root: hex(set.root), validAfter: validAfter.toString(), approveBefore: approveBefore.toString(),
  claimBefore: claimBefore.toString(), expiresAt: expiresAt.toString(),
  purchaseCommitment: hex(purchaseCommitment), reservationId: hex(reserve.reservationId),
  createMandate: creation.call, fundMandate: buildFundMandateCalls(set, AMOUNT),
  reserve: reserve.call,
}, null, 2) + '\n');
operator.lock();
supplier.lock();
operatorPrivateKey = supplierPrivateKey = permissionSet = '';
process.stdout.write(`Prepared public live mandate at ${PUBLIC_PATH}. Private keys remain in ${SECRET_PATH}.\n`);

function randomFelt(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  bytes.fill(0);
  return value === 0n ? 1n : value;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hex(value: bigint): string { return `0x${value.toString(16)}`; }
