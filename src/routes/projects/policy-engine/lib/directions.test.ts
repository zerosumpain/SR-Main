import { describe, it, expect } from 'vitest';
import { DIRECTIONS, DIRECTIONS_BY_ID, directionsForLever, milburnPackageLevers } from './directions';
import { ANALYSES_BY_ID } from './evidence';
import { THEMES_BY_ID } from './themes';
import { LEVERS_BY_ID, baselineLevers, policyLevers } from '$lib/policy-engine/levers';
import { runSim } from '$lib/policy-engine/engine';

// the set of valid outcome ids = the numeric keys of a YearResult
const OUTCOME_IDS = new Set(Object.keys(runSim(baselineLevers()).years[0]));

describe('directions referential integrity', () => {
  it('every lever, theme, outcome and companion id resolves', () => {
    for (const d of DIRECTIONS) {
      for (const l of d.levers) expect(LEVERS_BY_ID[l], `lever ${l} in ${d.id}`).toBeDefined();
      for (const t of d.themes ?? []) expect(THEMES_BY_ID[t], `theme ${t} in ${d.id}`).toBeDefined();
      for (const o of d.outcomes ?? []) expect(OUTCOME_IDS.has(o), `outcome ${o} in ${d.id}`).toBe(true);
      for (const c of d.companions ?? []) expect(ANALYSES_BY_ID[c], `companion ${c} in ${d.id}`).toBeDefined();
      for (const id of Object.keys(d.leverTargets ?? {})) expect(LEVERS_BY_ID[id], `target ${id} in ${d.id}`).toBeDefined();
    }
  });
  it('the five Milburn diagnosis-directions exist', () => {
    for (const id of ['milburn-youth-economy', 'milburn-health-participation', 'milburn-skills-foundation', 'milburn-welfare-participation', 'milburn-architecture']) {
      expect(DIRECTIONS_BY_ID[id]?.kind).toBe('diagnosis-direction');
    }
  });
  it('directionsForLever finds entry_level', () => {
    expect(directionsForLever('entry_level').map((d) => d.id)).toContain('milburn-youth-economy');
  });
});

describe('milburnPackageLevers', () => {
  it('raises the youth/health levers above announced policy and clamps to range', () => {
    const pkg = milburnPackageLevers(policyLevers());
    expect(pkg.entry_level).toBe(70);
    expect(pkg.mental_health).toBe(80);
    expect(pkg.youth_guarantee).toBe(80);
    for (const id of Object.keys(pkg)) {
      const L = LEVERS_BY_ID[id];
      if (L) { expect(pkg[id]).toBeLessThanOrEqual(L.max); expect(pkg[id]).toBeGreaterThanOrEqual(L.min); }
    }
  });
  it('projects lower NEET than announced policy at 2035', () => {
    const pol = runSim(policyLevers()).years.find((y) => y.year === 2035)!;
    const pkg = runSim(milburnPackageLevers(policyLevers())).years.find((y) => y.year === 2035)!;
    expect(pkg.neet).toBeLessThan(pol.neet);
  });
});
