// The suggestion rules for the taxonomy. Pure, so they are testable without a
// database — which matters, because these are the rules that propose retiring
// something and a wrong one costs an undo.
import { describe, it, expect } from 'vitest';
import {
  suggestTypeMerges,
  suggestCategoryMerges,
  isPluralPair,
  typeWords,
  pairKeyForTypes,
  type TaxonomyType,
  type TaxonomyCategory,
} from './taxonomy';

function type(name: string, count: number, over: Partial<TaxonomyType> = {}): TaxonomyType {
  return {
    id: `t-${name}`,
    name,
    icon: '🔷',
    color: '#7dd3fc',
    status: 'active',
    description: '',
    proposedRationale: null,
    count,
    confirmed: count,
    createdAt: new Date('2026-01-01'),
    ...over,
  };
}

describe('typeWords', () => {
  it('reads snake_case as words', () => {
    expect(typeWords('data_source')).toEqual(['data', 'source']);
    expect(typeWords('process-step')).toEqual(['process', 'step']);
  });
});

describe('isPluralPair', () => {
  it('catches the -s, -es and -ies forms', () => {
    expect(isPluralPair('risk', 'risks')).toBe(true);
    expect(isPluralPair('processes', 'process')).toBe(true);
    expect(isPluralPair('policy', 'policies')).toBe(true);
  });
  it('is not fooled by two words that merely both end in s', () => {
    expect(isPluralPair('status', 'standards')).toBe(false);
  });
  it('is false for the same name twice', () => {
    expect(isPluralPair('risk', 'risk')).toBe(false);
  });
});

describe('suggestTypeMerges', () => {
  it('flags a proposed type that is really a relationship', () => {
    // The production case: the extractor is asked for entities and edges in one
    // pass, and hands back the edge as a type. Seven of these are live.
    const types = [type('authored', 0, { status: 'proposed' }), type('person', 283)];
    const s = suggestTypeMerges(types, { relationshipTypes: new Set(['authored', 'chairs']) });
    const hit = s.find((x) => x.kind === 'relation')!;
    expect(hit.fromName).toBe('authored');
    expect(hit.intoId).toBeNull();
    expect(hit.reason).toContain('relationship type');
  });

  it('flags a proposal nothing was ever filed under', () => {
    const s = suggestTypeMerges([type('newsletter_issue', 0, { status: 'proposed' })]);
    expect(s[0].kind).toBe('empty-proposal');
    expect(s[0].reason).toContain('extraction prompt');
  });

  it('does not call an ACTIVE empty type a stray proposal', () => {
    // An active type with nothing in it is a deliberate slot, not a mistake.
    expect(suggestTypeMerges([type('decision', 0)])).toEqual([]);
  });

  it('suggests folding the plural into the singular, smaller side first', () => {
    const s = suggestTypeMerges([type('risk', 59), type('risks', 3)]);
    const hit = s.find((x) => x.kind === 'plural')!;
    expect(hit.fromName).toBe('risks');
    expect(hit.intoName).toBe('risk');
  });

  it('suggests a contained name folds into the broader one', () => {
    const s = suggestTypeMerges([type('data_source', 201), type('source', 2)]);
    const hit = s.find((x) => x.kind === 'contained')!;
    expect(hit.fromName).toBe('source');
    expect(hit.intoName).toBe('data_source');
  });

  it('honours a dismissal, so a rejected suggestion stays rejected', () => {
    const types = [type('risk', 59), type('risks', 3)];
    const key = pairKeyForTypes('t-risks', 't-risk');
    expect(suggestTypeMerges(types, { dismissed: new Set([key]) })).toEqual([]);
  });

  it('leaves two unrelated types alone', () => {
    expect(suggestTypeMerges([type('person', 283), type('location', 349)])).toEqual([]);
  });

  it('never proposes retiring a retired type', () => {
    expect(suggestTypeMerges([type('code_commit', 0, { status: 'retired' })])).toEqual([]);
  });
});

describe('suggestCategoryMerges', () => {
  const cat = (name: string, noteCount: number): TaxonomyCategory => ({
    id: `c-${name}`,
    slug: name.toLowerCase(),
    name,
    description: null,
    color: '#7dd3fc',
    noteCount,
    folderCount: 1,
    createdAt: new Date('2026-01-01'),
  });

  it('pairs a plural with its singular, keeping the busier one', () => {
    const [s] = suggestCategoryMerges([cat('Policy', 40), cat('Policies', 2)]);
    expect(s.fromName).toBe('Policies');
    expect(s.intoName).toBe('Policy');
  });

  it('says nothing about two genuinely different categories', () => {
    expect(suggestCategoryMerges([cat('Work', 10), cat('Family', 4)])).toEqual([]);
  });
});
