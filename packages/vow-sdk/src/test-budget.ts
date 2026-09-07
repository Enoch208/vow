import { parseAmount, U128_MAX, bounded } from './integers.ts';

export const TEST_COSTS = ['accountActivation', 'classDeclaration', 'probeDeployment', 'funding', 'privacyRegistration', 'collection', 'protocolFee', 'recoveryReserve'] as const;
export type TestCost = typeof TEST_COSTS[number];
export interface TestBudget {
  readonly maximumUSDCents: bigint;
  readonly principalSTRK: bigint | null;
  readonly feeCapsSTRK: Readonly<Record<TestCost, bigint | null>>;
  readonly quote: { readonly pair: 'STRK/USD'; readonly usdPerSTRK: string; readonly observedAt: number } | null;
}
export type TestBudgetReport =
  | { readonly status: 'needs-estimates'; readonly missing: readonly string[] }
  | { readonly status: 'within-quoted-cap' | 'over-quoted-cap'; readonly totalSTRK: bigint; readonly maximumSTRKAtQuote: bigint; readonly estimatedUSDCentsRoundedUp: bigint };

export function assessTestBudget(budget: TestBudget, now: number): TestBudgetReport {
  bounded(budget.maximumUSDCents, 1_000_000n, 'USD_CAP', 1n);
  if (budget.principalSTRK !== null) bounded(budget.principalSTRK, U128_MAX, 'PRINCIPAL');
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('VOW_INVALID_BUDGET_TIME');
  const missing: string[] = [];
  if (budget.principalSTRK === null) missing.push('testPrincipal');
  let totalSTRK = budget.principalSTRK ?? 0n;
  for (const component of TEST_COSTS) {
    const value = budget.feeCapsSTRK[component];
    if (value === null || value === undefined) missing.push(component);
    else totalSTRK += bounded(value, U128_MAX, 'FEE_CAP');
  }
  const quote = budget.quote;
  if (!quote) missing.push('STRK/USD quote');
  else if (quote.pair !== 'STRK/USD' || !Number.isSafeInteger(quote.observedAt) || quote.observedAt > now || now - quote.observedAt > 300) throw new Error('VOW_INVALID_OR_STALE_QUOTE');
  if (missing.length || !quote) return { status: 'needs-estimates', missing };
  const price = parseAmount(quote.usdPerSTRK, 8);
  if (price === 0n) throw new Error('VOW_INVALID_QUOTE_PRICE');
  const scale = 10n ** 18n;
  const maximumSTRKAtQuote = budget.maximumUSDCents * 1_000_000n * scale / price;
  const numerator = totalSTRK * price;
  const denominator = scale * 1_000_000n;
  const estimatedUSDCentsRoundedUp = (numerator + denominator - 1n) / denominator;
  return { status: totalSTRK <= maximumSTRKAtQuote ? 'within-quoted-cap' : 'over-quoted-cap', totalSTRK, maximumSTRKAtQuote, estimatedUSDCentsRoundedUp };
}
