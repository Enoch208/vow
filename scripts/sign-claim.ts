import { readFile } from 'node:fs/promises';
import { ec } from 'starknet';
import { hashClaim } from '../packages/vow-sdk/src/claims.ts';
import type { ClaimAuthorization } from '../packages/vow-sdk/src/claims.ts';

const label = (process.argv[2] ?? '').toLowerCase();
const reviewPath = process.argv[3];
if (!/^tx-[bc]$/.test(label) || !reviewPath) {
  process.stderr.write('Usage: node scripts/sign-claim.ts tx-b|tx-c <claim-review.json>\n');
  process.exitCode = 1;
} else {
  const supplier = JSON.parse(
    await readFile(`.secrets/vow-mandate-2/supplier-${label}.json`, 'utf8'),
  ) as { publicKey: string; privateKey: string };
  const review = JSON.parse(await readFile(reviewPath, 'utf8')) as {
    claim: Record<string, string>; digest: string;
  };
  const claim = Object.fromEntries(
    Object.entries(review.claim).map(([key, value]) => [key, BigInt(value)]),
  ) as unknown as ClaimAuthorization;

  const digest = hashClaim(claim);
  if (digest !== BigInt(review.digest)) throw new Error('VOW_DIGEST_MISMATCH');
  const signature = ec.starkCurve.sign(digest.toString(16), supplier.privateKey);
  const key = BigInt(supplier.publicKey).toString(16).padStart(64, '0');
  const ok = ec.starkCurve.verify(new ec.starkCurve.Signature(signature.r, signature.s), digest.toString(16), `02${key}`)
    || ec.starkCurve.verify(new ec.starkCurve.Signature(signature.r, signature.s), digest.toString(16), `03${key}`);
  if (!ok) throw new Error('VOW_SIGNATURE_DID_NOT_VERIFY');

  process.stdout.write(`digest verified against the claim fields\n`);
  process.stdout.write(`supplier public key: ${supplier.publicKey}\n\n`);
  process.stdout.write(`r  0x${signature.r.toString(16)}\n`);
  process.stdout.write(`s  0x${signature.s.toString(16)}\n`);
}
