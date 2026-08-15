/**
 * The retirement predicate, pinned at the SQL level.
 *
 * `retireAncientSessions` flips rows to `failed` and stamps an error message on
 * them, so an over-broad WHERE is destructive and silent — it would have marked
 * completed research as abandoned. The bug it guards against is not visible in
 * the TypeScript: Drizzle's `and()` parenthesises the conjunction as a whole but
 * splices each operand in verbatim, so a raw `sql` fragment containing OR
 * escapes the conjunction and AND/OR precedence does the rest.
 *
 * These tests assert the shape of the generated SQL rather than the behaviour of
 * a query, because that is where the fault lives.
 */
import { describe, it, expect } from 'vitest';
import { and, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { researchSessions } from '$lib/db/schema';

const NON_TERMINAL = ['phase1', 'phase2', 'phase3', 'post_processing'];
const cutoff = new Date('2026-08-14T00:00:00Z');
const dialect = new PgDialect();

const render = (clause: ReturnType<typeof and>): string => dialect.sqlToQuery(clause!).sql;

describe('retirement predicate', () => {
  it('keeps the liveness test inside its own parentheses', () => {
    const safe = and(
      inArray(researchSessions.status, NON_TERMINAL),
      lt(researchSessions.createdAt, cutoff),
      or(isNull(researchSessions.heartbeatAt), lt(researchSessions.heartbeatAt, cutoff)),
    );
    const rendered = render(safe);
    // The OR must be wrapped, so it cannot escape the conjunction.
    expect(rendered).toContain(
      '("research_session"."heartbeat_at" is null or "research_session"."heartbeat_at" < ',
    );
  });

  it('demonstrates the raw-sql form this replaces, which does NOT parenthesise', () => {
    const unsafe = and(
      inArray(researchSessions.status, NON_TERMINAL),
      lt(researchSessions.createdAt, cutoff),
      sql`${researchSessions.heartbeatAt} IS NULL OR ${researchSessions.heartbeatAt} < ${cutoff}`,
    );
    const rendered = render(unsafe);
    // `... and heartbeat_at IS NULL OR heartbeat_at < $6` — AND binds tighter,
    // so the trailing comparison stands alone and matches completed rows too.
    expect(rendered).toContain('IS NULL OR ');
    expect(rendered).not.toContain('("research_session"."heartbeat_at" IS NULL OR');
  });
});
