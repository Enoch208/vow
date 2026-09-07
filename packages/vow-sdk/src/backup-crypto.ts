export const BACKUP_ITERATIONS = 600_000;

export function checkBackupPassword(password: string): void {
  if (typeof password !== 'string' || password.length < 16 || password.length > 1024) {
    throw new Error('VOW_BACKUP_PASSWORD_LENGTH');
  }
}

export async function deriveBackupKey(
  password: string, salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const bytes = new TextEncoder().encode(password);
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: BACKUP_ITERATIONS, hash: 'SHA-256' }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
  } finally { bytes.fill(0); }
}

export function hexBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function parseHexBytes(
  value: unknown, minimum: number, maximum: number, code: string,
): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length < minimum * 2 || value.length > maximum * 2
    || value.length % 2 !== 0 || !/^[0-9a-f]+$/.test(value)) throw new Error(code);
  return Uint8Array.from(value.match(/../g)!, (byte) => parseInt(byte, 16));
}
