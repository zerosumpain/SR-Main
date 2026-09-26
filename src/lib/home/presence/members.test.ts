import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

// A tiny in-memory stand-in for the three drizzle chains members.ts uses, so
// the seed path is tested without the shared dev database.
const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Array<Record<string, unknown>>>,
  conflictIgnored: 0,
  updates: [] as Array<Record<string, unknown>>,
  settings: new Map<string, unknown>(),
  lastWhere: null as unknown,
}));

vi.mock('$lib/server/models/settings', () => ({
  getSetting: async (k: string) => (state.settings.has(k) ? state.settings.get(k) : null),
  setSetting: async (k: string, v: unknown) => {
    state.settings.set(k, v);
  },
}));

vi.mock('$lib/db', () => {
  const select = () => ({
    from: () => {
      const q = {
        where: (cond: unknown) => {
          state.lastWhere = cond;
          return q;
        },
        orderBy: () => q,
        limit: () => q,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve([...state.rows]).then(res, rej),
      };
      return q;
    },
  });
  const insert = () => ({
    values: (vals: Array<Record<string, unknown>>) => ({
      onConflictDoNothing: async () => {
        state.inserts.push(vals);
        state.conflictIgnored++;
        for (const v of vals) {
          if (!state.rows.some((r) => r.subject === v.subject)) state.rows.push({ ...v });
        }
      },
    }),
  });
  const update = () => ({
    set: (patch: Record<string, unknown>) => ({
      where: () => ({
        returning: async () => {
          state.updates.push(patch);
          return state.rows.length ? [{ ...state.rows[0], ...patch }] : [];
        },
      }),
    }),
  });
  return { db: { select, insert, update } };
});

import {
  MEMBERS_SEEDED_KEY,
  followers,
  isLife360Subject,
  lifeSubjects,
  listMembers,
  memberByEmail,
  seedMembers,
  updateMember,
  type HouseholdMember,
} from './members';
import { FAMILY_SUBJECTS } from './types';

function m(subject: string, extra: Partial<HouseholdMember> = {}): HouseholdMember {
  return {
    subject,
    email: null,
    displayName: subject,
    source: 'life360',
    haPersonEntity: `person.${subject}`,
    whatsapp: null,
    alerts: {},
    ...extra,
  };
}

describe('followers', () => {
  it('is everyone except the mover when nobody narrowed their list', () => {
    const out = followers([m('a'), m('b'), m('c')], 'a').map((x) => x.subject);
    expect(out).toEqual(['b', 'c']);
  });

  it('honours a follow list, and never includes the mover even if they follow themselves', () => {
    const members = [
      m('a', { alerts: { follow: ['a', 'b'] } }),
      m('b', { alerts: { follow: ['c'] } }),
      m('c', { alerts: { follow: ['a'] } }),
    ];
    expect(followers(members, 'a').map((x) => x.subject)).toEqual(['c']);
    expect(followers(members, 'b').map((x) => x.subject)).toEqual(['a']);
  });

  it('an empty follow list means nobody, not everybody', () => {
    const members = [m('a'), m('b', { alerts: { follow: [] } })];
    expect(followers(members, 'a')).toEqual([]);
  });
});

describe('seedMembers / lifeSubjects', () => {
  it('seeds every FAMILY_SUBJECTS entry as life360 with its entity and a capitalised name', () => {
    const seed = seedMembers();
    expect(seed).toHaveLength(FAMILY_SUBJECTS.length);
    expect(seed[0]).toMatchObject({
      subject: FAMILY_SUBJECTS[0].subject,
      source: 'life360',
      haPersonEntity: FAMILY_SUBJECTS[0].entity,
    });
    const first = FAMILY_SUBJECTS[0].subject;
    expect(seed[0].displayName).toBe(first[0].toUpperCase() + first.slice(1));
  });

  it('polls only life360 members that carry an entity', () => {
    const out = lifeSubjects([
      m('a'),
      m('b', { source: 'companion' }),
      m('c', { source: 'none' }),
      m('d', { haPersonEntity: null }),
    ]);
    expect(out).toEqual([{ subject: 'a', entity: 'person.a' }]);
  });
});

describe('isLife360Subject', () => {
  it('admits only a life360 member', () => {
    const members = [m('a'), m('b', { source: 'companion' }), m('c', { source: 'none' })];
    expect(isLife360Subject(members, 'a')).toBe(true);
    expect(isLife360Subject(members, 'b')).toBe(false);
    expect(isLife360Subject(members, 'c')).toBe(false);
    expect(isLife360Subject(members, 'stranger')).toBe(false);
  });
});

describe('listMembers', () => {
  beforeEach(() => {
    state.rows = [];
    state.inserts = [];
    state.conflictIgnored = 0;
    state.updates = [];
    state.settings.clear();
  });

  it('seeds an empty table with onConflictDoNothing, returns the seed and records it', async () => {
    const out = await listMembers();
    expect(state.inserts).toHaveLength(1);
    expect(state.conflictIgnored).toBe(1);
    expect(out.map((x) => x.subject)).toEqual(FAMILY_SUBJECTS.map((f) => f.subject));
    expect(state.settings.get(MEMBERS_SEEDED_KEY)).toBe(true);
  });

  it('never reseeds once the seed has been written, even if the table is emptied', async () => {
    await listMembers();
    state.rows = [];
    const out = await listMembers();
    expect(out).toEqual([]);
    expect(state.inserts).toHaveLength(1);
  });

  it('does not seed when the table already has people', async () => {
    state.rows = [{ ...m('someone', { email: 'someone@example.test', source: 'companion' }) }];
    const out = await listMembers();
    expect(state.inserts).toHaveLength(0);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('companion');
  });

  it('reads an unknown source as none, so a typo never polls someone', async () => {
    state.rows = [{ ...m('x'), source: 'carrier-pigeon' }];
    const [x] = await listMembers();
    expect(x.source).toBe('none');
  });
});

describe('updateMember', () => {
  beforeEach(() => {
    state.rows = [{ ...m('a') }];
    state.updates = [];
  });

  it('lower-cases the email and stamps updatedAt', async () => {
    await updateMember('a', { email: '  Someone@Example.TEST ' });
    expect(state.updates[0].email).toBe('someone@example.test');
    expect(state.updates[0].updatedAt).toBeInstanceOf(Date);
  });

  it('turns a blank email into null', async () => {
    await updateMember('a', { email: '  ' });
    expect(state.updates[0].email).toBeNull();
  });
});

describe('memberByEmail — case-insensitive', () => {
  it('compares lower(email) with the lower-cased address', async () => {
    state.rows = [{ ...m('sam', { email: 'sam@example.test', source: 'companion' }) }];
    const found = await memberByEmail('  Sam@Example.TEST ');
    expect(found?.subject).toBe('sam');
    const q = new PgDialect().sqlToQuery(state.lastWhere as SQL);
    expect(q.sql).toBe('lower("household_member"."email") = $1');
    expect(q.params).toEqual(['sam@example.test']);
  });

  it('asks nothing for a blank address', async () => {
    state.lastWhere = null;
    expect(await memberByEmail('  ')).toBeNull();
    expect(state.lastWhere).toBeNull();
  });
});
