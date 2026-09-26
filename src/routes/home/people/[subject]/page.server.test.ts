import { beforeEach, describe, expect, it, vi } from 'vitest';

// The REAL load with a faked `locals`; only the database readers are faked.
const householdSubjects = new Map<string, string>();

vi.mock('$lib/server/access', () => ({
  isOwnerEmail: (email: string | null | undefined) => (email ?? '').toLowerCase() === 'owner@example.test',
}));
vi.mock('$lib/server/members', () => ({
  memberPrincipalFor: async () => null,
  householdSubjectFor: async (email: string) => householdSubjects.get(email) ?? null,
}));
vi.mock('$lib/db', () => ({ db: {} }));

const listMembers = vi.fn(async () => [
  { subject: 'alex', displayName: 'Alex', email: null, source: 'life360', haPersonEntity: null, whatsapp: null, alerts: {} },
  { subject: 'sam', displayName: 'Sam', email: 'sam@example.test', source: 'companion', haPersonEntity: null, whatsapp: null, alerts: {} },
]);
vi.mock('$lib/home/presence/members', () => ({ listMembers }));

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
});

describe('/home/people/[subject] load — the guard', () => {
  it('lets a household viewer open their own page', async () => {
    expect(await load(eventFor('sam@example.test', 'sam'))).toEqual({ subject: 'sam', displayName: 'Sam' });
  });

  it("403s a household viewer asking for someone else's, before any lookup", async () => {
    await expect(load(eventFor('sam@example.test', 'alex'))).rejects.toMatchObject({ status: 403 });
    // An unknown name gets the same answer, so the page cannot list the household.
    await expect(load(eventFor('sam@example.test', 'nobody'))).rejects.toMatchObject({ status: 403 });
    expect(listMembers).not.toHaveBeenCalled();
  });

  it('lets the owner open anyone, and 404s a subject that does not exist', async () => {
    expect(await load(eventFor('owner@example.test', 'alex'))).toEqual({ subject: 'alex', displayName: 'Alex' });
    await expect(load(eventFor('owner@example.test', 'nobody'))).rejects.toMatchObject({ status: 404 });
  });

  it('403s a guest and a signed-out visitor', async () => {
    await expect(load(eventFor('guest@example.test', 'sam'))).rejects.toMatchObject({ status: 403 });
    await expect(load(eventFor(null, 'sam'))).rejects.toMatchObject({ status: 403 });
  });
});
