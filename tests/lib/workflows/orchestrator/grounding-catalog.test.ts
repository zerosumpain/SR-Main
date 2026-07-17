import { describe, it, expect, vi } from 'vitest';

// Mock only the registry — the real denylist (pure module) runs so we exercise
// actual denylist exclusion. buildSiteToolCatalog dynamic-imports both.
const { catalogTools } = vi.hoisted(() => ({ catalogTools: [] as any[] }));
vi.mock('$lib/workflows/site-tools/registry', () => ({
  getTools: () => catalogTools,
}));

import { buildSiteToolCatalog } from '$lib/workflows/orchestrator/grounding';

describe('buildSiteToolCatalog', () => {
  it('renders non-denylisted tools grouped by toolset with a destructive flag', async () => {
    catalogTools.length = 0;
    catalogTools.push(
      { name: 'save_memory', description: 'Save a fact about the user. Persists across sessions.', toolset: 'memory', destructive: false },
      { name: 'whatsapp_send', description: 'Send a WhatsApp message to a number.', toolset: 'whatsapp', destructive: true },
      { name: 'render_chart', description: 'Render a Vega-Lite chart inline.', toolset: 'visualise' },
      // denylisted — must be excluded:
      { name: 'workflow_delete', description: 'Delete a workflow forever.', toolset: 'workflows', destructive: true },
      { name: 'node_builder_write_files', description: 'Scaffold node files.', toolset: 'node-builder', destructive: true },
      { name: 'author_ephemeral_tool', description: 'Author a throwaway tool.', toolset: 'custom-tools' },
    );

    const out = await buildSiteToolCatalog();

    expect(out).toContain('## Site tools (via the `site-tool` node)');
    // Non-denylisted tools present.
    expect(out).toContain('`save_memory`');
    expect(out).toContain('`whatsapp_send`');
    expect(out).toContain('`render_chart`');
    // First sentence of the description shows.
    expect(out).toContain('Save a fact about the user.');
    // Destructive flag on the destructive one only.
    expect(out).toMatch(/`whatsapp_send`[^\n]*DESTRUCTIVE/);
    expect(out).not.toMatch(/`save_memory`[^\n]*DESTRUCTIVE/);
    // Grouped by toolset headers.
    expect(out).toContain('### memory');
    expect(out).toContain('### whatsapp');
    // Denylisted tools excluded.
    expect(out).not.toContain('workflow_delete');
    expect(out).not.toContain('node_builder_write_files');
    expect(out).not.toContain('author_ephemeral_tool');
    // Notes the destructive/approval rule once.
    expect(out).toContain('approval');
    // Stays compact.
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThan(6000);
  });

  it('returns empty string when there are no invocable tools', async () => {
    catalogTools.length = 0;
    catalogTools.push({ name: 'workflow_delete', description: 'x', toolset: 'workflows', destructive: true });
    expect(await buildSiteToolCatalog()).toBe('');
  });
});
