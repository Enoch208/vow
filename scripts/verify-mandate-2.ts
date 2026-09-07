import { readFile } from 'node:fs/promises';
import { hash } from 'starknet';
import { PermissionSet } from '../packages/vow-sdk/src/permission-set.ts';
import { hashPermission } from '../packages/vow-sdk/src/permissions.ts';
import { createPublicReader } from '../packages/vow-sdk/src/probe-reader.ts';
import { PUBLIC_MAINNET_RPC } from '../packages/vow-sdk/src/rpc-endpoint.ts';

const PUBLIC_PATH = 'dist/deployment/vow-mandate-2-public.json';
const SECRETS = '.secrets/vow-mandate-2';

interface PublicPlan {
  readonly owner: string;
  readonly vaultAddress: string;
  readonly mandateId: string;
  readonly root: string;
  readonly operatorPublicKey: string;
  readonly reservations: readonly {
    label: string; permissionId: string; leafHash: string;
  }[];
}

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok) failures.push(label);
};

const plan = JSON.parse(await readFile(PUBLIC_PATH, 'utf8')) as PublicPlan;
const owner = JSON.parse(await readFile(`${SECRETS}/owner-operator.json`, 'utf8')) as {
  permissionSetPlaintext?: string; operatorPrivateKey?: string;
};

if (typeof owner.permissionSetPlaintext !== 'string' || owner.permissionSetPlaintext.length === 0) {
  check('permission set plaintext is stored on disk', false, 'field missing');
} else {
  check('permission set plaintext is stored on disk', true);
  const set = PermissionSet.restore(new TextEncoder().encode(owner.permissionSetPlaintext));
  check('rebuilt root equals the committed root',
    `0x${set.root.toString(16)}` === plan.root, `0x${set.root.toString(16)}`);

  for (const reservation of plan.reservations) {
    const label = reservation.label.toLowerCase();
    const backup = JSON.parse(await readFile(`${SECRETS}/supplier-${label}.json`, 'utf8')) as {
      publicKey: string;
    };
    const leaf = set.permission(BigInt(reservation.permissionId));
    const committed = `0x${leaf.supplierClaimPublicKey.toString(16)}`;
    check(`${reservation.label} supplier backup key equals the committed permission key`,
      BigInt(committed) === BigInt(backup.publicKey), committed);
    check(`${reservation.label} leaf hash matches the published plan`,
      `0x${hashPermission(leaf).toString(16)}` === reservation.leafHash);
  }
}

const reader = createPublicReader(PUBLIC_MAINNET_RPC);
const expectCreated = process.argv.includes('--expect-created');
let mandateOwner: string | null = null;
let readFailed = false;
try {
  const result = await reader.request('starknet_call', {
    request: {
      contract_address: plan.vaultAddress,
      entry_point_selector: hash.getSelectorFromName('mandate'),
      calldata: [plan.mandateId],
    },
    block_id: 'latest',
  }) as readonly string[];
  mandateOwner = result[0] ?? null;
} catch {
  readFailed = true;
}

if (readFailed || mandateOwner === null) {
  check('mandate state could be read from chain', false, 'RPC read failed; state is unknown');
} else {
  const exists = BigInt(mandateOwner) !== 0n;
  check(
    expectCreated
      ? `mandate ${plan.mandateId} exists on chain`
      : `mandate ${plan.mandateId} is not already created on chain`,
    expectCreated ? exists : !exists,
    exists ? `owner ${mandateOwner}` : 'slot free',
  );
}

process.stdout.write(failures.length === 0
  ? '\nAll checks passed. The supplier keys you hold are the ones that will be committed.\n'
  : `\n${failures.length} CHECK(S) FAILED. Do not spend until resolved.\n`);
process.exitCode = failures.length === 0 ? 0 : 1;
