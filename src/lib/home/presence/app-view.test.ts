import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  token: 'tok' as string | null,
  users: [] as Array<{ email: string; name: string; sharing: boolean }> | null,
  viewers: new Map<string, unknown>(),
  trailRows: [] as unknown[],
  posted: [] as unknown[],
  status: 200,
}));

// A select chain that answers with the trail rows whatever is asked; the
// label lookup gets the same array, which has no `status` and so names nothing.
function chain(rows: () => unknown[]): unknown {
  const c: Record<string, unknown> = {};
  for (const k of ['from', 'where', 'orderBy']) c[k] = () => c;
  c.then = (resolve: (v: unknown) => void) => resolve(rows());
  return c;
}
vi.mock('$lib/db', () => ({ db: { select: () => chain(() => h.trailRows) } }));
vi.mock('./companion', () => ({
  companionToken: () => h.token,
  companionUrl: () => 'http://pilot.test',
  loadCompanionUsers: async () => h.users,
}));
vi.mock('./household', () => ({
  loadHousehold: async () => ({ members: [presence('john'), presence('sam'), { ...presence('kit'), notSharing: true }] }),
  livePositions: async () => [
    { subject: 'john', lat: 51.5, lon: -0.1, at: '2026-09-26T09:00:00.000Z', isHome: false },
    { subject: 'sam', lat: 51.6, lon: -0.2, at: '2026-09-26T08:58:00.000Z', isHome: true },
  ],
}));
vi.mock('./places', () => ({
  listPanelPlaces: async () => [
    { id: 'h', label: null, lat: 40.76, lon: -73.97, radiusM: 120, isHome: true, trackOnLeave: true },
    { id: 's', label: 'School', lat: 40.78, lon: -73.96, radiusM: 150, isHome: false, trackOnLeave: true },
    { id: 'g', label: 'Gym', lat: 40.77, lon: -73.95, radiusM: 80, isHome: false, trackOnLeave: false },
  ],
}));
vi.mock('./viewer', async (orig) => {
  const real = await orig<typeof import('./viewer')>();
  return { ...real, peopleViewerForEmail: async (email: string) => h.viewers.get(email) ?? null };
});

const { buildAppView, summariseTrail, thin, trailSubjects, pushAppViews } = await import('./app-view');
const { scopeHousehold } = await import('./viewer');
type Presence = import('./household').HouseholdPresence;
type TrailPoint = import('./app-view').TrailPoint;

const NOW = new Date('2026-09-26T09:05:00Z');
const DAY_START = new Date('2026-09-25T23:00:00Z'); // midnight BST

function presence(subject: string): Presence {
  return {
    subject,
    isHome: subject === 'sam',
    placeLabel: null,
    distanceHomeKm: subject === 'sam' ? 0 : 3.2,
    batteryPct: 71,
    ageMins: 5,
    lastSeenAt: new Date('2026-09-26T09:00:00Z'),
    today: { firstOutMins: 8 * 60 + 12, minutesOut: 40, placesVisited: 2, fixes: 30 },
  };
}

const at = (mins: number) => new Date(DAY_START.getTime() + mins * 60_000);
const pt = (mins: number, lat: number, lon: number, extra: Partial<TrailPoint> = {}): TrailPoint => ({
  ts: at(mins),
  lat,
  lon,
  accuracyM: 10,
  isHome: false,
  placeId: null,
  ...extra,
});

beforeEach(() => {
  h.token = 'tok';
  h.users = [];
  h.viewers.clear();
  h.trailRows = [];
  h.posted = [];
  h.status = 200;
});

describe('thin', () => {
  it('keeps short trails whole and always ends on the last point', () => {
    expect(thin([1, 2, 3], 5)).toEqual([1, 2, 3]);
    const out = thin(Array.from({ length: 1000 }, (_, i) => i), 300);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(999);
  });
});

