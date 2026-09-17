import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';

/**
 * The three calls chat makes to intel on the server, tested as ONE lane.
 *
 * Together rather than one file per route on purpose: they share a credential
 * and a failure contract, and the way that goes wrong is one of them drifting —
 * an endpoint that forgets the owner-session fallback, or turns a non-fatal
 * extraction into a 500. Asserting them side by side is what notices.
 */

vi.mock('$lib/jkai/intel/context', () => ({
  buildKnowledgeContext: vi.fn(async (msg: string) => `knowledge:${msg}`),
  buildEntityGrounding: vi.fn(async (ids: string[]) => `grounding:${ids.join(',')}`),
}));
let extractThrows = false;
vi.mock('$lib/jkai/intel/chat-extract', () => ({
  maybeExtractThreadConcepts: vi.fn(async (id: string) => {
    if (extractThrows) throw new Error('the graph was unreachable');
    return { entityCount: 3, conversationId: id };
  }),
}));
vi.mock('$lib/jkai/intel/daily-alerts.server', () => ({
  loadDailyAlerts: vi.fn(async () => ({
    status: 'failed',
    since: 'a',
    asOf: 'b',
    total: 0,
    high: 0,
    items: [],
  })),
}));

const { POST: chatContext } = await import('./chat-context/+server');
const { POST: extractThread } = await import('./extract-thread/+server');
const { GET: dailyAlerts } = await import('./daily-alerts/+server');

const TOKEN = 'i'.repeat(48);
const mutableEnv = env as Record<string, string | undefined>;
const original = env.JKAI_INVOKE_TOKEN;

beforeEach(() => {
  extractThrows = false;
  mutableEnv.JKAI_INVOKE_TOKEN = TOKEN;
});
afterAll(() => {
  if (original === undefined) delete mutableEnv.JKAI_INVOKE_TOKEN;
  else mutableEnv.JKAI_INVOKE_TOKEN = original;
});

type Caller = 'token' | 'owner' | 'nobody';
function event(body: unknown, who: Caller, method = 'POST') {
  return {
    request: new Request('https://example.test/api/jkai/intel/x', {
      method,
      headers: who === 'token' ? { authorization: `Bearer ${TOKEN}` } : {},
      body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
    }),
    locals: { auth: async () => (who === 'owner' ? { user: { email: 'o@x' }, expires: '' } : null) },
  } as never;
}

async function call(handler: (e: never) => unknown, body: unknown, who: Caller, method = 'POST') {
  try {
    const res = (await handler(event(body, who, method))) as Response;
    return { status: res.status, body: await res.json() };
  } catch (e) {
    const http = e as { status?: number };
    if (!http.status) throw e;
    return { status: http.status, body: null };
  }
}

describe('POST /api/jkai/intel/chat-context', () => {
  it('serves both reads in one call', async () => {
    const { status, body } = await call(chatContext, { userMessage: 'hi', entityIds: ['e1', 'e2'] }, 'token');
    expect(status).toBe(200);
    expect(body).toEqual({ knowledge: 'knowledge:hi', grounding: 'grounding:e1,e2' });
  });

  // The two are independent: a turn with no entity mentions asks for knowledge
  // alone, which is what the in-process caller already does with an empty list.
  it('answers each half on its own', async () => {
    expect((await call(chatContext, { userMessage: 'hi' }, 'token')).body).toEqual({
      knowledge: 'knowledge:hi',
      grounding: '',
    });
    expect((await call(chatContext, { entityIds: ['e1'] }, 'token')).body).toEqual({
      knowledge: '',
      grounding: 'grounding:e1',
    });
  });

  it('filters non-strings out of entityIds rather than trusting the array', async () => {
    const { body } = await call(chatContext, { entityIds: ['e1', 7, null, 'e2'] }, 'token');
    expect(body.grounding).toBe('grounding:e1,e2');
  });
});

describe('POST /api/jkai/intel/extract-thread', () => {
  it('accepts and reports the outcome', async () => {
    const { status, body } = await call(extractThread, { conversationId: 'c1' }, 'token');
    expect(status).toBe(202);
    expect(body).toEqual({ ok: true, outcome: { entityCount: 3, conversationId: 'c1' } });
  });

  /**
   * The property that has to survive the boundary. In-process the chat endpoint
   * calls this as `void maybeExtractThreadConcepts(...).catch(() => {})` — a
   * turn must not fail because the extraction did. A 500 here would be a
   * transport error the caller has to decide about; 202 with `ok: false` is the
   * same contract one hop further away.
   */
  it('reports a failed extraction without failing the request', async () => {
    extractThrows = true;
    const { status, body } = await call(extractThread, { conversationId: 'c1' }, 'token');
    expect(status).toBe(202);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/unreachable/);
  });

  it('400s without a conversation id', async () => {
    expect((await call(extractThread, {}, 'token')).status).toBe(400);
    expect((await call(extractThread, { conversationId: '' }, 'token')).status).toBe(400);
  });
});

describe('GET /api/jkai/intel/daily-alerts', () => {
  /**
   * `loadDailyAlerts` answers `{status:'failed'}` rather than throwing, so the
   * landing page can say so instead of losing the panel. Across the wire that
   * must stay a 200: a caller distinguishes "no alerts" from "could not ask" by
   * reading `status`, and a 500 would take that choice away.
   */
  it('returns a failed summary as 200, not 500', async () => {
    const { status, body } = await call(dailyAlerts, undefined, 'token', 'GET');
    expect(status).toBe(200);
    expect(body.status).toBe('failed');
  });
});

describe('the lane agrees on who may call', () => {
  const cases: Array<[string, (e: never) => unknown, unknown, string]> = [
    ['chat-context', chatContext, { userMessage: 'hi' }, 'POST'],
    ['extract-thread', extractThread, { conversationId: 'c1' }, 'POST'],
    ['daily-alerts', dailyAlerts, undefined, 'GET'],
  ];

  it.each(cases)('%s accepts an owner session', async (_n, handler, body, method) => {
    expect((await call(handler, body, 'owner', method)).status).not.toBe(401);
  });

  it.each(cases)('%s refuses an anonymous caller', async (_n, handler, body, method) => {
    expect((await call(handler, body, 'nobody', method)).status).toBe(401);
  });

  it.each(cases)('%s refuses everyone when no token is configured', async (_n, handler, body, method) => {
    delete mutableEnv.JKAI_INVOKE_TOKEN;
    expect((await call(handler, body, 'token', method)).status).toBe(401);
  });
});
