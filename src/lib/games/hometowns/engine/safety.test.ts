// Safety (§5.5): crime pressure, the spatial terms, police saturation, the
// Gini of incomes, M3's expected labour market, and the Why terms.

import { describe, expect, it } from 'vitest';
import { kitTown, monthOf, people, place, road, zoneRect } from '../../../../../scripts/hometowns/space-kit';
import { fieldsOf } from './fields';
import { paramsFor } from './params';
import { crimeField, crimePressure, expectedLabour, giniOf, safetyTerms, type CrimeInputs } from './safety';
import { buildModel, runFor } from './space';
import { CELLS } from './tiles';

const P = paramsFor('v1');

function inputs(
  o: Partial<{ uL: number; gini: number; dn: number; fun: number; edu: number; policy: number; youth: number; dens: number; lv: number; police: number }> = {},
): CrimeInputs {
  return {
    uL: o.uL ?? 0,
    gini: o.gini ?? 0,
    densityNorm: o.dn ?? 0,
    fun: o.fun ?? 0,
    edu: o.edu ?? 0,
    policy: o.policy ?? 1,
    youth: new Float64Array(CELLS).fill(o.youth ?? 0),
    dens: new Float64Array(CELLS).fill(o.dens ?? 0.5),
    lv: new Uint8Array(CELLS).fill(o.lv ?? 75),
    police: new Float64Array(CELLS).fill(o.police ?? 0),
    weights: new Float64Array(CELLS).fill(1),
  };
}

describe('crime pressure and the crime field', () => {
  it('multiplies the §5.5 factors', () => {
    const i = inputs({ uL: 0.1, gini: 0.3, dn: 0.5, fun: 40, edu: 50, policy: 0.92 });
    const want = 25 * (1 + 2.5 * 0.1) * (1 + 1.2 * 0.3) * (1 + 0.3 * 0.5) * (1 - 0.25 * 0.4) * (1 - 0.2 * 0.5) * 0.92;
    expect(crimePressure(i, P)).toBeCloseTo(want, 12);
  });

  it('is CP · (0.6 + 0.8·dens) · (1.3 − LV/250) · (1 − 0.6·Pol/(Pol + 30)) per cell, clamped to 0–100', () => {
    const i = inputs({ dens: 1, lv: 50, police: 30 });
    const r = crimeField(i, P);
    expect(r.crime[0]).toBeCloseTo(25 * 1.4 * (1.3 - 0.2) * (1 - 0.3), 12);
    expect(r.safety).toBeCloseTo(100 - r.crime[0], 12);
    expect(crimeField(inputs({ uL: 1, gini: 1, dn: 1, dens: 1, lv: 1 }), P).crime[0]).toBe(100);
  });

  it('saturates police deterrence at 60% (Becker)', () => {
    const at = (pol: number) => crimeField(inputs({ police: pol }), P).crime[0];
    expect(at(30) / at(0)).toBeCloseTo(0.7, 12);
    expect(at(100) / at(0)).toBeCloseTo(1 - (0.6 * 100) / 130, 12);
    expect(at(100) / at(0)).toBeGreaterThan(0.4);
  });

  it('cuts crime pressure by a fifth inside a Youth Club’s reach', () => {
    const r0 = crimeField(inputs(), P);
    const r1 = crimeField(inputs({ youth: 1 }), P);
    expect(r1.crime[0] / r0.crime[0]).toBeCloseTo(0.8, 12);
    expect(r1.cp / r0.cp).toBeCloseTo(0.8, 12);
  });

  it('names its Why terms by what each factor does to Safety', () => {
    const i = inputs({ uL: 0.2, police: 40, fun: 30 });
    const r = crimeField(i, P);
    const terms = Object.fromEntries(safetyTerms(i, P, r.safety));
    expect(terms['safety.unemployment']).toBeLessThan(0);
    expect(terms['safety.police']).toBeGreaterThan(0);
    expect(terms['safety.fun']).toBeGreaterThan(0);
    expect(terms['safety.landValue']).toBeUndefined(); // LV 75 is the neutral point
  });
});

describe('incomes and the Gini', () => {
  it('is 0 for equal incomes and 0.5 for one rich and one penniless group of equal size', () => {
    expect(giniOf([10, 20, 30], [100, 100, 100])).toBe(0);
    expect(giniOf([1, 1], [0, 100])).toBeCloseTo(0.5, 12);
    expect(giniOf([0, 0], [0, 0])).toBe(0);
  });

  it('matches workers top-down by tier and counts support and pensions (A1)', () => {
    const k = kitTown();
    road(k.t, 0, 4, 63, 4);
    zoneRect(k.t, 1, 5, 6, 1, 'homes', 5, 0);
    zoneRect(k.t, 10, 5, 2, 1, 'offices', 3); // 120 jobs: 12 £, 60 ££, 48 £££ at L3
    people(k.t, 0, 100, 0, 0, 10);
    people(k.t, 2, 100);
    const m = buildModel(k.t, P);
    const l = expectedLabour(m, [0, 0, 0], P);
    // £££: 85 workers, 48 £££ slots, the rest (37) take ££ slots (60) as underemployed.
    expect(l.employed[2]).toBeCloseTo(85, 9);
    // £: 85 workers for 12 slots.
    expect(l.unemployed[0]).toBeCloseTo(85 - 12, 9);
    expect(l.u[0]).toBeCloseTo((85 - 12) / 85, 9);
    const W0 = P.labour.W0;
    expect(l.incomePerPerson[0]).toBeCloseTo((12 * W0[0] + 0.6 * W0[0] * 10 + 0.35 * W0[0] * 73) / 110, 6);
  });

  it('feeds Safety in the fields step: a jobless town is less safe than a working one', () => {
    const mk = (jobs: boolean) => {
      const k = kitTown();
      road(k.t, 0, 4, 63, 4);
      place(k.t, 'windmill', 0, 5);
      zoneRect(k.t, 2, 5, 10, 1, 'homes', 4, 0);
      if (jobs) zoneRect(k.t, 20, 5, 10, 1, 'industry', 3);
      people(k.t, 0, 1000);
      const m = monthOf(k);
      return fieldsOf(runFor(k.t, m, m.derived)).slot.safety;
    };
    expect(mk(true)).toBeGreaterThan(mk(false));
  });
});
