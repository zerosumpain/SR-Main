import { describe, it, expect, vi } from 'vitest';
import { executeTool } from '../registry';
import '../registry';

/**
 * Fake db rows used by research_list tests. select() is projection-aware: when
 * the handler passes a column projection (compact mode) it returns only the
 * compact fields; when it passes none (verbose mode) it returns the full rows.
 */
vi.mock('$lib/db', () => {
  const fullRows = [
    {
      id: 'r-1',
      topic: 'Norfolk Broads moorings',
      goals: ['Map free moorings'],
      status: 'completed',
      report: { summary: 'A long report…' },
      config: { maxSites: 20 },
      seedContext: { region: 'east-anglia' },
      createdAt: '2026-08-01T09:00:00.000Z',
    },
    {
      id: 'r-2',
      topic: 'Electric narrowboats',
      goals: [],
      status: 'running',
      report: null,
      config: {},
      seedContext: null,
      createdAt: '2026-08-03T09:00:00.000Z',
    },
  ];
  const COMPACT = ['id', 'topic', 'status', 'createdAt'];
  const compactRows = fullRows.map((r) => Object.fromEntries(COMPACT.map((k) => [k, (r as any)[k]])));
  const makeQueryBuilder = (projected: unknown) => {
    const q: any = {
      from: () => q,
      orderBy: () => q,
      where: () => q,
      limit: () => (projected ? compactRows : fullRows),
    };
    return q;
  };
  return { db: { select: vi.fn((proj: unknown) => makeQueryBuilder(proj)) } };
});

/**
 * research_list token bloat — issue #126.
 *
 * The bare `db.select().from(researchSessions)` returned every column (goals,
 * config, report, seedContext…) of up to 50 sessions — full reports are
 * extremely token-heavy. Default is now the compact projection; verbose:true
 * opts back into the full rows.
 */
describe('research_list compact vs verbose', () => {
  it('returns compact rows by default (no heavy columns)', async () => {
    const r = (await executeTool('research_list', {})) as {
      success: boolean;
      data: Array<Record<string, unknown>>;
    };
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);
    const first = r.data[0];
    // Identifying fields present.
    expect(first.id).toBe('r-1');
    expect(first.topic).toBe('Norfolk Broads moorings');
    expect(first.status).toBe('completed');
    expect(first.createdAt).toBeDefined();
    // Heavy columns dropped from the compact projection.
    expect('goals' in first).toBe(false);
    expect('report' in first).toBe(false);
    expect('config' in first).toBe(false);
    expect('seedContext' in first).toBe(false);
  });

  it('returns full rows when verbose:true', async () => {
    const r = (await executeTool('research_list', { verbose: true })) as {
      success: boolean;
      data: Array<Record<string, unknown>>;
    };
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);
    const first = r.data[0];
    expect(first.id).toBe('r-1');
    expect(first.goals).toEqual(['Map free moorings']);
    expect(first.report).toEqual({ summary: 'A long report…' });
    expect(first.config).toEqual({ maxSites: 20 });
    expect(first.seedContext).toEqual({ region: 'east-anglia' });
  });
});
