import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real viewer chain — $lib/server/viewer → $lib/server/owner — runs; only
// the database-reading lookups under it are faked.
const ownerEmails = new Set(['owner@example.test']);
const householdSubjects = new Map<string, string>();
/** email → the permissions they hold (a member). */
const memberGrants = new Map<string, string[]>();
let lookupFails = false;

vi.mock('$lib/server/access', () => ({
  isOwnerEmail: (email: string | null | undefined) => ownerEmails.has((email ?? '').trim().toLowerCase()),
}));
vi.mock('$lib/server/members', () => ({
  householdSubjectFor: async (email: string) => {
    if (lookupFails) throw new Error('db down');
    return householdSubjects.get(email) ?? null;
  },
}));
vi.mock('$lib/server/grants', () => ({
  loadMember: async (email: string) => {
    if (lookupFails) throw new Error('db down');
    const grants = memberGrants.get(email);
    return grants ? { principalId: 'u_abc', grants: new Set(grants) } : null;
  },
}));
vi.mock('$lib/db', () => ({ db: {} }));

const { peopleViewerOf, personLinks, scopeHousehold } = await import('./viewer');
type Presence = import('./household').HouseholdPresence;

function eventFor(email: string | null) {
  return {
    locals: { auth: async () => (email ? { user: { email } } : null) } as unknown as App.Locals,
    // A public address, so the dev-only LAN bypass never makes anyone owner.
    getClientAddress: () => '203.0.113.9',
  };
}

beforeEach(() => {
  householdSubjects.clear();
  memberGrants.clear();
  lookupFails = false;
});

describe('peopleViewerOf', () => {
  it('owner ⇒ owner, without a household lookup', async () => {
    lookupFails = true;
    expect(await peopleViewerOf(eventFor('owner@example.test'))).toEqual({ kind: 'owner' });
  });

  it('family:circle + a household_member row ⇒ their subject', async () => {
    memberGrants.set('sam@example.test', ['family:circle']);
    householdSubjects.set('sam@example.test', 'sam');
    expect(await peopleViewerOf(eventFor('Sam@Example.test'))).toEqual({ kind: 'household', subject: 'sam' });
  });

  it('family:circle with no household_member row has nobody to be ⇒ null', async () => {
    memberGrants.set('sam@example.test', ['family:circle']);
    expect(await peopleViewerOf(eventFor('sam@example.test'))).toBeNull();
  });

  it('a household_member row without family:circle is someone tracked, not someone who may look ⇒ null', async () => {
    memberGrants.set('sam@example.test', ['jkai.intel:self']);
    householdSubjects.set('sam@example.test', 'sam');
    expect(await peopleViewerOf(eventFor('sam@example.test'))).toBeNull();
  });

  it('a guest, an intel-only member, a signed-out visitor ⇒ null', async () => {
    memberGrants.set('m@example.test', ['jkai.intel:self']);
    expect(await peopleViewerOf(eventFor('m@example.test'))).toBeNull();
    expect(await peopleViewerOf(eventFor('guest@example.test'))).toBeNull();
    expect(await peopleViewerOf(eventFor(null))).toBeNull();
  });

  it('fails closed when the lookup throws', async () => {
    memberGrants.set('sam@example.test', ['family:circle']);
    householdSubjects.set('sam@example.test', 'sam');
    lookupFails = true;
    expect(await peopleViewerOf(eventFor('sam@example.test'))).toBeNull();
  });
});

function card(subject: string, extra: Partial<Presence> = {}): Presence {
  return {
    subject,
    isHome: false,
    placeLabel: 'Somewhere',
    distanceHomeKm: 3.2,
    batteryPct: 64,
    ageMins: 4,
    lastSeenAt: new Date('2026-09-26T10:00:00Z'),
    today: { firstOutMins: 480, minutesOut: 90, placesVisited: 2, fixes: 150 },
    ...extra,
  };
}

describe('scopeHousehold', () => {
  const members = [card('alex'), card('sam'), card('robin', { notSharing: true })];

  it('gives the owner everything, unchanged', () => {
    expect(scopeHousehold(members, { kind: 'owner' })).toEqual(members);
  });

  it("keeps the viewer's own day and nobody else's", () => {
    const out = scopeHousehold(members, { kind: 'household', subject: 'sam' });
    const by = new Map(out.map((m) => [m.subject, m]));
    expect(by.get('sam')!.today).toEqual(members[1].today);
    expect(by.get('alex')!.today).toBeNull();
  });

  it('keeps live status for everyone sharing', () => {
    const alex = scopeHousehold(members, { kind: 'household', subject: 'sam' }).find((m) => m.subject === 'alex')!;
    expect(alex).toMatchObject({
      isHome: false,
      placeLabel: 'Somewhere',
      distanceHomeKm: 3.2,
      batteryPct: 64,
      ageMins: 4,
    });
    expect(alex.lastSeenAt).toEqual(members[0].lastSeenAt);
  });

  it('shows someone not sharing as not sharing, with no position data at all', () => {
    for (const subject of ['sam', 'robin']) {
      const robin = scopeHousehold(members, { kind: 'household', subject }).find((m) => m.subject === 'robin')!;
      expect(robin).toEqual({
        subject: 'robin',
        notSharing: true,
        isHome: null,
        placeLabel: null,
        distanceHomeKm: null,
        batteryPct: null,
        ageMins: null,
        lastSeenAt: null,
        today: null,
      });
    }
  });

  it('passes on no field it was not told to', () => {
    const withExtra = [{ ...card('alex'), secretTrack: [[51.0, -1.0]] } as unknown as Presence];
    const [alex] = scopeHousehold(withExtra, { kind: 'household', subject: 'sam' });
    expect(alex).not.toHaveProperty('secretTrack');
  });
});

describe('personLinks', () => {
  it('gives the owner every person page and a household viewer only their own', () => {
    const subjects = ['alex', 'sam', 'robin'];
    expect(personLinks(subjects, { kind: 'owner' })).toEqual({
      alex: '/home/people/alex',
      sam: '/home/people/sam',
      robin: '/home/people/robin',
    });
    expect(personLinks(subjects, { kind: 'household', subject: 'sam' })).toEqual({ sam: '/home/people/sam' });
    // Not on the list, so no link — even to themselves.
    expect(personLinks(['alex'], { kind: 'household', subject: 'sam' })).toEqual({});
  });
});
