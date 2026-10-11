import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The five owner-lane routes behind the real owner gate (`withDevice`), over
// the real client ($lib/wildmind/owner.server) with Wildmind's owner listener
// stubbed as `fetch`. Every fixture is synthetic.

const OWNER = 'owner@example.test';
const BASE = 'http://wildmind.test:5393';
const TOKEN = 't'.repeat(20) + 'OWNERTOKENVALUE' + 'k'.repeat(12);
const KEY = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const h = vi.hoisted(() => ({
  identity: null as null | { id: string; ownerEmail: string; label: string | null; expiresAt: Date },
  env: {} as Record<string, string | undefined>,
  members: new Map<string, { principalId: string; grants: Set<string> }>(),
}));

vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => h.identity,
  touchDevice: async () => {},
}));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string | null | undefined) => (e ?? '').trim().toLowerCase() === OWNER }));
vi.mock('$lib/server/grants', () => ({ loadMember: async (e: string) => h.members.get(e) ?? null }));

const talk = await import('./talk/+server');
const chronicle = await import('./chronicle/+server');
const inventions = await import('./inventions/+server');
const whispers = await import('./whispers/+server');
const whisper = await import('./whisper/+server');

type Handler = (e: unknown) => Promise<Response>;

const valley = { seed: 4242, generation: 3, day: 12, clock: 'Day 12, 09:30' };
const SECRET = 'PLANTED-SYSTEM-PROMPT';

const UPSTREAM: Record<string, unknown> = {
  talk: {
    v: 1,
    valley,
    entries: [
      { id: 9, minute: 1300, when: 'Day 12, 09:30', who: 'main', name: 'JKai', kind: 'speech', to: 'companion', toName: 'Wren', text: 'Reeds by the water.', detail: null, prompt: SECRET },
      { id: 8, minute: 1290, when: 'Day 12, 09:20', who: 'main', name: 'JKai', kind: 'thought', to: null, toName: null, text: 'I could weave these.', detail: 'Goal: mat · Mood: keen' },
    ],
    oldestId: 8,
    latestId: 9,
    more: false,
    internal: SECRET,
  },
  chronicle: {
    v: 1,
    valley,
    who: { id: 'main', name: 'JKai', alive: true, causeOfDeath: null, persona: 'Curious and careful.' },
    now: { lastThought: 'Rest soon.', mood: 'calm', goal: 'Mat', ambitions: [], values: [], attitudes: [], people: [] },
    timeline: [{ minute: 1, day: 0, when: 'Day 0, 00:01', kind: 'start', icon: '*', text: 'Woke by the river.' }],
    diary: [{ day: 11, text: 'Found reeds.' }],
    currentSystem: SECRET,
    origin: { system: SECRET },
    guardrails: [{ title: SECRET, items: [] }],
  },
  inventions: {
    v: 1,
    valley,
    inventions: [{ id: 'reed_mat', name: 'Reed mat', kind: 'item', description: 'Woven reeds.', inventor: 'JKai', day: 11, placed: true, summary: 'craft: 4 Reeds', notes: [], rationale: 'Dry floor.', visual: { parts: [SECRET] } }],
    refused: [{ when: 'Day 10, 12:00', text: 'A copper pot: no copper yet.' }],
  },
  whispers: {
    v: 1,
    pending: [],
    reserveLeftUsd: 0.25,
    modelAvailable: true,
    whispers: [{ logId: 5, when: 'Day 12, 08:00', text: 'Look east', status: 'heard', answer: { logId: 6, when: 'Day 12, 08:04', thought: 'East, then.', goal: 'Explore east', mood: 'curious' } }],
  },
};

let upstream: ReturnType<typeof vi.fn>;
let next: ((url: URL, init: RequestInit) => Response | Promise<Response>) | null;
let deviceSeq = 0;

function device(email: string) {
  return { id: `dev-${email}-${deviceSeq}`, ownerEmail: email, label: 'iPhone', expiresAt: new Date('2027-01-01T00:00:00Z') };
}

async function get(route: Handler, path: string, query = '', headers: Record<string, string> = {}) {
  const url = new URL(`https://site.test/api/native/wildmind/${path}${query}`);
  const request = new Request(url, { headers: { authorization: `Bearer ${'x'.repeat(43)}`, ...headers } });
  const res = await route({ request, url, locals: { auth: async () => null } });
  const raw = await res.text();
  return { res, raw, body: JSON.parse(raw) };
}

