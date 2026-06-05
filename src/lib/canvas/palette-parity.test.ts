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
});