describe('summariseTrail', () => {
  it('sums distance and time out within continuous stretches only', () => {
    // ~111 m per 0.001° of latitude; one minute apart, then a 30-minute hole.
    const t = summariseTrail([pt(0, 51.0, 0), pt(1, 51.001, 0), pt(2, 51.002, 0), pt(32, 51.2, 0)], new Map(), null);
    expect(t.distanceKm).toBe(0.2);
    expect(t.minutesOut).toBe(2);
    expect(t.trail).toHaveLength(4);
  });

  it('counts no time out for fixes at home, and drops fixes too inaccurate to place', () => {
    const t = summariseTrail(
      [pt(0, 51, 0, { isHome: true }), pt(5, 51, 0, { isHome: true }), pt(6, 51.3, 0, { accuracyM: 900 })],
      new Map(),
      null,
    );
    expect(t.minutesOut).toBe(0);
    expect(t.trail).toHaveLength(2);
  });

  it('adds nothing for a GPS jump', () => {
    const t = summariseTrail([pt(0, 51, 0), pt(1, 52, 0)], new Map(), null);
    expect(t.distanceKm).toBe(0);
  });

  it('lists named stops in order, folding repeats and skipping removed places', () => {
    const labels = new Map<string, string | null>([
      ['h', 'Home'],
      ['s', 'School'],
      ['gone', null],
    ]);
    const t = summariseTrail(
      [pt(0, 51, 0, { placeId: 'h' }), pt(1, 51, 0, { placeId: 'h' }), pt(2, 51, 0, { placeId: 'gone' }), pt(3, 51, 0, { placeId: 's' }), pt(4, 51, 0, { placeId: 'h' })],
      labels,
      null,
    );
    expect(t.stops).toEqual(['Home', 'School', 'Home']);
  });

  it('writes first out as a local clock time', () => {
    expect(summariseTrail([], new Map(), new Date('2026-09-26T07:12:00Z')).firstOut).toBe('08:12');
  });
});

describe('buildAppView', () => {
  const household = [presence('john'), presence('sam'), { ...presence('kit'), notSharing: true }];
  const positions = [
    { subject: 'john', lat: 51.5, lon: -0.1, at: '2026-09-26T09:00:00.000Z', isHome: false },
    { subject: 'sam', lat: 51.6, lon: -0.2, at: '2026-09-26T08:58:00.000Z', isHome: true },
    // A position for somebody not sharing must never reach a card, even if handed one.
    { subject: 'kit', lat: 51.7, lon: -0.3, at: '2026-09-26T08:00:00.000Z', isHome: false },
  ];
  const trails = new Map([
    ['john', [pt(0, 51, 0), pt(1, 51.001, 0)]],
    ['sam', [pt(0, 52, 0), pt(1, 52.001, 0)]],
  ]);
  const base = { names: new Map([['john', 'John'], ['sam', 'Sam'], ['kit', 'Kit']]), positions, trails, labels: new Map(), dayStart: DAY_START, now: NOW };

  it('gives a household viewer everyone’s live status, and only their own day and trail', () => {
    const viewer = { kind: 'household' as const, subject: 'sam', wards: [] };
    const view = buildAppView({ ...base, viewer, self: null, scoped: scopeHousehold(household, viewer) });
    expect(view.viewer).toBe('household');
    expect(view.people.map((p) => p.subject)).toEqual(['sam', 'john', 'kit']);
    const [sam, john, kit] = view.people;
    expect(sam.self).toBe(true);
    expect(sam.today?.trail).toHaveLength(2);
    expect(john.today).toBeNull();
    expect(john.position).toEqual({ lat: 51.5, lon: -0.1, at: '2026-09-26T09:00:00.000Z' });
    expect(john.batteryPct).toBe(71);
    expect(kit).toMatchObject({ status: 'off', position: null, batteryPct: null, lastSeenAt: null, today: null });
  });

  it('gives the owner every sharing person’s day, and marks their own card', () => {
    const viewer = { kind: 'owner' as const };
    const view = buildAppView({ ...base, viewer, self: 'john', scoped: scopeHousehold(household, viewer) });
    const john = view.people[0];
    expect(john.subject).toBe('john');
    expect(john.self).toBe(true);
    expect(john.name).toBe('John');
    expect(john.today?.firstOut).toBe('08:12');
    expect(view.people.find((p) => p.subject === 'sam')?.today?.trail).toHaveLength(2);
    expect(view.people.find((p) => p.subject === 'kit')?.today).toBeNull();
  });

  it('asks for trails only where the day is visible', () => {
    const viewer = { kind: 'household' as const, subject: 'sam', wards: [] };
    expect(trailSubjects(scopeHousehold(household, viewer))).toEqual(['sam']);
    expect(trailSubjects(scopeHousehold(household, { kind: 'owner' }))).toEqual(['john', 'sam']);
  });
});

