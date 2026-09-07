import { readFile } from 'node:fs/promises';
import { ec } from 'starknet';

const SECRET = '.secrets/vow-mandate-2/owner-operator.json';
const PUBLIC_PATH = 'dist/deployment/vow-mandate-2-public.json';

interface UnsignedReservation {
  readonly label: string;
  readonly reservationId: string;
  readonly authorizationDigest: string;
  readonly encodedAuthorization: readonly string[];
  readonly encodedPermission: readonly string[];
  readonly proof: readonly string[];
}

const label = (process.argv[2] ?? '').toUpperCase();
if (label !== 'TX-B' && label !== 'TX-C') {
  process.stderr.write('Usage: node scripts/sign-reserve.ts TX-B|TX-C\n');
  process.exitCode = 1;
} else {
  const secret = JSON.parse(await readFile(SECRET, 'utf8')) as {
    operatorPrivateKey: string; operatorPublicKey: string;
    unsignedReservations: readonly UnsignedReservation[];
  };
  const plan = JSON.parse(await readFile(PUBLIC_PATH, 'utf8')) as {
    operatorPublicKey: string;
    reservations: readonly { label: string; authorizationDigest: string; reservationId: string }[];
  };
  const reservation = secret.unsignedReservations.find((entry) => entry.label === label);
  const published = plan.reservations.find((entry) => entry.label === label);
  if (!reservation || !published) throw new Error('VOW_UNKNOWN_RESERVATION');
  if (reservation.authorizationDigest !== published.authorizationDigest) {
    throw new Error('VOW_DIGEST_DISAGREEMENT');
  }
  if (BigInt(secret.operatorPublicKey) !== BigInt(plan.operatorPublicKey)) {
    throw new Error('VOW_OPERATOR_KEY_DISAGREEMENT');
  }

  const signature = ec.starkCurve.sign(
    BigInt(reservation.authorizationDigest).toString(16), secret.operatorPrivateKey,
  );
  const verified = ec.starkCurve.verify(
    new ec.starkCurve.Signature(signature.r, signature.s),
    BigInt(reservation.authorizationDigest).toString(16),
    `02${BigInt(secret.operatorPublicKey).toString(16).padStart(64, '0')}`,
  ) || ec.starkCurve.verify(
    new ec.starkCurve.Signature(signature.r, signature.s),
    BigInt(reservation.authorizationDigest).toString(16),
    `03${BigInt(secret.operatorPublicKey).toString(16).padStart(64, '0')}`,
  );
  if (!verified) throw new Error('VOW_SIGNATURE_DID_NOT_VERIFY');

  const hex = (value: bigint) => `0x${value.toString(16)}`;
  const calldata = [
    ...reservation.encodedAuthorization.slice(1),
    ...reservation.encodedPermission.slice(1),
    hex(BigInt(reservation.proof.length)),
    ...reservation.proof,
    hex(signature.r),
    hex(signature.s),
  ];
  if (calldata.length !== 29) throw new Error('VOW_UNEXPECTED_CALLDATA_LENGTH');
  process.stdout.write(`${calldata.join(' ')}\n`);
}
