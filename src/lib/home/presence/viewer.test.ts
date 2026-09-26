import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real viewer chain — $lib/server/viewer → $lib/server/owner — runs; only
// the database-reading lookups under it are faked.
const ownerEmails = new Set(['owner@example.test']);
const householdSubjects = new Map<string, string>();
const memberPrincipals = new Map<string, string>();
let lookupFails = false;

vi.mock('$lib/server/access', () => ({
  isOwnerEmail: (email: string | null | undefined) => ownerEmails.has((email ?? '').trim().toLowerCase()),
}));
vi.mock('$lib/server/members', () => ({
  memberPrincipalFor: async (email: string) => {
    if (lookupFails) throw new Error('db down');
    return memberPrincipals.get(email) ?? null;
  },
  householdSubjectFor: async (email: string) => {
    if (lookupFails) throw new Error('db down');
    return householdSubjects.get(email) ?? null;
  },
}));
vi.mock('$lib/db', () => ({ db: {} }));

const { peopleViewerOf, scopeHousehold } = await import('./viewer');
const { viewerOf } = await import('$lib/server/viewer');
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
  memberPrincipals.clear();
  lookupFails = false;
});

describe('viewerOf — the household kind', () => {
  it('resolves role household + a household_member row to the subject', async () => {
    householdSubjects.set('sam@example.test', 'sam');
    expect(await viewerOf(eventFor('Sam@Example.test'))).toEqual({
      kind: 'household',
      subject: 'sam',
      email: 'sam@example.test',
    });
  });

  it('leaves a member a member and anyone else a guest', async () => {
    memberPrincipals.set('m@example.test', 'u_abc');
    expect((await viewerOf(eventFor('m@example.test'))).kind).toBe('member');
    expect((await viewerOf(eventFor('nobody@example.test'))).kind).toBe('guest');
  });
});

describe('peopleViewerOf', () => {
  it('owner ⇒ owner, without a household lookup', async () => {
    lookupFails = true;
    expect(await peopleViewerOf(eventFor('owner@example.test'))).toEqual({ kind: 'owner' });
  });

  it('household ⇒ their subject', async () => {
    householdSubjects.set('sam@example.test', 'sam');
    expect(await peopleViewerOf(eventFor('sam@example.test'))).toEqual({ kind: 'household', subject: 'sam' });
  });

  it('a guest, a member, a signed-out visitor ⇒ null', async () => {
    memberPrincipals.set('m@example.test', 'u_abc');
    expect(await peopleViewerOf(eventFor('m@example.test'))).toBeNull();
    expect(await peopleViewerOf(eventFor('guest@example.test'))).toBeNull();
    expect(await peopleViewerOf(eventFor(null))).toBeNull();
  });

  it('fails closed when the lookup throws', async () => {
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
