import { describe, it, expect } from 'vitest';
import { getToolsetManifest } from '$lib/workflows/site-tools/registry';

describe('visualise toolset', () => {
  it('appears in the manifest with a description and 5 tools', () => {
    const m = getToolsetManifest();
    const v = m.find((t) => t.toolset === 'visualise');
    expect(v).toBeDefined();
    expect(v!.description).toMatch(/chart|map|table/i);
    const names = v!.tools.map((t) => t.name).sort();
    expect(names).toEqual(['author_ephemeral_tool', 'promote_ephemeral_tool', 'render_chart', 'render_map', 'render_table']);
  });
});
