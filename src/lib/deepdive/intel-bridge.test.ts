import { describe, it, expect } from 'vitest';
import { buildResearchDigest } from './intel-bridge';
import type { ResearchReport } from './types';

const base: ResearchReport = {
  ranked_facts: [],
  timeline: [],
  clusters: [],
  executive_summary: '',
  entity_centrality: {},
};

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
});
