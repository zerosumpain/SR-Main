import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

// The household lookup's query, captured rather than run: no database. The
// row it returns is faked; what is asserted is the SQL it would send.
const state = vi.hoisted(() => ({
  join: null as unknown,
  where: null as unknown,
  rows: [] as Array<{ subject: string }>,
  asked: 0,
}));

vi.mock('$lib/db', () => ({
  db: {
    select: () => {
      state.asked++;
      const q = {
        from: () => q,
        innerJoin: (_t: unknown, cond: unknown) => {
          state.join = cond;
          return q;
        },
        where: (cond: unknown) => {
          state.where = cond;
          return q;
        },
        limit: () => Promise.resolve([...state.rows]),
      };
      return q;
    },
  },
}));

const { householdSubjectFor } = await import('./members');
const render = (s: unknown) => new PgDialect().sqlToQuery(s as SQL);

beforeEach(() => {
  state.join = null;
  state.where = null;
  state.rows = [];
  state.asked = 0;
});

describe('householdSubjectFor', () => {
  it('filters household_member on lower-cased email — identity, not permission', async () => {
    state.rows = [{ subject: 'sam' }];
    expect(await householdSubjectFor('  Sam@Example.TEST ')).toBe('sam');

    // No join to allowed_user and no role: whether they may LOOK is
    // family:circle, checked in peopleViewerOf.
    expect(state.join).toBeNull();
    const where = render(state.where);
    expect(where.sql).toBe('lower("household_member"."email") = $1');
    expect(where.params).toEqual(['sam@example.test']);
  });

  it('is null with no row, and asks nothing for a blank address', async () => {
    expect(await householdSubjectFor('nobody@example.test')).toBeNull();
    state.asked = 0;
    expect(await householdSubjectFor('  ')).toBeNull();
    expect(await householdSubjectFor(null)).toBeNull();
    expect(state.asked).toBe(0);
  });
});
