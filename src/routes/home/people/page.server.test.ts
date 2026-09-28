import { beforeEach, describe, expect, it, vi } from 'vitest';

// Runs the REAL load with a faked `locals`. The viewer chain is real too
// ($lib/home/presence/viewer → $lib/server/viewer → $lib/server/owner); only
// the modules that read the database are faked.
const householdSubjects = new Map<string, string>();

vi.mock('$lib/server/access', () => ({
  isOwnerEmail: (email: string | null | undefined) => (email ?? '').toLowerCase() === 'owner@example.test',
  getOwnerEmails: () => ['owner@example.test'],
}));
vi.mock('$lib/server/members', () => ({
  householdSubjectFor: async (email: string) => householdSubjects.get(email) ?? null,
}));
// A household viewer is a member holding family:circle; here, anyone with a
// household subject is one.
vi.mock('$lib/server/grants', () => ({
  loadMember: async (email: string) =>
    householdSubjects.has(email) ? { principalId: 'u_test', grants: new Set(['family:circle']) } : null,
}));
vi.mock('$lib/db', () => ({ db: {} }));

type Presence = import('$lib/home/presence/household').HouseholdPresence;
function card(subject: string, extra: Partial<Presence> = {}): Presence {
  return {
    subject,
    isHome: false,
    placeLabel: 'Somewhere',
    distanceHomeKm: 2.5,
    batteryPct: 80,
    ageMins: 3,
    lastSeenAt: new Date('2026-09-26T09:00:00Z'),
    today: { firstOutMins: 420, minutesOut: 60, placesVisited: 3, fixes: 120 },
    ...extra,
  };
}
const MEMBERS = [card('alex'), card('sam'), card('robin', { notSharing: true })];
const loadHousehold = vi.fn(async () => ({ members: MEMBERS.map((m) => ({ ...m })) }));
// livePositions filters out anyone not sharing itself (in SQL); here it is the
// already-filtered answer.
const POSITIONS = [{ subject: 'alex', lat: 54.52, lon: -1.55, at: '2026-09-26T09:00:00.000Z', isHome: false }];
const livePositions = vi.fn(async () => POSITIONS.map((p) => ({ ...p })));
vi.mock('$lib/home/presence/household', () => ({ loadHousehold, livePositions }));
// The daydream engine is gone from this page: importing its ledger at all
// is a failure.
vi.mock('$lib/daydream/ledger', () => {
  throw new Error('/home/people must not import the daydream ledger');
});

const loadFeedChecks = vi.fn(async () => ({ alex: { source: 'companion', checkedAt: new Date('2026-09-26T10:00:00Z') } }));
vi.mock('$lib/home/presence/feed-checks', () => ({ loadFeedChecks }));

const listMembers = vi.fn(async () => [
  { subject: 'alex', displayName: 'Alex' },
  { subject: 'sam', displayName: 'Sam' },
  { subject: 'robin', displayName: 'Robin' },
]);
vi.mock('$lib/home/presence/members', () => ({ listMembers, wardsOf: async () => [] }));
const loadPeopleMovement = vi.fn(async (people: Array<{ subject: string; displayName: string }>, _opts?: unknown) =>
  people.map((p) => ({ ...p, stats: null, commuting: [], error: null })),
);
vi.mock('$lib/home/presence/movement', () => ({ loadPeopleMovement }));

const { forecastMock, namingMock } = vi.hoisted(() => ({
  forecastMock: vi.fn(async (_viewer: unknown, _days: number, _person: string | null) => ({
    forecast: { routines: [], next: [], watch: [], arrivals: [], departures: [], generatedAt: '', days: 28 },
    insights: { people: [], routes: [] },
    homeId: null,
  })),
  namingMock: vi.fn(async () => []),
}));
vi.mock('$lib/home/presence/forecast.server', () => ({ loadForecast: forecastMock }));
vi.mock('$lib/home/presence/naming.server', () => ({ loadNamingQueue: namingMock, unnamedCount: async () => 3 }));

const { load } = await import('./+page.server');

function eventFor(email: string | null, person?: string, days?: string) {
  return {
    locals: { auth: async () => (email ? { user: { email } } : null) } as unknown as App.Locals,
    getClientAddress: () => '203.0.113.9',
    params: {},
    url: new URL(`https://example.test/home/people?${new URLSearchParams({ ...(person ? { person } : {}), ...(days ? { days } : {}) })}`),
    setHeaders: () => {},
    depends: vi.fn(),
  } as unknown as Parameters<typeof load>[0];
}

type Scoped = import('$lib/home/presence/viewer').ScopedPresence;
interface PeopleData {
  family: { members: Scoped[] };
  viewer: import('$lib/home/presence/viewer').PeopleViewer;
  links: Record<string, string>;
  loadError: string | null;
  feedChecks: Record<string, unknown>;
}
async function run(email: string | null): Promise<PeopleData> {
  return (await load(eventFor(email))) as PeopleData;
}

