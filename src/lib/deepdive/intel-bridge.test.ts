import { describe, it, expect } from 'vitest';
import { buildResearchDigest, collectFactIds, isOpaqueId } from './intel-bridge';
import type { ResearchReport } from './types';

const base: ResearchReport = {
  ranked_facts: [],
  timeline: [],
  clusters: [],
  executive_summary: '',
  entity_centrality: {},
};

const uuid = (n: number) => `0000000${n}-1111-2222-3333-444444444444`;

describe('buildResearchDigest', () => {
  it('includes topic, summary, clusters, facts and timeline', () => {
    const digest = buildResearchDigest('School funding', {
      ...base,
      executive_summary: 'Funding rose 3%.',
      clusters: [{ title: 'Budgets', summary: 'Per-pupil up', fact_ids: [] }],
      ranked_facts: ['DfE published the settlement'],
      timeline: [{ date: '2026-04-01', facts: ['Settlement published'] }],
    });

    expect(digest).toContain('Research topic: School funding');
    expect(digest).toContain('Funding rose 3%.');
    expect(digest).toContain('- Budgets: Per-pupil up');
    expect(digest).toContain('- DfE published the settlement');
    expect(digest).toContain('2026-04-01: Settlement published');
  });

  // The regression this whole module exists to prevent: postprocess.ts stores
  // fact IDs in ranked_facts/timeline, and the old digest emitted them raw.
  it('resolves fact ids to prose instead of emitting UUIDs', () => {
    const factText = new Map([
      [uuid(1), 'DfE published the 2026 settlement'],
      [uuid(2), 'Per-pupil funding rose 3.1% in real terms'],
    ]);

    const digest = buildResearchDigest(
      'School funding',
      {
        ...base,
        ranked_facts: [uuid(1), uuid(2)],
        timeline: [{ date: '2026-04-01', facts: [uuid(1)] }],
      },
      factText,
    );

    expect(digest).toContain('- DfE published the 2026 settlement');
    expect(digest).toContain('- Per-pupil funding rose 3.1% in real terms');
    expect(digest).toContain('2026-04-01: DfE published the 2026 settlement');
    expect(digest).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it('drops fact ids that cannot be resolved rather than printing them', () => {
    const digest = buildResearchDigest('Stale', {
      ...base,
      ranked_facts: [uuid(7), uuid(8)],
    });
    expect(digest).toBe('Research topic: Stale');
  });

  it('drops a timeline row whose facts all fail to resolve', () => {
    const digest = buildResearchDigest('Stale timeline', {
      ...base,
      timeline: [
        { date: '2026-04-01', facts: [uuid(9)] },
        { date: '2026-05-01', facts: ['A real event'] },
      ],
    });
    expect(digest).toContain('2026-05-01: A real event');
    expect(digest).not.toContain('2026-04-01');
  });

  it('caps ranked facts so a huge dive cannot blow up the extraction call', () => {
    const digest = buildResearchDigest('Big', {
      ...base,
      ranked_facts: Array.from({ length: 200 }, (_, i) => `fact ${i}`),
    });
    expect(digest).toContain('fact 39');
    expect(digest).not.toContain('fact 40');
  });

  it('omits empty sections rather than emitting bare headings', () => {
    const digest = buildResearchDigest('Sparse', base);
    expect(digest).toBe('Research topic: Sparse');
  });

  it('carries no entity or relationship hints — the graph is committed structurally now', () => {
    // The digest used to append the session's own entities and relationships as
    // prose hints for a model that re-derived the graph from them. That path is
    // gone (see $lib/deepdive/graph-commit): the structure is handed to intel
    // directly, so restating it in the note body would be duplication a reader
    // has to wade through.
    const digest = buildResearchDigest('Church', { ...base, executive_summary: 'x' });
    expect(digest).not.toContain('already identified');
    expect(digest).not.toContain('—[');
  });
});

describe('collectFactIds', () => {
  it('gathers ids from ranked facts, timeline and clusters without duplicates', () => {
    const ids = collectFactIds({
      ...base,
      ranked_facts: [uuid(1), uuid(2)],
      timeline: [{ date: '2026-01-01', facts: [uuid(2), uuid(3)] }],
      clusters: [{ title: 'c', summary: 's', fact_ids: [uuid(3), uuid(4)] }],
    });
    expect(new Set(ids)).toEqual(new Set([uuid(1), uuid(2), uuid(3), uuid(4)]));
  });
});

describe('isOpaqueId', () => {
  it('recognises UUIDs and rejects prose', () => {
    expect(isOpaqueId(uuid(1))).toBe(true);
    expect(isOpaqueId('  ' + uuid(1) + ' ')).toBe(true);
    expect(isOpaqueId('DfE published the settlement')).toBe(false);
    expect(isOpaqueId('f-top-1')).toBe(false);
  });
});
