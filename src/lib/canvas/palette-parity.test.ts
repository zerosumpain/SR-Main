import { describe, it, expect } from 'vitest';
import { byType } from './adapter';
import { nodeDefinitions } from '$lib/workflows/registry-client';
import { isDisplayOnlyType } from '$lib/workflows/types';

// `switch` is intentionally excluded from the palette until the canvas renders
// its per-config (switchHandles) output ports — mirror adapter.ts's skip set.
const DYNAMIC_HANDLE_SKIP = new Set(['switch']);

describe('canvas palette ↔ registry parity', () => {
  it('every registered, user-addable node has a palette entry (no silent drift)', () => {
    const missing = nodeDefinitions
      .filter((d) => !d.hidden && !isDisplayOnlyType(d.type) && !DYNAMIC_HANDLE_SKIP.has(d.type))
      .map((d) => d.type)
      .filter((t) => !byType(t));
    expect(missing).toEqual([]);
  });

  it('previously-unreachable nodes are now in the palette and wireable', () => {
    for (const t of ['apple-calendar', 'approval']) {
      const entry = byType(t);
      expect(entry, `missing palette entry for ${t}`).toBeTruthy();
      // A node with no handles cannot be wired on the canvas.
      expect(entry!.handles.inputs.length + entry!.handles.outputs.length).toBeGreaterThan(0);
    }
  });

  // E4: the RAG + research capability nodes must sit together in one coherent
  // "Intelligence" group so the builder can find them, with a positive default
  // weight so they surface in ranked suggestions rather than sinking to zero.
  it('groups the intelligence/RAG nodes under "Intelligence" with a sensible weight', () => {
    for (const t of ['file-search', 'research-search', 'deep-research', 'research-result']) {
      const entry = byType(t);
      expect(entry, `missing palette entry for ${t}`).toBeTruthy();
      expect(entry!.group, `${t} should be in the Intelligence group`).toBe('Intelligence');
      expect(entry!.defaultWeight ?? 0, `${t} should have a positive default weight`).toBeGreaterThan(0);
    }
  });

  it('exposes the webpage node for the research desk palette (E4 parity)', () => {
    const entry = byType('webpage');
    expect(entry).toBeTruthy();
    // The desk renders the same webpage kind; it must not be marked deskOnly
    // (which would hide it from the workflow canvas), and it must be wireable.
    expect(entry!.kind).toBe('webpage');
    expect(entry!.handles.inputs.length + entry!.handles.outputs.length).toBeGreaterThan(0);
  });
});
