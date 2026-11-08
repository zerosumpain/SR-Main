import { describe, expect, it } from 'vitest';
import { normaliseSharePack, sharePackLabel, sharePacksFor } from './share-pack';

// The pattern the gateway's normaliseClaims holds `project.pack` to.
const CLAIM_PACK = /^[a-z]{2,16}$/;

describe('share link packs', () => {
  it('the Spine offers the DfE pack first, then the schools pack; other projects none', () => {
    expect(sharePacksFor('spine').map((p) => p.id)).toEqual(['dfe', 'school']);
    for (const p of sharePacksFor('spine')) expect(p.id).toMatch(CLAIM_PACK);
    expect(sharePacksFor('policy-engine')).toEqual([]);
    expect(sharePacksFor('__proto__')).toEqual([]);
  });

  it('accepts only a pack the project offers, exactly as spelt', () => {
    expect(normaliseSharePack('spine', 'school')).toBe('school');
    expect(normaliseSharePack('spine', 'dfe')).toBe('dfe');
    for (const bad of ['School', ' school', 'teachers', '', null, 3, ['dfe']]) expect(normaliseSharePack('spine', bad)).toBeNull();
    expect(normaliseSharePack('policy-engine', 'dfe')).toBeNull();
  });

  it('a link with no pack shows the default\'s label', () => {
    const packs = sharePacksFor('spine');
    expect(sharePackLabel(packs, null)).toBe('DfE pack');
    expect(sharePackLabel(packs, 'school')).toBe('Schools pack');
    expect(sharePackLabel([], 'school')).toBeNull();
  });
});
