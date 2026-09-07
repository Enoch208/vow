import { BACKUP_ITERATIONS, checkBackupPassword, deriveBackupKey, hexBytes, parseHexBytes } from './backup-crypto.ts';
import { felt } from './integers.ts';
import { PermissionSet } from './permission-set.ts';

const FORMAT = 'vow-permission-backup-v1';
const MINIMUM_CIPHERTEXT = 64;
const MAXIMUM_CIPHERTEXT = 32_768;

export interface PermissionSetBackup {
  readonly format: typeof FORMAT;
  readonly root: string;
  readonly iterations: typeof BACKUP_ITERATIONS;
  readonly salt: string;
  readonly iv: string;
  readonly ciphertext: string;
}

export async function createPermissionSetBackup(set: PermissionSet, password: string): Promise<PermissionSetBackup> {
  checkBackupPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const root = `0x${set.root.toString(16)}`;
  const encryptionKey = await deriveBackupKey(password, salt);
  const ciphertext = await set.encrypt((plaintext) => crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(root), tagLength: 128 }, encryptionKey, plaintext,
  ));
  return Object.freeze({
    format: FORMAT, root, iterations: BACKUP_ITERATIONS, salt: hexBytes(salt), iv: hexBytes(iv),
    ciphertext: hexBytes(new Uint8Array(ciphertext)),
  });
}

export function parsePermissionSetBackup(text: string): PermissionSetBackup {
  if (typeof text !== 'string' || text.length > 131_072) throw new Error('VOW_INVALID_BACKUP');
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new Error('VOW_INVALID_BACKUP'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('VOW_INVALID_BACKUP');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'ciphertext,format,iterations,iv,root,salt') throw new Error('VOW_INVALID_BACKUP');
  if (value.format !== FORMAT || value.iterations !== BACKUP_ITERATIONS || typeof value.root !== 'string'
    || !/^0x[1-9a-f][0-9a-f]{0,62}$/.test(value.root)) throw new Error('VOW_INVALID_BACKUP');
  felt(BigInt(value.root), 'ROOT', 1n);
  parseHexBytes(value.salt, 16, 16, 'VOW_INVALID_BACKUP');
  parseHexBytes(value.iv, 12, 12, 'VOW_INVALID_BACKUP');
  parseHexBytes(value.ciphertext, MINIMUM_CIPHERTEXT, MAXIMUM_CIPHERTEXT, 'VOW_INVALID_BACKUP');
  return Object.freeze({
    format: FORMAT, root: value.root, iterations: BACKUP_ITERATIONS, salt: value.salt as string,
    iv: value.iv as string, ciphertext: value.ciphertext as string,
  });
}

export async function unlockPermissionSetBackup(backup: PermissionSetBackup, password: string): Promise<PermissionSet> {
  checkBackupPassword(password);
  const checked = parsePermissionSetBackup(JSON.stringify(backup));
  let plaintext: Uint8Array | undefined;
  try {
    const encryptionKey = await deriveBackupKey(password, parseHexBytes(checked.salt, 16, 16, 'VOW_INVALID_BACKUP'));
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: parseHexBytes(checked.iv, 12, 12, 'VOW_INVALID_BACKUP'), additionalData: aad(checked.root), tagLength: 128 },
      encryptionKey, parseHexBytes(checked.ciphertext, MINIMUM_CIPHERTEXT, MAXIMUM_CIPHERTEXT, 'VOW_INVALID_BACKUP'),
    ));
    const set = PermissionSet.restore(plaintext);
    if (`0x${set.root.toString(16)}` !== checked.root) throw new Error();
    return set;
  } catch { throw new Error('VOW_BACKUP_UNLOCK_FAILED'); } finally { plaintext?.fill(0); }
}

function aad(root: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${FORMAT}|${BACKUP_ITERATIONS}|${root}`);
}
