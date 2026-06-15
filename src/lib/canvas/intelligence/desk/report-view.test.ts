import { describe, it, expect } from 'vitest';
import { buildReportView, type DeskCardLite } from './report-view';
import type { ResearchReport } from '$lib/deepdive/types';

const cards: DeskCardLite[] = [
  { id: 'f1', kind: 'fact', fields: { content: 'GDP rose 2% in Q1.' } },
  { id: 'f2', kind: 'fact', fields: { content: 'Inflation fell to 3%.' } },
  { id: 'f3', kind: 'fact', fields: { content: 'Unemployment held at 4%.' } },
  { id: 'e1', kind: 'entity', fields: { name: 'Bank of England', type: 'organisation' } },
  { id: 'e2', kind: 'entity', fields: { name: 'Rachel Reeves', type: 'person' } },
  { id: 's1', kind: 'source', fields: { title: 'ONS Release', domain: 'ons.gov.uk', url: 'https://ons.gov.uk/a' } },
];

const report: ResearchReport = {
  ranked_facts: ['f1', 'f2', 'f3'],
  timeline: [],
  clusters: [
    { title: 'Macro indicators', summary: 'Headline economic moves.', fact_ids: ['f1', 'f2'] },
    { title: 'Labour market', summary: 'Jobs picture.', fact_ids: ['f3', 'missing-fact'] },
  ],
  executive_summary: 'The economy is mixed.',
  entity_centrality: { e1: 0.9, e2: 0.4 },
  knowledge_gaps: [
    { gap: 'No regional breakdown.', type: 'geographic', severity: 'high' },
    { gap: 'Pre-2020 baseline missing.', type: 'temporal', severity: 'low' },
  ],
  hypotheses: [
    {
      hypothesis: 'Rate cuts drove growth.',
      supporting_fact_ids: ['f1'],
      tension_fact_ids: ['f2'],
      testability: 'medium',
      suggested_queries: ['BoE rate decisions 2026'],
    },
  ],
  suggested_followups: [
    { question: 'What about wages?', context: 'Wage growth uncited.', seed_fact_ids: ['f3'] },
  ],
  source_diversity: { total_domains: 4, by_type: { government: 2, news: 2 }, concentration_index: 0.25 },
};

describe('buildReportView', () => {
  it('returns hasReport=false for a null report', () => {
    const v = buildReportView(null, cards);
    expect(v.hasReport).toBe(false);
    expect(v.clusters).toEqual([]);
    expect(v.executiveSummary).toBe('');
  });

  it('returns hasReport=false for an empty-object report (no executive_summary/clusters)', () => {
    const v = buildReportView({} as ResearchReport, cards);
    expect(v.hasReport).toBe(false);
  });

  it('surfaces the executive summary and marks hasReport', () => {
    const v = buildReportView(report, cards);
    expect(v.hasReport).toBe(true);
    expect(v.executiveSummary).toBe('The economy is mixed.');
  });

  it('joins cluster fact_ids to fact content and skips unknown ids', () => {
    const v = buildReportView(report, cards);
    expect(v.clusters).toHaveLength(2);
    const macro = v.clusters[0];
    expect(macro.title).toBe('Macro indicators');
    expect(macro.summary).toBe('Headline economic moves.');
    expect(macro.factCount).toBe(2);
    expect(macro.facts.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(macro.facts.map((f) => f.content)).toEqual(['GDP rose 2% in Q1.', 'Inflation fell to 3%.']);
    // 'missing-fact' has no card → dropped from the resolved list but still counted in factCount.
    const labour = v.clusters[1];
    expect(labour.factCount).toBe(2);
    expect(labour.facts.map((f) => f.id)).toEqual(['f3']);
  });

  it('colors knowledge gaps by severity', () => {
    const v = buildReportView(report, cards);
    expect(v.knowledgeGaps).toHaveLength(2);
    expect(v.knowledgeGaps[0]).toMatchObject({ gap: 'No regional breakdown.', severity: 'high', color: '#8b3a1a' });
    expect(v.knowledgeGaps[1].color).toBe('var(--text-muted)');
  });

  it('resolves hypothesis supporting/tension facts', () => {
    const v = buildReportView(report, cards);
    expect(v.hypotheses).toHaveLength(1);
    const h = v.hypotheses[0];
    expect(h.hypothesis).toBe('Rate cuts drove growth.');
    expect(h.testability).toBe('medium');
    expect(h.supporting.map((f) => f.content)).toEqual(['GDP rose 2% in Q1.']);
    expect(h.tension.map((f) => f.content)).toEqual(['Inflation fell to 3%.']);
    expect(h.suggestedQueries).toEqual(['BoE rate decisions 2026']);
  });

  it('passes follow-ups through with seed-fact resolution', () => {
    const v = buildReportView(report, cards);
    expect(v.followups).toHaveLength(1);
    expect(v.followups[0].question).toBe('What about wages?');
    expect(v.followups[0].seedFacts.map((f) => f.content)).toEqual(['Unemployment held at 4%.']);
  });

  it('sorts top entities by centrality descending and joins names/types', () => {
    const v = buildReportView(report, cards);
    expect(v.topEntities.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(v.topEntities[0]).toMatchObject({ name: 'Bank of England', type: 'organisation', centrality: 0.9 });
  });

  it('caps top entities at the requested limit', () => {
    const v = buildReportView(report, cards, { entityLimit: 1 });
    expect(v.topEntities).toHaveLength(1);
    expect(v.topEntities[0].id).toBe('e1');
  });

  it('exposes source diversity verbatim', () => {
    const v = buildReportView(report, cards);
    expect(v.sourceDiversity).toEqual({ total_domains: 4, by_type: { government: 2, news: 2 }, concentration_index: 0.25 });
  });

  it('tolerates a report missing all optional sections', () => {
    const minimal: ResearchReport = {
      ranked_facts: [],
      timeline: [],
      clusters: [{ title: 'Only', summary: '', fact_ids: [] }],
      executive_summary: 'Sparse.',
      entity_centrality: {},
    };
    const v = buildReportView(minimal, cards);
    expect(v.hasReport).toBe(true);
    expect(v.knowledgeGaps).toEqual([]);
    expect(v.hypotheses).toEqual([]);
    expect(v.followups).toEqual([]);
    expect(v.topEntities).toEqual([]);
    expect(v.sourceDiversity).toBeNull();
  });
});
