import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { GRAPH_SPECS, GRAPH_BACKFILL_DAYS, buildGraphSignals } from './graph';
import { db } from '$lib/db';

// No database: every query is captured and rendered, and answers no rows.
vi.mock('$lib/db', () => ({ db: { execute: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('./registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./registry')>();
  return { ...actual, registerSignals: vi.fn(async () => ({ registered: 0 })), setObservations: vi.fn(async () => 0) };
});
import { SWEEP_METRICS } from '../stats/sweep';
import { MIN_PAIRS } from '../stats/tests';

describe('graph signals', () => {
  it('are all namespaced under one source, so the registry can group them', () => {
    expect(GRAPH_SPECS.length).toBeGreaterThan(0);
    for (const s of GRAPH_SPECS) {
      expect(s.source).toBe('graph');
      expect(s.key.startsWith('graph:')).toBe(true);
    }
  });

  it('has no duplicate keys', () => {
    expect(new Set(GRAPH_SPECS.map((s) => s.key)).size).toBe(GRAPH_SPECS.length);
  });

  it('publishes NO cumulative total', () => {
    // The load-bearing design decision. A monotonically rising series
    // rank-correlates ~1.0 with time, and the sweep's default is Spearman —
    // so a cumulative total correlates with every other series that trends,
    // and the false-discovery correction then spends its budget mopping up
    // findings that were arithmetic rather than observation.
    //
    // Everything here is either a daily delta or a level that genuinely falls
    // as well as rises.
    for (const s of GRAPH_SPECS) {
      expect(s.key).not.toMatch(/_total$/);
      expect(s.key).not.toMatch(/_count$/);
      expect(s.label.toLowerCase()).not.toContain('total');
    }
  });

  it('names every signal as activity or as a state, never as an identifier', () => {
    // The registry's hygiene rule: it once registered `camera…#last_video_id`
    // at 7.67e18. Nothing here may look like an id.
    for (const s of GRAPH_SPECS) {
      expect(s.key).not.toMatch(/(^|[:_])id($|_)/);
      expect(s.valueKind).toBe('numeric');
    }
  });

  it('arrives with enough history to be swept immediately', () => {
    // The point of reconstructing the rates rather than accruing them: the
    // source rows carry their own timestamps, so these series do not have to
    // sit silent for a fortnight the way a newly-found sensor does.
    expect(GRAPH_BACKFILL_DAYS).toBeGreaterThan(MIN_PAIRS);
  });
});

describe('the proposer’s vocabulary stays shut', () => {
  // The owner's instruction, 2026-08-28: wire the graph into the sweep, and
  // keep it out of the vocabulary the hypothesis proposer is shown.
  //
  // The two are different surfaces and the distinction is the whole safety
  // argument. The sweep tests everything with enough days and corrects across
  // the lot. The proposer is shown a fixed short list and NEVER the
  // correlations — that blind pre-registration is what makes a q-value mean
  // something over ~4 tests instead of ~276. Widening the list would void it.
  it('contains no graph metric', () => {
    for (const m of SWEEP_METRICS) {
      expect(m.startsWith('graph')).toBe(false);
    }
  });

  it('shares no name with a graph signal', () => {
    const graphIds = new Set(GRAPH_SPECS.map((s) => s.key.replace(/^graph:/, '')));
    for (const m of SWEEP_METRICS) {
      expect(graphIds.has(m)).toBe(false);
    }
  });

  it('is still exactly the feature-store vocabulary', () => {
    // A guard against someone quietly appending to it later: every metric must
    // still be a bare feature column name, with no namespace prefix.
    for (const m of SWEEP_METRICS) {
      expect(m).not.toContain(':');
    }
  });
});

describe('graph signals count the owner\'s graph only', () => {
  // These series are correlated against the owner's days, so a member's mail
  // must not move them — not even as a count.
  it('every query carries the owner-scope space predicate', async () => {
    vi.mocked(db.execute).mockClear();
    const { errors } = await buildGraphSignals({ windowDays: 3, now: new Date('2026-09-24T12:00:00Z') });
    expect(errors).toEqual([]);
    const queries = vi.mocked(db.execute).mock.calls.map(([q]) => new PgDialect().sqlToQuery(q as SQL));
    // Six rates and two levels.
    expect(queries).toHaveLength(8);
    for (const q of queries) {
      expect(q.sql).toMatch(/\bfrom intel_\w+/);
      expect(q.sql).toMatch(/and space_id = ANY\(\$\d+::text\[\]\)/);
      expect(q.params).toContain('{"owner","household"}');
    }
  });
});
