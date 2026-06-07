// engine.ts — the simulation. An annual-step, system-dynamics + cohort model of the
// England schools system, 2025→2040. Self-contained.
//
// DESIGN (research-grounded):
//  • The KS4 disadvantage gap = a STRUCTURAL component (set upstream by early years,
//    pupil premium, poverty — slow, lagged) PLUS an ABSENCE component, because EPI
//    attributes the *entire* post-2019 widening to higher disadvantaged absence.
//  • Attainment LEVEL is driven by TEACHER CAPACITY (the strong evidenced channel),
//    attendance, and curriculum — NOT by a direct £/pupil elasticity (which is ~0).
//  • Early-years levers act on the age-5 gap fast (~2y) but on KS4 only after the
//    cohort ages (~11y), with partial fade-out.
//  • SEND is a stock-flow: EHCP prevalence grows logistically; inclusion/early-SEND
//    slow it; EHCP reform diverts to ISPs from 2029 — but harms SEND attainment and
//    raises tribunals UNLESS matched by inclusion investment (the double edge).
//  • Uncertainty is propagated by resolving every effect-size Band through a sampler.

import type { LeverState, SimResult, YearResult } from './types';
import { LEVERS_BY_ID, ageIdTotals, earlyIdShift } from './levers';
import {
  BASE_YEAR, END_YEAR, POP, BASELINE, GAP_TO_LEVEL, CH, SEND, SYS, POST16, WORK, AGEID, IND, EY_KS4_LAG, EY_FADEOUT, COST,
  type Band,
} from './params';

// Extra structural constants (calibrated so 2025 reproduces BASELINE exactly).
const ABSENCE_TO_GAP_K4 = 0.077;   // months KS4 gap per pp of disadvantaged PA (vs 2025) [EPI: +1mo ≈ +13pp PA]
const ABSENCE_TO_GAP_K2 = 0.040;   // months KS2 gap per pp disadvantaged PA
const POVERTY_TO_RECEP = 0.040;    // months reception gap per pp child poverty (vs 2025)
const POVERTY_TO_ABSENCE = 0.040;  // pp overall absence per pp child poverty
const PA_DIS_BASE = 29.9;          // disadvantaged persistent absence at 2025
// Full attendance-mentor coverage can cut disadvantaged PA ~8pp (most of the way back
// toward the pre-pandemic ~17%). Via ABSENCE_TO_GAP_K4 this makes attendance the single
// dominant gap lever, matching EPI's finding that absence drove the whole widening.
// (Other absence/drift coefficients live in params.ts SYS.* and are referenced directly.)
const EXTRA_MENTOR_DIS_CUT = 8.0;  // pp extra disadvantaged-PA cut at full mentor coverage

export interface SimOptions {
  /** Resolve a Band to a scalar for this run (MC passes a sampler; default = central). */
  sample?: (b: Band) => number;
}

// ---- small maths helpers ----
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Concave saturating response in [0,1]→[0,~1]; linear (harm) for negative deployment. */
function concave(x: number): number {
  const K = 1.8;
  if (x <= 0) return Math.max(-1.5, x);
  const xc = Math.min(1.5, x);
  return (1 - Math.exp(-K * xc)) / (1 - Math.exp(-K));
}
/** Geometric lag: fraction of full effect realised `yearsSince` years in (time-const `lag`). */
function ramp(yearsSince: number, lag: number): number {
  return 1 - Math.exp(-Math.max(0, yearsSince) / Math.max(0.5, lag));
}

