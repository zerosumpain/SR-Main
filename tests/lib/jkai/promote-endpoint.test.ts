import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/workflows/site-tools/registry', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    executeTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name !== 'promote_ephemeral_tool') throw new Error(`unexpected tool: ${name}`);
      if (!args.messageId) return { success: false, error: 'messageId is required' };
      return { success: true, data: { name: 'render_sleep_chart', toolset: 'visualise' } };
    }),
  };
});

describe('POST /api/jkai/tools/promote', () => {
  it('returns 200 and the promoted tool info on success', async () => {
    const { POST } = await import('../../../src/routes/api/jkai/tools/promote/+server');
    const req = new Request('http://localhost/api/jkai/tools/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'm1', toolCallId: 'step-1' }),
    });
    const res = await POST({ request: req } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('render_sleep_chart');
  }, 15_000);

  it('returns 400 when messageId is missing', async () => {
    const { POST } = await import('../../../src/routes/api/jkai/tools/promote/+server');
    const req = new Request('http://localhost/api/jkai/tools/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolCallId: 'step-1' }),
    });
    const res = await POST({ request: req } as never);
    expect(res.status).toBe(400);
  });
});
