import { describe, it, expect } from 'vitest';
import { THEMES, THEMES_BY_ID, themesForRoute } from './themes';
import { ANALYSES_BY_ID } from './evidence';
import { CONTRADICTIONS_BY_ID } from './contradictions';
import { LEVERS_BY_ID } from './levers';

describe('participation-by-design theme', () => {
  it('exists as the 5th theme and recurs on /neet', () => {
    expect(THEMES_BY_ID['participation-by-design']).toBeDefined();
    expect(THEMES.length).toBe(5);
    expect(themesForRoute('/projects/policy-engine/neet').map((t) => t.id)).toContain('participation-by-design');
  });
  it('every referenced analysis, contradiction and lever id resolves (all themes)', () => {
    for (const t of THEMES) {
      for (const a of t.analyses) expect(ANALYSES_BY_ID[a], `analysis ${a} in theme ${t.id}`).toBeDefined();
      for (const c of t.contradictions) expect(CONTRADICTIONS_BY_ID[c], `contradiction ${c} in theme ${t.id}`).toBeDefined();
      for (const l of t.levers) expect(LEVERS_BY_ID[l], `lever ${l} in theme ${t.id}`).toBeDefined();
    }
  });
});
