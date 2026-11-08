import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { and, type SQL } from 'drizzle-orm';

// Search scoping: every query the recorder's search runs reads ONE space —
// the recorder's — and never the household the owner's usual intel scope
// adds. Rendered to SQL with drizzle's own dialect; no database.

const h = vi.hoisted(() => ({ executed: [] as unknown[] }));

vi.mock('$lib/db', () => ({
  db: {
    execute: vi.fn(async (q: unknown) => {
      h.executed.push(q);
      return { rows: [] };
    }),
  },
}));
vi.mock('$lib/intel-client/embed', () => ({ generateEmbedding: async () => [0.1, 0.2] }));
vi.mock('./store.server', () => ({ openActionCounts: async () => new Map() }));

const search = await import('./search.server');
const { OWNER_INTEL_SCOPE } = await import('$lib/intel-client/scope');

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);

function expectScopedTo(q: SQL, space: string) {
  const { sql, params } = render(q);
  // The space travels as one text[] literal per spaceIn: exactly this space.
  const arrays = params.filter((p) => typeof p === 'string' && p.startsWith('{'));
  expect(arrays.length).toBeGreaterThan(0);
  for (const a of arrays) expect(a).toBe(`{"${space}"}`);
  expect(params.join(' ')).not.toContain('household');
  return sql;
}

describe('recorderScope', () => {
  it('is the one space, never the owner scope with the household in it', () => {
    expect(search.recorderScope('owner')).toEqual(['owner']);
    expect(OWNER_INTEL_SCOPE).toContain('household');
    expect(search.recorderScope('owner')).not.toContain('household');
  });
});

describe('the intel queries', () => {
  const scope = search.recorderScope('owner');

  it('note hits: the space, capture notes only, admitted only', () => {
    const sql = expectScopedTo(search.noteHitsQuery(scope, '[0.1,0.2]', 50), 'owner');
    expect(sql).toContain("n.metadata->>'autoKind' = 'capture'");
    expect(sql).toContain("n.graph_state = 'admitted'");
    // The join key is the bare refId, before any `/remember/…` suffix.
    expect(sql).toContain("split_part(n.metadata->>'refId', '/', 1)");
  });

  it('entities: both the entity and its note in the space', () => {
    const sql = expectScopedTo(search.captureEntitiesQuery(scope, 'sarah', 20), 'owner');
    expect(sql).toContain('e.space_id = ANY(');
    expect(sql).toContain('n.space_id = ANY(');
    expect(sql).toContain("n.metadata->>'autoKind' = 'capture'");
    // Narrowed to the captures the filters kept, when there are filters.
    expect(render(search.captureEntitiesQuery(scope, '', 20, ['cap_1'])).params).toContain('{"cap_1"}');
  });

  it('person lookups, the entity page and its neighbours are scoped too', () => {
    expectScopedTo(search.capturesNamingQuery(scope, 'Sarah'), 'owner');
    expectScopedTo(search.entityQuery(scope, 'ent_1'), 'owner');
    expectScopedTo(search.entityCapturesQuery(scope, 'ent_1'), 'owner');
    const sql = expectScopedTo(search.neighboursQuery(scope, 'ent_1', 40), 'owner');
    // Both ends of an edge: the relationship and the entity it leads to.
    expect(sql).toContain('r.space_id');
    expect(sql).toContain('o.space_id');
  });

  it('a member space reads only itself', () => {
    expectScopedTo(search.noteHitsQuery(search.recorderScope('u_ann'), '[0]', 5), 'u_ann');
  });

  it('escapes LIKE wildcards in what the phone typed', () => {
    const { params } = render(search.capturesNamingQuery(scope, '100%_x'));
    expect(params).toContain('%100\\%\\_x%');
  });
});

describe('captureFilters', () => {
  it('always starts with the recorder space', () => {
    const where = search.captureFilters('owner', { person: 'Sarah', app: 'Mail', place: '', from: '2026-10-01T00:00:00.000Z', to: null }, ['cap_9']);
    const { sql, params } = render(and(...where)!);
    expect(sql.startsWith('("capture"."space_id" = $1')).toBe(true);
    expect(params[0]).toBe('owner');
    expect(sql).toContain('"capture"."speakers"::text ILIKE');
    expect(params).toContain('cap_9');
  });
});

describe('captureEntityPage', () => {
  it('is null for an entity outside the space, having asked only in the space', async () => {
    h.executed.length = 0;
    expect(await search.captureEntityPage('owner', 'ent_elsewhere')).toBeNull();
    expect(h.executed).toHaveLength(1);
    expectScopedTo(h.executed[0] as SQL, 'owner');
  });
});
