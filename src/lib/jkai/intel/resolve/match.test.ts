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
  findSharedSenderAddresses,
  countNameGroups,
  canonicalName,
  isCanonicalMatch,
  looksLikeAcronym,
  initialsOf,
  emailTrust,
  countIdentitiesByAddress,
  sharedNeighbourCount,
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

describe('shared sender addresses', () => {
  const person = (id: string, name: string, email?: string) =>
    ent(id, name, {
      typeId: 'type-person',
      typeName: 'person',
      properties: email ? { email } : {},
    });

  it('groups the spellings of one name into a single identity', () => {
    expect(countNameGroups(['John Kelly', 'john.kelly', 'JohnKelly', 'J Kelly'])).toBe(1);
  });

  it('counts unrelated people separately', () => {
    expect(countNameGroups(['Anna Bainbridge', 'Stacey Keen', 'Dave Balderstone'])).toBe(3);
  });

  it('treats a name in a different order as the same person', () => {
    expect(countNameGroups(['Kelly, John', 'John Kelly'])).toBe(1);
  });

  it('flags an address that writes as several unrelated people', () => {
    const shared = findSharedSenderAddresses(
      new Map([
        ['invitations@linkedin.com', ['Anna Bainbridge', 'Stacey Keen', 'Dave Balderstone']],
        ['john@example.com', ['John Kelly', 'J Kelly', 'johnkelly']],
      ]),
    );
    expect(shared.has('invitations@linkedin.com')).toBe(true);
    // Aliases of one person are not a shared mailbox, however many there are.
    expect(shared.has('john@example.com')).toBe(false);
  });

  it('does not merge two strangers who share a notification address', () => {
    const shared = new Set(['invitations@linkedin.com']);
    const a = person('1', 'Anna Bainbridge', 'invitations@linkedin.com');
    const b = person('2', 'Dave Balderstone', 'invitations@linkedin.com');

    // Without the guard this is the graph's strongest signal, at 0.98.
    expect(scorePair(a, b)?.confidence).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
    expect(scorePair(a, b, { addressIdentities: shared })).toBeNull();
  });

  it('still resolves one person under two display names on a personal address', () => {
    const shared = new Set(['invitations@linkedin.com']);
    const a = person('1', 'J. Kelly', 'john@example.com');
    const b = person('2', 'John Kelly (IBCA)', 'john@example.com');
    const cand = scorePair(a, b, { addressIdentities: shared });
    expect(cand?.signals).toContain('same_email');
    expect(cand!.confidence).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
  });

  it('keeps a shared-sender address out of the candidate blocks entirely', () => {
    const shared = new Set(['invitations@linkedin.com']);
    const cands = findDuplicateCandidates(
      [
        person('1', 'Anna Bainbridge', 'invitations@linkedin.com'),
        person('2', 'Stacey Keen', 'invitations@linkedin.com'),
        person('3', 'Dave Balderstone', 'invitations@linkedin.com'),
      ],
      { addressIdentities: shared },
    );
    expect(cands).toEqual([]);
  });
});

describe('canonicalName', () => {
  it('drops a file extension', () => {
    expect(canonicalName('IBCA ExCo Paper 5a Data Strategy.docx')).toBe(canonicalName('IBCA ExCo Paper 5a Data Strategy'));
  });

  it('keeps an extension-like ending when nothing nameable is left', () => {
    // "Node.js" is a name, not a file — stripping it would meet a concept
    // called "Node".
    expect(canonicalName('Node.js')).not.toBe(canonicalName('Node'));
  });

  it('drops a namespace from a slug', () => {
    expect(canonicalName('z-ai/glm-5-turbo')).toBe(canonicalName('GLM-5 Turbo'));
    expect(canonicalName('canvas:tv-whats-playing')).toBe(canonicalName('tv-whats-playing'));
    expect(canonicalName('zerosumpain/SR-Main')).toBe(canonicalName('SR-Main'));
  });

  it('leaves a slash between two phrases alone', () => {
    // "M62/A1 corridor" is two roads, not a namespace and a name.
    expect(canonicalName('M62/A1 corridor')).not.toBe(canonicalName('A1 corridor'));
    expect(canonicalName('Church Lane / Preston Park area')).not.toBe(canonicalName('Preston Park area'));
  });

  it('leaves a slash before a bare word alone', () => {
    expect(canonicalName('Web/Dashboard')).not.toBe(canonicalName('Dashboard'));
  });

  it('drops a legal suffix', () => {
    expect(canonicalName('Google LLC')).toBe(canonicalName('Google'));
  });

  it('does not treat an identity-bearing word as noise', () => {
    // "team" and "group" are noise for overlap scoring and identity for this.
    expect(canonicalName('Security Team')).not.toBe(canonicalName('Security'));
  });

  it('leaves identical names to the identical_name signal', () => {
    expect(isCanonicalMatch('Data Strategy', 'data  strategy')).toBe(false);
  });
});

