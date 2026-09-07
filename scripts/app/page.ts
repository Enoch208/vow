import type { VaultMandate } from '../../packages/vow-sdk/src/reservation-reader.ts';
import { mandateAvailable } from '../../packages/vow-sdk/src/reservation-reader.ts';
import type { WriteOutcome } from './write-flow.ts';

export const LEDGER_TOTALS = ['funded', 'available', 'reserved', 'paid', 'reclaimed'] as const;

interface PageElement {
  value: string;
  textContent: string;
  disabled: boolean;
  checked: boolean;
  hidden: boolean;
  setAttribute(name: string, value: string): void;
  addEventListener(name: string, handler: () => void): void;
}

export function element(id: string): PageElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`VOW_MISSING_ELEMENT_${id}`);
  return found as unknown as PageElement;
}

export function json(value: unknown): string {
  return JSON.stringify(value, (_, item: unknown) => typeof item === 'bigint' ? `0x${item.toString(16)}` : item, 2);
}

export function ledger(mandate: VaultMandate | undefined): void {
  for (const total of LEDGER_TOTALS) {
    element(`ledger-${total}`).textContent = mandate === undefined ? 'unread'
      : (total === 'available' ? mandateAvailable(mandate) : mandate[total]).toString();
  }
}

export function renderWrite(outcome: WriteOutcome): void {
  const state = element('write-state');
  state.textContent = outcome.state;
  state.setAttribute('data-state', outcome.state);
  element('write-detail').textContent = outcome.detail;
  element('write-hash').textContent = outcome.transactionHash ?? 'No transaction hash for this attempt.';
}