describe('pushAppViews', () => {
  function fakeFetch() {
    return (async (_url: string, init: RequestInit) => {
      h.posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ stored: 1 }), { status: h.status });
    }) as unknown as typeof fetch;
  }
  const members = [
    { subject: 'john', email: 'owner@example.test', displayName: 'John', source: 'companion' as const, haPersonEntity: null, whatsapp: null, alerts: {} },
  ];

  it('does nothing without a token, or when the pilot’s users cannot be read', async () => {
    h.token = null;
    expect(await pushAppViews(members, fakeFetch(), NOW)).toBeNull();
    h.token = 'tok';
    h.users = null;
    expect(await pushAppViews(members, fakeFetch(), NOW)).toBeNull();
    expect(h.posted).toEqual([]);
  });

  it('builds a view for each app user who qualifies and counts the rest as refused', async () => {
    h.users = [
      { email: 'Owner@Example.test', name: 'J', sharing: true },
      { email: 'stranger@example.test', name: 'S', sharing: true },
    ];
    h.viewers.set('owner@example.test', { kind: 'owner' });
    const res = await pushAppViews(members, fakeFetch(), NOW);
    expect(res).toEqual({ stored: 1, refused: 1 });
    const body = h.posted[0] as { views: Array<{ email: string; view: { people: Array<{ subject: string; self: boolean }> } }> };
    expect(body.views.map((v) => v.email)).toEqual(['owner@example.test']);
    expect(body.views[0].view.people.find((p) => p.subject === 'john')?.self).toBe(true);
  });

  it('carries the watched places — home unnamed reads as Home — and never an unflagged one', async () => {
    h.users = [{ email: 'owner@example.test', name: 'J', sharing: true }];
    h.viewers.set('owner@example.test', { kind: 'owner' });
    await pushAppViews(members, fakeFetch(), NOW);
    const body = h.posted[0] as { views: Array<{ view: { watch: Array<{ id: string; label: string }> } }> };
    expect(body.views[0].view.watch.map((w) => [w.id, w.label])).toEqual([
      ['h', 'Home'],
      ['s', 'School'],
    ]);
  });

  it('gives a household member outside the Family Circle the watched places and nobody', async () => {
    h.users = [{ email: 'kid@example.test', name: 'K', sharing: true }];
    const withKid = [...members, { ...members[0], subject: 'kid', email: 'kid@example.test', displayName: 'Kid' }];
    const res = await pushAppViews(withKid, fakeFetch(), NOW);
    expect(res).toMatchObject({ refused: 1 });
    const body = h.posted[0] as { views: Array<{ email: string; view: { viewer: string; people: unknown[]; watch: unknown[] } }> };
    expect(body.views).toHaveLength(1);
    expect(body.views[0]).toMatchObject({ email: 'kid@example.test', view: { viewer: 'none', people: [] } });
    expect(body.views[0].view.watch).toHaveLength(2);
  });

  it('still posts an empty set when nobody qualifies, so a revoked view is cleared', async () => {
    h.users = [{ email: 'stranger@example.test', name: 'S', sharing: true }];
    await pushAppViews(members, fakeFetch(), NOW);
    expect(h.posted).toEqual([{ views: [] }]);
  });

  it('reports a refusal from the pilot rather than throwing', async () => {
    h.users = [];
    h.status = 500;
    expect(await pushAppViews(members, fakeFetch(), NOW)).toEqual({ stored: 0, refused: 0, error: 'views answered 500' });
  });
});
