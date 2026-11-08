// The labour market (WP2b, spec §5.9 with A1–A4): who works where, for what
// wage, and what every household earns.
//
// Jobs come from the supply count (WP2e's development slot, with A2's entry
// level skill mix already applied per tile) plus each civic building's staff.
// Matching runs in four passes:
//   1. locals into their own tier's slots, then the leftovers one tier down
//      (£££ into ££, ££ into £) as underemployed;
//   2. trainees (A4): unemployed £ workers into up to 25% of each sector's ££
//      slots, ££ into £££ slots, at their own tier's wage and ×0.8 effect;
//   3. in-commuters fill what is left, up to the day's fixed allowance;
//   4. out-commuters leave the local unemployed pool, up to theirs.
// Within a tier every pass spreads its workers over the sectors and civic
// staff pro rata to the open slots (A3), so every sector sees the same fill
// rate per tier and none is starved for coming last. Workers who live in a
// district with no job district within an hour are unemployed whatever the
// slots say ("too far to work").
//
// Support (A1) and pensions are paid from outside the town, like a state
// benefit, so a jobless hamlet still has an income and shops to spend it in.

import { monthF64, monthU8 } from './pool';
import { BUILDINGS, CIVIC_MIX, ENTRY_MIX_L1 } from './content';
import { flow, flowsFor, population } from './core';
import { clamp, expFx, powFx, T } from './fx';
import { neutral } from './derived';
import { largestRemainder } from './num';
import { memoFor, tierPersons } from './people';
import { homeTiles, jobDistricts, tileFacts } from './housing';
import { DISTRICT_OF, roadNetOf } from './space';
import { B_KIND, B_STAFF, B_X, B_Y, CAT_ZONE, DISTRICTS, planesOf, tileIndex, useCat, usePayload, zonedTiles } from './tiles';

const N_DISTRICTS = DISTRICTS;
import {
  PERSON_S,
  SECTOR_COUNT,
  STAGE_P,
  STAGE_R,
  STAGE_W,
  person,
  type LabourSlot,
  Z_HOMES,
  type MonthContext,
  type TownState,
} from './types';

/** Rows of the slot matrix: the five SECTORS, then civic staff. */
export const ROWS = SECTOR_COUNT + 1;
export const ROW_CIVIC = SECTOR_COUNT;

/**
 * Staff each finished civic building needs, by tier (A2: Hamlet-tier
 * buildings hire £ only; the rest hire the civic mix). Flattened b·3 + h.
 */
export function civicStaffNeeds(t: TownState, building: (b: number) => boolean = () => true): Float64Array {
  const out = monthF64(t.buildings.length * 3);
  const pop = population(t);
  for (let i = 0; i < t.buildings.length; i++) {
    const b = t.buildings[i];
    if (!building(i)) continue;
    const def = BUILDINGS[b[B_KIND]];
    if (!def) continue;
    const staff = def.staff + (def.staffPerResidents ? Math.floor(pop / def.staffPerResidents) : 0);
    if (staff <= 0) continue;
    const mix = def.tier === 0 ? ENTRY_MIX_L1 : CIVIC_MIX;
    for (let h = 0; h < 3; h++) out[i * 3 + h] = staff * mix[h];
  }
  return out;
}

/** Spreads `n` persons over rows pro rata to the open slots of tier column h (A3); returns per-row counts. */
function spread(open: Float64Array, h: number, n: number, cap?: Float64Array): number[] {
  const w = new Array<number>(ROWS);
  for (let r = 0; r < ROWS; r++) w[r] = Math.max(0, cap ? Math.min(open[r * 3 + h], cap[r]) : open[r * 3 + h]);
  let room = 0;
  for (let r = 0; r < ROWS; r++) room += w[r];
  const take = Math.max(0, Math.min(n, Math.floor(room)));
  const parts = largestRemainder(take, w);
  for (let r = 0; r < ROWS; r++) open[r * 3 + h] -= parts[r];
  return parts;
}

/**
 * Where a tile's trips start and end: the district of its attachment road
 * (the nearest road within develop.roadReach, as M4 Transport routes them,
 * §5.9), or −1 for a tile with no road in reach. `attach` is the road net's.
 */
export function roadDistrict(attach: Int32Array, i: number): number {
  const a = attach[i];
  return a >= 0 ? DISTRICT_OF[a] : -1;
}

/** The town's attachment roads per tile (the memoised road net's, as M4 uses). */
export function attachOf(t: TownState, m: MonthContext): Int32Array {
  return roadNetOf(t, m.params.develop.roadReach).attach;
}

/**
 * The districts (by attachment road, as M4 Transport routes the trips) with
 * a job district within maxCommute minutes (1), this month; null before the
 * month's travel times, or when the town has no job district at all (§5.9
 * matching step 2). A job tile counts for its own district and its road's.
 * The growth-help order reads it too (G3, §5.18).
 */
