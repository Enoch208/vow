import { BACKUP_ITERATIONS, checkBackupPassword, deriveBackupKey, hexBytes, parseHexBytes } from './backup-crypto.ts';
import { SupplierKey } from './supplier-key.ts';

const FORMAT = 'vow-supplier-key-v1';
const ITERATIONS = BACKUP_ITERATIONS;
export interface SupplierBackup {
  readonly format: typeof FORMAT;
  readonly publicKey: string;
  readonly iterations: typeof ITERATIONS;
  readonly salt: string;
  readonly iv: string;
  readonly ciphertext: string;
}

export async function createSupplierBackup(key: SupplierKey, password: string): Promise<SupplierBackup> {
  checkBackupPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const publicKey = `0x${key.publicKey.toString(16)}`;
  const encryptionKey = await deriveBackupKey(password, salt);
  const ciphertext = await key.encrypt((bytes) => crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(publicKey), tagLength: 128 }, encryptionKey, new Uint8Array(bytes)));
  return Object.freeze({ format: FORMAT, publicKey, iterations: ITERATIONS, salt: hexBytes(salt), iv: hexBytes(iv), ciphertext: hexBytes(new Uint8Array(ciphertext)) });
}

export function parseSupplierBackup(text: string): SupplierBackup {
  if (text.length > 2048) throw new Error('VOW_INVALID_BACKUP');
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new Error('VOW_INVALID_BACKUP'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('VOW_INVALID_BACKUP');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'ciphertext,format,iterations,iv,publicKey,salt') throw new Error('VOW_INVALID_BACKUP');
  if (value.format !== FORMAT || value.iterations !== ITERATIONS || typeof value.publicKey !== 'string' || !/^0x[1-9a-f][0-9a-f]{0,62}$/.test(value.publicKey)) throw new Error('VOW_INVALID_BACKUP');
  parseHexBytes(value.salt, 16, 16, 'VOW_INVALID_BACKUP'); parseHexBytes(value.iv, 12, 12, 'VOW_INVALID_BACKUP'); parseHexBytes(value.ciphertext, 48, 48, 'VOW_INVALID_BACKUP');
  return Object.freeze({ format: FORMAT, publicKey: value.publicKey, iterations: ITERATIONS, salt: value.salt as string, iv: value.iv as string, ciphertext: value.ciphertext as string });
}

export async function unlockSupplierBackup(backup: SupplierBackup, password: string): Promise<SupplierKey> {
  checkBackupPassword(password);
  const checked = parseSupplierBackup(JSON.stringify(backup));
  let plaintext: Uint8Array | undefined;
  let key: SupplierKey | undefined;
  try {
    const encryptionKey = await deriveBackupKey(password, parseHexBytes(checked.salt, 16, 16, 'VOW_INVALID_BACKUP'));
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: parseHexBytes(checked.iv, 12, 12, 'VOW_INVALID_BACKUP'), additionalData: aad(checked.publicKey), tagLength: 128 }, encryptionKey, parseHexBytes(checked.ciphertext, 48, 48, 'VOW_INVALID_BACKUP')));
    key = SupplierKey.restore(plaintext);
    if (`0x${key.publicKey.toString(16)}` !== checked.publicKey) throw new Error();
    return key;
  } catch {
    key?.lock(); throw new Error('VOW_BACKUP_UNLOCK_FAILED');
  } finally { plaintext?.fill(0); }
}

function aad(publicKey: string): Uint8Array<ArrayBuffer> { return new TextEncoder().encode(`${FORMAT}|${ITERATIONS}|${publicKey}`); }
