import { describe, it, expect } from 'vitest';
import { getToolsetManifest } from '$lib/workflows/site-tools/registry';

describe('visualise toolset', () => {
  it('appears in the manifest with a description and its five tools', () => {
    const m = getToolsetManifest();
    const v = m.find((t) => t.toolset === 'visualise');
    expect(v).toBeDefined();
    expect(v!.description).toMatch(/chart|map|table|diagram/i);
    const names = v!.tools.map((t) => t.name).sort();
    // author_ephemeral_tool / promote_ephemeral_tool moved to the 'custom-tools' toolset.
    expect(names).toEqual([
      'geocode_place',
      'render_chart',
      'render_diagram',
      'render_map',
      'render_table',
    ]);
  });
});
