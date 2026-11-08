// The off-rule identity runner (WP5 acceptance; spec §11.3, §10.4 item 7):
// with an optional system off, the run is bit-identical until the system's
// own step, and a switch that leaks into another system is caught.

import { describe, expect, it } from 'vitest';
import { offRuleCheck, OPTIONAL_SYSTEMS } from '../../../../../scripts/hometowns/lab/offrule';
import * as stubs from '../engine/stubs';

const SCENARIO = { seed: 5, bots: ['tourist'], days: 1 };

describe('off-rule identity runs', () => {
  it('tourism off: identical up to its own step', { timeout: 60_000 }, () => {
    const tourism = OPTIONAL_SYSTEMS.find((s) => s.id === 'tourism')!;
    const r = offRuleCheck(tourism, SCENARIO);
    expect(['pass', 'identical']).toContain(r.status);
    if (r.status === 'pass') expect(r.firstDivergence).toMatch(/M6 tourism$/);
  });

  it('catches a switch that also changes another system', { timeout: 60_000 }, () => {
    const leaky = { id: 'leaky tourism', off: { 'M6 tourism': stubs.stubTourism, 'M2 utilities': stubs.stubUtilities }, own: ['M6 tourism'] };
    const r = offRuleCheck(leaky, SCENARIO);
    expect(r.status).toBe('fail');
    expect(r.firstDivergence).toMatch(/M2 utilities$/);
  });

  it('reports systems without a switch as pending, with the reason', () => {
    for (const s of OPTIONAL_SYSTEMS.filter((x) => !x.off)) {
      const r = offRuleCheck(s, SCENARIO);
      expect(r.status).toBe('pending');
      expect(r.note.length).toBeGreaterThan(10);
    }
  });
});
