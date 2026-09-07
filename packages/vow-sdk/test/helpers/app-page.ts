import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';

export class Element {
  value = ''; textContent = ''; disabled = false; checked = false; hidden = false;
  readonly attributes = new Map<string, string>();
  readonly handlers = new Map<string, () => void>();
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(name: string, handler: () => void): void { this.handlers.set(name, handler); }
  fire(name: string): void { if (name !== 'click' || !this.disabled) this.handlers.get(name)?.(); }
}

export interface MountedPage {
  element(id: string): Element;
  readonly ids: readonly string[];
  set(id: string, value: string): void;
  click(id: string): void;
  settle(check: () => boolean): Promise<void>;
}

export async function mountPage(context: TestContext, page: 'owner' | 'operator'): Promise<MountedPage> {
  const html = await readFile(fileURLToPath(new URL(`../../../../scripts/app/${page}.html`, import.meta.url)), 'utf8');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!);
  const elements = new Map(ids.map((id) => {
    const element = new Element();
    const rendered = new RegExp(`\\sid="${id}"[^>]*>([^<]*)<`).exec(html);
    element.textContent = rendered ? rendered[1]!.trim() : '';
    return [id, element];
  }));
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true,
    value: { getElementById: (id: string) => elements.get(id) ?? null } });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  const element = (id: string): Element => {
    const found = elements.get(id);
    if (!found) throw new Error(`TEST_MISSING_ELEMENT_${id}`);
    return found;
  };
  return {
    element, ids,
    set(id, value) { element(id).value = value; element(id).fire('input'); },
    click(id) { element(id).fire('click'); },
    async settle(check) {
      for (let attempt = 0; attempt < 400 && !check(); attempt += 1) await new Promise((done) => setTimeout(done, 5));
      if (!check()) throw new Error('TEST_PAGE_NEVER_SETTLED');
    },
  };
}
