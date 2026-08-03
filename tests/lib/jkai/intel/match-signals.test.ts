// The resolution signals added for the Gmail sweep: exact-address identity,
// and the person-name forms that address headers actually produce.
import { describe, it, expect } from 'vitest';
import {
  scorePair,
  findDuplicateCandidates,
  isInitialExpansion,
  isNameReordering,
  personTokens,
  emailOf,
  AUTO_MERGE_THRESHOLD,
  type ResolvableEntity,
} from '$lib/jkai/intel/resolve/match';

const person = (over: Partial<ResolvableEntity> = {}): ResolvableEntity => ({
  id: 'a',
  name: 'John Kelly',
  typeId: 'person-type',
  typeName: 'person',
  degree: 3,
  noteCount: 2,
  ...over,
});

describe('emailOf', () => {
  it('reads and lowercases properties.email', () => {
    expect(emailOf(person({ properties: { email: 'John@X.com' } }))).toBe('john@x.com');
  });

  it('is null when absent or not an address', () => {
    expect(emailOf(person())).toBeNull();
    expect(emailOf(person({ properties: { email: 'not-an-address' } }))).toBeNull();
    expect(emailOf(person({ properties: { email: 42 as unknown as string } }))).toBeNull();
  });
});

describe('personTokens', () => {
  it('strips titles and suffixes', () => {
    expect(personTokens('Dr Jane Okafor')).toEqual(['jane', 'okafor']);
    expect(personTokens('John Kelly Jr')).toEqual(['john', 'kelly']);
  });
});

describe('isInitialExpansion', () => {
  it('matches an initial against its expansion on a shared family name', () => {
    expect(isInitialExpansion('J Kelly', 'John Kelly')).toBe(true);
    expect(isInitialExpansion('John R Kelly', 'John Kelly')).toBe(true);
  });

  it('refuses when the family name differs — the anchor is the whole point', () => {
    expect(isInitialExpansion('J Kelly', 'John Braun')).toBe(false);
  });

  it('refuses when the initial does not match the given name', () => {
    expect(isInitialExpansion('R Kelly', 'John Kelly')).toBe(false);
  });

  it('does not fire on identical names', () => {
    expect(isInitialExpansion('John Kelly', 'John Kelly')).toBe(false);
  });

  it('needs two tokens on both sides', () => {
    expect(isInitialExpansion('Kelly', 'John Kelly')).toBe(false);
  });
});

describe('isNameReordering', () => {
  it('matches the comma-reversed form address headers produce', () => {
    expect(isNameReordering('Kelly, John', 'John Kelly')).toBe(true);
  });

  it('does not fire on identical order', () => {
    expect(isNameReordering('John Kelly', 'John Kelly')).toBe(false);
  });

  it('refuses a partial name', () => {
    expect(isNameReordering('Kelly', 'John Kelly')).toBe(false);
  });

  it('refuses different words', () => {
    expect(isNameReordering('Kelly, Jane', 'John Kelly')).toBe(false);
  });
});

describe('scorePair — same_email', () => {
  it('is auto-mergeable on its own, even under unlike display names', () => {
    const a = person({ id: 'a', name: 'J. Kelly', properties: { email: 'john@x.com' } });
    const b = person({ id: 'b', name: 'John Kelly (IBCA)', properties: { email: 'john@x.com' } });
    const cand = scorePair(a, b);
    expect(cand?.signals).toContain('same_email');
    expect(cand!.confidence).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
  });

  it('survives a type mismatch — the disagreement is about the type, not identity', () => {
    const a = person({ id: 'a', typeId: 'person-type', properties: { email: 'j@x.com' } });
    const b = person({ id: 'b', typeId: 'org-type', typeName: 'organisation', properties: { email: 'j@x.com' } });
    const cand = scorePair(a, b);
    expect(cand!.confidence).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
  });

  it('explains itself with the address', () => {
    const a = person({ id: 'a', properties: { email: 'john@x.com' } });
    const b = person({ id: 'b', name: 'Johnny K', properties: { email: 'john@x.com' } });
    expect(scorePair(a, b)?.reason).toContain('john@x.com');
  });
});

