import { beforeEach, describe, expect, it, vi } from 'vitest';

// Runs the REAL load with a faked `locals`. The viewer chain is real too
// ($lib/home/presence/viewer → $lib/server/viewer → $lib/server/owner); only
// the modules that read the database are faked.
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
const DETAIL = {
  alex: { hypotheses: ['a private note about alex'], thoughts: ['a thought'] },
  sam: { hypotheses: ['a private note about sam'], thoughts: [] },
};

const loadHousehold = vi.fn(async () => ({ members: MEMBERS.map((m) => ({ ...m })) }));
const loadFamily = vi.fn(async () => ({ members: MEMBERS.map((m) => ({ ...m })), detail: DETAIL }));
vi.mock('$lib/home/presence/household', () => ({ loadHousehold }));
vi.mock('$lib/daydream/ledger', () => ({ loadFamily }));

const { load } = await import('./+page.server');

function eventFor(email: string | null) {
  return {
    locals: { auth: async () => (email ? { user: { email } } : null) } as unknown as App.Locals,
    getClientAddress: () => '203.0.113.9',
    params: {},
  } as unknown as Parameters<typeof load>[0];
}

type Scoped = import('$lib/home/presence/viewer').ScopedPresence;
interface PeopleData {
  family: { members: Scoped[]; detail: Record<string, unknown> };
  viewer: import('$lib/home/presence/viewer').PeopleViewer;
  links: Record<string, string>;
  loadError: string | null;
}
async function run(email: string | null): Promise<PeopleData> {
  return (await load(eventFor(email))) as PeopleData;
}

beforeEach(() => {
  householdSubjects.clear();
  householdSubjects.set('sam@example.test', 'sam');
  loadHousehold.mockClear();
  loadFamily.mockClear();
});

describe('/home/people load — D2 scoping', () => {
  it('gives the owner the family ledger, detail and every day included', async () => {
    const data = await run('owner@example.test');
    expect(data.viewer).toEqual({ kind: 'owner' });
    expect(loadFamily).toHaveBeenCalledOnce();
    expect(data.family.detail).toEqual(DETAIL);
    expect(data.family.members.every((m) => m.today !== null)).toBe(true);
  });

  it("gives a household viewer no daydream detail and no one else's day", async () => {
    const data = await run('sam@example.test');
    expect(data.viewer).toEqual({ kind: 'household', subject: 'sam', wards: [] });
    expect(loadFamily).not.toHaveBeenCalled();
    expect(data.family.detail).toEqual({});

    const by = new Map(data.family.members.map((m) => [m.subject, m]));
    expect(by.get('sam')!.today).toEqual(MEMBERS[1].today);
    expect(by.get('alex')!.today).toBeNull();
    // Live status for everyone sharing.
    expect(by.get('alex')).toMatchObject({ isHome: false, placeLabel: 'Somewhere', batteryPct: 80 });

    // The payload as it would be serialised to the browser: nothing about
    // anyone else's day, and nothing of the owner's notes.
    const wire = JSON.stringify(data);
    expect(wire).not.toContain('private note');
    expect(wire).not.toContain('hypotheses');
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
      alex: '/home/people/alex',
      sam: '/home/people/sam',
      robin: '/home/people/robin',
    });
    expect((await run('sam@example.test')).links).toEqual({ sam: '/home/people/sam' });
  });

  it('refuses a guest and a signed-out visitor', async () => {
    await expect(load(eventFor('guest@example.test'))).rejects.toMatchObject({ status: 403 });
    await expect(load(eventFor(null))).rejects.toMatchObject({ status: 403 });
    expect(loadHousehold).not.toHaveBeenCalled();
    expect(loadFamily).not.toHaveBeenCalled();
  });

  it('hides the failure detail from a household viewer', async () => {
    loadHousehold.mockRejectedValueOnce(new Error('relation "daydream_trail" does not exist'));
    const data = await run('sam@example.test');
    expect(data.family.members).toEqual([]);
    expect(data.loadError).not.toContain('daydream_trail');
  });
});
