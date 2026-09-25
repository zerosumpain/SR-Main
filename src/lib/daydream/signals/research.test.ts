import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { buildResearchSignals } from './research';
import { db } from '$lib/db';

// No database: every query is captured and rendered, and answers no rows.
vi.mock('$lib/db', () => ({ db: { execute: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('./registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./registry')>();
  return { ...actual, registerSignals: vi.fn(async () => ({ registered: 0 })), setObservations: vi.fn(async () => 0) };
});

describe('research signals', () => {
  it("count the intel timeline inside the owner's scope, and leave the research tables alone", async () => {
    const { errors } = await buildResearchSignals({ days: 3, now: new Date('2026-09-24T12:00:00Z') });
    expect(errors).toEqual([]);
    const queries = vi.mocked(db.execute).mock.calls.map(([q]) => new PgDialect().sqlToQuery(q as SQL));
    const intel = queries.filter((q) => /\bfrom intel_/.test(q.sql));
    expect(intel).toHaveLength(1);
    expect(intel[0].sql).toMatch(/and space_id = ANY\(\$\d+::text\[\]\) group by 1$/);
    expect(intel[0].params).toContain('{"owner","household"}');
    // research_session, fact and narrative_item have no space column.
    for (const q of queries.filter((x) => !/\bfrom intel_/.test(x.sql))) expect(q.sql).not.toContain('space_id');
  });
});
