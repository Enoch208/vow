import { address, bounded, felt, U128_MAX, U64_MAX } from './integers.ts';

export type PoolAction =
  | { readonly kind: 'write'; readonly storage: bigint; readonly values: bigint[] }
  | { readonly kind: 'append'; readonly recipient: bigint }
  | { readonly kind: 'transferFrom' | 'transferTo'; readonly recipient: bigint; readonly token: bigint; readonly amount: bigint }
  | { readonly kind: 'viewingKey' | 'withdrawal' | 'deposit' | 'encryptedNote' | 'noteUsed' }
  | { readonly kind: 'openNote'; readonly token: bigint; readonly note: bigint }
  | { readonly kind: 'invoke' | 'computation'; readonly target: bigint; readonly calldata: bigint[] };

class Cursor {
  private position = 0;
  private readonly data: readonly bigint[];
  constructor(data: readonly bigint[]) { this.data = data; }
  read(): bigint {
    const value = this.data[this.position++];
    if (value === undefined) throw new Error('VOW_TRUNCATED_CALLDATA');
    return value;
  }
  skip(count: number): void { for (let i = 0; i < count; i++) this.read(); }
  span(): bigint[] {
    const length = Number(bounded(this.read(), 4096n, 'SPAN_LENGTH'));
    return Array.from({ length }, () => this.read());
  }
  end(): void {
    if (this.position !== this.data.length) throw new Error('VOW_TRAILING_CALLDATA');
  }
}

export function decodePoolActions(input: unknown): readonly PoolAction[] {
  if (!Array.isArray(input) || input.length > 4096) throw new Error('VOW_INVALID_CALLDATA');
  const data = input.map((value: unknown) => {
    if (typeof value !== 'string' || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value) || value.length > 80) {
      throw new Error('VOW_INVALID_FELT');
    }
    return felt(BigInt(value), 'FELT');
  });
  const cursor = new Cursor(data);
  const count = Number(bounded(cursor.read(), 128n, 'ACTION_COUNT', 1n));
  const actions = Array.from({ length: count }, () => decodeAction(cursor));
  const screening = cursor.read();
  if (screening === 0n) {
    bounded(cursor.read(), U64_MAX, 'SCREENING_TIME');
    cursor.skip(2);
  } else if (screening !== 1n) throw new Error('VOW_INVALID_SCREENING');
  cursor.end();
  return actions;
}

function decodeAction(cursor: Cursor): PoolAction {
  switch (cursor.read()) {
    case 0n: return { kind: 'write', storage: cursor.read(), values: cursor.span() };
    case 1n: {
      const recipient = address(cursor.read(), 'RECIPIENT');
      cursor.skip(3);
      return { kind: 'append', recipient };
    }
    case 2n: return transfer(cursor, 'transferFrom');
    case 3n: return transfer(cursor, 'transferTo');
    case 4n: cursor.skip(5); return { kind: 'viewingKey' };
    case 5n: cursor.skip(6); return { kind: 'withdrawal' };
    case 6n: cursor.skip(3); return { kind: 'deposit' };
    case 7n: {
      cursor.skip(3);
      return { kind: 'openNote', token: address(cursor.read(), 'TOKEN'), note: felt(cursor.read(), 'NOTE', 1n) };
    }
    case 8n: cursor.skip(2); return { kind: 'encryptedNote' };
    case 9n: cursor.skip(1); return { kind: 'noteUsed' };
    case 10n: return { kind: 'invoke', target: address(cursor.read(), 'TARGET'), calldata: cursor.span() };
    case 11n: return { kind: 'computation', target: address(cursor.read(), 'TARGET'), calldata: cursor.span() };
    default: throw new Error('VOW_UNKNOWN_POOL_ACTION');
  }
}

function transfer(cursor: Cursor, kind: 'transferFrom' | 'transferTo'): PoolAction {
  return {
    kind, recipient: address(cursor.read(), 'RECIPIENT'), token: address(cursor.read(), 'TOKEN'),
    amount: bounded(cursor.read(), U128_MAX, 'AMOUNT', 1n),
  };
}
