import { felt } from './integers.ts';

export function receiptRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VOW_INVALID_RECEIPT_DATA');
  return value as Record<string, unknown>;
}

export function receiptFelt(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error('VOW_INVALID_RECEIPT_DATA');
  return felt(BigInt(value), 'RECEIPT_DATA');
}

export function receiptFelts(value: unknown, maximum: number): bigint[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('VOW_INVALID_RECEIPT_DATA');
  return value.map(receiptFelt);
}

export function equalFelts(actual: readonly bigint[], expected: readonly bigint[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
