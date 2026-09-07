export const VOW_VAULT_ENTRYPOINTS = Object.freeze({
  create_mandate: 'external',
  fund_mandate: 'external',
  reserve: 'external',
  expire_reservation: 'external',
  revoke_mandate: 'external',
  reclaim_available: 'external',
  privacy_invoke: 'external',
  mandate: 'view',
  reservation: 'view',
  mandate_available: 'view',
  permission_consumed: 'view',
  accounted_balance: 'view',
  pool: 'view',
  claim_digest: 'view',
} as const);

export interface VaultAbiAudit {
  readonly entrypoints: readonly string[];
  readonly genericDrain: false;
  readonly arbitraryExternalCall: false;
  readonly rootReplacement: false;
  readonly upgrade: false;
}

export function auditVaultAbi(input: unknown): VaultAbiAudit {
  const abi = parseAbi(input);
  const functions = abi.flatMap((entry) => {
    const record = object(entry);
    if (record.type === 'function') return [record];
    if (record.type !== 'interface' || !Array.isArray(record.items)) return [];
    return record.items.map(object).filter((item) => item.type === 'function');
  });
  const expected = Object.entries(VOW_VAULT_ENTRYPOINTS);
  if (functions.length !== expected.length) throw new Error('VOW_VAULT_ABI_CHANGED');
  const found = new Map<string, string>();
  for (const entry of functions) {
    if (typeof entry.name !== 'string' || typeof entry.state_mutability !== 'string' || found.has(entry.name)) throw new Error('VOW_VAULT_ABI_CHANGED');
    found.set(entry.name, entry.state_mutability);
  }
  for (const [name, mutability] of expected) if (found.get(name) !== mutability) throw new Error('VOW_VAULT_ABI_CHANGED');
  return Object.freeze({ entrypoints: Object.freeze([...found.keys()].sort()), genericDrain: false, arbitraryExternalCall: false,
    rootReplacement: false, upgrade: false });
}

function parseAbi(input: unknown): unknown[] {
  let value = input;
  if (typeof value === 'string') {
    if (value.length > 200_000) throw new Error('VOW_VAULT_ABI_CHANGED');
    try { value = JSON.parse(value); } catch { throw new Error('VOW_VAULT_ABI_CHANGED'); }
  }
  if (!Array.isArray(value) || value.length > 1024) throw new Error('VOW_VAULT_ABI_CHANGED');
  return value;
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('VOW_VAULT_ABI_CHANGED');
  return input as Record<string, unknown>;
}