async function post(body: unknown, headers: Record<string, string> = { 'idempotency-key': KEY }) {
  const url = new URL('https://site.test/api/native/wildmind/whisper');
  const request = new Request(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${'x'.repeat(43)}`, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await (whisper.POST as unknown as Handler)({ request, url, locals: { auth: async () => null } });
  const raw = await res.text();
  return { res, raw, body: JSON.parse(raw) };
}

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

beforeEach(() => {
  for (const k of Object.keys(h.env)) delete h.env[k];
  h.env.AUTH_ALLOWED_EMAILS = OWNER;
  h.env.WILDMIND_OWNER_URL = BASE;
  h.env.WILDMIND_OWNER_TOKEN = TOKEN;
  deviceSeq += 1;
  h.identity = device(OWNER);
  h.members.clear();
  next = null;
  upstream = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const u = new URL(String(input));
    if (next) return next(u, init);
    const route = u.pathname.replace('/api/owner/v1/', '');
    if (route === 'whisper') return reply(202, { v: 1, ok: true, logId: 31, when: 'Day 12, 09:31', pending: ['Look east'], dropped: null, asleep: false, modelAvailable: true, echo: SECRET });
    return reply(200, UPSTREAM[route]);
  });
  vi.stubGlobal('fetch', upstream);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const GETS: Array<[string, Handler]> = [
  ['talk', talk.GET as unknown as Handler],
  ['chronicle', chronicle.GET as unknown as Handler],
  ['inventions', inventions.GET as unknown as Handler],
  ['whispers', whispers.GET as unknown as Handler],
];

describe.each(GETS)('GET /api/native/wildmind/%s', (path, route) => {
  it('401s an unpaired phone, without asking Wildmind', async () => {
    h.identity = null;
    const { res, body } = await get(route, path);
    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'Pair this iPhone again.' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("403s a member's phone, without asking Wildmind", async () => {
    h.identity = device('ann@example.test');
    h.members.set('ann@example.test', { principalId: 'u_ann', grants: new Set(['news:self', 'games:self']) });
    const { res } = await get(route, path);
    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('403s the owner viewing as a member', async () => {
    h.members.set('ann@example.test', { principalId: 'u_ann', grants: new Set(['news:self']) });
    const { res } = await get(route, path, '', { 'x-sr-view-as': 'ann@example.test' });
    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers offline, asking nobody, when the lane is not configured', async () => {
    delete h.env.WILDMIND_OWNER_TOKEN;
    expect((await get(route, path)).body).toEqual({ state: 'offline' });
    h.env.WILDMIND_OWNER_TOKEN = TOKEN;
    delete h.env.WILDMIND_OWNER_URL;
    const { res, body } = await get(route, path);
    expect(res.status).toBe(200);
    expect(body).toEqual({ state: 'offline' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('treats a short token as no token', async () => {
    h.env.WILDMIND_OWNER_TOKEN = 'short';
    expect((await get(route, path)).body).toEqual({ state: 'offline' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('asks the owner listener with the bearer, refusing redirects', async () => {
    const { res, body } = await get(route, path);
    expect(res.status).toBe(200);
    expect(body.state).toBe('live');
    expect(body.v).toBe(1);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [input, init] = upstream.mock.calls[0] as [string, RequestInit];
    expect(new URL(input).origin).toBe(BASE);
    expect(new URL(input).pathname).toBe(`/api/owner/v1/${path}`);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('drops keys the contract does not name and never carries the token', async () => {
    const { raw } = await get(route, path);
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('OWNERTOKENVALUE');
    for (const k of ['currentSystem', 'origin', 'guardrails', 'visual', 'internal', 'prompt']) expect(raw).not.toContain(`"${k}"`);
  });

  it('answers offline when Wildmind refuses, fails or sends something else', async () => {
    next = () => reply(401, { error: 'unauthorized' });
    expect((await get(route, path)).body).toEqual({ state: 'offline' });
    next = () => reply(500, { error: 'boom' });
    expect((await get(route, path)).body).toEqual({ state: 'offline' });
    next = () => reply(200, { v: 2 });
    expect((await get(route, path)).body).toEqual({ state: 'offline' });
    next = () => new Response('not json', { status: 200 });
    expect((await get(route, path)).body).toEqual({ state: 'offline' });
    next = () => {
      throw new TypeError('fetch failed');
    };
    expect((await get(route, path)).body).toEqual({ state: 'offline' });
    next = () => new Response('x'.repeat(2 * 1024 * 1024), { status: 200 });
    const { res, body } = await get(route, path);
    expect(res.status).toBe(200);
    expect(body).toEqual({ state: 'offline' });
  });

  it('never logs the token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    next = () => reply(401, { error: 'unauthorized' });
    await get(route, path);
    h.env.WILDMIND_OWNER_TOKEN = 'short-OWNERTOKENVALUE';
    await get(route, path);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('OWNERTOKENVALUE');
  });
});

describe('GET /api/native/wildmind/talk', () => {
  it('passes only the checked query through', async () => {
    const { body } = await get(talk.GET as unknown as Handler, 'talk', '?before=120&since=x&limit=900&who=companion&kinds=speech,system,whisper&token=1');
    const q = Object.fromEntries(new URL(String(upstream.mock.calls[0][0])).searchParams);
    expect(q).toEqual({ before: '120', limit: '200', who: 'companion', kinds: 'speech,whisper' });
    expect(Object.keys(body).sort()).toEqual(['entries', 'latestId', 'more', 'oldestId', 'state', 'v', 'valley']);
    expect(body.entries[0]).toEqual({ id: 9, minute: 1300, when: 'Day 12, 09:30', who: 'main', name: 'JKai', kind: 'speech', to: 'companion', toName: 'Wren', text: 'Reeds by the water.', detail: null });
  });
});

describe('GET /api/native/wildmind/chronicle', () => {
  const route = chronicle.GET as unknown as Handler;

  it('asks for main by default and the companion when named', async () => {
    await get(route, 'chronicle');
    await get(route, 'chronicle', '?id=companion');
    expect(upstream.mock.calls.map(([u]) => new URL(String(u)).search)).toEqual(['?id=main', '?id=companion']);
  });

  it('400s anyone else without asking', async () => {
    const { res, body } = await get(route, 'chronicle', '?id=../settings');
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'bad-id' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('404s a person the valley does not have', async () => {
    next = () => reply(404, { error: 'no such character' });
    const { res, body } = await get(route, 'chronicle', '?id=companion');
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'no-such-person' });
  });

  it('keeps who, now, timeline and diary', async () => {
    const { body } = await get(route, 'chronicle');
    expect(Object.keys(body).sort()).toEqual(['diary', 'now', 'state', 'timeline', 'v', 'valley', 'who']);
    expect(body.who).toEqual({ id: 'main', name: 'JKai', alive: true, causeOfDeath: null, persona: 'Curious and careful.' });
  });
});

describe('GET /api/native/wildmind/inventions and whispers', () => {
  it('keeps inventions without their visual, and the refused ideas', async () => {
    const { body } = await get(inventions.GET as unknown as Handler, 'inventions');
    expect(body.inventions[0]).not.toHaveProperty('visual');
    expect(body.inventions[0].name).toBe('Reed mat');
    expect(body.refused).toEqual([{ when: 'Day 10, 12:00', text: 'A copper pot: no copper yet.' }]);
  });

  it('keeps the heard link and clamps the limit', async () => {
    const { body } = await get(whispers.GET as unknown as Handler, 'whispers', '?limit=500');
    expect(new URL(String(upstream.mock.calls[0][0])).search).toBe('?limit=50');
    expect(body.whispers[0].answer.thought).toBe('East, then.');
    expect(body.reserveLeftUsd).toBe(0.25);
  });
});

describe('POST /api/native/wildmind/whisper', () => {
  it('401s an unpaired phone and 403s a member, without asking Wildmind', async () => {
    h.identity = null;
    expect((await post({ text: 'Look east' })).res.status).toBe(401);
    h.identity = device('ann@example.test');
    h.members.set('ann@example.test', { principalId: 'u_ann', grants: new Set(['news:self']) });
    expect((await post({ text: 'Look east' })).res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('is refused while viewing as someone', async () => {
    h.members.set('ann@example.test', { principalId: 'u_ann', grants: new Set(['news:self']) });
    const { res, body } = await post({ text: 'Look east' }, { 'idempotency-key': KEY, 'x-sr-view-as': 'ann@example.test' });
    expect(res.status).toBe(403);
    expect(body.error).toMatch(/look-only/);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('503s offline, asking nobody, when the lane is not configured', async () => {
    delete h.env.WILDMIND_OWNER_URL;
    const { res, body } = await post({ text: 'Look east' });
    expect(res.status).toBe(503);
    expect(body).toEqual({ error: 'offline' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('needs a UUID Idempotency-Key and a good body, checked before asking', async () => {
    expect((await post({ text: 'Look east' }, {})).body).toEqual({ error: 'idempotency-key' });
    expect((await post({ text: 'Look east' }, { 'idempotency-key': 'abc' })).res.status).toBe(400);
    expect((await post({ text: '   ' })).body).toEqual({ error: 'empty' });
    expect((await post({ text: 'x'.repeat(241) })).body).toEqual({ error: 'too-long' });
    expect((await post('not json')).body).toEqual({ error: 'bad-request' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('forwards one whisper for JKai with the bearer and the key, and answers 202', async () => {
    const { res, raw, body } = await post({ text: '  Look east ', to: 'companion' });
    expect(res.status).toBe(202);
    expect(body).toEqual({ v: 1, ok: true, logId: 31, when: 'Day 12, 09:31', pending: ['Look east'], dropped: null, asleep: false, modelAvailable: true });
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('OWNERTOKENVALUE');
    expect(upstream).toHaveBeenCalledTimes(1);
    const [input, init] = upstream.mock.calls[0] as [string, RequestInit];
    expect(input).toBe(`${BASE}/api/owner/v1/whisper`);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    const sent = init.headers as Record<string, string>;
    expect(sent.authorization).toBe(`Bearer ${TOKEN}`);
    expect(sent['idempotency-key']).toBe(KEY);
    expect(JSON.parse(String(init.body))).toEqual({ to: 'main', text: 'Look east' });
  });

  it.each([
    [400, { error: 'too-long' }, { error: 'too-long' }],
    [400, { error: 'Your text was weird: ' + SECRET }, { error: 'bad-request' }],
    [403, { error: 'only-jkai' }, { error: 'only-jkai' }],
    [409, { error: 'dead' }, { error: 'dead' }],
    [409, { error: 'halted' }, { error: 'halted' }],
    [409, { error: 'between-lives' }, { error: 'between-lives' }],
    [409, { error: SECRET }, { error: 'unavailable' }],
    [422, { error: 'key-reused' }, { error: 'key-reused' }],
  ])('maps a Wildmind %i to the same status and a fixed string', async (status, said, want) => {
    next = () => reply(status, said);
    const { res, body } = await post({ text: 'Look east' });
    expect(res.status).toBe(status);
    expect(body).toEqual(want);
  });

  it('maps a Wildmind 429 to slow-down with its retry-after', async () => {
    next = () => reply(429, { error: 'slow-down' }, { 'retry-after': '17' });
    const { res, body } = await post({ text: 'Look east' });
    expect(res.status).toBe(429);
    expect(body).toEqual({ error: 'slow-down' });
    expect(res.headers.get('retry-after')).toBe('17');
  });

  it('503s offline on no answer, a 401, a 5xx or a body off contract, and never retries', async () => {
    for (const fail of [
      () => {
        throw new DOMException('timed out', 'TimeoutError');
      },
      () => reply(401, { error: 'unauthorized' }),
      () => reply(502, { error: 'bad gateway' }),
      () => reply(202, { v: 1, ok: false }),
    ]) {
      upstream.mockClear();
      deviceSeq += 1; // a fresh phone each time, so its own 3/min limit is not what answers
      h.identity = device(OWNER);
      next = fail;
      const { res, body } = await post({ text: 'Look east' });
      expect(res.status).toBe(503);
      expect(body).toEqual({ error: 'offline' });
      expect(upstream).toHaveBeenCalledTimes(1);
    }
  });

  it('allows three a minute from one phone, then says slow-down without asking', async () => {
    for (let i = 0; i < 3; i++) expect((await post({ text: `Look east ${i}` })).res.status).toBe(202);
    const { res, body } = await post({ text: 'Look east again' });
    expect(res.status).toBe(429);
    expect(body).toEqual({ error: 'slow-down' });
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(upstream).toHaveBeenCalledTimes(3);
  });
});
