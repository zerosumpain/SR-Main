import { describe, it, expect } from 'vitest';
import { allTypes } from '$lib/canvas/adapter';
import { getDefinition } from '$lib/workflows/registry-client';
import { categoryId, categoryOfType, nodeTypeCatalogue } from '$lib/workflows/native/catalogue';

describe('native node-types catalogue', () => {
  const categories = nodeTypeCatalogue();
  const types = categories.flatMap((c) => c.types.map((t) => t.type));

  it('offers what the canvas palette offers, minus what a phone cannot place', () => {
    expect(types.length).toBeGreaterThan(20);
    for (const excluded of ['postit', 'annotation', 'trigger', 'stats-summary', 'stats-trends', 'run-timeline']) {
      expect(types, excluded).not.toContain(excluded);
    }
    const deskOnly = allTypes().filter((t) => t.deskOnly).map((t) => t.type);
    for (const t of deskOnly) expect(types).not.toContain(t);
    for (const t of types) expect(getDefinition(t)?.hidden ?? false, t).toBe(false);
    for (const t of ['llm-call', 'whatsapp', 'http-request']) expect(types).toContain(t);
  });

  it('lists every type once, with a form and a default config', () => {
    expect(new Set(types).size).toBe(types.length);
    for (const c of categories) {
      expect(c.id).toBe(categoryId(c.label));
      expect(c.label).not.toBe('Annotations');
      for (const t of c.types) {
        expect(t.form.length, t.type).toBeGreaterThan(0);
        expect(typeof t.defaultConfig).toBe('object');
      }
    }
  });

  it('files a step under the same category id the catalogue uses', () => {
    expect(categoryId('Trigger & Flow')).toBe('trigger-flow');
    expect(categoryId('LLM & AI')).toBe('llm-ai');
    const llm = categories.find((c) => c.types.some((t) => t.type === 'llm-call'));
    expect(categoryOfType('llm-call')).toBe(llm?.id);
  });
});
