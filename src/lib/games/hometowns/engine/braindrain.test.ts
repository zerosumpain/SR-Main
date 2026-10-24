// WP2b acceptance (spec §4.4, §13.2; A41 moves the full three-package version
// to WP5's M0 suite): brain drain emerges from the people model alone. Nothing
// scripts it. A town that educates its children without the jobs its new
// professionals want watches them leave, for the Outside World and for a
// linked rival with offices; the same town with offices keeps them.
//
// The upstream packages are scripted (scripts/hometowns/people-kit.ts):
// fixed homes and jobs (WP2e), fixed school quality (WP2a), everything else
// at its stub, so the only difference between the runs is the one named.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { runMonths, scriptedSteps, type Scripted } from '../../../../../scripts/hometowns/people-kit';
import { population } from './core';
import { checkTown } from './invariants';
import { scratchOf } from './people';
import { stepDemography } from './people';
import { withSteps } from './steps';
import { COHORT_COUNT, SECTORS, type MonthContext, type StepTable, type TownState } from './types';

const SECTOR = (s: (typeof SECTORS)[number]) => SECTORS.indexOf(s);
const jobs = (bySector: Partial<Record<(typeof SECTORS)[number], [number, number, number]>>): number[] => {
  const out = new Array<number>(15).fill(0);
  for (const [s, mix] of Object.entries(bySector)) for (let h = 0; h < 3; h++) out[SECTOR(s as (typeof SECTORS)[number]) * 3 + h] = mix![h];
  return out;
};

// A Town-tier town of about 11,000: plenty of homes in every tier, factory and shop work for £ and some ££.
const HOMES = [6000, 6200, 1600];
const FACTORY_TOWN = jobs({ industry: [2600, 700, 0], shops: [1500, 300, 0], farms: [200, 0, 0] });
const WITH_OFFICES = jobs({ industry: [2600, 700, 0], shops: [1500, 300, 0], farms: [200, 0, 0], offices: [100, 1600, 1100] });
const GOOD_SCHOOLS = [0.95, 0.95, 0.6];
const POOR_SCHOOLS = [0.15, 0.1, 0];

interface Run {
  /** Home-grown ££ and £££ Workers who left, to the Outside World and to the rival (persons, doubles). */
  leftOutside: number;
  leftToRival: number;
  /** New ££ and £££ adults who came of age or graduated over the run. */
  newProfessionals: number;
  pop: number;
}

function scenario(eduQ: number[], jobSlots: number[], months = 120): Run {
  const f = fixture('town');
  const c = f.county;
  const t = c.towns[f.town];
  // A linked rival with offices and a theatre: what this town's movers see of it (perceived stars, §5.6).
  const own = c.snapshot.towns[f.town];
  const rival = { ...JSON.parse(JSON.stringify(own)), seat: 'rival', pop: 30000, cohorts: own.cohorts.map(() => 3000) };
  rival.perceived = own.perceived.map(() => 60);
  for (const s of [11 + 0 * 3 + 1, 11 + 0 * 3 + 2]) rival.perceived[s] = 90; // Jobs ££ and £££
  rival.perceived[7] = 80; // Culture
  rival.linkTimes = [25, -1];
  own.linkTimes = [-1, 25];
  c.snapshot.towns.push(rival);

  const script: Scripted = {
    tiles: false,
    cap: HOMES,
    jobs: jobSlots,
    coverage: { eduQ, libraryShare: 0.5, healthCap: 60000, healthCovered: 0.9, healthQuality: 0.9, town: [60, 60, 60, 60, 60, 40, 40, 30] },
    fields: { safety: 70 },
  };
  const base = scriptedSteps(script);
  let newProfessionals = 0;
  const steps: StepTable = withSteps({
    ...Object.fromEntries(base.month.map((r) => [r.id, r.run])),
    ...Object.fromEntries(base.tick.map((r) => [r.id, r.run])),
    'M9 demography': (tt: TownState, m: MonthContext) => {
      stepDemography(tt, m);
      const s = scratchOf(m);
      newProfessionals += s.newAdults[1] + s.newAdults[2] + s.graduates[1] + s.graduates[2];
    },
  });
  let leftOutside = 0;
  let leftToRival = 0;
  runMonths(c, f.town, months, steps, (_k, d) => {
    const hg = d.migration!.homeGrownOut!;
    leftOutside += hg[0][3] + hg[0][6];
    leftToRival += hg[1][3] + hg[1][6];
  });
  expect(t.alerts).toEqual([]);
  expect(checkTown(t)).toEqual([]);
  expect(t.realised.intents?.length).toBe(2 * COHORT_COUNT);
  return { leftOutside, leftToRival, newProfessionals, pop: population(t) };
}

describe('brain drain emerges (§4.4)', () => {
  const schoolsNoOffices = scenario(GOOD_SCHOOLS, FACTORY_TOWN);
  const noSchools = scenario(POOR_SCHOOLS, FACTORY_TOWN);
  const schoolsAndOffices = scenario(GOOD_SCHOOLS, WITH_OFFICES);
  const left = (r: Run) => r.leftOutside + r.leftToRival;

  it('good schools turn more children into ££ and £££ adults', () => {
    expect(schoolsNoOffices.newProfessionals).toBeGreaterThan(1.3 * noSchools.newProfessionals);
  });

  it('a town that educates without offices loses many more of its new professionals', () => {
    expect(left(schoolsNoOffices)).toBeGreaterThan(1.3 * left(noSchools));
    expect(left(schoolsNoOffices)).toBeGreaterThan(2 * left(schoolsAndOffices));
    // Some go to the rival with the offices, not only to the Outside World.
    expect(schoolsNoOffices.leftToRival).toBeGreaterThan(0);
  });

  it('the same schools with offices keep them: the share who leave falls', () => {
    const share = (r: Run) => left(r) / Math.max(1, r.newProfessionals);
    expect(share(schoolsAndOffices)).toBeLessThan(0.5 * share(schoolsNoOffices));
  });

  it('pins the measured numbers (update deliberately when the people model changes)', () => {
    const row = (r: Run) => ({
      newProfessionals: r.newProfessionals,
      left: Math.round(left(r)),
      toRival: Math.round(r.leftToRival),
      share: Math.round((100 * left(r)) / Math.max(1, r.newProfessionals)) / 100,
      pop: r.pop,
    });
    expect({ schoolsNoOffices: row(schoolsNoOffices), noSchools: row(noSchools), schoolsAndOffices: row(schoolsAndOffices) }).toMatchInlineSnapshot(`
      {
        "noSchools": {
          "left": 636,
          "newProfessionals": 1008,
          "pop": 13158,
          "share": 0.63,
          "toRival": 566,
        },
        "schoolsAndOffices": {
          "left": 381,
          "newProfessionals": 1640,
          "pop": 14404,
          "share": 0.23,
          "toRival": 340,
        },
        "schoolsNoOffices": {
          "left": 996,
          "newProfessionals": 1557,
          "pop": 13915,
          "share": 0.64,
          "toRival": 897,
        },
      }
    `);
  });
});
