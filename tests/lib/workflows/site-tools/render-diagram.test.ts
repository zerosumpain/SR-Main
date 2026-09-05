import { describe, it, expect } from 'vitest';
import { getTools } from '$lib/workflows/site-tools/registry';

/**
 * `render_diagram` hands a model's Mermaid source straight to the renderer, so
 * the handler's whole job is to reject what mermaid would only fail on later —
 * and to forgive the one mistake models reliably make (fencing the source).
 */
function diagramTool() {
  const tool = getTools().find((t) => t.name === 'render_diagram');
  if (!tool) throw new Error('render_diagram is not registered');
  return tool;
}

const run = (args: Record<string, unknown>) =>
  diagramTool().handler(args, {} as never) as Promise<{
    success: boolean;
    error?: string;
    data?: { artifact: { type: string; code: string }; summary: string };
  }>;

describe('render_diagram', () => {
  it('is registered in the visualise toolset', () => {
    expect(diagramTool().toolset).toBe('visualise');
  });

  it('returns a diagram artifact for valid source', async () => {
    const r = await run({ code: 'flowchart TD\n  A[Start] --> B[End]', caption: 'The flow' });
    expect(r.success).toBe(true);
    expect(r.data?.artifact.type).toBe('diagram');
    expect(r.data?.artifact.code).toBe('flowchart TD\n  A[Start] --> B[End]');
    expect(r.data?.summary).toContain('flowchart');
  });

  it('strips a markdown fence rather than failing over punctuation', async () => {
    const r = await run({ code: '```mermaid\nsequenceDiagram\n  A->>B: hi\n```' });
    expect(r.success).toBe(true);
    expect(r.data?.artifact.code).toBe('sequenceDiagram\n  A->>B: hi');
  });

  it("accepts `graph`, flowchart's older spelling", async () => {
    const r = await run({ code: 'graph LR\n  A --> B' });
    expect(r.success).toBe(true);
  });

  it('rejects prose that is not a diagram at all', async () => {
    const r = await run({ code: 'Here is a diagram of the system' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Mermaid diagram header');
  });

  it('rejects an empty or fence-only source', async () => {
    expect((await run({ code: '   ' })).success).toBe(false);
    expect((await run({ code: '```mermaid\n```' })).success).toBe(false);
  });
});