export function workReach(t: TownState, m: MonthContext): Uint8Array | null {
  const travel = m.derived.travel;
  const own = jobDistricts(t, m);
  const nd = N_DISTRICTS;
  const jobs = JOB_DISTRICTS;
  jobs.set(own);
  // A job lot across a district line from its road is reached through the road's district (G3).
  const attach = attachOf(t, m);
  const busy = tileFacts(t, m).busy;
  const p = planesOf(t);
  const zoned = zonedTiles(p.use);
  for (let q = 0; q < zoned.length; q++) {
    const i = zoned[q];
    const u = p.use[i];
    if (useCat(u) !== CAT_ZONE || usePayload(u) === Z_HOMES || (p.lvl[i] & 7) === 0 || busy[i]) continue;
    const d = roadDistrict(attach, i);
    if (d >= 0) jobs[d] = 1;
  }
  let anyJobs = false;
  for (let d = 0; d < nd; d++) if (jobs[d]) anyJobs = true;
  if (!travel || !anyJobs) return null;
  const reach = monthU8(nd);
  const minutes = travel.minutes;
  const max = m.params.labour.maxCommute;
  for (let a = 0; a < nd; a++)
    for (let b = 0; b < nd; b++)
      if (jobs[b] && minutes[a * nd + b] <= max) {
        reach[a] = 1;
        break;
      }
  return reach;
}

/** workReach's scratch: job districts. */
const JOB_DISTRICTS = new Uint8Array(N_DISTRICTS);

/**
 * Share of each tier's workforce living in a district with no job district
 * within maxCommute minutes (§5.9 matching step 2).
 */
function unreachableShare(t: TownState, m: MonthContext): number[] {
  const homes = homeTiles(t, m);
  const reach = workReach(t, m);
  const out = [0, 0, 0];
  if (!reach || homes.count === 0) return out;
  const attach = attachOf(t, m);
  const all = [0, 0, 0];
  const far = [0, 0, 0];
  for (let i = 0; i < homes.count; i++) {
    const h = homes.tier[i];
    all[h] += homes.persons[i];
    // A home's trips leave from its road's district (as M4 routes them), not from the district it sits in (G3);
    // a home with no road in reach keeps its own district, as before.
    const tile = homes.tile[i];
    const d = roadDistrict(attach, tile);
    if (!reach[d >= 0 ? d : ((tile >> 9) << 3) | ((tile & 63) >> 3)]) far[h] += homes.persons[i]; // districtOf, 64-wide map
  }
  for (let h = 0; h < 3; h++) out[h] = all[h] > 0 ? far[h] / all[h] : 0;
  return out;
}

