/**
 * What this file does and does not test.
 *
 * There is no database here, so nothing below proves a row survives a round
 * trip — that is what `npm run test:integration` is for. What it DOES prove is
 * the one thing a database test would be a clumsy way to check: the exact SQL
 * these functions build. The invariants that make the desk usable are all in
 * the statement shape rather than in the data —
 *
 *   - the upsert's SET clause must never contain `status` or `resolved_at`,
 *     because an upsert that reopens a resolved item replays every finding the
 *     author has already dealt with;
 *   - the batch must be deduped before it reaches Postgres, which refuses an ON
 *     CONFLICT DO UPDATE that would touch one row twice;
 *   - the sweep must use `is distinct from`, not `<>`, or it silently skips
 *     every row whose run_id is NULL.
 *
 * Each of those is a one-line edit away from being wrong, and each fails
 * silently in production. So `$lib/db` is replaced with a recorder that
 * captures what was built, and the assertions are made against that. The
 * recorder asserts it was actually used before every check — a mock that
 * quietly stopped matching the drizzle chain would otherwise turn this whole
 * file into six tests that pass by doing nothing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Finding } from './types';

const rec = vi.hoisted(() => ({
  /** Results the next `.select()` chains should resolve to, in order. */
  selectResults: [] as unknown[][],
  inserts: [] as { values: unknown[]; conflict: { target: unknown; set: Record<string, unknown> } | null }[],
  updates: [] as { set: Record<string, unknown>; where: unknown }[],
  selects: [] as { where: unknown }[],
}));

vi.mock('$lib/db', () => {
  const METHODS = ['from', 'where', 'orderBy', 'limit', 'values', 'onConflictDoUpdate', 'set', 'returning'];

  /** A drizzle-shaped fluent chain that is also a thenable, so `await` on it
   *  resolves to `result` wherever the real builder would have run the query. */
  const chain = (result: unknown, onCall: (method: string, args: unknown[]) => void) => {
    const node: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej),
    };
    for (const m of METHODS) {
      node[m] = (...args: unknown[]) => {
        onCall(m, args);
        return node;
      };
    }
    return node;
  };

  return {
    db: {
      select: () => {
        const entry = { where: undefined as unknown };
        rec.selects.push(entry);
        const rows = rec.selectResults.shift() ?? [];
        return chain(rows, (m, args) => {
          if (m === 'where') entry.where = args[0];
        });
      },
      insert: () => {
        const entry = { values: [] as unknown[], conflict: null as { target: unknown; set: Record<string, unknown> } | null };
        rec.inserts.push(entry);
        return chain(undefined, (m, args) => {
          if (m === 'values') entry.values = args[0] as unknown[];
          if (m === 'onConflictDoUpdate') entry.conflict = args[0] as { target: unknown; set: Record<string, unknown> };
        });
      },
      update: () => {
        const entry = { set: {} as Record<string, unknown>, where: undefined as unknown };
        rec.updates.push(entry);
        // `.returning()` resolves to the swept rows; sweepStaleItems counts them.
        return chain([{ id: 1 }, { id: 2 }], (m, args) => {
          if (m === 'set') entry.set = args[0] as Record<string, unknown>;
          if (m === 'where') entry.where = args[0];
        });
      },
    },
  };
});

const { upsertFindings, setItemStatus, sweepStaleItems, listChecklist } = await import('./store.server');

const dialect = new PgDialect();
/** Render a recorded WHERE back to SQL so an assertion can be made about the
 *  operator, not about drizzle's internal object graph. */
const render = (where: unknown) => dialect.sqlToQuery(where as never);

function finding(over: Partial<Finding> = {}): Finding {
  return {
    kind: 'meta',
    severity: 'review',
    title: 'Excerpt is only 12 characters',
    detail: 'Under 40 the card reads as a stub.',
    anchorText: 'A short one',
    anchorHash: 'aaaa1111',
    ...over,
  };
}

beforeEach(() => {
  rec.selectResults.length = 0;
  rec.inserts.length = 0;
  rec.updates.length = 0;
  rec.selects.length = 0;
});

