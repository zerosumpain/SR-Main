import { describe, it, expect } from 'vitest';
import {
  normaliseName,
  significantTokens,
  acronymsOf,
  isAcronymPair,
  tokenOverlap,
  isTokenSubset,
  scorePair,
  pickSurvivor,
  findDuplicateCandidates,
  AUTO_MERGE_THRESHOLD,
  type ResolvableEntity,
} from './match';

function ent(id: string, name: string, over: Partial<ResolvableEntity> = {}): ResolvableEntity {
  return {
    id,
    name,
    typeId: 'type-org',
    typeName: 'organisation',
    degree: 5,
    noteCount: 2,
    embedding: null,
    ...over,
  };
}

describe('normaliseName', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normaliseName('  IBCA’s   Data-Strategy!  ')).toBe('ibca data strategy');
  });

  it('removes possessives in both apostrophe styles', () => {
    expect(normaliseName("IBCA's Data Strategy")).toBe(normaliseName('IBCA Data Strategy'));
    expect(normaliseName('IBCA’s Data Strategy')).toBe(normaliseName('IBCA Data Strategy'));
  });

  it('keeps letters from non-Latin scripts', () => {
    expect(normaliseName('Płaneta')).toBe('płaneta');
  });
});

describe('significantTokens', () => {
  it('drops noise words', () => {
    expect(significantTokens('The Department for Education')).toEqual(['department', 'education']);
  });

  it('returns nothing for a name that is all noise', () => {
    expect(significantTokens('the and of')).toEqual([]);
  });
});

describe('acronymsOf', () => {
  it('reads an acronym out of parentheses', () => {
    expect(acronymsOf('Infected Blood Compensation Authority (IBCA)').has('ibca')).toBe(true);
  });

  it('derives initials from the significant words', () => {
    expect(acronymsOf('Department for Education').has('de')).toBe(true);
    expect(acronymsOf('National Pupil Database').has('npd')).toBe(true);
  });

  it('ignores parentheticals that are not acronym-shaped', () => {
    const acr = acronymsOf('Some Body (formerly known as another thing entirely)');
    expect([...acr].some((a) => a.length > 12)).toBe(false);
  });

  it('does not invent an acronym for a single-word name', () => {
    expect(acronymsOf('IBCA').size).toBe(0);
  });
});

describe('isAcronymPair', () => {
  it('matches the real production case', () => {
    expect(isAcronymPair('IBCA', 'Infected Blood Compensation Authority (IBCA)')).toBe(true);
  });

  it('is symmetric', () => {
    expect(isAcronymPair('Infected Blood Compensation Authority (IBCA)', 'IBCA')).toBe(true);
  });

  it('matches initials without an explicit parenthetical', () => {
    expect(isAcronymPair('NPD', 'National Pupil Database')).toBe(true);
  });

  it('rejects an unrelated short name', () => {
    expect(isAcronymPair('DfE', 'Infected Blood Compensation Authority')).toBe(false);
  });

  it('rejects two multi-word names', () => {
    expect(isAcronymPair('Department for Education', 'Department for Transport')).toBe(false);
  });

  it('rejects identical names', () => {
    expect(isAcronymPair('IBCA', 'IBCA')).toBe(false);
  });
});

describe('tokenOverlap and isTokenSubset', () => {
  it('scores full overlap as one', () => {
    expect(tokenOverlap('Data Strategy', 'The Data Strategy')).toBe(1);
  });

  it('scores disjoint names as zero', () => {
    expect(tokenOverlap('Alpha Project', 'Beta Review')).toBe(0);
  });

  it('detects a genuine containment', () => {
    expect(isTokenSubset('AI Playbook', 'IBCA AI Playbook')).toBe(true);
  });

  it('refuses a single-token subset as too weak', () => {
    expect(isTokenSubset('Strategy', 'Data Strategy')).toBe(false);
  });

  it('refuses equal-length names', () => {
    expect(isTokenSubset('Data Strategy', 'AI Strategy')).toBe(false);
  });
});