export function runSim(levers: LeverState, opts: SimOptions = {}): SimResult {
  const sampler = opts.sample ?? ((b: Band) => b.central);
  const cache = new Map<Band, number>();
  const R = (b: Band): number => {
    let v = cache.get(b);
    if (v === undefined) { v = sampler(b); cache.set(b, v); }
    return v;
  };

  // deployment of a lever relative to its baseline, scaled to its max (signed)
  const dep = (id: string): number => {
    const L = LEVERS_BY_ID[id];
    const v = levers[id] ?? L.baseline;
    const span = L.max - L.baseline;
    return span === 0 ? 0 : (v - L.baseline) / span;
  };
  const depPos = (id: string) => Math.max(0, dep(id));
  const val = (id: string) => levers[id] ?? LEVERS_BY_ID[id].baseline;

  // sum of band contributions over a channel map, applying concave(dep)·ramp
  function channelSum(
    map: Record<string, Band>,
    yearsSince: number,
    lagFor: (id: string) => number,
    depFor: (id: string) => number = dep,
  ): number {
    let s = 0;
    for (const id in map) s += R(map[id]) * concave(depFor(id)) * ramp(yearsSince, lagFor(id));
    return s;
  }
  const lagOf = (id: string) => CH.lag[id] ?? 3;

  // ---- stateful variables ----
  let ehcpPct = BASELINE.ehcpPct;
  let deficitStock = BASELINE.highNeedsDeficitStock;
  let shortfall = BASELINE.teacherShortfall;
  let teachersFTE = POP.teachersFTE0;
  let cumulativeCost = 0;

  // SEND/EHCP identification-by-age profile: constant across the horizon (levers are sustained).
  const idShift = earlyIdShift(levers);                                  // [0,1] front-loading vs baseline
  const ageIdDelta = ageIdTotals(levers, AGEID.sendPrevalence).additional; // £bn/yr additional vs baseline

  const years: YearResult[] = [];

  for (let year = BASE_YEAR; year <= END_YEAR; year++) {
    const ys = year - BASE_YEAR;

    // ---------------- WORKFORCE ----------------
    // recruitment multiplier from pay & bursaries; net adds vs the baseline replacement
    // (pay, bursaries AND school funding act on attainment INDIRECTLY, via teacher capacity below —
    //  never a direct attainment term — to avoid double-counting; see params.ts notes).
    const payAbove = val('teacher_pay') - LEVERS_BY_ID['teacher_pay'].baseline; // %/yr
    const recMult = 1 + R(WORK.recruitPayMult) * Math.max(0, payAbove) + R(WORK.recruitBursaryMult) * depPos('bursaries');
    // Real-terms core-funding growth funds posts, TAs and retention — so money buys teacher CAPACITY
    // (the strong evidenced channel) rather than buying attainment directly (the £→attainment elasticity
    //  is ~0 at current spend: IFS/NFER/Jackson). This is what stops funding being pure dead-weight.
    const fundingAbove = Math.max(0, val('school_funding') - LEVERS_BY_ID['school_funding'].baseline); // %/yr above baseline
    const fundingRecruit = R(WORK.fundingRecruitK) * fundingAbove; // extra '000 net teachers/yr funded by real-terms growth
    const effectiveAdds = val('teachers') * recMult + fundingRecruit; // k/yr gross net-of-attrition recruitment effort
    if (ys > 0) {
      shortfall = clamp(shortfall - (effectiveAdds - WORK.baseAttritionK), -3, 12);
    }
    // FTE tracks the shortfall reduction (capped), so cost cannot grow unbounded once the
    // system is fully staffed — recruiting beyond full staffing yields neither benefit nor charge.
    teachersFTE = POP.teachersFTE0 + (BASELINE.teacherShortfall - shortfall); // '000
    const capacity = clamp(1 - shortfall / WORK.shortfallToCapacity, 0, 1.12); // 0.5 at baseline shortfall 6.5
    const capacityNorm = clamp((capacity - 0.5) / 0.5, -1, 1.2);               // 0 at baseline, 1 when fully staffed

    // ---------------- CHILD POVERTY ----------------
    const childPoverty = clamp(
      BASELINE.childPoverty + SYS.povertyDrift * ys
        - R(SYS.povertyActionMax) * concave(depPos('poverty_action')) * ramp(ys, 3)
        - R(SYS.fsmPovertyCut) * concave(depPos('fsm')) * ramp(ys, 3),
      15, 40,
    );

    // ---------------- ATTENDANCE ----------------
    const absCut = R(SYS.absenceReductionMax)
      * concave(0.7 * depPos('attendance') + 0.3 * depPos('breakfast')) * ramp(ys, 2);
    const absenceOverall = clamp(
      BASELINE.absenceOverall - absCut + POVERTY_TO_ABSENCE * (childPoverty - BASELINE.childPoverty),
      3.5, 11,
    );
    const persistentAbsence = clamp(BASELINE.persistentAbsence + SYS.paLeverage * (absenceOverall - BASELINE.absenceOverall), 6, 40);
    const extraMentorDisCut = EXTRA_MENTOR_DIS_CUT * concave(depPos('attendance')) * ramp(ys, 2);
    // wider determinants on disadvantaged absence: housing instability is an inflow (signed —
    // worse above baseline, better below); SEND specialist capacity lets supported pupils attend.
    const housingPA = R(IND.housingPA) * dep('housing_instability') * ramp(ys, 2);
    const pipelinePAcut = R(IND.pipelinePA) * concave(depPos('send_pipeline')) * ramp(ys, 3);
    const persistentAbsenceDis = clamp(
      PA_DIS_BASE + SYS.paLeverage * SYS.paDisLeverage * (absenceOverall - BASELINE.absenceOverall)
        - extraMentorDisCut + housingPA - pipelinePAcut,
      8, 45,
    );
    const severeAbsence = clamp(
      BASELINE.severeAbsence + SYS.severeDrift * ys
        - R(SYS.severeMentorCut) * concave(depPos('attendance')) * ramp(ys, 2)
        - R(POST16.mhSevereMax) * concave(depPos('mental_health')) * ramp(ys, 3)
        - R(IND.camhsSevere) * concave(depPos('camhs')) * ramp(ys, 2)
        - R(IND.behaviourSevere) * concave(depPos('behaviour_support')) * ramp(ys, 2),
      0.3, 8,
    );

    // ---------------- DISADVANTAGE GAP (months) ----------------
    // structural KS4 reductions (exclude attendance/breakfast — they act via PA_dis)
    const k4Struct: Record<string, Band> = {
      pupil_premium: CH.gapKS4.pupil_premium, fsm: CH.gapKS4.fsm, poverty_action: CH.gapKS4.poverty_action,
      teachers: CH.gapKS4.teachers, rise: CH.gapKS4.rise,
      place_investment: CH.gapKS4.place_investment, tutoring: CH.gapKS4.tutoring,
      mission_ne: CH.gapKS4.mission_ne, mission_coastal: CH.gapKS4.mission_coastal,
    };
    let structReductionsK4 = channelSum(k4Struct, ys, lagOf);
    // early-years channels reach KS4 only with the ~11y cohort lag + fade-out
    const eyFade = R(EY_FADEOUT);
    for (const id of ['eypp', 'ey_quality', 'ey_access'] as const) {
      structReductionsK4 += R(CH.gapKS4[id]) * concave(depPos(id)) * ramp(ys, EY_KS4_LAG) * eyFade;
    }
    const gapKS4 = clamp(
      BASELINE.gapKS4 + ABSENCE_TO_GAP_K4 * (persistentAbsenceDis - PA_DIS_BASE)
        + SYS.povertyToGapDrift * (childPoverty - BASELINE.childPoverty)
        + R(IND.housingGap) * dep('housing_instability') * ramp(ys, 2) - structReductionsK4,
      0.5, 30,
    );

    // attendance & breakfast act on the KS2 gap ONLY via the absence term (below), as at KS4.
    const k2Map: Record<string, Band> = {
      pupil_premium: CH.gapKS2.pupil_premium, poverty_action: CH.gapKS2.poverty_action,
      rise: CH.gapKS2.rise, reading: CH.gapKS2.reading,
    };
    let structReductionsK2 = channelSum(k2Map, ys, lagOf);
    for (const id of ['ey_quality', 'eypp'] as const) {
      if (CH.gapKS2[id]) structReductionsK2 += R(CH.gapKS2[id]) * concave(depPos(id)) * ramp(ys, 6);
    }
    const gapKS2 = clamp(
      BASELINE.gapKS2 + ABSENCE_TO_GAP_K2 * (persistentAbsenceDis - PA_DIS_BASE) - structReductionsK2,
      0.3, 16,
    );

    const recepMap: Record<string, Band> = {
      ey_quality: CH.gapRecep.ey_quality, ey_access: CH.gapRecep.ey_access,
      eypp: CH.gapRecep.eypp, poverty_action: CH.gapRecep.poverty_action,
    };
    const reductionsRecep = channelSum(recepMap, ys, () => 2); // reception responds within ~2y
    const gapReception = clamp(
      BASELINE.gapReception + POVERTY_TO_RECEP * (childPoverty - BASELINE.childPoverty) - reductionsRecep,
      0.3, 8,
    );

    // ---------------- ATTAINMENT LEVEL (all pupils) ----------------
    const teacherAttnA8 = R(CH.levelA8.teachers) * capacityNorm * ramp(ys, 4);
    const teacherAttnK2 = R(CH.levelKS2.teachers) * capacityNorm * ramp(ys, 4);
    // curriculum effects begin from first teaching in 2028
    const curRampA8 = ramp(year - 2028, 4);
    const a8Other =
      R(CH.levelA8.attendance) * concave(depPos('attendance')) * ramp(ys, 2)
      + R(CH.levelA8.curriculum) * concave(depPos('curriculum')) * curRampA8
      + R(CH.levelA8.rise) * concave(depPos('rise')) * ramp(ys, 2)
      + R(CH.levelA8.breakfast) * concave(depPos('breakfast')) * ramp(ys, 1)
      + R(CH.levelA8.reading) * concave(depPos('reading')) * ramp(ys, 2)
      + R(CH.levelA8.eal_support) * concave(depPos('eal_support')) * ramp(ys, 2);
    // (school_funding has NO direct A8 term — it acts via teacher capacity in the WORKFORCE block above)
    const attainment8 = clamp(BASELINE.attainment8 + teacherAttnA8 + a8Other, 30, 70);
    const grade5EM = clamp(BASELINE.grade5EM + 2.2 * (attainment8 - BASELINE.attainment8), 10, 95);

    const k2Other =
      R(CH.levelKS2.attendance) * concave(depPos('attendance')) * ramp(ys, 2)
      + R(CH.levelKS2.curriculum) * concave(depPos('curriculum')) * ramp(year - 2028, 4)
      + R(CH.levelKS2.reading) * concave(depPos('reading')) * ramp(ys, 2)
      + R(CH.levelKS2.rise) * concave(depPos('rise')) * ramp(ys, 2);
    // (school_funding acts via teacher capacity, not a direct KS2 term)
    const ks2RWM = clamp(BASELINE.ks2RWM + teacherAttnK2 + k2Other, 35, 95);

    const gldDelta =
      R(CH.levelGLD.ey_quality) * concave(depPos('ey_quality')) * ramp(ys, 3)
      + R(CH.levelGLD.ey_access) * concave(depPos('ey_access')) * ramp(ys, 2)
      + R(CH.levelGLD.eypp) * concave(depPos('eypp')) * ramp(ys, 3)
      + R(CH.levelGLD.poverty_action) * concave(depPos('poverty_action')) * ramp(ys, 3);
    const gld = clamp(BASELINE.gld + gldDelta, 40, 95);

    // ---------------- disadvantaged sub-levels (derived from the stage gaps) ----------------
    const attainment8Dis = clamp(attainment8 - GAP_TO_LEVEL.ks4A8 * gapKS4, 20, 70);
    const grade5EMDis = clamp(grade5EM - GAP_TO_LEVEL.ks4G5 * gapKS4, 2, 95);
    const ks2RWMDis = clamp(ks2RWM - GAP_TO_LEVEL.ks2 * gapKS2, 20, 95);
    const gldDis = clamp(gld - GAP_TO_LEVEL.recep * gapReception, 25, 95);

    // ---------------- SEND ----------------
    // inclusion strength scales over the lever's full 0–£3bn range (not a fixed £1.5bn divisor)
    const inclusionStrength = concave(depPos('inclusion_fund')) * 0.6 + depPos('send_early') * 0.4;
    const inclAdequacy = concave(inclusionStrength);
    if (ys > 0) {
      // logistic deceleration: full increment at the 2025 prevalence, → 0 at the ceiling
      const decel = Math.max(0, (SEND.prevCeiling - ehcpPct) / (SEND.prevCeiling - BASELINE.ehcpPct));
      // mental-health support + CAMHS access damp the SEMH-driven share of demand (SEMH ≈ a fifth of EHCPs)
      const mhDemandDamp = Math.max(0.4, 1 - 0.15 * concave(depPos('mental_health')) * ramp(ys, 3)
        - R(IND.camhsDemandDamp) * concave(depPos('camhs')) * ramp(ys, 3));
      const increment = R(SEND.noReformIncrementPP) * decel * mhDemandDamp;
      const mitig = R(SEND.inclusionMitigation) * inclAdequacy * ramp(ys, 3);
      // identification-vs-prevention: early SEND raises demand short-run, reduces long-run
      const shortRunBump = depPos('send_early') * 0.12 * Math.exp(-ys / 3);
      // age-ID profile: front-loading flags more children early (short-run) but prevents
      // later escalation (long-run) — the same tension, resolved by the chosen age profile.
      const idShortRun = R(AGEID.earlyShiftShortRunBump) * idShift * Math.exp(-ys / 3);
      const idPrevention = R(AGEID.earlyShiftPrevention) * idShift * ramp(ys, 3);
      // EHCP reform diverts to ISPs only from Sept 2029/2030 (no plan changes before then)
      const divert = year >= SEND.reformDivertStart
        ? R(SEND.reformDivertMax) * concave(depPos('ehcp_reform')) * ramp(year - SEND.reformDivertStart, 2)
        : 0;
      ehcpPct = clamp(ehcpPct + increment * (1 - mitig) + shortRunBump + idShortRun - idPrevention - divert, 3, 9);
    }
    const ehcpCount = (ehcpPct / 100) * POP.ehcpRefPop * 1e6;
    const subSaving = Math.min(0.4,
      R(SEND.substitutionSaving) * concave(depPos('inclusion_fund') + depPos('ehcp_reform')) * ramp(ys, 3)
      + R(IND.pipelineSubSaving) * concave(depPos('send_pipeline')) * ramp(ys, 3)
      + R(IND.careSubSaving) * concave(depPos('care_support')) * ramp(ys, 3));
    // inclusion_fund is a ring-fenced, separately-funded grant — it is NOT charged to the DSG
    // high-needs deficit (it would otherwise net to zero: new spend matched by new funding).
    const dsgSpend = SEND.spendPerPrevalence * ehcpPct * (1 - subSaving); // deficit basis (excludes ring-fenced grant)
    const highNeedsSpend = dsgSpend + (ys > 0 ? val('inclusion_fund') : 0);
    const highNeedsFunding = BASELINE.highNeedsFunding * Math.pow(1 + val('high_needs') / 100, ys);
    if (ys > 0) deficitStock = Math.max(0, deficitStock + (dsgSpend - highNeedsFunding));
    const ehcpAttnGain = R(SEND.ehcpAttnInclusionGain) * inclAdequacy * ramp(ys, 3)
      + R(AGEID.earlyShiftEhcpAttn) * idShift * ramp(ys, 3) // early identification → better SEND outcomes
      + R(IND.pipelineEhcpAttn) * concave(depPos('send_pipeline')) * ramp(ys, 3) // specialist capacity → adequate provision
      + R(IND.careA8) * concave(depPos('care_support')) * ramp(ys, 3); // virtual schools / PP+ for vulnerable pupils
    const ehcpAttnHarm = R(SEND.ehcpAttnReformHarm) * concave(depPos('ehcp_reform')) * (1 - inclAdequacy) * ramp(ys, 2);
    const ehcpAttainment8 = clamp(BASELINE.ehcpAttainment8 + ehcpAttnGain - ehcpAttnHarm, 5, 40);
    const tribunalAppeals = clamp(
      BASELINE.tribunalAppeals
        + R(SEND.tribunalReformRise) * concave(depPos('ehcp_reform')) * (1 - inclAdequacy) * ramp(ys, 2)
        - 3 * inclAdequacy * ramp(ys, 2)
        - R(IND.pipelineTribunal) * concave(depPos('send_pipeline')) * ramp(ys, 2), // capacity → needs met → fewer appeals
      4, 60,
    );
    const senSupportPct = BASELINE.senSupportPct + 0.1 * depPos('send_early') * ramp(ys, 2); // mild rise w/ early ID

    // ---------------- NEET (post-16 exit boundary — the Milburn review) ----------------
    const mhDriftMitig = R(POST16.mhDriftMitig) * concave(depPos('mental_health')) * ramp(ys, 3);
    const neet = clamp(
      BASELINE.neet + R(SYS.youthIllHealthDrift) * (1 - mhDriftMitig) * ys
        - R(SYS.neetPerA8) * (attainment8 - BASELINE.attainment8)
        - 0.08 * structReductionsK4
        - R(POST16.neetMax) * concave(depPos('post16_skills')) * ramp(ys, 2)
        - R(POST16.mhNeetMax) * concave(depPos('mental_health')) * ramp(ys, 2)
        - R(IND.careNeet) * concave(depPos('care_support')) * ramp(ys, 2)         // care-experienced support
        - R(IND.behaviourNeet) * concave(depPos('behaviour_support')) * ramp(ys, 2) // cut exclusion→AP→NEET pipeline
        - R(IND.placeNeet) * concave(depPos('place_investment')) * ramp(ys, 2)     // place-based investment
        - R(IND.camhsNeet) * concave(depPos('camhs')) * ramp(ys, 2),               // CAMHS access
      5, 25,
    );

    // ---------------- FUNDING per pupil ----------------
    // High-needs cost pressure above the 2025 level leaks from mainstream per-pupil funding.
    const sendLeak = ys > 0 ? 50 * Math.max(0, dsgSpend - 12.0) : 0;
    // The DSG statutory override ends March 2028: once it lifts, the accumulated deficit must be
    // serviced from general funds, producing a discontinuity in mainstream funding (the "cliff").
    const overrideEnded = year >= SEND.overrideEndYear;
    const overridePenalty = overrideEnded ? 8 * Math.max(0, deficitStock - 3) : 0; // £/pupil per £bn on-book
    const insolvencyRisk = overrideEnded && deficitStock >= SEND.insolvencyDeficit;
    const fundingPerPupil = clamp(
      BASELINE.fundingPerPupil * Math.pow(1 + val('school_funding') / 100, ys) - sendLeak - overridePenalty,
      4500, 12000,
    );
    const teacherShortfall = shortfall;

    // ---------------- COST (£bn additional vs baseline) ----------------
    // FSM cost is piecewise: £1.0bn at "all UC" (index 60), £1.8bn at universal (index 100).
    const fsmV = val('fsm');
    const fsmCost = fsmV <= 30 ? 0
      : fsmV <= 60 ? ((fsmV - 30) / 30) * COST.fsmFullBn
      : COST.fsmFullBn + ((fsmV - 60) / 40) * (COST.fsmUniversalBn - COST.fsmFullBn);
    // 2025 is the observed baseline anchor: programme spend begins in 2026 (ys > 0).
    const annualCost = ys === 0 ? 0 : (
      (val('pupil_premium') - 1300) * COST.ppPerPound
      + (val('eypp') - 570) * COST.eyppPerPound
      + fsmCost
      + Math.max(0, val('breakfast') - 15) / 85 * COST.breakfastFullBn
      + Math.max(0, val('poverty_action') - 20) / 80 * COST.povertyActionFullBn
      + Math.max(0, teachersFTE - POP.teachersFTE0) * COST.teacherPerK
      + Math.max(0, val('teacher_pay') - 0.5) * COST.payPerPctBn * ys
      + Math.max(0, val('bursaries') - 70) / 30 * COST.bursaryFullBn
      + val('inclusion_fund') * COST.inclusionDirect
      + Math.max(0, val('send_early') - 20) / 80 * COST.sendEarlyFullBn
      + Math.max(0, val('high_needs') - 2) * COST.highNeedsPerPctBn * ys
      + Math.max(0, val('ey_quality') - 30) / 70 * COST.eyQualityFullBn
      + Math.max(0, val('ey_access') - 70) / 30 * COST.eyAccessFullBn
      + val('curriculum') / 100 * COST.curriculumImplBn
      + Math.max(0, val('reading') - 30) / 70 * COST.readingFullBn
      + Math.max(0, val('rise') - 20) / 80 * COST.riseFullBn
      + Math.max(0, val('attendance') - 10) / 90 * COST.attendanceFullBn
      + Math.max(0, val('post16_skills') - 20) / 80 * COST.post16FullBn
      + Math.max(0, val('mental_health') - 25) / 75 * COST.mentalHealthFullBn
      + ageIdDelta // SEND/EHCP identification-by-age: additional ("stretch") cost vs baseline
      + Math.max(0, val('send_pipeline') - 30) / 70 * COST.sendPipelineFullBn
      + Math.max(0, val('camhs') - 30) / 70 * COST.camhsFullBn
      + Math.max(0, val('eal_support') - 30) / 70 * COST.ealSupportFullBn
      + Math.max(0, val('care_support') - 40) / 60 * COST.careSupportFullBn
      + Math.max(0, val('behaviour_support') - 30) / 70 * COST.behaviourFullBn
      + Math.max(0, val('place_investment') - 20) / 80 * COST.placeInvestFullBn
      + val('mission_ne') / 100 * COST.missionNeFullBn
      + val('mission_coastal') / 100 * COST.missionCoastalFullBn
      + Math.max(0, val('tutoring') - 30) / 70 * COST.tutoringFullBn
      + Math.max(0, val('school_funding') - 0.4) * COST.fundingPerPctBn * ys
    );
    cumulativeCost += annualCost;

    years.push({
      year, isProjection: year > BASE_YEAR,
      gapReception, gapKS2, gapKS4,
      gld, gldDis, ks2RWM, ks2RWMDis, attainment8, attainment8Dis, grade5EM, grade5EMDis,
      ehcpCount, ehcpPct, senSupportPct, highNeedsSpend, highNeedsDeficitStock: deficitStock,
      ehcpAttainment8, tribunalAppeals, insolvencyRisk,
      absenceOverall, persistentAbsence, persistentAbsenceDis, severeAbsence,
      teacherShortfall, teachersFTE, fundingPerPupil, childPoverty, neet,
      annualCost, cumulativeCost,
    });
  }

  return { years, baseYear: BASE_YEAR, endYear: END_YEAR };
}
