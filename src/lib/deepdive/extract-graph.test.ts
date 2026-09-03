import { describe, it, expect } from 'vitest';
import {
  SessionEntityIndex,
  GRAPH_EXTRACTION_PROMPT,
  coerceSentiment,
  coerceStrength,
} from './extract-graph';

describe('SessionEntityIndex', () => {
  it('resolves an exact name', () => {
    const ix = new SessionEntityIndex();
    ix.add('Department for Education', 'e1');
    expect(ix.resolve('Department for Education')).toBe('e1');
  });

  it('ignores case and surrounding whitespace', () => {
    const ix = new SessionEntityIndex();
    ix.add('  Ofsted ', 'e1');
    expect(ix.resolve('OFSTED')).toBe('e1');
    expect(ix.resolve('ofsted')).toBe('e1');
  });

  it('collapses runs of internal whitespace', () => {
    const ix = new SessionEntityIndex();
    ix.add('Care  Quality   Commission', 'e1');
    expect(ix.resolve('Care Quality Commission')).toBe('e1');
  });

  it('sees through punctuation and a legal suffix', () => {
    const ix = new SessionEntityIndex();
    ix.add('Acme Ltd.', 'e1');
    expect(ix.resolve('Acme')).toBe('e1');
    expect(ix.resolve('Acme Ltd')).toBe('e1');
  });

  it('sees through a leading article', () => {
    // The single commonest way the two halves of an extraction disagreed:
    // the entity list says "Department for Education", the relationship says
    // "the Department for Education".
    const ix = new SessionEntityIndex();
    ix.add('Department for Education', 'e1');
    expect(ix.resolve('The Department for Education')).toBe('e1');
  });

  it('resolves when the ARTICLE is the stored form and the link is not', () => {
    const ix = new SessionEntityIndex();
    ix.add('The Guardian', 'e1');
    expect(ix.resolve('Guardian')).toBe('e1');
  });

  it('returns null for a name it has never seen', () => {
    const ix = new SessionEntityIndex();
    ix.add('Ofsted', 'e1');
    expect(ix.resolve('Ofqual')).toBeNull();
  });

  it('does not fuse two different entities that merely share a word', () => {
    const ix = new SessionEntityIndex();
    ix.add('Education Policy Institute', 'e1');
    ix.add('Education Endowment Foundation', 'e2');
    expect(ix.resolve('Education Policy Institute')).toBe('e1');
    expect(ix.resolve('Education Endowment Foundation')).toBe('e2');
    expect(ix.resolve('Education')).toBeNull();
  });

  it('keeps the first id when the same name is added twice', () => {
    // A duplicate row created by a parallel source must not steal links from
    // the entity that already carries them.
    const ix = new SessionEntityIndex();
    ix.add('Ofsted', 'first');
    ix.add('ofsted', 'second');
    expect(ix.resolve('Ofsted')).toBe('first');
  });

  it('ignores an empty or whitespace-only name', () => {
    const ix = new SessionEntityIndex();
    ix.add('   ', 'e1');
    expect(ix.size).toBe(0);
    expect(ix.resolve('')).toBeNull();
  });
});

describe('GRAPH_EXTRACTION_PROMPT', () => {
  it('binds relationship endpoints to the entities array in the same response', () => {
    // This one line is the whole fix. Losing it returns the pipeline to a
    // relationship call that names endpoints the entity list never contained.
    expect(GRAPH_EXTRACTION_PROMPT).toMatch(/EXACTLY as they appear in the\s+entities array/);
  });

  it('asks for both halves of the graph', () => {
    expect(GRAPH_EXTRACTION_PROMPT).toContain('ENTITIES:');
    expect(GRAPH_EXTRACTION_PROMPT).toContain('RELATIONSHIPS:');
  });

  it('forbids self-loops, which break the force layout downstream', () => {
    expect(GRAPH_EXTRACTION_PROMPT).toMatch(/Never link an entity to itself/);
  });
});

describe('coerceSentiment', () => {
  it('accepts the four values the schema uses', () => {
    for (const v of ['positive', 'negative', 'neutral', 'contested']) {
      expect(coerceSentiment(v)).toBe(v);
    }
  });

  it('normalises case and padding', () => {
    expect(coerceSentiment('  Positive ')).toBe('positive');
  });

  it('falls back to neutral for anything else', () => {
    expect(coerceSentiment('spicy')).toBe('neutral');
    expect(coerceSentiment(undefined)).toBe('neutral');
    expect(coerceSentiment(7)).toBe('neutral');
  });
});

describe('coerceStrength', () => {
  it('passes a value already in range', () => {
    expect(coerceStrength(0.75)).toBe(0.75);
  });

  it('clamps out-of-range numbers rather than storing them', () => {
    expect(coerceStrength(1.4)).toBe(1);
    expect(coerceStrength(-2)).toBe(0);
  });

  it('reads a numeric string, which models emit routinely', () => {
    expect(coerceStrength('0.8')).toBeCloseTo(0.8);
  });

  it('defaults to 0.5 when there is no usable number', () => {
    expect(coerceStrength(undefined)).toBe(0.5);
    expect(coerceStrength('very strong')).toBe(0.5);
    expect(coerceStrength(NaN)).toBe(0.5);
  });
});
