import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  token: 'tok' as string | null,
  users: [] as Array<{ email: string; name: string; sharing: boolean; sitePairWanted?: string | null }> | null,
  viewers: new Map<string, unknown>(),
  trailRows: [] as unknown[],
  posted: [] as unknown[],
  status: 200,
  owners: new Set<string>(),
  members: new Map<string, { principalId: string; grants: Set<string> }>(),
  minted: [] as Array<{ email: string; code: string; expiresAt: Date }>,
  live: new Set<string>(),
  ttlMs: 10 * 60_000,
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
// The access flags run for real (`appAccessFrom`); only who is an owner, who
// is a member and the credential table are stood in for.
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => h.owners.has(String(e).toLowerCase()) }));
vi.mock('$lib/server/grants', () => ({ loadMember: async (e: string) => h.members.get(e) ?? null }));
vi.mock('$lib/server/native-auth', () => ({
  createPairingCode: async (email: string) => {
    const minted = { email, code: `code-${h.minted.length + 1}`, expiresAt: new Date(NOW.getTime() + h.ttlMs) };
    h.minted.push(minted);
    h.live.add(minted.code);
    return { code: minted.code, expiresAt: minted.expiresAt };
  },
  isPairingCodeLive: async (code: string) => h.live.has(code),
}));
vi.mock('./viewer', async (orig) => {
  const real = await orig<typeof import('./viewer')>();
  return { ...real, peopleViewerForEmail: async (email: string) => h.viewers.get(email) ?? null };
});

const { buildAppView, movingFrom, summariseTrail, thin, trailSubjects, pushAppViews, resetSitePairCache, sitePairWanted } = await import(
  './app-view'
);
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
  h.owners = new Set(['owner@example.test']);
  h.members.clear();
  h.minted = [];
  h.live.clear();
  h.ttlMs = 10 * 60_000;
  resetSitePairCache();
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

