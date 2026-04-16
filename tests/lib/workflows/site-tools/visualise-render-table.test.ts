import { describe, it, expect, beforeAll } from 'vitest';
import { getTool, executeTool } from '$lib/workflows/site-tools/registry';

beforeAll(async () => {
  // Registry self-registers on import. Force-load visualise module.
  await import('$lib/workflows/site-tools/tools/visualise');
});

describe('render_table', () => {
  it('is registered in the visualise toolset', () => {
    const t = getTool('render_table');
    expect(t).toBeDefined();
    expect(t!.toolset).toBe('visualise');
  });

  it('returns a table artifact with a summary', async () => {
    const res = await executeTool('render_table', {
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'age',  label: 'Age', align: 'right' },
      ],
      rows: [
        { name: 'Alice', age: 30 },
        { name: 'Bob',   age: 25 },
      ],
      caption: 'People',
    });
    expect(res.success).toBe(true);
    const data = res.data as { artifact: { type: string; columns: unknown[]; rows: unknown[] }; summary: string };
    expect(data.artifact.type).toBe('table');
    expect(data.artifact.columns).toHaveLength(2);
    expect(data.artifact.rows).toHaveLength(2);
    expect(data.summary).toMatch(/2 rows/);
    expect(data.summary).toMatch(/name/i);
  });

  it('rejects rows that aren\'t objects', async () => {
    const res = await executeTool('render_table', {
      columns: [{ key: 'x', label: 'X' }],
      rows: [1, 2, 3] as unknown[],
    });
    expect(res.success).toBe(false);
  });
});
