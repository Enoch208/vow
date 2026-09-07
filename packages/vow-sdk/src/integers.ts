export const FELT_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
export const ADDRESS_BOUND = (1n << 251n) - 256n;
export const U128_MAX = (1n << 128n) - 1n;
export const U64_MAX = (1n << 64n) - 1n;

export function bounded(value: bigint, maximum: bigint, name: string, minimum = 0n): bigint {
  if (typeof value !== 'bigint' || value < minimum || value > maximum) {
    throw new RangeError(`VOW_INVALID_${name}`);
  }
  return value;
}

export function felt(value: bigint, name: string, minimum = 0n): bigint {
  return bounded(value, FELT_PRIME - 1n, name, minimum);
}

export function address(value: bigint, name: string): bigint {
  return bounded(value, ADDRESS_BOUND - 1n, name, 1n);
}

export function parseAmount(input: string, decimals: number): bigint {
  validateDecimals(decimals);
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(input) || input.length > 296) {
    throw new Error('VOW_INVALID_AMOUNT');
  }
  const [whole, fraction = ''] = input.split('.');
  if (fraction.length > decimals) throw new Error('VOW_EXCESS_PRECISION');
  return bounded(BigInt(whole! + fraction.padEnd(decimals, '0')), U128_MAX, 'AMOUNT');
}

export function formatAmount(value: bigint, decimals: number): string {
  validateDecimals(decimals);
  bounded(value, U128_MAX, 'AMOUNT');
  if (decimals === 0) return value.toString();
  const digits = value.toString().padStart(decimals + 1, '0');
  const fraction = digits.slice(-decimals).replace(/0+$/, '');
  return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : '');
}

function validateDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError('VOW_INVALID_DECIMALS');
  }
}

export function parsePublicInteger(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 80 || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) throw new Error('VOW_INVALID_PUBLIC_INTEGER');
  return felt(BigInt(value), 'PUBLIC_INTEGER');
}
