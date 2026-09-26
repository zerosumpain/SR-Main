import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HouseholdMember } from './members';

// loadHousehold with the database and the two roster reads faked. What is
// under test is the consent rule: when the pilot's users list cannot be read,
// nobody on the app can be shown as sharing.
const state = vi.hoisted(() => ({
  members: [] as HouseholdMember[],
  users: null as unknown,
  usersThrow: false,
  membersThrow: false,
  calls: 0,
}));

vi.mock('$lib/db', () => ({
  db: {
    execute: async () => {
      // Promise.all issues the latest-fix query first, then today's aggregate.
      const first = state.calls++ % 2 === 0;
      const subjects = state.members.length ? state.members.map((m) => m.subject) : ['alex', 'sam'];
      return {
        rows: first
          ? subjects.map((subject) => ({
              subject,
              ts: new Date(Date.now() - 5 * 60_000),
              is_home: false,
              place_id: null,
              distance_home_km: 2.5,
              battery_pct: 70,
            }))
          : subjects.map((subject) => ({ subject, fixes: 30, out_rows: 10, first_out: new Date(), places_visited: 1 })),
      };
    },
  },
}));
vi.mock('./members', () => ({
  listMembers: async () => {
    if (state.membersThrow) throw new Error('db down');
    return state.members;
  },
}));
vi.mock('./companion', async (importOriginal) => {
  const real = await importOriginal<typeof import('./companion')>();
  return {
    notSharingSubjects: real.notSharingSubjects,
    loadCompanionUsers: async () => {
      if (state.usersThrow) throw new Error('settings unreadable');
      return state.users;
    },
  };
});
vi.mock('./types', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./types')>()),
  FAMILY_SUBJECTS: [
    { subject: 'alex', entity: 'person.alex' },
    { subject: 'sam', entity: 'person.sam' },
  ],
}));

const { loadHousehold } = await import('./household');
const { scopeHousehold } = await import('./viewer');

function member(subject: string, source: HouseholdMember['source']): HouseholdMember {
  return {
    subject,
    email: `${subject}@example.test`,
    displayName: subject,
    source,
    haPersonEntity: null,
    whatsapp: null,
    alerts: {},
  };
}

const POSITION = ['isHome', 'placeLabel', 'distanceHomeKm', 'batteryPct', 'ageMins', 'lastSeenAt', 'today'] as const;

beforeEach(() => {
  state.members = [member('alex', 'life360'), member('sam', 'companion')];
  state.users = null;
  state.usersThrow = false;
  state.membersThrow = false;
  state.calls = 0;
});

describe('loadHousehold — sharing fails closed', () => {
  it('with the list read, a companion member sharing is shown', async () => {
    state.users = [{ email: 'sam@example.test', name: 'Sam', sharing: true }];
    const { members } = await loadHousehold();
    expect(members.find((m) => m.subject === 'sam')!.notSharing).toBeUndefined();
  });

  for (const [label, arrange] of [
    ['the users list is null', () => (state.users = null)],
    ['the users list read throws', () => (state.usersThrow = true)],
  ] as const) {
    it(`when ${label}, every companion member is not sharing, sharing unknown`, async () => {
      arrange();
      const { members } = await loadHousehold();
      const sam = members.find((m) => m.subject === 'sam')!;
      const alex = members.find((m) => m.subject === 'alex')!;
      expect(sam).toMatchObject({ notSharing: true, sharingUnknown: true });
      // Life360 people are not the pilot's to switch off.
      expect(alex.notSharing).toBeUndefined();

      // And a household viewer — even Sam himself — gets no position for him.
      for (const subject of ['alex', 'sam']) {
        const scoped = scopeHousehold(members, { kind: 'household', subject }).find((m) => m.subject === 'sam')!;
        for (const k of POSITION) expect(scoped[k], `${label}: ${k}`).toBeNull();
      }
    });
  }

  it('when the member list itself cannot be read, nobody is shown as sharing', async () => {
    state.membersThrow = true;
    const { members } = await loadHousehold();
    expect(members.map((m) => m.subject)).toEqual(['alex', 'sam']);
    expect(members.every((m) => m.notSharing && m.sharingUnknown)).toBe(true);
    for (const m of scopeHousehold(members, { kind: 'household', subject: 'sam' })) {
      for (const k of POSITION) expect(m[k], k).toBeNull();
    }
  });
});
