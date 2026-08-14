// The pure half of a cluster narrative: does the prompt carry the facts that
// make it a description of the CLUSTER rather than of a dozen entities?
import { describe, it, expect } from 'vitest';
import { buildBriefPrompt, type BriefContext, type ClusterBriefFacts } from './brief';

const baseContext: BriefContext = {
  title: 'IBCA',
  subjects: [],
  neighbours: [],
  links: [],
  sources: [],
  timeline: [],
  research: [],
  openQuestions: [],
  generatedAt: '2026-08-14T00:00:00.000Z',
};

const facts: ClusterBriefFacts = {
  label: 'IBCA · Responsible AI Strategy',
  size: 205,
  subjectCount: 12,
  types: [
    ['policy', 46],
    ['person', 28],
  ],
  sources: [
    ['file', 140],
    ['chat', 63],
    ['research', 19],
  ],
  sourceless: 12,
  noteTotal: 488,
  diversity: 0.7,
  span: { from: '2026-05-01T00:00:00.000Z', to: '2026-08-12T00:00:00.000Z' },
  bridges: [{ name: 'IBCA', reaches: ['a', 'b', 'c'] }],
};

const withCluster = (over: Partial<ClusterBriefFacts> = {}): BriefContext => ({
  ...baseContext,
  cluster: { ...facts, ...over },
});

describe('cluster narrative prompt', () => {
  it('is unchanged for a brief that is not about a cluster', () => {
    const prompt = buildBriefPrompt(baseContext);
    expect(prompt.user).not.toContain('## CLUSTER');
    expect(prompt.system).not.toContain('CLUSTER NARRATIVE');
  });

  it('tells the model the subjects are a sample, not the cluster', () => {
    const prompt = buildBriefPrompt(withCluster());
    expect(prompt.system).toContain('CLUSTER NARRATIVE');
    expect(prompt.system).toContain('NOT all of it');
    expect(prompt.user).toContain('205 entities, of which the 12 most connected');
  });

  it('states the source mix per channel, not as a summary', () => {
    const prompt = buildBriefPrompt(withCluster());
    expect(prompt.user).toContain('file 140, chat 63, research 19');
    expect(prompt.user).toContain('488 note links');
  });

  it('gives the observed span', () => {
    const prompt = buildBriefPrompt(withCluster());
    expect(prompt.user).toContain('2026-05-01 to 2026-08-12');
  });

  it('names unevidenced members so they land under Gaps', () => {
    const prompt = buildBriefPrompt(withCluster());
    expect(prompt.user).toContain('12 members carry NO evidence');
  });

  it('says nothing about unevidenced members when there are none', () => {
    const prompt = buildBriefPrompt(withCluster({ sourceless: 0 }));
    expect(prompt.user).not.toContain('NO evidence at all');
  });

  it('calls a single-source cluster a feed, from the data', () => {
    // The Brakeburn/Zavvi case: diversity 0.04, everything from one mailbox.
    const prompt = buildBriefPrompt(
      withCluster({ diversity: 0.04, sources: [['email', 229]], label: 'Brakeburn · Summer Sale' }),
    );
    expect(prompt.user).toContain('ONE kind of source (email)');
    expect(prompt.user).toContain('feed arriving on its own');
  });

  it('calls a corroborated cluster deliberate, from the data', () => {
    const prompt = buildBriefPrompt(withCluster());
    expect(prompt.user).toContain('Corroborated across 3 kinds of source');
    expect(prompt.user).toContain('engaged with deliberately');
    expect(prompt.user).not.toContain('ONE kind of source');
  });

  it('never asks the model to guess whether the cluster matters', () => {
    // It got this wrong on the first real run — a cluster of hand-written policy
    // documents was labelled a feed, because nothing in a list of entities says
    // how it was acquired. The classification is the data's job, not the model's.
    const prompt = buildBriefPrompt(withCluster());
    expect(prompt.system).toContain('Do NOT guess');
  });

  it('names what holds the cluster to the rest of the graph', () => {
    const prompt = buildBriefPrompt(withCluster());
    expect(prompt.user).toContain('IBCA (reaches 3 other clusters)');
  });

  it('still warns about having no sources at all', () => {
    const prompt = buildBriefPrompt(withCluster());
    expect(prompt.system).toContain('NO SOURCES');
  });

  it('keeps the citation contract', () => {
    const prompt = buildBriefPrompt(withCluster());
    expect(prompt.system).toContain('Never invent a source number');
  });

  it('handles a cluster with no dated evidence', () => {
    const prompt = buildBriefPrompt(withCluster({ span: null }));
    expect(prompt.user).not.toContain('Observed span');
  });
});
