// The alias half of the matcher, and the two blocking passes that feed it.
//
// Kept out of match.test.ts because that file tests the rules as they stood
// when only names existed; these are about the two things the matcher was blind
// to — what the graph had already recorded as another name for the same thing,
// and pairs that share no word at all.
import { describe, it, expect } from 'vitest';
import {
  surfaceForms,
  aliasMatch,
  scorePair,
  findDuplicateCandidates,
  MAX_ALIASES_CONSIDERED,
  hasSubstantiveName,
  differsOnlyByNumber,
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

describe('surfaceForms', () => {
  it('is the name plus every alias', () => {
    const e = ent('a', 'Independent Body for Compensation Awards', { aliases: ['IBCA', 'the Body'] });
    expect(surfaceForms(e)).toEqual(['Independent Body for Compensation Awards', 'IBCA', 'the Body']);
  });

  it('drops an alias that normalises onto the name', () => {
    const e = ent('a', 'Companies House', { aliases: ['companies house', "Companies House."] });
    expect(surfaceForms(e)).toEqual(['Companies House']);
  });

  it('ignores blanks and non-strings', () => {
    const e = ent('a', 'Ofsted', { aliases: ['', '   ', null as unknown as string] });
    expect(surfaceForms(e)).toEqual(['Ofsted']);
  });

  it('caps the forms an entity contributes, name included', () => {
    const aliases = Array.from({ length: 40 }, (_, i) => `form ${i}`);
    expect(surfaceForms(ent('a', 'Thing', { aliases })).length).toBe(MAX_ALIASES_CONSIDERED);
  });
});

describe('aliasMatch', () => {
  it('fires when one name is the other side’s recorded alias', () => {
    const a = ent('a', 'Independent Body for Compensation Awards', { aliases: ['IBCA'] });
    const b = ent('b', 'IBCA');
    expect(aliasMatch(a, b)).toBe(true);
  });

  it('matches through canonicalisation, so packaging does not defeat it', () => {
    const a = ent('a', 'Broads Speed Reporter', { aliases: ['broads-speed-reporter-2.md'] });
    const b = ent('b', 'canvas:broads-speed-reporter-2');
    expect(aliasMatch(a, b)).toBe(true);
  });

  it('does NOT fire on two aliases resembling each other', () => {
    // An alias is a claim the graph accepted about ONE entity. Matching two of
    // them together is that claim twice removed, and on a mailbox-fed graph it
    // is how a shared honorific would start joining people up.
    const a = ent('a', 'Alice Smith', { aliases: ['Dr Smith'] });
    const b = ent('b', 'Bob Smith', { aliases: ['Dr Smith'] });
    expect(aliasMatch(a, b)).toBe(false);
  });

  it('is false when neither side has aliases', () => {
    expect(aliasMatch(ent('a', 'One'), ent('b', 'Two'))).toBe(false);
  });
});

describe('scorePair with aliases', () => {
  it('scores an alias match just below an identical name', () => {
    const a = ent('a', 'Independent Body for Compensation Awards', { aliases: ['IBCA'] });
    const b = ent('b', 'IBCA');
    const c = scorePair(a, b)!;
    expect(c.signals).toContain('alias_match');
    expect(c.confidence).toBeGreaterThan(0.9);
    expect(c.reason).toContain('alias');
  });

  it('finds an acronym that only one side’s ALIAS carries', () => {
    // Neither name resembles the other; the alias is the whole link.
    const a = ent('a', 'Department for Education', { aliases: ['the department'] });
    const b = ent('b', 'DfE');
    const c = scorePair(a, b)!;
    expect(c.signals).toContain('acronym');
  });

  it('still refuses a pair with nothing in common', () => {
    const a = ent('a', 'Norfolk Broads Authority', { aliases: ['NBA'] });
    const b = ent('b', 'Sheffield Hallam University', { aliases: ['SHU'] });
    expect(scorePair(a, b)).toBeNull();
  });
});

describe('findDuplicateCandidates blocking', () => {
  it('meets two entities through an alias token neither name shares', () => {
    const entities = [
      ent('a', 'Independent Body for Compensation Awards', { aliases: ['IBCA'] }),
      ent('b', 'IBCA'),
    ];
    const found = findDuplicateCandidates(entities);
    expect(found).toHaveLength(1);
    expect(found[0].signals).toContain('alias_match');
  });

  it('compares each pair once even when name and alias share a token', () => {
    const entities = [
      ent('a', 'Data Strategy', { aliases: ['Data Strategy 2026'] }),
      ent('b', 'Data Strategy'),
    ];
    expect(findDuplicateCandidates(entities)).toHaveLength(1);
  });

  it('scores a pair supplied by the vector pass that no block would produce', () => {
    // Nothing lexical connects these, so lexical blocking finds nothing…
    const a = ent('a', 'Ofsted', {
      embedding: [1, 0, 0],
      summary: 'the schools inspectorate',
    });
    const b = ent('b', 'the schools inspectorate', { embedding: [0.999, 0.04, 0] });
    expect(findDuplicateCandidates([a, b])).toHaveLength(0);

    // …until the pair is handed in directly, when the semantic rule can fire.
    const found = findDuplicateCandidates([a, b], { extraPairs: [['a', 'b']] });
    expect(found).toHaveLength(1);
    expect(found[0].signals).toContain('semantic');
  });

  it('promotes a semantically close pair that also shares neighbours', () => {
    const a = ent('a', 'Companies House', { embedding: [1, 0, 0] });
    const b = ent('b', 'the register of companies', { embedding: [0.93, 0.37, 0] });
    const neighbours = new Map([
      ['a', new Set(['x', 'y'])],
      ['b', new Set(['x', 'y'])],
    ]);
    const found = findDuplicateCandidates([a, b], { extraPairs: [['a', 'b']], neighbours });
    expect(found).toHaveLength(1);
    expect(found[0].signals).toEqual(expect.arrayContaining(['semantic', 'shared_neighbours']));
    // Referred for review, never near the auto-merge line.
    expect(found[0].confidence).toBeLessThan(0.6);
  });

  it('ignores an extra pair naming an entity that is not in the set', () => {
    const found = findDuplicateCandidates([ent('a', 'One')], { extraPairs: [['a', 'ghost']] });
    expect(found).toEqual([]);
  });
});

describe('hasSubstantiveName', () => {
  it('rejects a bare number', () => {
    expect(hasSubstantiveName('43')).toBe(false);
  });
  it('rejects initials with nothing else', () => {
    expect(hasSubstantiveName('J K')).toBe(false);
  });
  it('accepts a real word', () => {
    expect(hasSubstantiveName('Ofsted')).toBe(true);
  });
});

describe('semantic blocking noise', () => {
  // On the live graph the vector pass proposed nine pairs of two-digit page
  // numbers at 95% similarity and nothing else. Similarity between two bare
  // numbers describes the STRING, not the thing.
  it('refuses two numbers however similar their vectors', () => {
    const a = ent('a', '43', { embedding: [1, 0, 0], typeName: 'concept' });
    const b = ent('b', '33', { embedding: [0.999, 0.04, 0], typeName: 'concept' });
    expect(findDuplicateCandidates([a, b], { extraPairs: [['a', 'b']] })).toEqual([]);
  });

  it('still allows a lexical signal to carry a short name', () => {
    const a = ent('a', 'MoJ');
    const b = ent('b', 'Ministry of Justice');
    expect(scorePair(a, b)?.signals).toContain('acronym');
  });
});

describe('differsOnlyByNumber', () => {
  it('separates two members of a series', () => {
    expect(differsOnlyByNumber('700Wh Battery', '600Wh Battery')).toBe(true);
    expect(differsOnlyByNumber('iteration 2', 'iteration 3')).toBe(true);
    expect(differsOnlyByNumber('PR #166', 'PR #173')).toBe(true);
    expect(differsOnlyByNumber('192.168.1.0/24', '192.168.0.0/24')).toBe(true);
    expect(differsOnlyByNumber('Nmap 7.80', 'Nmap 7.991')).toBe(true);
  });

  // A number APPEARING is not a number CHANGING. This pair is one plan.
  it('does not fire when only one side carries a number', () => {
    expect(
      differsOnlyByNumber('MoJ AI action plan for Justice', 'MoJ AI action plan for Justice (2025-2028)'),
    ).toBe(false);
  });

  it('does not fire when the words differ too', () => {
    expect(differsOnlyByNumber('DJI Avinox M2S', 'DJI Avinox M2')).toBe(false);
    expect(differsOnlyByNumber('COVID-19', 'COVID-19 pandemic')).toBe(false);
  });

  it('does not fire on two names with the same numbers', () => {
    expect(differsOnlyByNumber('Q1 2026 report', 'Q1 2026 Report')).toBe(false);
  });

  // The path these actually arrive by: lexical blocking scores them null (they
  // share one word out of three), so it is the vector pass that proposes them —
  // 92% similar, sitting beside the same entities, and two different batteries.
  it('caps a series pair the vector pass proposed', () => {
    const a = ent('a', '700Wh Battery', { typeName: 'product', embedding: [1, 0, 0] });
    const b = ent('b', '600Wh Battery', { typeName: 'product', embedding: [0.93, 0.37, 0] });
    const neighbours = new Map([
      ['a', new Set(['bike', 'shop'])],
      ['b', new Set(['bike', 'shop'])],
    ]);
    const [found] = findDuplicateCandidates([a, b], { extraPairs: [['a', 'b']], neighbours });
    expect(found.signals).toContain('numeric_variant');
    expect(found.confidence).toBeLessThanOrEqual(0.38);
    expect(found.reason).toContain('members of a series');
  });
});
