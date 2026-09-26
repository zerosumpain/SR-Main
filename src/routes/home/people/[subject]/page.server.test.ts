import { beforeEach, describe, expect, it, vi } from 'vitest';

// The REAL load with a faked `locals`; only the database readers are faked.
const householdSubjects = new Map<string, string>();
/** email → the subjects that Family Admin is guardian of. */
const guardianOf = new Map<string, string[]>();

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
    householdSubjects.has(email)
      ? { principalId: 'u_test', grants: new Set(guardianOf.has(email) ? ['family:circle', 'family:admin'] : ['family:circle']) }
      : null,
}));
vi.mock('$lib/db', () => ({ db: {} }));

const listMembers = vi.fn(async () => [
  { subject: 'alex', displayName: 'Alex', email: null, source: 'life360', haPersonEntity: null, whatsapp: null, alerts: {} },
  { subject: 'sam', displayName: 'Sam', email: 'sam@example.test', source: 'companion', haPersonEntity: null, whatsapp: null, alerts: {} },
]);
const wardsOf = async (subject: string) =>
  [...guardianOf.entries()].flatMap(([email, wards]) => (householdSubjects.get(email) === subject ? wards : []));
vi.mock('$lib/home/presence/members', () => ({ listMembers, wardsOf }));

const STATS = {
  byMode: {
    foot: { count: 1, metres: 1500, seconds: 1200 },
    car: { count: 0, metres: 0, seconds: 0 },
    rail: { count: 0, metres: 0, seconds: 0 },
    other: { count: 0, metres: 0, seconds: 0 },
  },
  walkingPace: null,
  commonTrips: [],
  roundTrips: null,
  timeOut: [],
  placeTime: { windowMinutes: 43200, places: [], unnamed: { minutes: 0, visits: 0 }, transitMinutes: 20 },
};
// Made-up coordinates (51.0, -1.0): this repo is public.
const COMMUTING = [
  {
    id: '1790000000000',
    startedAt: '2026-09-20T07:40:00.000Z',
    endedAt: '2026-09-20T08:05:00.000Z',
    mode: 'car',
    distanceKm: 14.2,
    minutes: 25,
    meanSpeedKmh: 34.1,
    fromLabel: 'Home',
    toLabel: null,
    route: [
      [-1.0, 51.0],
      [-1.0, 51.12],
    ],
  },
];
const loadPersonMovement = vi.fn(async (_subject: string, _opts?: unknown) => ({ stats: STATS, commuting: COMMUTING }));
const loadMovementStats = loadPersonMovement;
vi.mock('$lib/home/presence/movement', () => ({ loadPersonMovement }));

const { load } = await import('./+page.server');

/** The load, typed as the object it returns (never `void` here: every path returns or throws). */
const loaded = async (email: string | null, subject: string) =>
  (await load(eventFor(email, subject))) as { stats: unknown; commuting: unknown; yourDay: boolean };

function eventFor(email: string | null, subject: string) {
  return {
    locals: { auth: async () => (email ? { user: { email } } : null) } as unknown as App.Locals,
    getClientAddress: () => '203.0.113.9',
    params: { subject },
  } as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
  householdSubjects.clear();
  householdSubjects.set('sam@example.test', 'sam');
  guardianOf.clear();
  listMembers.mockClear();
  loadMovementStats.mockClear();
  loadMovementStats.mockImplementation(async () => ({ stats: STATS, commuting: COMMUTING }));
});

const page = (subject: string, displayName: string, yourDay = false) => ({
  subject,
  yourDay,
  displayName,
  days: 30,
  stats: STATS,
  commuting: COMMUTING,
  loadError: null,
});

