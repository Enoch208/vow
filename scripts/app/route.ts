import { felt } from '../../packages/vow-sdk/src/integers.ts';

export type AppRoute = { readonly kind: 'claim'; readonly value: bigint }
  | { readonly kind: 'verify'; readonly value: bigint | null };

export function parseAppRoute(rawPathname: string): AppRoute {
  const pathname = rawPathname.length > 1 && rawPathname.endsWith('/')
    ? rawPathname.slice(0, -1)
    : rawPathname;
  const claim = /^\/claim\/(0x[0-9a-fA-F]+|[0-9]+)$/.exec(pathname);
  if (claim) return { kind: 'claim', value: felt(BigInt(claim[1]!), 'RESERVATION', 1n) };
  const verify = /^\/verify(?:\/(0x[0-9a-fA-F]+|[0-9]+))?$/.exec(pathname);
  if (verify) return { kind: 'verify', value: verify[1] ? felt(BigInt(verify[1]), 'TRANSACTION_HASH', 1n) : null };
  throw new Error('VOW_ROUTE_NOT_FOUND');
}