describe('scorePair — conflicting addresses', () => {
  it('holds two same-named people with different addresses below auto-merge', () => {
    // Two real people do share a name; the addresses say they are not one.
    const a = person({ id: 'a', name: 'John Kelly', properties: { email: 'john.kelly@x.com' } });
    const b = person({ id: 'b', name: 'John Kelly', properties: { email: 'jkelly@y.org' } });
    const cand = scorePair(a, b);
    expect(cand!.confidence).toBeLessThan(AUTO_MERGE_THRESHOLD);
  });

  it('still surfaces them for review rather than dropping them', () => {
    const a = person({ id: 'a', name: 'John Kelly', properties: { email: 'a@x.com' } });
    const b = person({ id: 'b', name: 'John Kelly', properties: { email: 'b@x.com' } });
    expect(scorePair(a, b)).not.toBeNull();
  });

  it('does not penalise when only one side has an address', () => {
    const a = person({ id: 'a', name: 'John Kelly', properties: { email: 'a@x.com' } });
    const b = person({ id: 'b', name: 'John Kelly' });
    expect(scorePair(a, b)!.confidence).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
  });
});

describe('scorePair — person-name rules are gated to people', () => {
  it('matches a reordered person name', () => {
    const a = person({ id: 'a', name: 'Kelly, John' });
    const b = person({ id: 'b', name: 'John Kelly' });
    expect(scorePair(a, b)?.signals).toContain('name_reordering');
  });

  it('does NOT apply reordering to organisations', () => {
    const a = person({ id: 'a', name: 'Systems, Acme', typeName: 'organisation', typeId: 'org' });
    const b = person({ id: 'b', name: 'Acme Systems', typeName: 'organisation', typeId: 'org' });
    const cand = scorePair(a, b);
    expect(cand?.signals ?? []).not.toContain('name_reordering');
  });

  it('does NOT apply initial expansion to organisations', () => {
    const a = person({ id: 'a', name: 'B Corp', typeName: 'organisation', typeId: 'org' });
    const b = person({ id: 'b', name: 'Bravo Corp', typeName: 'organisation', typeId: 'org' });
    expect(scorePair(a, b)?.signals ?? []).not.toContain('initial_expansion');
  });

  it('keeps initial expansion below auto-merge — it is a suggestion, not proof', () => {
    const a = person({ id: 'a', name: 'J Kelly' });
    const b = person({ id: 'b', name: 'John Kelly' });
    const cand = scorePair(a, b);
    expect(cand?.signals).toContain('initial_expansion');
    expect(cand!.confidence).toBeLessThan(AUTO_MERGE_THRESHOLD);
  });
});

describe('findDuplicateCandidates — email blocking', () => {
  it('pairs two entities that share an address but no name token', () => {
    // This is the case the signal exists for: without email blocking these two
    // never meet in any block and the duplicate is invisible.
    const found = findDuplicateCandidates([
      person({ id: 'a', name: 'Jonathan Kelly', properties: { email: 'jk@x.com' } }),
      person({ id: 'b', name: 'Chief Data Officer', properties: { email: 'jk@x.com' } }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].signals).toContain('same_email');
  });

  it('leaves unrelated people alone', () => {
    const found = findDuplicateCandidates([
      person({ id: 'a', name: 'Alice Braun', properties: { email: 'alice@x.com' } }),
      person({ id: 'b', name: 'Bob Vance', properties: { email: 'bob@y.com' } }),
    ]);
    expect(found).toHaveLength(0);
  });

  it('does not regress the existing acronym behaviour', () => {
    const found = findDuplicateCandidates([
      person({ id: 'a', name: 'IBCA', typeName: 'organisation', typeId: 'org' }),
      person({ id: 'b', name: 'Infected Blood Compensation Authority (IBCA)', typeName: 'organisation', typeId: 'org' }),
    ]);
    expect(found[0]?.signals).toContain('acronym');
  });
});
