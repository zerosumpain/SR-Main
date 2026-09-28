import { describe, expect, it } from 'vitest';
import { AREAS, LEVELS, type Permission } from './catalogue';
import {
  AREA_CHOICES,
  EDITABLE_AREAS,
  familyLevel,
  heldChoice,
  normaliseGrants,
  pruneAdds,
  strongestRole,
  summarise,
  withAreaLevel,
  withFamily,
} from './roles';

describe('area choices', () => {
  it('covers every area, starts with Off, and names only real levels once each', () => {
    for (const a of AREAS) {
      const choices = AREA_CHOICES[a.id];
      expect(choices[0], a.id).toEqual({ level: null, label: 'Off' });
      const levels = choices.slice(1).map((c) => c.level);
      for (const l of levels) expect(LEVELS, a.id).toContain(l);
      expect(new Set(levels).size, a.id).toBe(levels.length);
    }
  });

  it('offers no choice the catalogue calls "Same as"', () => {
    for (const a of AREAS) {
      for (const c of AREA_CHOICES[a.id]) {
        if (c.level && c.level !== 'self') expect(a.levels[c.level], `${a.id}:${c.level}`).not.toMatch(/^Same as/);
      }
    }
  });

  it('never draws recall: it follows intel', () => {
    expect(EDITABLE_AREAS.map((a) => a.id)).not.toContain('jkai.knowledge');
  });

  it('shows a level with no choice of its own as the choice below', () => {
    expect(heldChoice(['news:all'], 'news')).toBe('self');
    expect(heldChoice(['home:admin'], 'home')).toBe('all');
    expect(heldChoice(['health:admin'], 'health')).toBe('all');
    expect(heldChoice(['health:self'], 'health')).toBe(null);
    expect(heldChoice([], 'research')).toBe(null);
  });

  it('sets one level per area', () => {
    expect(withAreaLevel(['research:self', 'news:self'], 'research', 'all')).toEqual(['news:self', 'research:all']);
    expect(withAreaLevel(['research:self'], 'research', null)).toEqual([]);
  });
});

describe('family is one choice', () => {
  it('reads and writes None / Circle / Parent', () => {
    expect(familyLevel([])).toBe('none');
    expect(familyLevel(['family:circle'])).toBe('circle');
    expect(familyLevel(['family:admin'])).toBe('parent');
    expect(withFamily(['news:self', 'family:circle'], 'parent')).toEqual(['news:self', 'family:circle', 'family:admin']);
    expect(withFamily(['family:circle', 'family:admin'], 'none')).toEqual([]);
  });
});

describe('what a save stores', () => {
  it('never stores family admin without the circle the routes check', () => {
    expect(normaliseGrants(['family:admin'])).toEqual(['family:admin', 'family:circle']);
  });

  it('holds recall exactly when an intel level is held', () => {
    expect(normaliseGrants(['jkai.intel:all'])).toEqual(['jkai.intel:all', 'jkai.knowledge:self']);
    expect(normaliseGrants(['jkai.knowledge:self', 'news:self'])).toEqual(['news:self']);
  });

  it('drops junk', () => {
    expect(normaliseGrants(['bogus', 'news:self', 7])).toEqual(['news:self']);
  });

  it('keeps only the adds the role does not already give', () => {
    const parent: Permission[] = ['family:circle', 'family:admin', 'games:self'];
    expect(pruneAdds(parent, ['games:all', 'family:circle', 'research:self'])).toEqual(['research:self']);
    expect(pruneAdds(['research:all'], ['research:self', 'research:admin'])).toEqual(['research:admin']);
  });
});

describe('one role from an old multi-group row', () => {
  const grants = new Map<string, Permission[]>([
    ['family-circle', ['family:circle', 'games:self']],
    ['family-admin', ['family:circle', 'family:admin', 'games:self']],
    ['readers', ['research:all']],
  ]);

  it('takes the role that covers the others', () => {
    expect(strongestRole(['family-circle', 'family-admin'], grants)).toBe('family-admin');
  });

  it('falls back to the one granting most, and ignores unknown ids', () => {
    expect(strongestRole(['readers', 'family-admin', 'gone'], grants)).toBe('family-admin');
    expect(strongestRole(['gone'], grants)).toBe(null);
  });
});

describe('summary', () => {
  it('names areas in catalogue order, with the reach of multi-step ones', () => {
    expect(summarise(['jkai.chat:self', 'news:all', 'research:all', 'jkai.knowledge:self'])).toEqual([
      'news',
      'research (+ read everyone’s)',
      'chat',
    ]);
  });
});