describe('/home/people/[subject] load — the guard', () => {
  it('lets a household viewer open their own page', async () => {
    expect(await load(eventFor('sam@example.test', 'sam'))).toEqual(page('sam', 'Sam', true));
    expect(loadMovementStats).toHaveBeenCalledWith('sam', { days: 30 });
  });

  it("403s a household viewer asking for someone else's, before any lookup", async () => {
    await expect(load(eventFor('sam@example.test', 'alex'))).rejects.toMatchObject({ status: 403 });
    // An unknown name gets the same answer, so the page cannot list the household.
    await expect(load(eventFor('sam@example.test', 'nobody'))).rejects.toMatchObject({ status: 403 });
    expect(listMembers).not.toHaveBeenCalled();
    expect(loadMovementStats).not.toHaveBeenCalled();
  });

  it('lets the owner open anyone, and 404s a subject that does not exist', async () => {
    expect(await load(eventFor('owner@example.test', 'alex'))).toEqual(page('alex', 'Alex'));
    expect(loadMovementStats).toHaveBeenCalledWith('alex', { days: 30 });
    await expect(load(eventFor('owner@example.test', 'nobody'))).rejects.toMatchObject({ status: 404 });
  });

  it('403s a guest and a signed-out visitor', async () => {
    await expect(load(eventFor('guest@example.test', 'sam'))).rejects.toMatchObject({ status: 403 });
    await expect(load(eventFor(null, 'sam'))).rejects.toMatchObject({ status: 403 });
    expect(loadMovementStats).not.toHaveBeenCalled();
  });
});

describe('/home/people/[subject] load — the stats', () => {
  it('draws the page with a plain message when the trail cannot be read', async () => {
    loadMovementStats.mockImplementation(async () => {
      throw new Error('relation "daydream_trail" does not exist');
    });
    const data = await load(eventFor('sam@example.test', 'sam'));
    expect(data).toMatchObject({
      subject: 'sam',
      stats: null,
      commuting: [],
      loadError: 'The trail could not be read just now.',
    });
  });

  it('keeps the stats coordinate-free: routes travel only in `commuting`', async () => {
    const data = await loaded('owner@example.test', 'alex');
    expect(JSON.stringify(data.stats)).not.toMatch(/"(lat|lon|latitude|longitude|route)"/);
    expect(JSON.stringify({ ...data, commuting: undefined })).not.toMatch(/"route"/);
  });
});

describe('/home/people/[subject] load — commuting visibility', () => {
  it("gives a household viewer their own commuting, and never anyone else's", async () => {
    expect((await loaded('sam@example.test', 'sam')).commuting).toEqual(COMMUTING);
    await expect(load(eventFor('sam@example.test', 'alex'))).rejects.toMatchObject({ status: 403 });
    // The trail (and so any route) was read for Sam alone.
    expect(loadPersonMovement.mock.calls.map((c) => c[0])).toEqual(['sam']);
  });

  it("gives a guardian their ward's commuting, and the owner anyone's", async () => {
    guardianOf.set('sam@example.test', ['alex']);
    expect((await loaded('sam@example.test', 'alex')).commuting).toEqual(COMMUTING);
    expect((await loaded('owner@example.test', 'alex')).commuting).toEqual(COMMUTING);
  });

  it('reads no trail for a guest or a signed-out visitor', async () => {
    await expect(load(eventFor('guest@example.test', 'alex'))).rejects.toMatchObject({ status: 403 });
    await expect(load(eventFor(null, 'alex'))).rejects.toMatchObject({ status: 403 });
    expect(loadPersonMovement).not.toHaveBeenCalled();
  });
});

describe('/home/people/[subject] load — "Your day" is offered on your own page only', () => {
  it('offers it to a circle member on their own page', async () => {
    expect((await loaded('sam@example.test', 'sam')).yourDay).toBe(true);
  });

  it('does not offer it to a guardian on a ward’s page — the day is read from the viewer’s own phone', async () => {
    guardianOf.set('sam@example.test', ['alex']);
    expect((await loaded('sam@example.test', 'alex')).yourDay).toBe(false);
  });

  it('shows the owner nothing of it on someone else’s page, and offers it on their own', async () => {
    // The owner's email is on no household row: no page is theirs.
    expect((await loaded('owner@example.test', 'alex')).yourDay).toBe(false);
    expect((await loaded('owner@example.test', 'sam')).yourDay).toBe(false);
    // Once it is on Alex's row, Alex's page is the owner's own.
    householdSubjects.set('owner@example.test', 'alex');
    expect((await loaded('owner@example.test', 'alex')).yourDay).toBe(true);
    expect((await loaded('owner@example.test', 'sam')).yourDay).toBe(false);
  });
});
