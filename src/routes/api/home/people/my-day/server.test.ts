import { beforeEach, describe, expect, it, vi } from 'vitest';

// The REAL handler and the REAL viewer resolution (`ownDayOf` → `peopleViewerOf`),
// with a faked `locals`; only the database readers and the pilot are faked.
const householdSubjects = new Map<string, string>();

vi.mock('$lib/server/access', () => ({
  isOwnerEmail: (email: string | null | undefined) => (email ?? '').toLowerCase() === 'owner@example.test',
  getOwnerEmails: () => ['owner@example.test'],
}));
vi.mock('$lib/server/members', () => ({
  householdSubjectFor: async (email: string) => householdSubjects.get(email) ?? null,
}));
// Circle members are the emails with a household row, plus one member who
// holds no family permission at all.
vi.mock('$lib/server/grants', () => ({
  loadMember: async (email: string) =>
    householdSubjects.has(email)
      ? { principalId: 'u_test', grants: new Set(['family:circle']) }
      : email === 'reader@example.test'
        ? { principalId: 'u_reader', grants: new Set(['research:self']) }
        : null,
}));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/home/presence/members', () => ({ wardsOf: async () => [] }));

const pilotDay = vi.fn(async (_email: string, _w: unknown) => ({
  ok: true as const,
  value: { track: { points: [] }, timeline: { heartRate: { seconds: 300, bins: [] } } },
}));
vi.mock('$lib/home/presence/companion-accounts', async (orig) => ({
  ...(await orig<typeof import('$lib/home/presence/companion-accounts')>()),
  pilotDay,
}));

const { GET } = await import('./+server');

const today = () => new Date().toISOString().slice(0, 10);

function eventFor(email: string | null, query: string) {
  return {
    locals: { auth: async () => (email ? { user: { email } } : null) } as unknown as App.Locals,
    getClientAddress: () => '203.0.113.9',
    url: new URL(`https://strangeramblings.com/api/home/people/my-day?${query}`),
  } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  householdSubjects.clear();
  householdSubjects.set('sam@example.test', 'sam');
  householdSubjects.set('owner@example.test', 'john');
  pilotDay.mockClear();
});

describe('GET /api/home/people/my-day', () => {
  it('answers a circle member with THEIR OWN day, read by their session email', async () => {
    const res = await GET(eventFor('Sam@Example.test', `date=${today()}&tz=0`));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(pilotDay).toHaveBeenCalledTimes(1);
    expect(pilotDay.mock.calls[0][0]).toBe('sam@example.test');
    const body = await res.json();
    expect(body).toMatchObject({ date: today(), tz: 0, track: { points: [] } });
  });

  it('answers the owner with the owner’s own day', async () => {
    const res = await GET(eventFor('owner@example.test', `date=${today()}&tz=-60`));
    expect(res.status).toBe(200);
    expect(pilotDay.mock.calls[0][0]).toBe('owner@example.test');
    expect(pilotDay.mock.calls[0][1]).toMatchObject({ tz: -60 });
  });

  it('refuses a signed-in member without family:circle, and a stranger, and nobody', async () => {
    for (const email of ['reader@example.test', 'stranger@example.test', null]) {
      const res = await GET(eventFor(email, `date=${today()}&tz=0`));
      // Signed out on a non-private address: no dev bypass either.
      expect(res.status, String(email)).toBe(403);
    }
    expect(pilotDay).not.toHaveBeenCalled();
  });

  it('cannot be pointed at anybody else: an email or subject parameter is refused', async () => {
    for (const extra of ['email=owner@example.test', 'subject=john', 'user=1']) {
      const res = await GET(eventFor('sam@example.test', `date=${today()}&tz=0&${extra}`));
      expect(res.status, extra).toBe(400);
    }
    expect(pilotDay).not.toHaveBeenCalled();
  });

  it('refuses a date outside the last 31 days', async () => {
    const res = await GET(eventFor('sam@example.test', 'date=2020-01-01&tz=0'));
    expect(res.status).toBe(400);
    expect(pilotDay).not.toHaveBeenCalled();
  });

  it('says "no-account" when the pilot does not know them, and hides the pilot’s other failures', async () => {
    pilotDay.mockResolvedValueOnce({ ok: false, reason: 'not-found', status: 404 } as never);
    const res = await GET(eventFor('sam@example.test', `date=${today()}&tz=0`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no-account' });

    pilotDay.mockResolvedValueOnce({ ok: false, reason: 'unreachable' } as never);
    const down = await GET(eventFor('sam@example.test', `date=${today()}&tz=0`));
    expect(down.status).toBe(502);
  });
});
