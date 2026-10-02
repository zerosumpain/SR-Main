import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ queries: [] as Array<{ text: string; values: unknown[] }>, rows: [] as unknown[][] }));
vi.mock('$lib/db', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres');
  // A real drizzle over a fake client: the SQL is rendered exactly as it would
  // be sent, and nothing reaches a database.
  const client = { query: vi.fn(async (q: { text: string; values?: unknown[] }, params?: unknown[]) => { h.queries.push({ text: q.text, values: params ?? q.values ?? [] }); return { rows: h.rows.shift() ?? [], rowCount: 0 }; }) };
  return { db: drizzle(client as never) };
});

import { areaLessons } from './build-lessons.server';

describe('areaLessons: the area list, read from the graph', () => {
  it('lists live build lessons for the delivery area, stale ones last, never a tombstone', async () => {
    const observed = new Date('2026-09-30T10:00:00.000Z');
    h.rows.push([['development-lesson:1', 'Owner gates go first', `Owner gates go first\nEvidence: e\nAccepted local candidate: abc. Production deployment is not established.`, observed, observed, null]]);
    const lessons = await areaLessons('Platform');
    const { text, values } = h.queries[0];
    expect(text).toContain('"codegraph_lessons"."retired_at" is null');
    expect(text).toContain('"codegraph_lessons"."superseded_by_id" is null');
    expect(text).toContain(`'/jkai/develop/' || "jkai_build_deliveries"."build_id"`);
    expect(text).toMatch(/"jkai_build_deliveries"\."state"->>'area' = \$\d/);
    expect(text).toMatch(/order by "codegraph_lessons"\."stale_at" is not null/);
    expect(values).toEqual(expect.arrayContaining(['build', 'development-lesson:%', 'Platform']));
    expect(lessons).toEqual([expect.objectContaining({ id: 'development-lesson:1', lesson: 'Owner gates go first', evidence: 'e', revision: 'abc', unverified: true, stale: false })]);
  });
});
