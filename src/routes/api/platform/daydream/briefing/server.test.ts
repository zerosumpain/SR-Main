import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';

/**
 * The briefing endpoint: SR-Workflows' morning briefing reads yesterday's
 * daydream section from here instead of from its own stale copy of the engine.
 */

const briefing = { day: '2026-09-30', facts: [], text: '', status: 'empty', counts: { sent: 0, held: 0, memoriesLearned: 0, wants: 0 } };
vi.mock('$lib/daydream/briefing', () => ({ buildDaydreamBriefing: vi.fn(async () => briefing) }));

const { GET } = await import('./+server');

const TOKEN = 'c'.repeat(48);
const mutableEnv = env as Record<string, string | undefined>;
const original = env.JKAI_INVOKE_TOKEN;

beforeEach(() => {
  mutableEnv.JKAI_INVOKE_TOKEN = TOKEN;
});

afterAll(() => {
  if (original === undefined) delete mutableEnv.JKAI_INVOKE_TOKEN;
  else mutableEnv.JKAI_INVOKE_TOKEN = original;
});

async function call(token?: string) {
  const request = new Request('https://example.test/api/platform/daydream/briefing', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  try {
    return await GET({ request } as Parameters<typeof GET>[0]);
  } catch (e) {
    return e as { status: number };
  }
}

describe('GET /api/platform/daydream/briefing', () => {
  it('refuses a caller without the invoke token', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('x'.repeat(48))).status).toBe(401);
  });

  it("returns Main's briefing to the token holder", async () => {
    const res = (await call(TOKEN)) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(briefing);
  });
});
