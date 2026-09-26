import { beforeEach, describe, expect, it, vi } from 'vitest';

// The REAL load with a faked `locals`; only the database readers are faked.
const householdSubjects = new Map<string, string>();

vi.mock('$lib/server/access', () => ({
  isOwnerEmail: (email: string | null | undefined) => (email ?? '').toLowerCase() === 'owner@example.test',
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

const listMembers = vi.fn(async () => [
  { subject: 'alex', displayName: 'Alex', email: null, source: 'life360', haPersonEntity: null, whatsapp: null, alerts: {} },
  { subject: 'sam', displayName: 'Sam', email: 'sam@example.test', source: 'companion', haPersonEntity: null, whatsapp: null, alerts: {} },
]);
vi.mock('$lib/home/presence/members', () => ({ listMembers }));

const STATS = {
  byMode: {
    foot: { count: 1, metres: 1500, seconds: 1200 },
    car: { count: 0, metres: 0, seconds: 0 },
    rail: { count: 0, metres: 0, seconds: 0 },
    other: { count: 0, metres: 0, seconds: 0 },
  },
  walkingPace: null,
  commonTrips: [],
  timeOut: [],
};
const loadMovementStats = vi.fn(async (_subject: string, _opts?: unknown) => STATS);
vi.mock('$lib/home/presence/movement', () => ({ loadMovementStats }));

const { load } = await import('./+page.server');

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
  listMembers.mockClear();
  loadMovementStats.mockClear();
  loadMovementStats.mockImplementation(async () => STATS);
});

const page = (subject: string, displayName: string) => ({
  subject,
  displayName,
  days: 30,
  stats: STATS,
  loadError: null,
});

describe('/home/people/[subject] load — the guard', () => {
  it('lets a household viewer open their own page', async () => {
    expect(await load(eventFor('sam@example.test', 'sam'))).toEqual(page('sam', 'Sam'));
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
    expect(data).toMatchObject({ subject: 'sam', stats: null, loadError: 'The trail could not be read just now.' });
  });

  it('sends no coordinates to the page', async () => {
    const data = await load(eventFor('owner@example.test', 'alex'));
    expect(JSON.stringify(data)).not.toMatch(/"(lat|lon|latitude|longitude)"/);
  });
});
