export function publicInteger(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 80 || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) throw new Error('VOW_INVALID_PUBLIC_INTEGER');
  return BigInt(value);
}

export function json(value: unknown): string { return JSON.stringify(value, (_, item: unknown) => typeof item === 'bigint' ? hex(item) : item, 2); }
export function hex(value: bigint): string { return `0x${value.toString(16)}`; }
