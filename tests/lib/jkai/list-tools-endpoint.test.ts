import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => {
  return {
    db: {
      select: () => ({
        from: () => ({
          orderBy: async () => [
            { id: 'a', name: 'render_sleep_chart', description: 'sleep', toolset: 'visualise', enabled: true, runCount: 3, errorCount: 0, lastRunAt: null, createdAt: new Date('2026-04-16'), handlerCode: 'secret code', parameters: {} },
          ],
        }),
      }),
    },
  };
});

describe('GET /api/jkai/tools', () => {
  it('returns the list of persisted custom tools without leaking handlerCode', async () => {
    const { GET } = await import('../../../src/routes/api/jkai/tools/+server');
    const res = await GET({} as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools[0].name).toBe('render_sleep_chart');
    expect(body.tools[0].handlerCode).toBeUndefined();
  });
});