describe('upsertFindings', () => {
  it('targets the (postId, anchorHash, kind) index and never moves status or resolvedAt', async () => {
    await upsertFindings(7, [finding()], 'run-1');

    const insert = rec.inserts.at(0);
    expect(insert, 'no insert was built — the mocked chain no longer matches the real one').toBeTruthy();
    expect(insert!.conflict, 'onConflictDoUpdate was never called: the write is not an upsert').toBeTruthy();

    const target = insert!.conflict!.target as { name: string }[];
    expect(target.map((c) => c.name)).toEqual(['post_id', 'anchor_hash', 'kind']);

    const set = insert!.conflict!.set;
    // The whole reason this file exists.
    expect(Object.keys(set)).not.toContain('status');
    expect(Object.keys(set)).not.toContain('resolvedAt');
    // And the columns that must move, or a re-run shows yesterday's wording.
    for (const col of ['title', 'detail', 'severity', 'anchorText', 'evidence', 'runId', 'updatedAt']) {
      expect(Object.keys(set), `${col} is missing from the SET clause`).toContain(col);
    }
  });

  it('inserts rows as open, stamped with the run', async () => {
    await upsertFindings(7, [finding()], 'run-1');
    const row = rec.inserts[0].values[0] as Record<string, unknown>;
    expect(row.status).toBe('open');
    expect(row.runId).toBe('run-1');
    expect(row.postId).toBe(7);
  });

  it('collapses findings that share a key before they reach Postgres', async () => {
    // Two claims quoting the same sentence hash identically. Sent as-is,
    // Postgres aborts the whole statement with "cannot affect row a second
    // time" and the run loses every finding in it.
    const dupe = [finding({ kind: 'claim', anchorHash: 'dddd2222' }), finding({ kind: 'claim', anchorHash: 'dddd2222' })];
    const written = await upsertFindings(7, dupe, 'run-1');

    expect(rec.inserts[0].values).toHaveLength(1);
    expect(written).toEqual({ created: 1, updated: 0 });
  });

  it('counts an existing row as updated, not created', async () => {
    // The pre-flight SELECT reports the first finding already stored.
    rec.selectResults.push([{ kind: 'meta', anchorHash: 'aaaa1111' }]);
    const written = await upsertFindings(7, [finding(), finding({ kind: 'link', anchorHash: 'bbbb3333' })], 'run-2');
    expect(written).toEqual({ created: 1, updated: 1 });
  });

  it('does no work at all for an empty run', async () => {
    expect(await upsertFindings(7, [], 'run-1')).toEqual({ created: 0, updated: 0 });
    expect(rec.inserts).toHaveLength(0);
    expect(rec.selects).toHaveLength(0);
  });
});

describe('setItemStatus', () => {
  it('stamps resolvedAt when the item leaves open, and clears it when it comes back', async () => {
    await setItemStatus(3, 'resolved');
    expect(rec.updates[0].set.resolvedAt).toBeInstanceOf(Date);

    await setItemStatus(3, 'open');
    expect(rec.updates[1].set.resolvedAt).toBeNull();
  });
});

describe('sweepStaleItems', () => {
  it('compares run ids with IS DISTINCT FROM, so rows with a null run_id are swept too', async () => {
    const swept = await sweepStaleItems(7, 'run-9', ['meta', 'link']);
    expect(swept).toBe(2);

    const update = rec.updates.at(0);
    expect(update, 'no update was built').toBeTruthy();
    const { sql, params } = render(update!.where);
    // `run_id <> $n` is NULL for a row that has no run_id, so `<>` would leave
    // exactly the stalest items open forever.
    expect(sql).toContain('is distinct from');
    expect(sql).not.toMatch(/"run_id"\s*<>/);
    // Scoped to this post, to open items only, and to the kinds passed in.
    expect(params).toContain('open');
    expect(params).toContain('run-9');
    expect(params).toContain(7);
  });

  it('marks swept items dismissed without touching resolvedAt', async () => {
    await sweepStaleItems(7, 'run-9', ['meta']);
    const set = rec.updates[0].set;
    expect(set.status).toBe('dismissed');
    // A sweep is not an author decision, so resolvedAt stays as it was.
    expect(Object.keys(set)).not.toContain('resolvedAt');
  });

  it('issues no statement when no kinds were re-derived', async () => {
    // The caller passes only the kinds this run actually re-ran. An empty list
    // must be a no-op and not "sweep everything".
    expect(await sweepStaleItems(7, 'run-9', [])).toBe(0);
    expect(rec.updates).toHaveLength(0);
  });
});

describe('listChecklist', () => {
  it('filters to open items by default and drops the filter for "all"', async () => {
    await listChecklist(7);
    const openWhere = render(rec.selects[0].where);
    expect(openWhere.params).toContain('open');

    await listChecklist(7, { status: 'all' });
    const allWhere = render(rec.selects[1].where);
    expect(allWhere.params).not.toContain('open');
    expect(allWhere.params).toContain(7);
  });
});
