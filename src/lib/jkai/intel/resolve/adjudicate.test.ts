// The pure half of adjudication: what goes into the prompt, and what is allowed
// to come back out of it.
import { describe, it, expect } from 'vitest';
import { parseAdjudication, buildAdjudicationPrompt, CO_MENTION } from './adjudicate';
import type { ResolvableEntity } from './match';

function ent(id: string, name: string, over: Partial<ResolvableEntity> = {}): ResolvableEntity {
  return {
    id,
    name,
    typeId: 'type-org',
    typeName: 'organisation',
    degree: 4,
    noteCount: 2,
    embedding: null,
    ...over,
  };
}

describe('parseAdjudication', () => {
  it('reads a clean verdict', () => {
    const out = parseAdjudication('{"verdict":"same","confidence":0.8,"rationale":"one replaced the other"}');
    expect(out).toEqual({ verdict: 'same', confidence: 0.8, rationale: 'one replaced the other' });
  });

  it('tolerates a preamble around the object', () => {
    const out = parseAdjudication('Here you go:\n{"verdict":"different","confidence":0.9,"rationale":"a body and its committee"}\nThanks');
    expect(out?.verdict).toBe('different');
  });

  it('accepts unsure, which is the answer it should give most often', () => {
    expect(parseAdjudication('{"verdict":"unsure","confidence":0.2,"rationale":"the notes do not say"}')?.verdict).toBe(
      'unsure',
    );
  });

  // The important half. A defaulted verdict would be recorded as though
  // something had been decided: a defaulted "different" buries a real duplicate
  // where the queue can never show it again, and a defaulted "same" proposes a
  // merge nobody made. No answer must produce no row.
  it('refuses a verdict it does not recognise', () => {
    expect(parseAdjudication('{"verdict":"probably","confidence":0.9,"rationale":"x"}')).toBeNull();
  });

  it('refuses prose', () => {
    expect(parseAdjudication('They look like the same organisation to me.')).toBeNull();
  });

  it('refuses malformed JSON', () => {
    expect(parseAdjudication('{"verdict":"same",')).toBeNull();
  });

  it('clamps a confidence outside 0..1 and defaults a missing one', () => {
    expect(parseAdjudication('{"verdict":"same","confidence":7,"rationale":"x"}')?.confidence).toBe(1);
    expect(parseAdjudication('{"verdict":"same","rationale":"x"}')?.confidence).toBe(0.5);
  });
});

describe('buildAdjudicationPrompt', () => {
  const a = ent('a', 'Independent Body for Compensation Awards', {
    aliases: ['IBCA'],
    summary: 'Pays compensation awards.',
    properties: { email: 'info@ibca.gov.uk' },
  });
  const b = ent('b', 'IBCA Board');

  it('carries evidence without anchoring the adjudicator to a heuristic score', () => {
    const prompt = buildAdjudicationPrompt({
      a,
      b,
      evidence: [{ entityId: 'a', noteTitle: 'Minutes', noteSource: 'file', excerpt: 'IBCA was established…' }],
      sharedNeighbours: ['Cabinet Office'],
      confidence: 0.55,
      reason: 'names share most of their words',
    });
    expect(prompt).toContain('Independent Body for Compensation Awards');
    expect(prompt).toContain('also called: IBCA');
    expect(prompt).toContain('info@ibca.gov.uk');
    expect(prompt).toContain('IBCA was established');
    expect(prompt).toContain('Cabinet Office');
    expect(prompt).not.toContain('55%');
    expect(prompt).toContain('independently');
  });

  it('says so plainly when an entity has no evidence, rather than omitting the line', () => {
    const prompt = buildAdjudicationPrompt({
      a,
      b,
      evidence: [],
      sharedNeighbours: [],
      confidence: 0.4,
      reason: 'one name contains the other',
    });
    expect(prompt).toContain('evidence: none recorded');
    expect(prompt).toContain('They share no connections in the graph.');
  });
});

describe('buildAdjudicationPrompt with a co-mention', () => {
  const a = ent('a', 'Infected Blood Compensation Authority');
  const b = ent('b', 'Infected Blood Inquiry');

  it('sets a source naming BOTH apart from each side’s own evidence', () => {
    const prompt = buildAdjudicationPrompt({
      a,
      b,
      evidence: [
        { entityId: 'a', noteTitle: null, noteSource: 'file', excerpt: 'The Authority pays awards.' },
        {
          entityId: CO_MENTION,
          noteTitle: 'Briefing',
          noteSource: 'email',
          excerpt: 'The Inquiry recommended that the Authority be established.',
        },
      ],
      sharedNeighbours: [],
      confidence: 0.6,
      reason: 'names share most of their words',
    });
    expect(prompt).toContain('Sources naming BOTH:');
    expect(prompt).toContain('The Inquiry recommended');
    // The co-mention must NOT be filed under either side as its own evidence.
    expect(prompt.indexOf('The Inquiry recommended')).toBeGreaterThan(prompt.indexOf('B: "Infected Blood Inquiry"'));
  });

  it('omits the section entirely when nothing names both', () => {
    const prompt = buildAdjudicationPrompt({
      a,
      b,
      evidence: [],
      sharedNeighbours: [],
      confidence: 0.6,
      reason: 'x',
    });
    expect(prompt).not.toContain('Sources naming BOTH');
  });
});
