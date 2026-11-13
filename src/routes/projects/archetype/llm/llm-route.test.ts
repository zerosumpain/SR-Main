import { describe, expect, it, vi } from 'vitest';

// The Archetype adviser relay: an upstream failure reaches the visitor as a
// fixed sentence, never the provider's own error text; and its per-visitor
// ceiling keys on the edge address, not the shared loopback socket.
vi.mock('$lib/projects/guard', () => ({ requireProjectPublic: async () => {} }));
vi.mock('$lib/context/activity', () => ({ withActivity: (_: string, run: () => unknown) => run() }));
vi.mock('$lib/server/models/workload-settings', () => ({ resolveProjectChatModel: async () => 'm' }));
vi.mock('$lib/llm/client', () => ({
  getLLMClient: async () => ({
    model: 'm',
    client: { chat: { completions: { create: async () => { throw new Error('401 key sk-or-internal-detail for route X'); } } } },
  }),
}));

const { POST } = await import('./+server');

type Outcome = { status: number; body?: { message?: string } };

/** The handler's Response, or the HttpError it threw — both carry a status. */
async function call(edgeIp: string): Promise<Outcome> {
  const request = new Request('https://site.test/projects/archetype/llm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': edgeIp },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'rank these' }] }),
  });
  try {
    return (await POST({ request, getClientAddress: () => '127.0.0.1' } as never)) as Outcome;
  } catch (e) {
    return e as Outcome;
  }
}

describe('archetype adviser relay', () => {
  it('does not echo the upstream error to the visitor', async () => {
    const failure = await call('203.0.113.20');
    expect(failure.status).toBe(502);
    expect(failure.body?.message).toBe('The adviser could not be reached. Try again in a moment.');
    expect(JSON.stringify(failure.body)).not.toContain('sk-or');
  });

  it('gives each visitor their own ceiling behind the tunnel', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) statuses.push((await call('203.0.113.30')).status);
    expect(statuses.slice(0, 8).every((s) => s === 502)).toBe(true);
    expect(statuses[8]).toBe(429);
    expect((await call('203.0.113.31')).status).toBe(502);
  });
});