beforeEach(() => {
  householdSubjects.clear();
  householdSubjects.set('sam@example.test', 'sam');
  loadHousehold.mockClear();
  livePositions.mockClear();
  loadFeedChecks.mockClear();
  loadPeopleMovement.mockClear();
});

describe('/home/people load — D2 scoping', () => {
  it('gives the owner every card untouched, every day included, through the household path', async () => {
    const data = await run('owner@example.test');
    expect(data.viewer).toEqual({ kind: 'owner' });
    expect(loadHousehold).toHaveBeenCalledOnce();
    expect(data.family.members).toEqual(MEMBERS);
    expect(data.family.members.every((m) => m.today !== null)).toBe(true);
    // No daydream detail rides along any more.
    expect(Object.keys(data.family)).toEqual(['members']);
  });

  it("gives a household viewer no daydream detail and no one else's day", async () => {
    const data = await run('sam@example.test');
    expect(data.viewer).toEqual({ kind: 'household', subject: 'sam', wards: [] });
    expect(Object.keys(data.family)).toEqual(['members']);

    const by = new Map(data.family.members.map((m) => [m.subject, m]));
    expect(by.get('sam')!.today).toEqual(MEMBERS[1].today);
    expect(by.get('alex')!.today).toBeNull();
    // Live status for everyone sharing.
    expect(by.get('alex')).toMatchObject({ isHome: false, placeLabel: 'Somewhere', batteryPct: 80 });

    // The payload as it would be serialised to the browser: nothing about
    // anyone else's day.
    const wire = JSON.stringify(data.family.members.filter((m) => m.subject !== 'sam'));
    expect(wire).not.toContain('firstOutMins');
    expect(wire).not.toContain('minutesOut');
  });

  it('shows someone not sharing with no position data', async () => {
    const data = await run('sam@example.test');
    const robin = data.family.members.find((m) => m.subject === 'robin')!;
    expect(robin.notSharing).toBe(true);
    for (const k of ['isHome', 'placeLabel', 'distanceHomeKm', 'batteryPct', 'ageMins', 'lastSeenAt', 'today'] as const) {
      expect(robin[k], k).toBeNull();
    }
  });

  it('links the owner to every person page, a household viewer to their own only', async () => {
    expect((await run('owner@example.test')).links).toEqual({
      alex: '/home/people?person=alex#movement',
      sam: '/home/people?person=sam#movement',
      robin: '/home/people?person=robin#movement',
    });
    expect((await run('sam@example.test')).links).toEqual({ sam: '/home/people?person=sam#movement' });
  });

  it('refuses a guest and a signed-out visitor', async () => {
    await expect(load(eventFor('guest@example.test'))).rejects.toMatchObject({ status: 403 });
    await expect(load(eventFor(null))).rejects.toMatchObject({ status: 403 });
    expect(loadHousehold).not.toHaveBeenCalled();
    // Positions are read only after the viewer check passes.
    expect(livePositions).not.toHaveBeenCalled();
  });

  it('gives the owner the failure detail', async () => {
    loadHousehold.mockRejectedValueOnce(new Error('relation "daydream_trail" does not exist'));
    const data = await run('owner@example.test');
    expect(data.family.members).toEqual([]);
    expect(data.loadError).toContain('daydream_trail');
  });

  it('hides the failure detail from a household viewer', async () => {
    loadHousehold.mockRejectedValueOnce(new Error('relation "daydream_trail" does not exist'));
    const data = await run('sam@example.test');
    expect(data.family.members).toEqual([]);
    expect(data.loadError).not.toContain('daydream_trail');
  });
});

describe('the household map', () => {
  it('gives the owner and a household viewer the sharing positions, nobody else anything', async () => {
    const { load } = await import('./+page.server');
    householdSubjects.set('sam@example.test', 'sam');
    const asViewer = (await load(eventFor('sam@example.test') as never)) as { positions: unknown[] };
    expect(asViewer.positions).toEqual(POSITIONS);
    const asOwner = (await load(eventFor('owner@example.test') as never)) as { positions: unknown[] };
    expect(asOwner.positions).toEqual(POSITIONS);
    expect(livePositions).toHaveBeenCalledTimes(2);
    livePositions.mockClear();
    await expect(load(eventFor('guest@example.test') as never)).rejects.toMatchObject({ status: 403 });
    await expect(load(eventFor(null) as never)).rejects.toMatchObject({ status: 403 });
    // A refused visitor never causes a positions read at all.
    expect(livePositions).not.toHaveBeenCalled();
  });

  it('still returns the positions when the household cards fail', async () => {
    loadHousehold.mockRejectedValueOnce(new Error('db down'));
    const data = (await load(eventFor('sam@example.test') as never)) as { positions: unknown[] };
    expect(data.positions).toEqual(POSITIONS);
  });

  it('draws no map, and nothing else breaks, when positions cannot be read', async () => {
    const { load } = await import('./+page.server');
    householdSubjects.set('sam@example.test', 'sam');
    livePositions.mockRejectedValueOnce(new Error('db down'));
    const data = (await load(eventFor('sam@example.test') as never)) as { positions: unknown[]; family: { members: unknown[] } };
    expect(data.positions).toEqual([]);
    expect(data.family.members.length).toBeGreaterThan(0);
  });
});



