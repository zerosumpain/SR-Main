import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same seam as load.test.ts: db.execute and the channel-artefact list are the
// builder's only external touch-points, so the scoping is testable without a
// live DB by rendering the SQL it issues.
const mockExecute = vi.fn();
vi.mock('$lib/db', () => ({ db: { execute: (...a: unknown[]) => mockExecute(...a) } }));
vi.mock('../channel-artefacts', () => ({ channelArtefactIds: async () => new Set<string>() }));

import { buildEvidenceGraph, countEvidenceNotes } from './evidence-graph';
import { sourcesForDomains } from '../domains';

const dialect = new PgDialect();
const render = (q: unknown) => dialect.sqlToQuery(q as SQL);

function query() {
  expect(mockExecute).toHaveBeenCalledTimes(1);
  return render(mockExecute.mock.calls[0][0]);
}

beforeEach(() => {
  mockExecute.mockReset();
  mockExecute.mockResolvedValue({ rows: [] });
});

describe('buildEvidenceGraph scoping', () => {
  it('constrains notes, entities and relationships to the scope', async () => {
    await buildEvidenceGraph({ scope: ['u_member', 'household'] });
    const { sql, params } = query();
    // Both halves of the query — the ranking CTE picks the notes, the outer
    // select fetches every entity those notes mention — so each needs its own
    // predicate: a note in scope must not drag in an entity that is not.
    expect(sql.match(/n\.space_id = ANY\(/g)?.length).toBe(2);
    expect(sql.match(/e\.space_id = ANY\(/g)?.length).toBe(2);
    expect(sql).toContain('r.space_id = ANY(');
    expect(params).toContain('{"u_member","household"}');
    expect(params).not.toContain('{"owner","household"}');
  });

  it('defaults to the owner scope', async () => {
    await buildEvidenceGraph();
    expect(query().params).toContain('{"owner","household"}');
  });

  it('an empty scope matches nothing rather than everything', async () => {
    await buildEvidenceGraph({ scope: [] });
    const { sql, params } = query();
    expect(sql).toContain('n.space_id = ANY(');
    expect(params).toContain('{}');
  });
});

describe('buildEvidenceGraph domains', () => {
  it('filters notes on the sources a domain names', async () => {
    await buildEvidenceGraph({ domains: ['research'] });
    const { params } = query();
    expect(params).toContain(`{${sourcesForDomains(['research']).map((s) => `"${s}"`).join(',')}}`);
  });

  it('the other domain is every source no domain maps', async () => {
    await buildEvidenceGraph({ domains: ['other'] });
    const { sql } = query();
    expect(sql).toContain('n.source <> ALL(');
  });

  it('applies no domain predicate when none is asked for', async () => {
    await buildEvidenceGraph({ domains: [] });
    const { sql } = query();
    expect(sql).not.toContain('n.source <> ALL(');
    expect(sql).not.toContain('n.source = ANY(');
  });

  it('carries each row’s space onto its note and entity nodes', async () => {
    mockExecute.mockResolvedValue({
      rows: [{
        note_id: 'n1', note_title: 'T', note_source: 'email', observed_at: null,
        created_at: '2026-09-01T00:00:00Z', entity_id: 'e1', entity_name: 'Ada',
        type_id: null, type_name: null, icon: null, color: null, summary: null,
        confirmed: true, sources: null, note_space: 'household', entity_space: 'household',
      }],
    });
    const built = await buildEvidenceGraph({ scope: ['household'] });
    expect(built.snapshot.nodes.map((n) => n.space)).toEqual(['household', 'household']);
  });
});

describe('countEvidenceNotes', () => {
  it('counts the notes the view could draw over the whole scope, uncapped and unfiltered', async () => {
    mockExecute.mockResolvedValue({
      rows: [
        { space: 'owner', source: 'email', count: '12' },
        { space: 'household', source: null, count: 3 },
      ],
    });
    const rows = await countEvidenceNotes(['owner', 'household']);
    const { sql, params } = query();
    expect(sql).toContain('n.space_id = ANY(');
    expect(sql).toContain('e.space_id = ANY(');
    expect(sql).toContain('e.merged_into_id IS NULL');
    // The same qualifying rule the build ranks by — a note naming one entity
    // is never drawn, so it must not be counted either.
    expect(sql).toContain('HAVING COUNT(DISTINCT ne.entity_id) > 1');
    expect(sql).not.toContain('LIMIT');
    expect(sql).not.toContain('n.source = ANY(');
    expect(params).toContain('{"owner","household"}');
    expect(rows).toEqual([
      { space: 'owner', source: 'email', count: 12 },
      { space: 'household', source: null, count: 3 },
    ]);
  });

  it('shares its qualifying rule with the build', async () => {
    await buildEvidenceGraph();
    expect(query().sql).toContain('HAVING COUNT(DISTINCT ne.entity_id) > 1');
  });
});