describe('movingFrom', () => {
  // NOW is 09:05Z = minute 605 from DAY_START. 0.001° of latitude is ~111 m.
  const walk = [pt(597, 51, 0), pt(599, 51.0015, 0), pt(601, 51.003, 0), pt(603, 51.0045, 0), pt(604, 51.005, 0)];

  it('reads a steady walk as walking, with its speed and when the stretch began', () => {
    const m = movingFrom(walk, NOW);
    expect(m).toMatchObject({ mode: 'walking', since: at(597).toISOString() });
    expect(m!.speedKmh).toBeGreaterThanOrEqual(3);
    expect(m!.speedKmh).toBeLessThanOrEqual(6);
  });

  it('reads a drive as a vehicle', () => {
    const drive = [pt(600, 51, 0), pt(601, 51.01, 0), pt(602, 51.02, 0), pt(603, 51.03, 0), pt(604, 51.04, 0)];
    expect(movingFrom(drive, NOW)?.mode).toBe('vehicle');
  });

  it('is still for drift at a desk, however many fixes', () => {
    const desk = [596, 597, 598, 599, 600, 601, 602, 603, 604].map((m, i) => pt(m, 51 + (i % 2) * 0.0004, 0));
    expect(movingFrom(desk, NOW)).toBeNull();
  });

  it('is null when the newest fix is stale — that is where they WERE moving', () => {
    expect(movingFrom(walk.map((p) => ({ ...p, ts: new Date(p.ts.getTime() - 7 * 60_000) })), NOW)).toBeNull();
  });

  it('ignores fixes outside the window and ones too inaccurate to use', () => {
    const old = [pt(500, 50, 0), pt(604, 51, 0), pt(604.5, 51.0001, 0)];
    expect(movingFrom(old, NOW)).toBeNull();
    const vague = walk.map((p) => ({ ...p, accuracyM: 400 }));
    expect(movingFrom(vague, NOW)).toBeNull();
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
    expect(kit).toMatchObject({ status: 'off', position: null, batteryPct: null, lastSeenAt: null, today: null, moving: null });
  });

  it('says who is moving from the recent fixes, for anyone with a pin, never for someone not sharing', () => {
    const viewer = { kind: 'household' as const, subject: 'sam', wards: [] };
    const drive = (lat: number) => [pt(601, lat, 0), pt(602, lat + 0.01, 0), pt(603, lat + 0.02, 0), pt(604, lat + 0.03, 0)];
    const recent = new Map([['john', drive(51)], ['kit', drive(52)]]);
    const view = buildAppView({ ...base, recent, viewer, self: null, scoped: scopeHousehold(household, viewer) });
    const by = new Map(view.people.map((p) => [p.subject, p]));
    // John's day is not Sam's to see, but that he is driving is on the map anyway.
    expect(by.get('john')?.today).toBeNull();
    expect(by.get('john')?.moving?.mode).toBe('vehicle');
    expect(by.get('sam')?.moving).toBeNull();
    expect(by.get('kit')?.moving).toBeNull();
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

  it('builds a view for everyone on the app, counting those who see nobody as refused', async () => {
    h.users = [
      { email: 'Owner@Example.test', name: 'J', sharing: true },
      { email: 'stranger@example.test', name: 'S', sharing: true },
    ];
    h.viewers.set('owner@example.test', { kind: 'owner' });
    const res = await pushAppViews(members, fakeFetch(), NOW);
    expect(res).toEqual({ stored: 1, refused: 1 });
    type Posted = { email: string; view: { viewer: string; watch?: unknown; access: Record<string, unknown>; people: Array<{ subject: string; self: boolean }> } };
    const body = h.posted[0] as { views: Posted[] };
    expect(body.views.map((v) => v.email)).toEqual(['stranger@example.test', 'owner@example.test']);
    const owner = body.views[1].view;
    expect(owner.people.find((p) => p.subject === 'john')?.self).toBe(true);
    expect(owner.access).toEqual({
      owner: true, chat: true, news: true, research: true, notes: true, intel: true, family: true, sitePair: null,
    });
    // Somebody with no site access and no household row: nobody, no places, nothing offered.
    const stranger = body.views[0].view;
    expect(stranger).toMatchObject({ viewer: 'none', people: [] });
    expect(stranger.watch).toBeUndefined();
    expect(Object.values(stranger.access).every((v) => v === false || v === null)).toBe(true);
  });

  it("offers a member exactly what their grants hold, and the family only through the Circle rule", async () => {
    h.users = [{ email: 'ann@example.test', name: 'A', sharing: true }];
    h.members.set('ann@example.test', { principalId: 'u_ann', grants: new Set(['news:self', 'jkai.chat:all', 'family:circle']) });
    await pushAppViews(members, fakeFetch(), NOW);
    const body = h.posted[0] as { views: Array<{ view: { access: Record<string, unknown> } }> };
    // family:circle alone is not the family: she has no household row, so
    // `peopleViewerForEmail` (stood in for here) says no, and so does the flag.
    expect(body.views[0].view.access).toEqual({
      owner: false, chat: true, news: true, research: false, notes: false, intel: false, family: false, sitePair: null,
    });
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

  it('still posts when nobody qualifies, so a revoked view is emptied', async () => {
    h.users = [{ email: 'stranger@example.test', name: 'S', sharing: true }];
    await pushAppViews(members, fakeFetch(), NOW);
    const body = h.posted[0] as { views: Array<{ view: { people: unknown[] } }> };
    expect(body.views).toHaveLength(1);
    expect(body.views[0].view.people).toEqual([]);
  });

  it('reports a refusal from the pilot rather than throwing', async () => {
    h.users = [];
    h.status = 500;
    expect(await pushAppViews(members, fakeFetch(), NOW)).toEqual({ stored: 0, refused: 0, error: 'views answered 500' });
  });
});

describe('site pairing through the push', () => {
  function fakeFetch() {
    return (async (_url: string, init: RequestInit) => {
      h.posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ stored: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
  }
  const asked = (minsAgo: number) => new Date(NOW.getTime() - minsAgo * 60_000).toISOString();
  const pairOf = (i = h.posted.length - 1) =>
    (h.posted[i] as { views: Array<{ email: string; view: { access: { sitePair: { server: string; code: string; expiresAt: string } | null } } }> })
      .views[0].view.access.sitePair;

  beforeEach(() => {
    h.members.set('ann@example.test', { principalId: 'u_ann', grants: new Set(['jkai.chat:self']) });
  });

  it('mints a code for a member holding chat who asked in the last 15 minutes', async () => {
    h.users = [{ email: 'ann@example.test', name: 'A', sharing: true, sitePairWanted: asked(3) }];
    await pushAppViews([], fakeFetch(), NOW);
    expect(h.minted.map((m) => m.email)).toEqual(['ann@example.test']);
    expect(pairOf()).toEqual({
      server: expect.stringMatching(/^https?:\/\/[^/]+$/),
      code: 'code-1',
      expiresAt: h.minted[0].expiresAt.toISOString(),
    });
  });

  it('re-sends the same code every cycle rather than rotating the one on screen', async () => {
    h.users = [{ email: 'ann@example.test', name: 'A', sharing: true, sitePairWanted: asked(1) }];
    await pushAppViews([], fakeFetch(), NOW);
    await pushAppViews([], fakeFetch(), NOW);
    await pushAppViews([], fakeFetch(), NOW);
    expect(h.minted).toHaveLength(1);
    expect([pairOf(0)?.code, pairOf(1)?.code, pairOf(2)?.code]).toEqual(['code-1', 'code-1', 'code-1']);
  });

  it('mints afresh once the code is spent, or has under two minutes left', async () => {
    h.users = [{ email: 'ann@example.test', name: 'A', sharing: true, sitePairWanted: asked(1) }];
    await pushAppViews([], fakeFetch(), NOW);
    h.live.delete('code-1'); // redeemed by the phone
    await pushAppViews([], fakeFetch(), NOW);
    expect(pairOf()?.code).toBe('code-2');

    h.ttlMs = 90_000; // the next one is minted nearly dead
    h.live.delete('code-2');
    await pushAppViews([], fakeFetch(), NOW);
    await pushAppViews([], fakeFetch(), NOW);
    expect(h.minted.map((m) => m.code)).toEqual(['code-1', 'code-2', 'code-3', 'code-4']);
  });

  it('sends nothing for a stale ask, no ask, the owner, or a member with neither chat nor news', async () => {
    h.users = [
      { email: 'ann@example.test', name: 'A', sharing: true, sitePairWanted: asked(20) },
      { email: 'bob@example.test', name: 'B', sharing: true },
      { email: 'owner@example.test', name: 'J', sharing: true, sitePairWanted: asked(1) },
      { email: 'cat@example.test', name: 'C', sharing: true, sitePairWanted: asked(1) },
    ];
    h.members.set('bob@example.test', { principalId: 'u_bob', grants: new Set(['news:self']) });
    h.members.set('cat@example.test', { principalId: 'u_cat', grants: new Set(['research:self', 'family:circle']) });
    h.viewers.set('owner@example.test', { kind: 'owner' });
    await pushAppViews(members(), fakeFetch(), NOW);
    const body = h.posted[0] as { views: Array<{ email: string; view: { access: { sitePair: unknown } } }> };
    expect(body.views.map((v) => [v.email, v.view.access.sitePair])).toEqual([
      ['ann@example.test', null],
      ['bob@example.test', null],
      ['cat@example.test', null],
      ['owner@example.test', null],
    ]);
    expect(h.minted).toEqual([]);
  });

  it('reads the ask window strictly, and ignores a stamp from the future', () => {
    expect(sitePairWanted(null, NOW)).toBe(false);
    expect(sitePairWanted('not a date', NOW)).toBe(false);
    expect(sitePairWanted(asked(14.9), NOW)).toBe(true);
    expect(sitePairWanted(asked(15.1), NOW)).toBe(false);
    expect(sitePairWanted(asked(-1), NOW)).toBe(true);
    expect(sitePairWanted(asked(-60), NOW)).toBe(false);
  });

  function members() {
    return [
      { subject: 'john', email: 'owner@example.test', displayName: 'John', source: 'companion' as const, haPersonEntity: null, whatsapp: null, alerts: {} },
    ];
  }
});