/** STEP M5 (WP2b): matching, trainees, commuters, wages, incomes and staffing → derived.labour (+ buildings[B_STAFF]). */
export function stepLabour(t: TownState, m: MonthContext): void {
  const lp = m.params.labour;
  const part = m.params.people.participation;
  const dev = m.derived.development ?? neutral.development();
  const fl = flowsFor(m);
  const p = t.people;

  // Workforce by tier (Students work part-time as £ workers).
  const wf = [0, 0, 0];
  for (let h = 0; h < 3; h++) wf[h] = Math.round(part.W * p[person(STAGE_W, h)] + part.P * p[person(STAGE_P, h)]);
  wf[0] += Math.round(part.S * p[PERSON_S]);

  // Slots: rows × tiers, whole jobs.
  const building = tileFacts(t, m).busy;
  const needs = civicStaffNeeds(t, (i) => building[tileIndex(t.buildings[i][B_X], t.buildings[i][B_Y])] === 0);
  const civicNeed = [0, 0, 0];
  for (let i = 0; i < t.buildings.length; i++) for (let h = 0; h < 3; h++) civicNeed[h] += needs[i * 3 + h];
  const slots = monthF64(ROWS * 3);
  for (let s = 0; s < SECTOR_COUNT; s++) for (let h = 0; h < 3; h++) slots[s * 3 + h] = Math.round(dev.jobs[s * 3 + h] ?? 0);
  for (let h = 0; h < 3; h++) slots[ROW_CIVIC * 3 + h] = Math.round(civicNeed[h]);
  const open = Float64Array.from(slots);
  const slotTotal = [0, 0, 0];
  for (let r = 0; r < ROWS; r++) for (let h = 0; h < 3; h++) slotTotal[h] += slots[r * 3 + h];

  // Who can reach any job at all.
  const far = unreachableShare(t, m);
  const free = wf.map((n, h) => n - Math.round(n * far[h]));

  // Per row and slot tier: own-tier staff, underemployed from the tier above,
  // trainees from the tier below, and in-commuters.
  const own = monthF64(ROWS * 3);
  const under = monthF64(ROWS * 3);
  const trainee = monthF64(ROWS * 3);
  const inComm = monthF64(ROWS * 3);
  const add = (into: Float64Array, h: number, parts: number[]) => {
    let n = 0;
    for (let r = 0; r < ROWS; r++) {
      into[r * 3 + h] += parts[r];
      n += parts[r];
    }
    return n;
  };

  // 1. Locals into their own tier, then one tier down.
  const employedOwn = [0, 0, 0];
  for (let h = 2; h >= 0; h--) employedOwn[h] = add(own, h, spread(open, h, free[h]));
  const left = free.map((n, h) => n - employedOwn[h]);
  const underemployed = [0, 0, 0];
  for (let h = 2; h >= 1; h--) {
    underemployed[h] = add(under, h - 1, spread(open, h - 1, left[h]));
    left[h] -= underemployed[h];
  }

  // 2. Trainees one tier up, at most traineeShare of each row's slots of that tier (A4).
  const trainees = [0, 0, 0];
  for (let h = 1; h >= 0; h--) {
    const cap = monthF64(ROWS);
    for (let r = 0; r < ROWS; r++) cap[r] = Math.floor(slots[r * 3 + h + 1] * lp.traineeShare);
    trainees[h] = add(trainee, h + 1, spread(open, h + 1, left[h], cap));
    left[h] -= trainees[h];
  }

  // 3. In-commuters fill what is left, up to the day's allowance.
  const commIn = [0, 0, 0];
  for (let h = 0; h < 3; h++) commIn[h] = add(inComm, h, spread(open, h, Math.floor(fl.commutersIn[h] ?? 0)));

  // 4. Out-commuters leave the unemployed pool (including those too far from local work).
  const unemployedBefore = left.map((n, h) => n + (wf[h] - free[h]));
  const commOut = unemployedBefore.map((u, h) => Math.max(0, Math.min(u, Math.floor(fl.commutersOut[h] ?? 0))));
  const unemployed = unemployedBefore.map((u, h) => u - commOut[h]);

  const vacancies = [0, 0, 0];
  for (let r = 0; r < ROWS; r++) for (let h = 0; h < 3; h++) vacancies[h] += open[r * 3 + h];
  const employed = [0, 0, 0];
  for (let h = 0; h < 3; h++) employed[h] = employedOwn[h] + underemployed[h] + trainees[h] + commOut[h];

  // Productivity (§5.9): agglomeration through local and linked jobs, education, and congestion.
  let jobsHere = 0;
  for (let i = 0; i < ROWS * 3; i++) jobsHere += slots[i];
  let effJobs = jobsHere;
  const row = m.snapshot.towns[m.townIndex];
  if (row)
    for (let j = 0; j < m.snapshot.towns.length; j++) {
      const mins = row.linkTimes[j] ?? -1;
      if (j === m.townIndex || mins < 0 || !m.snapshot.towns[j].active) continue;
      let jj = 0;
      for (const x of m.snapshot.towns[j].jobs) jj += x;
      effJobs += jj * expFx(-mins / lp.linkDecay);
    }
  const congestion = m.derived.travel?.congestion ?? 0;
  const agg = clamp(powFx(effJobs / lp.prodRef, lp.sigma), lp.prodBand[0], lp.prodBand[1]);
  const prod = agg * (lp.prodEdu[0] + (lp.prodEdu[1] * t.edu) / 100) * (1 - lp.prodCongestion * congestion);

  const wage = [0, 0, 0];
  for (let h = 0; h < 3; h++) {
    const vac = vacancies[h] / Math.max(1, slotTotal[h]);
    const u = unemployed[h] / Math.max(1, wf[h]);
    wage[h] = lp.W0[h] * prod * (1 + lp.wageTight[0] * T(lp.wageTight[1] * (vac - u)));
  }

  // Incomes by tier: wages (underemployed ×0.8 of their own tier's wage; trainees and
  // out-commuters at their own tier's), pensions, support, and students' £500 in £.
  const pensions = [0, 0, 0];
  const support = [0, 0, 0];
  const income = [0, 0, 0];
  for (let h = 0; h < 3; h++) {
    pensions[h] = lp.pensionShare * lp.W0[0] * p[person(STAGE_R, h)];
    support[h] = lp.supportShare * lp.W0[0] * unemployed[h];
    income[h] = (employedOwn[h] + trainees[h] + commOut[h]) * wage[h] + underemployed[h] * wage[h] * lp.underemployed + pensions[h] + support[h];
  }
  income[0] += lp.studentIncome * p[PERSON_S];
  const incomePerPerson = [0, 0, 0];
  for (let h = 0; h < 3; h++) {
    const n = tierPersons(t, h, true);
    // A tier nobody lives in yet is judged by what a newcomer household would earn.
    incomePerPerson[h] = n > 0 ? income[h] / n : wage[h] * lp.newcomerHeads;
  }

  // Sector staffing, output and wage bills.
  const sectorJobs: number[] = [];
  const sectorFilled: number[] = [];
  const sectorEffective: number[] = [];
  const sectorWages: number[] = [];
  const fillRate: number[] = [];
  const rowEff = (r: number, h: number) => own[r * 3 + h] + under[r * 3 + h] + inComm[r * 3 + h] + lp.traineeEffect * trainee[r * 3 + h];
  for (let r = 0; r < ROWS; r++) {
    let jobs = 0;
    let heads = 0;
    let eff = 0;
    let bill = 0;
    for (let h = 0; h < 3; h++) {
      jobs += slots[r * 3 + h];
      heads += own[r * 3 + h] + under[r * 3 + h] + inComm[r * 3 + h] + trainee[r * 3 + h];
      eff += rowEff(r, h);
      bill += (own[r * 3 + h] + inComm[r * 3 + h]) * wage[h] + trainee[r * 3 + h] * wage[h - 1 < 0 ? 0 : h - 1];
      if (h < 2) bill += under[r * 3 + h] * wage[h + 1] * lp.underemployed;
    }
    if (r === ROW_CIVIC) continue;
    sectorJobs.push(jobs);
    sectorFilled.push(heads);
    sectorEffective.push(eff);
    sectorWages.push(bill);
    fillRate.push(jobs > 0 ? heads / jobs : 0);
  }

  // Civic staffing: each building's effect is scaled by the share of its staff filled (A26: stored for next month's coverage).
  const civicFilled = [0, 0, 0];
  const tierFill = [1, 1, 1];
  for (let h = 0; h < 3; h++) {
    civicFilled[h] = rowEff(ROW_CIVIC, h);
    tierFill[h] = slots[ROW_CIVIC * 3 + h] > 0 ? Math.min(1, civicFilled[h] / slots[ROW_CIVIC * 3 + h]) : 1;
  }
  let needAll = 0;
  let fillAll = 0;
  for (let i = 0; i < t.buildings.length; i++) {
    let need = 0;
    let got = 0;
    for (let h = 0; h < 3; h++) {
      need += needs[i * 3 + h];
      got += needs[i * 3 + h] * tierFill[h];
    }
    needAll += need;
    fillAll += got;
    t.buildings[i][B_STAFF] = need > 0 ? Math.round((1000 * got) / need) : 1000;
  }

  // Trainees learning on the job become Aspirants for the next tier (A4).
  for (let h = 0; h < 2; h++) {
    const up = flow(t, `lab.promote.${h}`, trainees[h] * lp.traineePromote);
    t.aspirants[h] = Math.min(p[person(STAGE_W, h)], t.aspirants[h] + up);
  }

  // The long-term unemployed: each month a sixth of the shorter-term
  // unemployed cross the six-month line; the pool never exceeds unemployment.
  for (let h = 0; h < 3; h++) {
    const lu = t.longUnemployed[h];
    const cross = flow(t, `lab.long.${h}`, Math.max(0, unemployed[h] - lu) / m.params.people.longUnemployedMonths);
    t.longUnemployed[h] = Math.max(0, Math.min(unemployed[h], lu + cross));
  }

  // Commuters who actually worked today, for the Regional Day (A41).
  for (let h = 0; h < 3; h++) {
    t.realised.commutersIn[h] += commIn[h];
    t.realised.commutersOut[h] += commOut[h];
  }
  m.why.add('comm.in', commIn[0] + commIn[1] + commIn[2], 'commutersNet');
  m.why.add('comm.out', -(commOut[0] + commOut[1] + commOut[2]), 'commutersNet');

  const memo = memoFor(t);
  memo.vacancies = [...vacancies];
  memo.unemployed = [...unemployed];
  memo.jobs = [...slotTotal];

  let support0 = 0;
  let pensions0 = 0;
  for (let h = 0; h < 3; h++) {
    support0 += support[h];
    pensions0 += pensions[h];
  }
  const slot: LabourSlot = {
    workforce: wf,
    jobSlots: slotTotal,
    employed,
    unemployed,
    underemployed,
    trainees,
    vacancies,
    sectorJobs,
    sectorFilled,
    fillRate,
    civicStaffNeeded: civicNeed,
    civicStaffFilled: civicFilled,
    staffFill: needAll > 0 ? fillAll / needAll : 1,
    wage,
    prod,
    effJobs,
    income,
    incomePerPerson,
    support: support0,
    pensions: pensions0,
    commutersIn: commIn,
    commutersOut: commOut,
    sectorEffective,
    sectorWages,
  };
  m.derived.labour = slot;
}
