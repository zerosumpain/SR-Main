import { describe, it, expect, vi, beforeEach } from 'vitest';

// Per-table fixtures resolved by .from(table) via a __t tag.
let sessionRows: any[] = [{
  id: 'sess-1',
  topic: 'Acme Corp',
  report: {
    executive_summary: 'First para.\n\nSecond para.',
    clusters: [{ title: 'Finances', summary: 'Money stuff.', fact_ids: ['f1', 'f2'] }],
    ranked_facts: ['f1', 'f2'],
    timeline: [],
    entity_centrality: { e1: 0.9 },
    knowledge_gaps: [{ gap: 'No regional data', type: 'geographic', severity: 'high' }],
  },
}];
const factRows = [
  { id: 'f1', content: 'Revenue rose.', confidence: 0.91, sourceId: 's1', isCounterfactual: false, refutesFactId: null },
  { id: 'f2', content: 'Costs fell.', confidence: 0.7, sourceId: 's1', isCounterfactual: false, refutesFactId: null },
];
const entityRows = [{ id: 'e1', name: 'Acme', type: 'org', description: 'a company' }];
const sourceRows = [{ id: 's1', url: 'http://acme.test', title: 'Acme Filing', domain: 'acme.test', phase: 1 }];

vi.mock('$lib/db/schema', () => ({
  researchSessions: { __t: 'researchSessions' },
  facts: { __t: 'facts' },
  entities: { __t: 'entities' },
  sources: { __t: 'sources' },
  entityMentions: { __t: 'entityMentions' },
  narrativeItems: { __t: 'narrativeItems' },
}));
vi.mock('drizzle-orm', () => ({ eq: () => ({}), and: () => ({}), sql: () => ({}), asc: () => ({}) }));

vi.mock('$lib/db', () => {
  const rowsFor = (table: any) => {
    switch (table?.__t) {
      case 'researchSessions': return sessionRows;
      case 'facts': return factRows;
      case 'entities': return entityRows;
      case 'sources': return sourceRows;
      default: return [];
    }
  };
  return {
    db: {
      select: () => ({
        from: (table: any) => {
          const rows = rowsFor(table);
          const p: any = Promise.resolve(rows);
          p.where = () => Promise.resolve(rows);
          return p;
        },
      }),
    },
  };
});

import { generateReportMarkdown } from './docx-export';

beforeEach(() => {
  sessionRows = [{
    id: 'sess-1',
    topic: 'Acme Corp',
    report: {
      executive_summary: 'First para.\n\nSecond para.',
      clusters: [{ title: 'Finances', summary: 'Money stuff.', fact_ids: ['f1', 'f2'] }],
      ranked_facts: ['f1', 'f2'],
      timeline: [],
      entity_centrality: { e1: 0.9 },
      knowledge_gaps: [{ gap: 'No regional data', type: 'geographic', severity: 'high' }],
    },
  }];
});

describe('generateReportMarkdown', () => {
  it('renders title, executive summary, and cluster sections with facts', async () => {
    const md = await generateReportMarkdown('sess-1');
    expect(md).toContain('# Acme Corp');
    expect(md).toContain('## Executive Summary');
    expect(md).toContain('First para.');
    expect(md).toContain('Second para.');
    expect(md).toContain('## Finances');
    expect(md).toContain('Money stuff.');
    // facts appear with confidence
    expect(md).toContain('Revenue rose.');
    expect(md).toContain('Costs fell.');
    expect(md).toMatch(/confidence:\s*0\.91/);
  });

  it('renders knowledge gaps when present', async () => {
    const md = await generateReportMarkdown('sess-1');
    expect(md).toContain('No regional data');
  });

  it('throws "Report not yet generated" when report is null', async () => {
    sessionRows = [{ id: 'sess-1', topic: 'Acme Corp', report: null }];
    await expect(generateReportMarkdown('sess-1')).rejects.toThrow('Report not yet generated');
  });

  it('throws "Session not found" when the session is missing', async () => {
    sessionRows = [];
    await expect(generateReportMarkdown('missing')).rejects.toThrow('Session not found');
  });
});
