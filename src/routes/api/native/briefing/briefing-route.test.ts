import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BriefingData } from '$lib/briefing/types';

// The phone's Morning report behind the real owner gate (`withDevice`), with
// the datastore reads stubbed. Every fixture is synthetic.

const OWNER = 'owner@example.test';

const factor = {
  key: 'weather-here',
  n: 2,
  label: 'Weather where you are',
  group: 'Place',
  icon: 'cloud.sun',
  status: 'ok',
  headline: '18°, dry until 4pm',
  salience: 60,
  facts: [{ label: 'High', value: '18°', assessment: '3° warmer than home', href: '/jkai/health' }],
  detail: 'Open-Meteo',
};

const NEW: BriefingData = {
  id: '2026-10-28',
  trigger: 'cron',
  status: 'complete',
  startedAt: '2026-10-28T06:00:00.000Z',
  title: 'Briefing — Wed 28 Oct',
  markdown: 'Good morning.',
  sources: [],
  llmCalls: 1,
  costUsd: 0.01,
  detail: {
    headline: 'Day three in Rome',
    dateLabel: 'Wed 28 Oct',
    generatedAt: '2026-10-28T06:00:05.000Z',
    timezone: 'Europe/Rome',
    location: null,
    weather: null,
    knowledge: null,
    facts: [],
    gaps: [{ section: 'Email', reason: 'Gmail token expired', required: true }],
    sources: [],
    mode: 'travel',
    verification: { verified: true, usedFallback: false, violations: [] },
    daydreamsText: '💭 Daydreams',
    factors: [factor as never],
    connections: [{ text: 'Rain at 4pm meets the Forum visit', factors: ['weather-here', 'trip'], salience: 70, action: true }],
  },
};

const OLD = {
  id: '2026-10-01',
  trigger: 'cron',
  status: 'complete',
  startedAt: '2026-10-01T06:00:00.000Z',
  title: 'Briefing — Thu 1 Oct',
  markdown: 'Old one.',
  sources: [],
  llmCalls: 1,
  costUsd: 0,
  detail: { headline: 'Old', dateLabel: 'Thu 1 Oct', generatedAt: '2026-10-01T06:00:00.000Z', facts: [], gaps: [], sources: [], mode: 'weekday' },
} as unknown as BriefingData;

const h = vi.hoisted(() => ({
  identity: null as null | { id: string; ownerEmail: string; label: string | null; expiresAt: Date },
  env: {} as Record<string, string | undefined>,
  records: {} as Record<string, unknown>,
}));

vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => h.identity,
  touchDevice: async () => {},
}));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string | null | undefined) => (e ?? '').trim().toLowerCase() === OWNER }));
vi.mock('$lib/server/grants', () => ({ loadMember: async () => null }));
vi.mock('$lib/briefing/dashboard.server', () => ({
  listBriefingDays: async () =>
    Object.keys(h.records)
      .sort()
      .reverse()
      .map((id) => ({ id, title: '', startedAt: '', status: 'complete' })),
  loadBriefingDay: async (id: string) => (h.records[id] as BriefingData | undefined) ?? null,
}));

const route = await import('./+server');
type Handler = (e: unknown) => Promise<Response>;

async function get(query = '', auth = true) {
  const url = new URL(`https://site.test/api/native/briefing${query}`);
  const request = new Request(url, { headers: auth ? { authorization: `Bearer ${'x'.repeat(43)}` } : {} });
  const res = await (route.GET as unknown as Handler)({ request, url, locals: { auth: async () => null } });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  for (const k of Object.keys(h.env)) delete h.env[k];
  h.env.AUTH_ALLOWED_EMAILS = OWNER;
  h.identity = { id: 'dev-1', ownerEmail: OWNER, label: 'iPhone', expiresAt: new Date('2027-01-01T00:00:00Z') };
  h.records = { '2026-10-28': NEW, '2026-10-01': OLD };
});

describe('GET /api/native/briefing', () => {
  it('refuses an unpaired phone', async () => {
    h.identity = null;
    expect((await get('', false)).status).toBe(401);
  });

  it("refuses a family member's phone", async () => {
    h.identity = { id: 'dev-2', ownerEmail: 'ann@example.test', label: 'iPhone', expiresAt: new Date('2027-01-01T00:00:00Z') };
    expect((await get()).status).toBe(403);
  });

  it('answers the newest day in the contract shape', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body).toEqual({
      day: '2026-10-28',
      title: 'Briefing — Wed 28 Oct',
      dateLabel: 'Wed 28 Oct',
      generatedAt: '2026-10-28T06:00:05.000Z',
      headline: 'Day three in Rome',
      markdown: 'Good morning.',
      verified: true,
      mode: 'travel',
      factors: [factor],
      connections: [{ text: 'Rain at 4pm meets the Forum visit', factors: ['weather-here', 'trip'], salience: 70, action: true }],
      gaps: [{ section: 'Email', reason: 'Gmail token expired' }],
      daydreamsText: '💭 Daydreams',
      pageUrl: 'https://strangeramblings.com/jkai/daydreams/briefing/2026-10-28',
      days: ['2026-10-28', '2026-10-01'],
    });
  });

  it('reads an old record with no factors or connections as empty lists', async () => {
    const { status, body } = await get('?day=2026-10-01');
    expect(status).toBe(200);
    expect(body.factors).toEqual([]);
    expect(body.connections).toEqual([]);
    expect(body.verified).toBe(false);
    expect(body.mode).toBe('weekday');
    expect(body.daydreamsText).toBe('');
  });

  it('404s an unknown day and an empty collection, 400s a malformed day', async () => {
    expect(await get('?day=2026-09-01')).toEqual({ status: 404, body: { error: 'no briefing' } });
    expect((await get('?day=yesterday')).status).toBe(400);
    h.records = {};
    expect(await get()).toEqual({ status: 404, body: { error: 'no briefing' } });
  });
});
