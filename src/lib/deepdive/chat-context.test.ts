// src/lib/deepdive/chat-context.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildOverview,
  numberSources,
  buildChatPrompt,
  CHAT_SYSTEM,
  PASSAGE_CAP,
  MAX_HISTORY_TURNS,
  type RetrievedFact,
  type SourceMeta,
} from './chat-context';
import type { ResearchReport } from './types';

const report: ResearchReport = {
  ranked_facts: ['f-top-1', 'f-top-2'],
  timeline: [],
  clusters: [
    { title: 'Funding mechanics', summary: 'How money flows.', fact_ids: ['f-top-1'] },
    { title: 'Equity gap', summary: 'The disadvantage gap.', fact_ids: ['f-top-2'] },
  ],
  executive_summary: 'A study of education policy levers and their effects.',
  entity_centrality: { 'e-1': 0.9, 'e-2': 0.4, 'e-3': 0.1 },
};

const factsById = new Map([
  ['f-top-1', { id: 'f-top-1', content: 'Per-pupil funding rose 3% in real terms.', confidence: 0.8 }],
  ['f-top-2', { id: 'f-top-2', content: 'The disadvantage gap widened post-2019.', confidence: 0.7 }],
]);

const entitiesById = new Map([
  ['e-1', { id: 'e-1', name: 'Department for Education', type: 'org' }],
  ['e-2', { id: 'e-2', name: 'Ofsted', type: 'org' }],
  ['e-3', { id: 'e-3', name: 'Pupil Premium', type: 'concept' }],
]);

describe('buildOverview — from report', () => {
  it('includes the executive summary', () => {
    const ov = buildOverview(report, factsById, entitiesById);
    expect(ov).toContain('A study of education policy levers');
  });

  it('lists top ranked facts by their content', () => {
    const ov = buildOverview(report, factsById, entitiesById);
    expect(ov).toContain('Per-pupil funding rose 3% in real terms.');
    expect(ov).toContain('The disadvantage gap widened post-2019.');
  });

  it('lists cluster titles', () => {
    const ov = buildOverview(report, factsById, entitiesById);
    expect(ov).toContain('Funding mechanics');
    expect(ov).toContain('Equity gap');
  });

  it('lists top entities ordered by centrality (DfE before Ofsted before Pupil Premium)', () => {
    const ov = buildOverview(report, factsById, entitiesById);
    const dfe = ov.indexOf('Department for Education');
    const ofsted = ov.indexOf('Ofsted');
    const pp = ov.indexOf('Pupil Premium');
    expect(dfe).toBeGreaterThanOrEqual(0);
    expect(dfe).toBeLessThan(ofsted);
    expect(ofsted).toBeLessThan(pp);
  });
});

describe('buildOverview — fallback when no report', () => {
  it('falls back to the top-confidence facts when report is null', () => {
    const fallbackFacts = [
      { id: 'a', content: 'Low conf fact.', confidence: 0.2 },
      { id: 'b', content: 'High conf fact.', confidence: 0.95 },
    ];
    const ov = buildOverview(null, new Map(), new Map(), fallbackFacts);
    // Highest-confidence fact must appear first
    expect(ov.indexOf('High conf fact.')).toBeLessThan(ov.indexOf('Low conf fact.'));
    expect(ov).toContain('High conf fact.');
  });

  it('returns a non-empty string even with no report and no facts', () => {
    const ov = buildOverview(null, new Map(), new Map(), []);
    expect(ov.length).toBeGreaterThan(0);
  });
});

describe('numberSources', () => {
  const retrieved: RetrievedFact[] = [
    { id: 'r1', content: 'Passage one.', sourceId: 's1', similarity: 0.9 },
    { id: 'r2', content: 'Passage two.', sourceId: 's2', similarity: 0.8 },
    { id: 'r3', content: 'Passage three, same source as one.', sourceId: 's1', similarity: 0.7 },
  ];
  const sourceMeta = new Map<string, SourceMeta>([
    ['s1', { id: 's1', title: 'Source One', domain: 'one.gov.uk', url: 'https://one.gov.uk/a' }],
    ['s2', { id: 's2', title: 'Source Two', domain: 'two.org', url: 'https://two.org/b' }],
  ]);

  it('assigns one citation number per distinct source', () => {
    const { sources } = numberSources(retrieved, sourceMeta);
    // s1 and s2 only — two distinct sources
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.n)).toEqual([1, 2]);
  });

  it('exposes title/domain/url on each numbered source', () => {
    const { sources } = numberSources(retrieved, sourceMeta);
    expect(sources[0]).toMatchObject({ n: 1, title: 'Source One', domain: 'one.gov.uk', url: 'https://one.gov.uk/a' });
  });

  it('caps each passage to PASSAGE_CAP characters', () => {
    const long = 'x'.repeat(PASSAGE_CAP + 500);
    const { passages } = numberSources(
      [{ id: 'r1', content: long, sourceId: 's1', similarity: 0.9 }],
      sourceMeta,
    );
    // Passage text body must not exceed the cap
    expect(passages).toContain('x'.repeat(PASSAGE_CAP));
    expect(passages).not.toContain('x'.repeat(PASSAGE_CAP + 1));
  });

  it('tags each passage with the [n] of its source', () => {
    const { passages } = numberSources(retrieved, sourceMeta);
    expect(passages).toContain('[1]');
    expect(passages).toContain('[2]');
  });
});

describe('buildChatPrompt', () => {
  const overview = 'OVERVIEW TEXT';
  const passages = '[1] (Source One)\nPassage one.';
  const sources = [{ n: 1, title: 'Source One', domain: 'one.gov.uk', url: 'https://one.gov.uk/a' }];

  it('system prompt instructs grounding and [n] citation', () => {
    expect(CHAT_SYSTEM.toLowerCase()).toContain('cite');
    expect(CHAT_SYSTEM).toContain('[n]');
  });

  it('user prompt embeds the topic, overview, passages and question', () => {
    const { user } = buildChatPrompt('Education policy', overview, passages, [], 'How is funding modelled?');
    expect(user).toContain('Education policy');
    expect(user).toContain('OVERVIEW TEXT');
    expect(user).toContain('Passage one.');
    expect(user).toContain('How is funding modelled?');
  });

  it('caps history to the most recent MAX_HISTORY_TURNS turns', () => {
    const history = Array.from({ length: MAX_HISTORY_TURNS + 4 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `turn-${i}`,
    }));
    const { user } = buildChatPrompt('T', overview, passages, history, 'Q');
    // The oldest turn must have been dropped; the newest must be present.
    expect(user).not.toContain('turn-0');
    expect(user).toContain(`turn-${MAX_HISTORY_TURNS + 3}`);
  });

  it('returns the shared CHAT_SYSTEM as the system prompt', () => {
    const { system } = buildChatPrompt('T', overview, passages, [], 'Q');
    expect(system).toBe(CHAT_SYSTEM);
  });
});