describe('feed check scoping', () => {
  it('only reads feed times for authorised sharing subjects', async () => {
    const data = await run('sam@example.test');
    expect(loadFeedChecks).toHaveBeenCalledWith(['alex', 'sam']);
    expect(data.feedChecks).toHaveProperty('alex');
    expect(data.feedChecks).not.toHaveProperty('robin');
  });
  it('never reads feed status for a refused visitor', async () => {
    await expect(run(null)).rejects.toMatchObject({ status: 403 });
    expect(loadFeedChecks).not.toHaveBeenCalled();
  });
  it('keeps the locations when the feed status read fails', async () => {
    loadFeedChecks.mockRejectedValueOnce(new Error('feed status unavailable'));
    const data = await run('sam@example.test');
    expect(data.family.members).toHaveLength(3);
    expect(data.feedChecks).toEqual({});
    expect(data.loadError).toBeNull();
  });
});

describe('everyone’s movement on the one page', () => {
  type Moving = { movement: Array<{ subject: string }>; person: string | null; ownSubject: string | null };
  const moving = async (email: string, person?: string) => (await load(eventFor(email, person))) as unknown as Moving;

  it('gives the owner everyone, and honours the person filter', async () => {
    const data = await moving('owner@example.test', 'alex');
    expect(data.movement.map((p) => p.subject)).toEqual(['alex', 'sam', 'robin']);
    expect(data.person).toBe('alex');
  });

  it('reads a household viewer’s own trail only, and ignores a filter on anyone else', async () => {
    const data = await moving('sam@example.test', 'alex');
    expect(loadPeopleMovement.mock.calls.map((c) => c[0].map((p) => p.subject))).toEqual([['sam']]);
    expect(data.movement.map((p) => p.subject)).toEqual(['sam']);
    // Not a 403 and not an echo: the filter says nothing about who exists.
    expect(data.person).toBeNull();
    expect(data.ownSubject).toBe('sam');
  });

  it('reads no trail for a refused visitor', async () => {
    await expect(load(eventFor('guest@example.test'))).rejects.toMatchObject({ status: 403 });
    expect(loadPeopleMovement).not.toHaveBeenCalled();
  });

  it('still draws the live band when movement cannot be read', async () => {
    loadPeopleMovement.mockRejectedValueOnce(new Error('db down'));
    const data = await moving('owner@example.test');
    expect(data.movement).toEqual([]);
    expect((data as unknown as PeopleData).family.members).toHaveLength(3);
  });
});

describe('the forecast and the naming queue', () => {
  beforeEach(() => {
    forecastMock.mockClear();
    namingMock.mockClear();
  });
  it('gives the owner the naming queue and a household viewer none', async () => {
    const owner = (await load(eventFor('owner@example.test'))) as unknown as { naming: Promise<unknown> | null };
    expect(await owner.naming).toEqual({ queue: [], unnamed: 3 });
    const sam = (await load(eventFor('sam@example.test'))) as unknown as { naming: Promise<unknown> | null };
    expect(sam.naming).toBeNull();
    expect(namingMock).toHaveBeenCalledTimes(1);
  });
  it('passes the forecast only a person the viewer may open, and a bounded window', async () => {
    const own = (await load(eventFor('sam@example.test', 'sam', '7'))) as unknown as { forecast: Promise<unknown>; days: number };
    await own.forecast;
    expect(forecastMock).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'household' }), 7, 'sam');
    const other = (await load(eventFor('sam@example.test', 'alex', '99999'))) as unknown as { forecast: Promise<unknown>; days: number };
    await other.forecast;
    expect(forecastMock).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'household' }), 28, null);
    expect(other.days).toBe(28);
  });
  it('streams null, not an empty forecast, when the forecast fails', async () => {
    forecastMock.mockRejectedValueOnce(new Error('boom'));
    const data = (await load(eventFor('owner@example.test'))) as unknown as { forecast: Promise<unknown> };
    expect(await data.forecast).toBeNull();
  });
});
