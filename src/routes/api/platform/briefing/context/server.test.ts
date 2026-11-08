import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';

/**
 * The briefing context endpoint: SR-Workflows reads today's trip and the
 * family summary from here, since its role cannot read Main's tables.
 * Every fixture is synthetic.
 */

const context = {
  generatedAt: '2026-10-27T06:00:00.000Z',
  trip: null,
  nextTrip: null,
  family: { members: ['Ann'], messagesOvernight: 0, lastFrom: [], latestText: null, tasksOpen: [] },
};
const build = vi.fn(async (_now: Date, _tz?: string | null) => context);
vi.mock('$lib/briefing/context.server', () => ({ buildBriefingContext: build }));

const { GET } = await import('./+server');

const TOKEN = 'c'.repeat(48);
const mutableEnv = env as Record<string, string | undefined>;
const original = env.JKAI_INVOKE_TOKEN;

beforeEach(() => {
  mutableEnv.JKAI_INVOKE_TOKEN = TOKEN;
  build.mockClear();
});

afterAll(() => {
  if (original === undefined) delete mutableEnv.JKAI_INVOKE_TOKEN;
  else mutableEnv.JKAI_INVOKE_TOKEN = original;
});

async function call(token?: string, query = '') {
  const url = new URL(`https://example.test/api/platform/briefing/context${query}`);
  const request = new Request(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  try {
    return await GET({ request, url } as Parameters<typeof GET>[0]);
  } catch (e) {
    return e as { status: number };
  }
}

describe('GET /api/platform/briefing/context', () => {
  it('refuses a caller without the invoke token', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('x'.repeat(48))).status).toBe(401);
    expect(build).not.toHaveBeenCalled();
  });

  it('returns the context to the token holder, passing the zone through', async () => {
    const res = (await call(TOKEN, '?tz=Europe/Rome')) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(context);
    expect(build.mock.calls[0][1]).toBe('Europe/Rome');
  });

  it('asks for the default zone when none is given', async () => {
    await call(TOKEN);
    expect(build.mock.calls[0][1]).toBeNull();
  });
});
