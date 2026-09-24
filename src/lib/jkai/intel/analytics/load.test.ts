import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// db.execute and the channel-artefact list are the loader's only external
// touch-points; mock both so the scoping and the per-scope cache are testable
// without a live DB.
const mockExecute = vi.fn();
vi.mock('$lib/db', () => ({ db: { execute: (...a: unknown[]) => mockExecute(...a) } }));
vi.mock('../channel-artefacts', () => ({ channelArtefactIds: async () => new Set<string>() }));

import { getGraphAnalysis, invalidateGraphAnalysis, ensureEmbeddings } from './load';
import { OWNER_INTEL_SCOPE } from '../scope';

const dialect = new PgDialect();
const render = (q: unknown) => dialect.sqlToQuery(q as SQL);

/** Every query the loader has issued, rendered. */
function queries() {
  return mockExecute.mock.calls.map(([q]) => render(q));
}

beforeEach(() => {
  mockExecute.mockReset();
  mockExecute.mockImplementation(async (q: unknown) => {
    const { sql } = render(q);
    if (sql.includes('FROM intel_entities e')) {
      return { rows: [{ id: 'e1', name: 'Alice', space_id: 'household' }] };
    }
    return { rows: [] };
  });
  invalidateGraphAnalysis();
});

describe('getGraphAnalysis scoping', () => {
  it('constrains every intel query to the scope, joined notes included', async () => {
    await getGraphAnalysis(false, { scope: ['u_member', 'household'] });
    const qs = queries();
    expect(qs).toHaveLength(3);

    const [entities, edges, suppressed] = qs;
    expect(entities.sql).toContain('e.space_id = ANY(');
    expect(entities.sql).toContain('n.space_id = ANY(');
    expect(entities.sql).toContain('fsn.space_id = ANY(');
    expect(edges.sql).toContain('r.space_id = ANY(');
    expect(edges.sql).toContain('r.suppressed IS NOT TRUE');
    expect(suppressed.sql).toContain('r.space_id = ANY(');
    expect(suppressed.sql).toContain('r.suppressed IS TRUE');
    for (const q of qs) {
      // Bound as ONE array literal, never an expanded parameter list.
      expect(q.params).toContain('{"u_member","household"}');
    }
  });

  it('carries each entity’s space onto its node', async () => {
    const analysis = await getGraphAnalysis();
    expect(analysis.snapshot.nodes.map((n) => n.space)).toEqual(['household']);
    expect(analysis.scope).toEqual(OWNER_INTEL_SCOPE);
  });

  it('defaults to the owner scope', async () => {
    await getGraphAnalysis();
    expect(queries()[0].params).toContain('{"owner","household"}');
  });

  it('caches one analysis per scope, keyed independently of order', async () => {
    const owner = await getGraphAnalysis();
    expect(mockExecute).toHaveBeenCalledTimes(3);

    // Same scope in another order — a cache hit, not a second load.
    expect(await getGraphAnalysis(false, { scope: ['household', 'owner'] })).toBe(owner);
    expect(mockExecute).toHaveBeenCalledTimes(3);

    // A different scope must not be served the owner's graph.
    const member = await getGraphAnalysis(false, { scope: ['u_member', 'household'] });
    expect(member).not.toBe(owner);
    expect(mockExecute).toHaveBeenCalledTimes(6);

    // …and both stay cached side by side.
    expect(await getGraphAnalysis()).toBe(owner);
    expect(await getGraphAnalysis(false, { scope: ['household', 'u_member'] })).toBe(member);
    expect(mockExecute).toHaveBeenCalledTimes(6);
  });

  it('loads embeddings only for the analysis’s own scope', async () => {
    const analysis = await getGraphAnalysis(false, { scope: ['u_member', 'household'] });
    mockExecute.mockClear();
    await ensureEmbeddings(analysis);
    const [q] = queries();
    expect(q.sql).toContain('space_id = ANY(');
    expect(q.params).toContain('{"u_member","household"}');
  });
});