describe('scorePair', () => {
  it('scores the IBCA acronym pair high enough to auto-merge', () => {
    const c = scorePair(ent('1', 'IBCA'), ent('2', 'Infected Blood Compensation Authority (IBCA)'))!;
    expect(c).not.toBeNull();
    expect(c.signals).toContain('acronym');
    expect(c.confidence).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
    expect(c.reason).toContain('acronym');
  });

  it('scores identical names highest', () => {
    const c = scorePair(ent('1', 'IBCA Data Strategy'), ent('2', "IBCA's Data Strategy"))!;
    expect(c.signals).toContain('identical_name');
    expect(c.confidence).toBeGreaterThan(0.9);
  });

  it('returns null for a pair with nothing in common', () => {
    expect(scorePair(ent('1', 'Alpha'), ent('2', 'Completely Different Thing'))).toBeNull();
  });

  it('returns null when given the same entity twice', () => {
    expect(scorePair(ent('1', 'IBCA'), ent('1', 'IBCA'))).toBeNull();
  });

  it('keeps a containment below the auto-merge threshold without corroboration', () => {
    const c = scorePair(ent('1', 'AI Playbook'), ent('2', 'IBCA AI Playbook'))!;
    expect(c.signals).toContain('token_subset');
    expect(c.confidence).toBeLessThan(AUTO_MERGE_THRESHOLD);
  });

  it('raises confidence when embeddings agree', () => {
    const bare = scorePair(ent('1', 'AI Playbook'), ent('2', 'IBCA AI Playbook'))!;
    const backed = scorePair(
      ent('1', 'AI Playbook', { embedding: [1, 0, 0] }),
      ent('2', 'IBCA AI Playbook', { embedding: [0.99, 0.14, 0] }),
    )!;
    expect(backed.confidence).toBeGreaterThan(bare.confidence);
    expect(backed.signals).toContain('semantic');
  });

  it('drops a pair whose similar names demonstrably mean different things', () => {
    // Orthogonal embeddings are a direct contradiction of the name evidence, and
    // halving a 0.55 containment score takes it below the reporting floor —
    // the pair should not be offered for merge at all.
    const contradicted = scorePair(
      ent('1', 'AI Playbook', { embedding: [1, 0] }),
      ent('2', 'IBCA AI Playbook', { embedding: [0, 1] }),
    );
    expect(contradicted).toBeNull();
  });

  it('still surfaces a strong name match even when embeddings disagree', () => {
    // An explicit acronym is hard evidence; it should survive weak semantics
    // rather than being silently discarded.
    const c = scorePair(
      ent('1', 'IBCA', { embedding: [1, 0] }),
      ent('2', 'Infected Blood Compensation Authority (IBCA)', { embedding: [0, 1] }),
    );
    expect(c).not.toBeNull();
    expect(c!.signals).toContain('acronym');
  });

  it('never auto-merges on embeddings alone', () => {
    const c = scorePair(
      ent('1', 'Alpha Thing', { embedding: [1, 0] }),
      ent('2', 'Beta Object', { embedding: [1, 0] }),
    );
    expect(c!.confidence).toBeLessThan(AUTO_MERGE_THRESHOLD);
  });

  it('discounts a name match across different types', () => {
    const same = scorePair(ent('1', 'Morgan'), ent('2', 'Morgan'))!;
    const crossType = scorePair(
      ent('1', 'Morgan'),
      ent('2', 'Morgan', { typeId: 'type-person', typeName: 'person' }),
    )!;
    expect(crossType.confidence).toBeLessThan(same.confidence);
    expect(crossType.reason).toContain('typed differently');
  });

  it('orders the pair deterministically regardless of argument order', () => {
    const a = scorePair(ent('z', 'IBCA'), ent('a', 'Infected Blood Compensation Authority (IBCA)'))!;
    const b = scorePair(ent('a', 'Infected Blood Compensation Authority (IBCA)'), ent('z', 'IBCA'))!;
    expect([a.aId, a.bId]).toEqual([b.aId, b.bId]);
    expect(a.aId < a.bId).toBe(true);
  });
});

describe('pickSurvivor', () => {
  it('keeps the better-connected entity', () => {
    const { keep, merge } = pickSurvivor(
      ent('1', 'IBCA', { degree: 119 }),
      ent('2', 'Infected Blood Compensation Authority (IBCA)', { degree: 12 }),
    );
    expect(keep.id).toBe('1');
    expect(merge.id).toBe('2');
  });

  it('breaks a degree tie on evidence count', () => {
    const { keep } = pickSurvivor(
      ent('1', 'A', { degree: 5, noteCount: 1 }),
      ent('2', 'B', { degree: 5, noteCount: 9 }),
    );
    expect(keep.id).toBe('2');
  });

  it('is deterministic when everything ties', () => {
    const a = pickSurvivor(ent('1', 'Same'), ent('2', 'Same'));
    const b = pickSurvivor(ent('2', 'Same'), ent('1', 'Same'));
    expect(a.keep.id).toBe(b.keep.id);
  });
});

describe('findDuplicateCandidates', () => {
  it('finds the production duplicates and ranks the acronym pair first', () => {
    const entities = [
      ent('1', 'IBCA', { degree: 119 }),
      ent('2', 'Infected Blood Compensation Authority (IBCA)', { degree: 12 }),
      ent('3', 'IBCA Data Strategy', { degree: 28 }),
      ent('4', "IBCA's Data Strategy", { degree: 2 }),
      ent('5', 'Department for Education', { degree: 7 }),
    ];
    const cands = findDuplicateCandidates(entities);
    const pairs = cands.map((c) => [c.aId, c.bId].sort().join('-'));
    expect(pairs).toContain('1-2');
    expect(pairs).toContain('3-4');
    expect(cands[0].confidence).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
  });

  it('never pairs an entity with itself', () => {
    const cands = findDuplicateCandidates([ent('1', 'IBCA'), ent('2', 'IBCA')]);
    expect(cands.every((c) => c.aId !== c.bId)).toBe(true);
  });

  it('emits each pair once', () => {
    const cands = findDuplicateCandidates([
      ent('1', 'IBCA Data Strategy'),
      ent('2', "IBCA's Data Strategy"),
    ]);
    expect(cands).toHaveLength(1);
  });

  it('leaves genuinely distinct entities alone', () => {
    const cands = findDuplicateCandidates([
      ent('1', 'Department for Education'),
      ent('2', 'Department for Transport'),
      ent('3', 'Cabinet Office'),
    ]);
    expect(cands).toEqual([]);
  });

  it('does not confuse sibling strategies that merely share a prefix', () => {
    const cands = findDuplicateCandidates([
      ent('1', 'IBCA Data Strategy'),
      ent('2', 'IBCA AI Strategy'),
      ent('3', 'IBCA Digital and Cybersecurity Strategy'),
    ]);
    expect(cands.filter((c) => c.confidence >= AUTO_MERGE_THRESHOLD)).toEqual([]);
  });

  it('handles an empty input', () => {
    expect(findDuplicateCandidates([])).toEqual([]);
  });

  it('returns candidates in descending confidence', () => {
    const cands = findDuplicateCandidates([
      ent('1', 'IBCA', { degree: 119 }),
      ent('2', 'Infected Blood Compensation Authority (IBCA)'),
      ent('3', 'AI Playbook'),
      ent('4', 'IBCA AI Playbook'),
    ]);
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].confidence).toBeGreaterThanOrEqual(cands[i].confidence);
    }
  });
});
