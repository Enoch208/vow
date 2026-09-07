import { parseCollectionBudgetManifest } from '../../packages/vow-sdk/src/collection-budget.ts';
import type { CollectionBudgetReview } from '../../packages/vow-sdk/src/collection-budget.ts';
import type { ProbeConfiguration } from '../../packages/vow-sdk/src/probe-snapshot.ts';

export function createCollectionBudgetGate(transport: typeof fetch = fetch, now = () => Math.floor(Date.now() / 1000)) {
  let manifest: string | null = null;
  let revision = 0;
  const allows = (configuration: ProbeConfiguration, review: CollectionBudgetReview): boolean => {
    if (manifest === null) return false;
    try { parseCollectionBudgetManifest(manifest, configuration, review, now()); return true; }
    catch { return false; }
  };
  return {
    allows,
    clear(): void { revision++; manifest = null; },
    async load(configuration: ProbeConfiguration, review: CollectionBudgetReview): Promise<void> {
      const current = ++revision; manifest = null;
      try {
        const response = await transport('/collection/budget.json', { method: 'GET', cache: 'no-store', credentials: 'omit',
          redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10_000) });
        if (!response.ok || response.redirected || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') return;
        const declaredSize = response.headers.get('content-length');
        if (declaredSize !== null && (!/^[0-9]+$/.test(declaredSize) || Number(declaredSize) > 16_384)) return;
        const text = await boundedBody(response);
        if (current !== revision) return;
        parseCollectionBudgetManifest(text, configuration, review, now());
        manifest = text;
      } catch { if (current === revision) manifest = null; }
    },
  };
}

async function boundedBody(response: Response): Promise<string> {
  if (!response.body) throw new Error('VOW_MISSING_BUDGET_BODY');
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0; let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 16_384) { await reader.cancel(); throw new Error('VOW_OVERSIZED_BUDGET_BODY'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