describe('canonical_name scoring', () => {
  it('reaches the auto-merge bar', () => {
    const cand = scorePair(ent('1', 'z-ai/glm-5-turbo'), ent('2', 'GLM-5 Turbo'));
    expect(cand?.signals).toContain('canonical_name');
    expect(cand!.confidence).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
  });

  it('survives a type disagreement, which is a typing question not a second thing', () => {
    const cand = scorePair(
      ent('1', 'canvas:broads-speed-reporter-2', { typeId: 'type-project', typeName: 'project' }),
      ent('2', 'broads-speed-reporter-2', { typeId: 'type-step', typeName: 'process_step' }),
    );
    expect(cand!.confidence).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
  });

  it('still refuses two roads that share a corridor', () => {
    const cand = scorePair(ent('1', 'M62/A1 corridor'), ent('2', 'A1 corridor'));
    expect(cand?.signals ?? []).not.toContain('canonical_name');
    expect(cand?.confidence ?? 0).toBeLessThan(AUTO_MERGE_THRESHOLD);
  });
});

describe('acronym shape', () => {
  it('accepts real initialisms, including mixed case', () => {
    for (const s of ['IBCA', 'DfE', 'MoJ', 'NCSC', 'DPIA']) {
      expect(looksLikeAcronym(s)).toBe(true);
    }
  });

  it('rejects two-letter forms, which collide with everything', () => {
    // "CI" had absorbed Compound Interest, client_id and Contact info.
    for (const s of ['AI', 'CI', 'EE', 'UK']) expect(looksLikeAcronym(s)).toBe(false);
  });

  it('rejects ordinary words', () => {
    for (const s of ['Piraeus', 'Morecambe', 'England', 'session']) {
      expect(looksLikeAcronym(s)).toBe(false);
    }
  });

  it('rejects anything with a space', () => {
    expect(looksLikeAcronym('WAN status')).toBe(false);
  });
});

describe('isAcronymPair — tightened', () => {
  it('still resolves the initialisms that matter', () => {
    expect(isAcronymPair('IBCA', 'Infected Blood Compensation Authority (IBCA)')).toBe(true);
    expect(isAcronymPair('DfE', 'Department for Education')).toBe(true);
    expect(isAcronymPair('MoJ', 'Ministry of Justice')).toBe(true);
    expect(isAcronymPair('NAO', 'National Audit Office')).toBe(true);
  });

  it('no longer takes a bracketed word for an abbreviation', () => {
    // A bracket means "a related thing" far more often than "my abbreviation".
    expect(isAcronymPair('Piraeus', '7-Day Greek Isles from Athens (Piraeus) to Venice')).toBe(false);
    expect(isAcronymPair('Morecambe', 'Independent Church (Morecambe)')).toBe(false);
    expect(isAcronymPair('VPS', 'Build + deploy (VPS)')).toBe(false);
    expect(isAcronymPair('EMEA', 'DataIQ 100 Brands 2024 (EMEA)')).toBe(false);
  });

  it('no longer reads an ordinary phrase as a two-letter acronym', () => {
    expect(isAcronymPair('AI', 'Alexa integration')).toBe(false);
    expect(isAcronymPair('CI', 'Competing Ideologies')).toBe(false);
    expect(isAcronymPair('EE', 'Energy efficiency')).toBe(false);
  });

  it('keeps a genuine acronym below the auto-merge bar when unproven', () => {
    // "ExCo" is syllabic, not initials — review, not automatic.
    const cand = scorePair(ent('1', 'EXCO'), ent('2', 'Executive Committee'));
    expect(cand?.confidence ?? 0).toBeLessThan(AUTO_MERGE_THRESHOLD);
  });
});

