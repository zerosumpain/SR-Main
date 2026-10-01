import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';

/**
 * The backlog intake lane: SR-Jkai-Core's trace page hands its findings to the
 * one intake here, rather than writing the backlog through its own old copy.
 */

const intakeIdeas = vi.fn(async (ideas: unknown[]) => ({ added: ['reduce-x'], merged: [], capped: 0, outcomes: ideas.map(() => 'added') }));
vi.mock('$lib/selfimprove/backlog', () => ({ intakeIdeas }));

const { POST } = await import('./+server');

const TOKEN = 'c'.repeat(48);
const mutableEnv = env as Record<string, string | undefined>;
const original = env.JKAI_INVOKE_TOKEN;

beforeEach(() => {
  mutableEnv.JKAI_INVOKE_TOKEN = TOKEN;
  intakeIdeas.mockClear();
});

afterAll(() => {
  if (original === undefined) delete mutableEnv.JKAI_INVOKE_TOKEN;
  else mutableEnv.JKAI_INVOKE_TOKEN = original;
});

const idea = { title: 'Reduce x calls per turn (repeat)', detail: 'Measured: 9 calls', kind: 'tool', priority: 1, source: 'trace' };

async function call(body: unknown, token: string | undefined = TOKEN) {
  const request = new Request('https://example.test/api/platform/backlog/intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  try {
    return await POST({ request } as Parameters<typeof POST>[0]);
  } catch (e) {
    return e as { status: number };
  }
}

describe('POST /api/platform/backlog/intake', () => {
  it('refuses a caller without the invoke token', async () => {
    expect((await call({ ideas: [idea] }, '')).status).toBe(401);
    expect(intakeIdeas).not.toHaveBeenCalled();
  });

  it('passes trace ideas to the one intake', async () => {
    const res = (await call({ ideas: [idea] })) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: ['reduce-x'], considered: 1 });
    expect(intakeIdeas).toHaveBeenCalledWith([idea]);
  });

  it('drops any source other than trace, so this lane cannot stand in for the engine', async () => {
    const res = await call({ ideas: [{ ...idea, source: 'owner' }, { ...idea, kind: 'engine' }] });
    expect((res as { status: number }).status).toBe(400);
    expect(intakeIdeas).not.toHaveBeenCalled();
  });

  it('caps the batch', async () => {
    const res = await call({ ideas: Array.from({ length: 21 }, () => idea) });
    expect((res as { status: number }).status).toBe(400);
  });
});
