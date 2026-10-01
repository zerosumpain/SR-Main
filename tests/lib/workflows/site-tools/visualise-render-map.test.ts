import { describe, it, expect, beforeAll } from 'vitest';
import { getTool, executeTool } from '$lib/workflows/site-tools/registry';

beforeAll(async () => {
  await import('$lib/workflows/site-tools/tools/visualise');
});

describe('render_map', () => {
  it('is registered in the visualise toolset', () => {
    const t = getTool('render_map');
    expect(t).toBeDefined();
    expect(t!.toolset).toBe('visualise');
  });

  it('returns a map artifact with a summary describing layers', async () => {
    const res = await executeTool('render_map', {
      layers: [
        { kind: 'track', points: [{ lat: 51.5, lng: -0.1 }, { lat: 51.6, lng: -0.2 }] },
        { kind: 'points', points: [{ lat: 51.55, lng: -0.15, label: 'start' }] },
      ],
      caption: 'Today\'s run',
    });
    expect(res.success).toBe(true);
    const data = res.data as { artifact: { type: string; layers: unknown[] }; summary: string };
    expect(data.artifact.type).toBe('map');
    expect(data.artifact.layers).toHaveLength(2);
    expect(data.summary).toMatch(/1 track/);
    expect(data.summary).toMatch(/1 points layer|1 point/);
  });

  it('rejects empty layers', async () => {
    const res = await executeTool('render_map', { layers: [] });
    expect(res.success).toBe(false);
  });

  it('rejects a layer with no points', async () => {
    const res = await executeTool('render_map', {
      layers: [{ kind: 'points', points: [] }],
    });
    expect(res.success).toBe(false);
  });
});