describe('initialsOf', () => {
  it('offers both the noise-word and noise-free forms', () => {
    const acr = initialsOf('Department for Education');
    expect(acr.has('dfe')).toBe(true);
    expect(acr.has('de')).toBe(true);
  });
});

describe('graduated email trust', () => {
  const person = (id: string, name: string, email: string) =>
    ent(id, name, { typeId: 'type-person', typeName: 'person', properties: { email } });

  it('grades an address by how many identities have used it', () => {
    const counts = countIdentitiesByAddress(
      new Map([
        ['solo@example.com', ['John Kelly']],
        ['aliases@example.com', ['John Kelly', 'J Kelly', 'Kelly, John']],
        ['two@example.com', ['EA', 'EdTech Architect']],
        ['channel@example.com', ['Anna Bainbridge', 'Stacey Keen', 'Dave Balderstone']],
      ]),
    );
    expect(emailTrust('solo@example.com', counts)).toBe('proof');
    expect(emailTrust('aliases@example.com', counts)).toBe('proof'); // one identity, three spellings
    expect(emailTrust('two@example.com', counts)).toBe('weak');
    expect(emailTrust('channel@example.com', counts)).toBe('none');
  });

  it('will not fuse two unrelated names on a two-identity address', () => {
    // ea@e.ea.com carries a games publisher and a job title that borrowed its mail.
    const counts = new Map([['ea@e.ea.com', 2]]);
    const cand = scorePair(
      person('1', 'EA', 'ea@e.ea.com'),
      person('2', 'EdTech Architect', 'ea@e.ea.com'),
      { addressIdentities: counts },
    );
    expect(cand?.signals ?? []).not.toContain('same_email');
    expect(cand?.confidence ?? 0).toBeLessThan(AUTO_MERGE_THRESHOLD);
  });

  it('still merges one person under two spellings on their own address', () => {
    const counts = new Map([['john@example.com', 2]]);
    const cand = scorePair(
      person('1', 'John Kelly', 'john@example.com'),
      person('2', 'johnkelly'.toUpperCase(), 'john@example.com'),
      { addressIdentities: counts },
    );
    expect(cand?.signals).toContain('same_email');
    expect(cand!.confidence).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
  });
});

describe('shared neighbours', () => {
  const neighbours = new Map<string, Set<string>>([
    ['1', new Set(['n1', 'n2', 'n3'])],
    ['2', new Set(['n1', 'n2', '9'])],
    ['3', new Set(['n1'])],
    ['4', new Set(['n1', 'x'])],
  ]);

  it('counts the entities both sides connect to', () => {
    expect(sharedNeighbourCount('1', '2', neighbours)).toBe(2);
    expect(sharedNeighbourCount('3', '4', neighbours)).toBe(1);
    expect(sharedNeighbourCount('1', 'missing', neighbours)).toBe(0);
  });

  it('strengthens a pair the names already proposed', () => {
    const bare = scorePair(ent('1', 'Trend Engine'), ent('2', 'Trend engine v4'));
    const withGraph = scorePair(ent('1', 'Trend Engine'), ent('2', 'Trend engine v4'), { neighbours });
    expect(withGraph!.confidence).toBeGreaterThan(bare!.confidence);
    expect(withGraph!.signals).toContain('shared_neighbours');
  });

  it('never proposes a pair on its own', () => {
    // Two entities with nothing in common but a shared neighbour are not a match.
    expect(scorePair(ent('1', 'Alpha'), ent('2', 'Omega'), { neighbours })).toBeNull();
  });

  it('overrides the low-similarity penalty, which was burying real duplicates', () => {
    const unlike = [1, 0, 0, 0];
    const alsoUnlike = [0, 1, 0, 0];
    const a = ent('1', 'Card ending 6878', { embedding: unlike });
    const b = ent('2', 'Card 6878 ending', { embedding: alsoUnlike });
    const penalised = scorePair(a, b)!;
    const rescued = scorePair(a, b, { neighbours })!;
    expect(rescued.confidence).toBeGreaterThan(penalised.confidence);
  });
});
