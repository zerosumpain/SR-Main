import { describe, it, expect, beforeAll } from 'vitest';
import { getTool, executeTool } from '$lib/workflows/site-tools/registry';

beforeAll(async () => {
  await import('$lib/workflows/site-tools/tools/visualise');
});

describe('render_chart', () => {
  it('is registered in the visualise toolset', () => {
    const t = getTool('render_chart');
    expect(t).toBeDefined();
    expect(t!.toolset).toBe('visualise');
  });

  it('returns a chart artifact with a summary derived from the spec', async () => {
    const res = await executeTool('render_chart', {
      spec: {
        mark: 'line',
        encoding: {
          x: { field: 'date', type: 'temporal' },
          y: { field: 'hours', type: 'quantitative', title: 'Sleep (hrs)' },
        },
      },
      data: [
        { date: '2026-04-10', hours: 7.2 },
        { date: '2026-04-11', hours: 6.4 },
        { date: '2026-04-12', hours: 8.1 },
      ],
      caption: 'Sleep last 3 nights',
    });
    expect(res.success).toBe(true);
    const data = res.data as { artifact: { type: string; spec: Record<string, unknown>; data: unknown[] }; summary: string };
    expect(data.artifact.type).toBe('chart');
    expect(data.artifact.data).toHaveLength(3);
    expect(data.summary).toMatch(/line/i);
    expect(data.summary).toMatch(/3 (points|data)/i);
    expect(data.summary).toMatch(/6\.4|8\.1/); // min or max surfaced
  });

  it('rejects a non-object spec', async () => {
    const res = await executeTool('render_chart', { spec: 'not a spec', data: [] });
    expect(res.success).toBe(false);
  });

  it('allows data to be embedded in spec.data.values instead of a separate `data` arg', async () => {
    const res = await executeTool('render_chart', {
      spec: {
        mark: 'bar',
        data: { values: [{ a: 1 }, { a: 2 }] },
        encoding: { y: { field: 'a', type: 'quantitative' } },
      },
      data: [],
    });
    expect(res.success).toBe(true);
  });
});
