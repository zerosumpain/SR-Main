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

import type { LeverState, SimResult, YearResult, OutcomeTrace, TraceTerm } from './types';
import { LEVERS_BY_ID, ageIdTotals, earlyIdShift } from './levers';
import {
  BASE_YEAR, END_YEAR, POP, BASELINE, GAP_TO_LEVEL, CH, SEND, SYS, POST16, WORK, AGEID, IND, EY_KS4_LAG, EY_FADEOUT, COST,
  NEETSEG, NEETPIPE,
  type Band,
} from './params';

// Extra structural constants (calibrated so 2025 reproduces BASELINE exactly).
const ABSENCE_TO_GAP_K4 = 0.077;   // months KS4 gap per pp of disadvantaged PA (vs 2025) [EPI: +1mo ≈ +13pp PA]
const ABSENCE_TO_GAP_K2 = 0.040;   // months KS2 gap per pp disadvantaged PA
const POVERTY_TO_AGE3 = 0.035;     // months age-3 gap per pp child poverty (vs 2025) — home learning environment, the dominant early driver
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
  /** Capture the real intermediate calculation terms for this year (the "show your working" trace). */
  trace?: number;
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

  // sum of band contributions over a channel map, applying concave(dep)·ramp.
  // `sink`, when supplied, records each lever id's individual contribution (for the trace).
  function channelSum(
    map: Record<string, Band>,
    yearsSince: number,
    lagFor: (id: string) => number,
    depFor: (id: string) => number = dep,
    sink?: Record<string, number>,
  ): number {
    let s = 0;
    for (const id in map) {
      const c = R(map[id]) * concave(depFor(id)) * ramp(yearsSince, lagFor(id));
      s += c;
      if (sink) sink[id] = (sink[id] ?? 0) + c;
    }
    return s;
  }
  const lagOf = (id: string) => CH.lag[id] ?? 3;

  // ---- trace scaffolding (only active for the requested year) ----
  const traceYear = opts.trace;
  const traceOut: Record<string, OutcomeTrace> = {};
  const partsOf = (sink: Record<string, number>): { id: string; label: string; value: number }[] =>
    Object.entries(sink)
      .map(([id, value]) => ({ id, label: LEVERS_BY_ID[id]?.label ?? id, value: -value }))
      .filter((p) => Math.abs(p.value) > 1e-4)
      .sort((a, b) => a.value - b.value);

  // ---- stateful variables ----
  let ehcpPct = BASELINE.ehcpPct;
  let deficitStock = BASELINE.highNeedsDeficitStock;
  let shortfall = BASELINE.teacherShortfall;
  let teachersFTE = POP.teachersFTE0;
  let cumulativeCost = 0;
  // prior-year NEET segments, for the persistence (long-term) stock
  let prevU = BASELINE.neetUnemployed, prevIH = BASELINE.neetInactiveHealth, prevIO = BASELINE.neetInactiveOther;

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
    const povDrift = SYS.povertyDrift * ys;
    const povAction = R(SYS.povertyActionMax) * concave(depPos('poverty_action')) * ramp(ys, 3);
    const povFsm = R(SYS.fsmPovertyCut) * concave(depPos('fsm')) * ramp(ys, 3);
    const childPoverty = clamp(BASELINE.childPoverty + povDrift - povAction - povFsm, 15, 40);
    if (year === traceYear) {
      const res = BASELINE.childPoverty + povDrift - povAction - povFsm;
      const terms: TraceTerm[] = [
        { label: 'Baseline drift', symbol: `${SYS.povertyDrift} · ${ys} years`, value: povDrift, note: 'A modelled upward trend (two-child limit etc.) absent new action [CPAG].' },
        { label: 'Anti-poverty action', symbol: '− povertyActionMax · f(dep) · ramp', value: -povAction, leverIds: ['poverty_action'] },
        { label: 'Free school meals', symbol: '− fsmPovertyCut · f(dep) · ramp', value: -povFsm, leverIds: ['fsm'] },
      ];
      traceOut.childPoverty = { key: 'childPoverty', title: 'Child poverty', unit: '%', base: BASELINE.childPoverty, baseLabel: '2025 baseline', terms, result: res, engineValue: childPoverty, clamped: Math.abs(res - childPoverty) > 1e-6, codeKey: 'childPoverty' };
    }

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
    const paSystem = SYS.paLeverage * SYS.paDisLeverage * (absenceOverall - BASELINE.absenceOverall);
    const persistentAbsenceDis = clamp(
      PA_DIS_BASE + paSystem - extraMentorDisCut + housingPA - pipelinePAcut,
      8, 45,
    );
    if (year === traceYear) {
      const res = PA_DIS_BASE + paSystem - extraMentorDisCut + housingPA - pipelinePAcut;
      const terms: TraceTerm[] = [
        { label: 'System absence', symbol: `${(SYS.paLeverage * SYS.paDisLeverage).toFixed(2)} · (absence − ${BASELINE.absenceOverall})`, value: paSystem, leverIds: ['attendance', 'breakfast', 'poverty_action'], note: 'Disadvantaged absence tracks overall absence, amplified (2.5 × 1.3).' },
        { label: 'Attendance mentors', symbol: '− mentor cut', value: -extraMentorDisCut, leverIds: ['attendance'], note: 'Up to 8pp at full mentor coverage — the single highest-leverage equity lever.' },
        { label: 'Housing instability', symbol: '+ housingPA · dep(housing)', value: housingPA, leverIds: ['housing_instability'] },
        { label: 'SEND specialist capacity', symbol: '− pipeline cut', value: -pipelinePAcut, leverIds: ['send_pipeline'], note: 'Supported SEND pupils attend more.' },
      ];
      traceOut.persistentAbsenceDis = { key: 'persistentAbsenceDis', title: 'Persistent absence (disadvantaged)', unit: '%', base: PA_DIS_BASE, baseLabel: '2025 baseline', terms, result: res, engineValue: persistentAbsenceDis, clamped: Math.abs(res - persistentAbsenceDis) > 1e-6, codeKey: 'paDis' };
    }
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
    const k4Sink: Record<string, number> | undefined = year === traceYear ? {} : undefined;
    let structReductionsK4 = channelSum(k4Struct, ys, lagOf, dep, k4Sink);
    // early-years channels reach KS4 only with the ~11y cohort lag + fade-out
    const eyFade = R(EY_FADEOUT);
    for (const id of ['eypp', 'ey_quality', 'ey_access'] as const) {
      const c = R(CH.gapKS4[id]) * concave(depPos(id)) * ramp(ys, EY_KS4_LAG) * eyFade;
      structReductionsK4 += c;
      if (k4Sink) k4Sink[id] = (k4Sink[id] ?? 0) + c;
    }
    const k4Absence = ABSENCE_TO_GAP_K4 * (persistentAbsenceDis - PA_DIS_BASE);
    const k4PovDrift = SYS.povertyToGapDrift * (childPoverty - BASELINE.childPoverty);
    const k4Housing = R(IND.housingGap) * dep('housing_instability') * ramp(ys, 2);
    const gapKS4 = clamp(
      BASELINE.gapKS4 + k4Absence + k4PovDrift + k4Housing - structReductionsK4,
      0.5, 30,
    );
    if (year === traceYear) {
      const res = BASELINE.gapKS4 + k4Absence + k4PovDrift + k4Housing - structReductionsK4;
      const terms: TraceTerm[] = [
        { label: 'Disadvantaged absence', symbol: `${ABSENCE_TO_GAP_K4} · (PA_dis − ${PA_DIS_BASE})`, value: k4Absence, leverIds: ['attendance', 'breakfast'], note: 'The dominant lever: EPI attributes the entire post-2019 widening to higher disadvantaged absence.' },
        { label: 'Child-poverty drift', symbol: `${SYS.povertyToGapDrift} · (poverty − ${BASELINE.childPoverty})`, value: k4PovDrift, leverIds: ['poverty_action', 'fsm'] },
        { label: 'Housing instability', symbol: 'housingGap · dep(housing)', value: k4Housing, leverIds: ['housing_instability'] },
        { label: 'Structural reductions', symbol: '− Σ (pupil premium, teachers, RISE, tutoring, early years …)', value: -structReductionsK4, parts: k4Sink ? partsOf(k4Sink) : undefined, note: 'Each disadvantage-targeted lever, with diminishing returns and its lag; early-years terms carry the ~11-year cohort lag.' },
      ];
      traceOut.gapKS4 = { key: 'gapKS4', title: 'Disadvantage gap at 16', unit: 'months', base: BASELINE.gapKS4, baseLabel: '2025 baseline', terms, result: res, engineValue: gapKS4, clamped: Math.abs(res - gapKS4) > 1e-6, codeKey: 'gapKS4' };
    }

    // attendance & breakfast act on the KS2 gap ONLY via the absence term (below), as at KS4.
    const k2Map: Record<string, Band> = {
      pupil_premium: CH.gapKS2.pupil_premium, poverty_action: CH.gapKS2.poverty_action,
      rise: CH.gapKS2.rise, reading: CH.gapKS2.reading,
    };
    const k2Sink: Record<string, number> | undefined = year === traceYear ? {} : undefined;
    let structReductionsK2 = channelSum(k2Map, ys, lagOf, dep, k2Sink);
    for (const id of ['ey_quality', 'eypp'] as const) {
      if (CH.gapKS2[id]) {
        const c = R(CH.gapKS2[id]) * concave(depPos(id)) * ramp(ys, 6);
        structReductionsK2 += c;
        if (k2Sink) k2Sink[id] = (k2Sink[id] ?? 0) + c;
      }
    }
    const k2Absence = ABSENCE_TO_GAP_K2 * (persistentAbsenceDis - PA_DIS_BASE);
    const gapKS2 = clamp(BASELINE.gapKS2 + k2Absence - structReductionsK2, 0.3, 16);
    if (year === traceYear) {
      const res = BASELINE.gapKS2 + k2Absence - structReductionsK2;
      const terms: TraceTerm[] = [
        { label: 'Disadvantaged absence', symbol: `${ABSENCE_TO_GAP_K2} · (PA_dis − ${PA_DIS_BASE})`, value: k2Absence, leverIds: ['attendance', 'breakfast'] },
        { label: 'Structural reductions', symbol: '− Σ (pupil premium, poverty action, reading, RISE, early years)', value: -structReductionsK2, parts: k2Sink ? partsOf(k2Sink) : undefined },
      ];
      traceOut.gapKS2 = { key: 'gapKS2', title: 'Disadvantage gap at 11', unit: 'months', base: BASELINE.gapKS2, baseLabel: '2025 baseline', terms, result: res, engineValue: gapKS2, clamped: Math.abs(res - gapKS2) > 1e-6, codeKey: 'gapKS2' };
    }

    // ---------------- DEVELOPMENT GAP AT AGE 3 (months) ----------------
    // The earliest modelled point — the gap is observable from age 3 and ~40% of the age-16
    // gap is set by age 5 (EPI). EY levers act here FIRST and FASTEST (~1.5y). A parallel
    // fast-response indicator of the same early-years inputs that drive the reception gap;
    // the model does not yet chain age-3 → age-5 causally (a documented limitation).
    const age3Map: Record<string, Band> = {
      ey_quality: CH.gapAge3.ey_quality, ey_access: CH.gapAge3.ey_access,
      eypp: CH.gapAge3.eypp, poverty_action: CH.gapAge3.poverty_action,
    };
    const age3Sink: Record<string, number> | undefined = year === traceYear ? {} : undefined;
    const reductionsAge3 = channelSum(age3Map, ys, () => 1.5, dep, age3Sink);
    const sendEarlyAge3 = R(CH.gapAge3.send_early) * concave(depPos('send_early')) * ramp(ys, 2);
    if (age3Sink) age3Sink['send_early'] = (age3Sink['send_early'] ?? 0) + sendEarlyAge3;
    const age3Pov = POVERTY_TO_AGE3 * (childPoverty - BASELINE.childPoverty);
    const gapAge3 = clamp(
      BASELINE.gapAge3 + age3Pov - reductionsAge3 - sendEarlyAge3,
      0.2, 7,
    );
    if (year === traceYear) {
      const res = BASELINE.gapAge3 + age3Pov - reductionsAge3 - sendEarlyAge3;
      const terms: TraceTerm[] = [
        { label: 'Home learning environment (via poverty)', symbol: `${POVERTY_TO_AGE3} · (poverty − ${BASELINE.childPoverty})`, value: age3Pov, leverIds: ['poverty_action'], note: 'The home learning environment is the dominant early driver (EPPE/EPI); proxied here through child poverty.' },
        { label: 'Early-years investment', symbol: '− Σ (quality, access, EYPP, early SEND)', value: -(reductionsAge3 + sendEarlyAge3), parts: age3Sink ? partsOf(age3Sink) : undefined, note: 'The fastest-responding gap (~1.5y) — the Heckman front-load logic.' },
      ];
      traceOut.gapAge3 = { key: 'gapAge3', title: 'Development gap at 3', unit: 'months', base: BASELINE.gapAge3, baseLabel: '2025 baseline (estimate)', terms, result: res, engineValue: gapAge3, clamped: Math.abs(res - gapAge3) > 1e-6, codeKey: 'gapAge3' };
    }

    // ---------------- EARLY-EDUCATION TAKE-UP (%) ----------------
    // The 0-5 "front door": realised take-up of funded early education. The universal 3-4yo
    // offer is near-saturated (~94%); disadvantaged take-up (the equity entitlement) tracks
    // the ey_access lever, lifted modestly by Family-Hub outreach (send_early). The persistent
    // all-vs-disadvantaged gap at this first gate is the early-years equity story in one number.
    const eyTakeUp = clamp(val('ey_access') + 8 * concave(depPos('send_early')) * ramp(ys, 2), 0, 100);
    const eyTakeUpAll = clamp(94 + 4 * depPos('ey_access') * ramp(ys, 2), 0, 100);

    const recepMap: Record<string, Band> = {
      ey_quality: CH.gapRecep.ey_quality, ey_access: CH.gapRecep.ey_access,
      eypp: CH.gapRecep.eypp, poverty_action: CH.gapRecep.poverty_action,
    };
    const recepSink: Record<string, number> | undefined = year === traceYear ? {} : undefined;
    const reductionsRecep = channelSum(recepMap, ys, () => 2, dep, recepSink); // reception responds within ~2y
    const recepPov = POVERTY_TO_RECEP * (childPoverty - BASELINE.childPoverty);
    const gapReception = clamp(BASELINE.gapReception + recepPov - reductionsRecep, 0.3, 8);
    if (year === traceYear) {
      const res = BASELINE.gapReception + recepPov - reductionsRecep;
      const terms: TraceTerm[] = [
        { label: 'Home learning environment (via poverty)', symbol: `${POVERTY_TO_RECEP} · (poverty − ${BASELINE.childPoverty})`, value: recepPov, leverIds: ['poverty_action'] },
        { label: 'Early-years investment', symbol: '− Σ (quality, access, EYPP, poverty action)', value: -reductionsRecep, parts: recepSink ? partsOf(recepSink) : undefined, note: 'Reception responds within ~2 years — faster than the lagged KS4 effect.' },
      ];
      traceOut.gapReception = { key: 'gapReception', title: 'Disadvantage gap at 5', unit: 'months', base: BASELINE.gapReception, baseLabel: '2025 baseline', terms, result: res, engineValue: gapReception, clamped: Math.abs(res - gapReception) > 1e-6, codeKey: 'gapReception' };
    }

    // ---------------- ATTAINMENT LEVEL (all pupils) ----------------
    const teacherAttnA8 = R(CH.levelA8.teachers) * capacityNorm * ramp(ys, 4);
    const teacherAttnK2 = R(CH.levelKS2.teachers) * capacityNorm * ramp(ys, 4);
    // curriculum effects begin from first teaching in 2028
    const curRampA8 = ramp(year - 2028, 4);
    const a8Terms: Array<[string, number]> = [
      ['attendance', R(CH.levelA8.attendance) * concave(depPos('attendance')) * ramp(ys, 2)],
      ['curriculum', R(CH.levelA8.curriculum) * concave(depPos('curriculum')) * curRampA8],
      ['rise', R(CH.levelA8.rise) * concave(depPos('rise')) * ramp(ys, 2)],
      ['breakfast', R(CH.levelA8.breakfast) * concave(depPos('breakfast')) * ramp(ys, 1)],
      ['reading', R(CH.levelA8.reading) * concave(depPos('reading')) * ramp(ys, 2)],
      ['eal_support', R(CH.levelA8.eal_support) * concave(depPos('eal_support')) * ramp(ys, 2)],
    ];
    const a8Other = a8Terms.reduce((s, [, v]) => s + v, 0);
    // (school_funding has NO direct A8 term — it acts via teacher capacity in the WORKFORCE block above)
    const attainment8 = clamp(BASELINE.attainment8 + teacherAttnA8 + a8Other, 30, 70);
    if (year === traceYear) {
      const res = BASELINE.attainment8 + teacherAttnA8 + a8Other;
      const terms: TraceTerm[] = [
        { label: 'Teacher capacity', symbol: 'maxₜ · capacityNorm · ramp(4y)', value: teacherAttnA8, leverIds: ['teachers', 'teacher_pay', 'bursaries', 'school_funding'], note: 'The strong, evidenced channel. Funding acts ONLY here (via recruitment/retention), never as a direct £→attainment term.' },
        { label: 'Other channels', symbol: '+ Σ (attendance, curriculum, RISE, breakfast, reading, EAL)', value: a8Other, parts: a8Terms.map(([id, v]) => ({ id, label: LEVERS_BY_ID[id]?.label ?? id, value: v })).filter((p) => Math.abs(p.value) > 1e-4).sort((a, b) => b.value - a.value) },
      ];
      traceOut.attainment8 = { key: 'attainment8', title: 'Attainment 8 (all pupils)', unit: 'score', base: BASELINE.attainment8, baseLabel: '2025 baseline', terms, result: res, engineValue: attainment8, clamped: Math.abs(res - attainment8) > 1e-6, codeKey: 'attainment8' };
    }
    const g5Link = 2.2 * (attainment8 - BASELINE.attainment8);
    const grade5EM = clamp(BASELINE.grade5EM + g5Link, 10, 95);
    if (year === traceYear) {
      const res = BASELINE.grade5EM + g5Link;
      const terms: TraceTerm[] = [
        { label: 'Follows Attainment 8', symbol: `2.2 · (A8 − ${BASELINE.attainment8}) = 2.2 · ${(attainment8 - BASELINE.attainment8).toFixed(2)}`, value: g5Link, leverIds: ['teachers', 'attendance', 'reading', 'curriculum'], note: 'The strong-pass rate moves ~2.2pp per Attainment-8 point — so its levers are Attainment 8\'s levers.' },
      ];
      traceOut.grade5EM = { key: 'grade5EM', title: 'Grade 5+ English & Maths', unit: '%', base: BASELINE.grade5EM, baseLabel: '2025 baseline', terms, result: res, engineValue: grade5EM, clamped: Math.abs(res - grade5EM) > 1e-6, codeKey: 'grade5EM' };
    }

    const k2OtherTerms: Array<[string, number]> = [
      ['attendance', R(CH.levelKS2.attendance) * concave(depPos('attendance')) * ramp(ys, 2)],
      ['curriculum', R(CH.levelKS2.curriculum) * concave(depPos('curriculum')) * ramp(year - 2028, 4)],
      ['reading', R(CH.levelKS2.reading) * concave(depPos('reading')) * ramp(ys, 2)],
      ['rise', R(CH.levelKS2.rise) * concave(depPos('rise')) * ramp(ys, 2)],
    ];
    const k2Other = k2OtherTerms.reduce((s, [, v]) => s + v, 0);
    // (school_funding acts via teacher capacity, not a direct KS2 term)
    const ks2RWM = clamp(BASELINE.ks2RWM + teacherAttnK2 + k2Other, 35, 95);
    if (year === traceYear) {
      const res = BASELINE.ks2RWM + teacherAttnK2 + k2Other;
      const terms: TraceTerm[] = [
        { label: 'Teacher capacity', symbol: 'maxₜ · capacityNorm · ramp(4y)', value: teacherAttnK2, leverIds: ['teachers', 'teacher_pay', 'bursaries', 'school_funding'] },
        { label: 'Other channels', symbol: '+ Σ (attendance, curriculum, reading, RISE)', value: k2Other, parts: k2OtherTerms.map(([id, v]) => ({ id, label: LEVERS_BY_ID[id]?.label ?? id, value: v })).filter((p) => Math.abs(p.value) > 1e-4).sort((a, b) => b.value - a.value) },
      ];
      traceOut.ks2RWM = { key: 'ks2RWM', title: 'KS2 reading+writing+maths', unit: '%', base: BASELINE.ks2RWM, baseLabel: '2025 baseline', terms, result: res, engineValue: ks2RWM, clamped: Math.abs(res - ks2RWM) > 1e-6, codeKey: 'ks2RWM' };
    }

    const gldTerms: Array<[string, number]> = [
      ['ey_quality', R(CH.levelGLD.ey_quality) * concave(depPos('ey_quality')) * ramp(ys, 3)],
      ['ey_access', R(CH.levelGLD.ey_access) * concave(depPos('ey_access')) * ramp(ys, 2)],
      ['eypp', R(CH.levelGLD.eypp) * concave(depPos('eypp')) * ramp(ys, 3)],
      ['poverty_action', R(CH.levelGLD.poverty_action) * concave(depPos('poverty_action')) * ramp(ys, 3)],
    ];
    const gldDelta = gldTerms.reduce((s, [, v]) => s + v, 0);
    const gld = clamp(BASELINE.gld + gldDelta, 40, 95);
    if (year === traceYear) {
      const res = BASELINE.gld + gldDelta;
      const terms: TraceTerm[] = [
        { label: 'Early-years investment', symbol: '+ Σ (quality, access, EYPP, poverty action)', value: gldDelta, parts: gldTerms.map(([id, v]) => ({ id, label: LEVERS_BY_ID[id]?.label ?? id, value: v })).filter((p) => Math.abs(p.value) > 1e-4).sort((a, b) => b.value - a.value), note: 'GLD 68→75 (Best Start target) needs ~7pp — quality is the largest strand.' },
      ];
      traceOut.gld = { key: 'gld', title: 'Good Level of Development (age 5)', unit: '%', base: BASELINE.gld, baseLabel: '2025 baseline', terms, result: res, engineValue: gld, clamped: Math.abs(res - gld) > 1e-6, codeKey: 'gld' };
    }

    // ---------------- disadvantaged sub-levels (derived from the stage gaps) ----------------
    const a8DisPenalty = GAP_TO_LEVEL.ks4A8 * gapKS4;
    const attainment8Dis = clamp(attainment8 - a8DisPenalty, 20, 70);
    if (year === traceYear) {
      const res = attainment8 - a8DisPenalty;
      const terms: TraceTerm[] = [
        { label: 'Disadvantage gap penalty', symbol: `− ${GAP_TO_LEVEL.ks4A8.toFixed(3)} · gapKS4 (= ${gapKS4.toFixed(1)} mo)`, value: -a8DisPenalty, leverIds: ['attendance', 'pupil_premium', 'poverty_action', 'tutoring'], note: 'Disadvantaged attainment = the all-pupil level MINUS the gap (converted to A8 points). Close the gap and this rises.' },
      ];
      traceOut.attainment8Dis = { key: 'attainment8Dis', title: 'Attainment 8 (disadvantaged)', unit: 'score', base: attainment8, baseLabel: 'Attainment 8 (all pupils)', terms, result: res, engineValue: attainment8Dis, clamped: Math.abs(res - attainment8Dis) > 1e-6, codeKey: 'a8Dis' };
    }
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
    const prevDeficit = deficitStock;
    if (ys > 0) deficitStock = Math.max(0, deficitStock + (dsgSpend - highNeedsFunding));
    if (year === traceYear) {
      const res = prevDeficit + (ys > 0 ? dsgSpend - highNeedsFunding : 0);
      const terms: TraceTerm[] = [
        { label: 'High-needs spend (DSG basis)', symbol: `${SEND.spendPerPrevalence.toFixed(2)} · ehcp% · (1 − substitution)`, value: ys > 0 ? dsgSpend : 0, leverIds: ['inclusion_fund', 'ehcp_reform', 'send_early'], note: 'Driven by EHCP prevalence; inclusion & early-SEND slow demand, reform diverts to ISPs from 2030.' },
        { label: 'High-needs funding', symbol: `− ${BASELINE.highNeedsFunding} · (1 + high_needs%)^t`, value: ys > 0 ? -highNeedsFunding : 0, leverIds: ['high_needs'], note: 'Real-terms growth in the high-needs block.' },
      ];
      traceOut.highNeedsDeficitStock = { key: 'highNeedsDeficitStock', title: 'High-needs (DSG) deficit', unit: '£bn', base: prevDeficit, baseLabel: `deficit carried from ${year - 1}`, terms, result: res, engineValue: deficitStock, clamped: Math.abs(res - deficitStock) > 1e-6, codeKey: 'deficit' };
    }
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

    // ---------------- NEET (post-16 exit boundary), three segments ----------------
    // U = unemployed-active (cyclical) · IH = inactive-health (sticky; the Milburn
    // "generational fault line") · IO = inactive-other (caring / discouraged).
    // Headline = sum. Composition: ONS May 2026; risk pipeline: DfE risk-factors May 2026.
    const mhDriftMitig = R(POST16.mhDriftMitig) * concave(depPos('mental_health')) * ramp(ys, 3);
    // upstream pipeline pressure (pp on headline NEET) from the modelled mediators —
    // associational multipliers, propagating with the stock-turnover lag
    const pipe = (R(NEETPIPE.absenceK) * (persistentAbsenceDis - PA_DIS_BASE)
      + R(NEETPIPE.povertyK) * (childPoverty - BASELINE.childPoverty)
      + R(NEETPIPE.ehcpK) * (ehcpPct - BASELINE.ehcpPct)) * ramp(ys, NEETPIPE.lag);
    const a8Effect = R(SYS.neetPerA8) * (attainment8 - BASELINE.attainment8) + 0.08 * structReductionsK4;
    const careersCut = R(POST16.careersMax) * concave(depPos('careers_gatsby')) * ramp(ys, 3);
    // Programme cuts act MULTIPLICATIVELY on each segment (proportional hazards): each
    // term's pp-at-full-deployment is converted to a fraction of the segment's 2025
    // base, so overlapping programmes saturate instead of additively clamping the
    // small segment bases to their floors (which would deaden every marginal lever).
    const survive = (cutsPp: number[], basePp: number) =>
      cutsPp.reduce((m, c) => m * clamp(1 - Math.max(0, c) / basePp, 0.3, 1), 1);

    const uPressure = BASELINE.neetUnemployed
      + NEETSEG.pipeShare.unemployed * pipe - NEETSEG.a8Share.unemployed * a8Effect;
    const neetUnemployed = clamp(uPressure * survive([
      0.6 * careersCut,
      R(POST16.neetMax) * concave(depPos('post16_skills')) * ramp(ys, 2),
      R(POST16.youthGuaranteeMax) * concave(depPos('youth_guarantee')) * ramp(ys, 2),
      R(POST16.apprenticeshipsMax) * concave(depPos('apprenticeships')) * ramp(ys, 3),
      R(POST16.entryLevelMax) * concave(depPos('entry_level')) * ramp(ys, 2),
      0.5 * R(POST16.post16PremiumMax) * concave(depPos('post16_premium')) * ramp(ys, 3),
      0.6 * R(IND.behaviourNeet) * concave(depPos('behaviour_support')) * ramp(ys, 2), // exclusion→AP→NEET pipeline
      R(IND.placeNeet) * concave(depPos('place_investment')) * ramp(ys, 2),
      0.5 * R(IND.careNeet) * concave(depPos('care_support')) * ramp(ys, 2),
    ], BASELINE.neetUnemployed), 1.0, 10);

    const ihPressure = BASELINE.neetInactiveHealth
      + R(SYS.youthIllHealthDrift) * (1 - mhDriftMitig) * ys
      + NEETSEG.pipeShare.health * pipe - NEETSEG.a8Share.health * a8Effect;
    const neetInactiveHealth = clamp(ihPressure * survive([
      0.1 * careersCut,
      R(POST16.mhNeetMax) * concave(depPos('mental_health')) * ramp(ys, NEETSEG.healthLag),
      R(IND.camhsNeet) * concave(depPos('camhs')) * ramp(ys, NEETSEG.healthLag),
    ], BASELINE.neetInactiveHealth), 1.0, 12);

    const ioPressure = BASELINE.neetInactiveOther
      + NEETSEG.pipeShare.other * pipe - NEETSEG.a8Share.other * a8Effect;
    const neetInactiveOther = clamp(ioPressure * survive([
      0.3 * careersCut,
      0.5 * R(POST16.post16PremiumMax) * concave(depPos('post16_premium')) * ramp(ys, 3),
      0.4 * R(POST16.entryLevelMax) * concave(depPos('entry_level')) * ramp(ys, 2),
      0.4 * R(IND.behaviourNeet) * concave(depPos('behaviour_support')) * ramp(ys, 2),
      0.5 * R(IND.careNeet) * concave(depPos('care_support')) * ramp(ys, 2),
    ], BASELINE.neetInactiveOther), 1.0, 9);

    const neet = neetUnemployed + neetInactiveHealth + neetInactiveOther;
    if (year === traceYear) {
      const terms: TraceTerm[] = [
        { label: 'Unemployed-active', symbol: 'cyclical segment', value: neetUnemployed, leverIds: ['youth_guarantee', 'apprenticeships', 'careers_gatsby', 'post16_skills', 'entry_level'], note: 'Moved by work-route levers (incl. the demand-side entry_level); cuts act multiplicatively (proportional hazards) so overlapping programmes saturate.' },
        { label: 'Inactive — health', symbol: 'sticky segment', value: neetInactiveHealth, leverIds: ['mental_health', 'camhs'], note: 'The Milburn "generational fault line": ~8 in 10 still NEET 2+ years on; responds to mental-health/CAMHS, not job schemes.' },
        { label: 'Inactive — other', symbol: 'caring / discouraged', value: neetInactiveOther, leverIds: ['post16_premium', 'care_support', 'behaviour_support'] },
      ];
      traceOut.neet = { key: 'neet', title: 'NEET (16–24)', unit: '%', base: 0, baseLabel: 'sum of three segments', terms, result: neet, engineValue: neet, clamped: false, codeKey: 'neet' };
    }

    // ---- persistence: the long-term (12+ month) NEET stock ----
    // Of LAST year's stock, the share still NEET this year — per-segment persistence,
    // with re-engagement levers acting on the EXISTING stock (not just inflow): the
    // Youth/Jobs Guarantee keyworker model cuts unemployed persistence; MH + CAMHS
    // chip the (much stickier) health persistence. [Milburn 2026: 6 in 10 never worked]
    const pU = clamp(R(NEETSEG.persist.unemployed)
      - R(NEETSEG.persistCutU) * concave(depPos('youth_guarantee')) * ramp(ys, 2)
      - R(NEETSEG.entryLevelPersistCutU) * concave(depPos('entry_level')) * ramp(ys, 2), 0.10, 0.95);
    const pIH = clamp(R(NEETSEG.persist.health)
      - R(NEETSEG.persistCutIH) * concave(0.6 * depPos('mental_health') + 0.4 * depPos('camhs')) * ramp(ys, NEETSEG.healthLag), 0.30, 0.97);
    const pIO = R(NEETSEG.persist.other);
    const neetLongTerm = Math.min(0.9 * neet, pU * prevU + pIH * prevIH + pIO * prevIO);
    prevU = neetUnemployed; prevIH = neetInactiveHealth; prevIO = neetInactiveOther;

    // ---------------- FUNDING per pupil ----------------
    // High-needs cost pressure above the 2025 level leaks from mainstream per-pupil funding.
    const sendLeak = ys > 0 ? 50 * Math.max(0, dsgSpend - 12.0) : 0;
    // The DSG statutory override ends March 2028: once it lifts, the accumulated deficit must be
    // serviced from general funds, producing a discontinuity in mainstream funding (the "cliff").
    const overrideEnded = year >= SEND.overrideEndYear;
    const overridePenalty = overrideEnded ? 8 * Math.max(0, deficitStock - 3) : 0; // £/pupil per £bn on-book
    const insolvencyRisk = overrideEnded && deficitStock >= SEND.insolvencyDeficit;
    const fundGrowth = BASELINE.fundingPerPupil * Math.pow(1 + val('school_funding') / 100, ys) - BASELINE.fundingPerPupil;
    const fundingPerPupil = clamp(
      BASELINE.fundingPerPupil + fundGrowth - sendLeak - overridePenalty,
      4500, 12000,
    );
    if (year === traceYear) {
      const res = BASELINE.fundingPerPupil + fundGrowth - sendLeak - overridePenalty;
      const terms: TraceTerm[] = [
        { label: 'Real-terms growth', symbol: `base · (1 + funding%)^${ys} − base`, value: fundGrowth, leverIds: ['school_funding'] },
        { label: 'SEND cost leak', symbol: ys > 0 ? '− 50 · max(0, DSG spend − 12)' : 'n/a (base year)', value: -sendLeak, leverIds: ['high_needs', 'inclusion_fund', 'ehcp_reform'], note: 'High-needs spend above the 2025 level leaks £/pupil out of mainstream funding.' },
        { label: 'Override cliff (from 2028)', symbol: overrideEnded ? '− 8 · max(0, deficit − 3)' : 'not yet (override holds until 2028)', value: -overridePenalty, leverIds: ['high_needs', 'ehcp_reform'], note: 'When the DSG statutory override ends (March 2028), the accumulated deficit is serviced from general funds.' },
      ];
      traceOut.fundingPerPupil = { key: 'fundingPerPupil', title: 'Funding per pupil', unit: '£', base: BASELINE.fundingPerPupil, baseLabel: '2025 baseline', terms, result: res, engineValue: fundingPerPupil, clamped: Math.abs(res - fundingPerPupil) > 1e-6, codeKey: 'funding' };
    }
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
      + Math.max(0, val('youth_guarantee') - 15) / 85 * COST.youthGuaranteeFullBn
      + Math.max(0, val('careers_gatsby') - 35) / 65 * COST.careersFullBn
      + Math.max(0, val('apprenticeships') - 30) / 70 * COST.apprenticeshipsFullBn
      + Math.max(0, val('entry_level') - 25) / 75 * COST.entryLevelFullBn
      + val('post16_premium') * COST.post16PremiumPerPound
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
      gapAge3, gapReception, gapKS2, gapKS4,
      eyTakeUp, eyTakeUpAll,
      gld, gldDis, ks2RWM, ks2RWMDis, attainment8, attainment8Dis, grade5EM, grade5EMDis,
      ehcpCount, ehcpPct, senSupportPct, highNeedsSpend, highNeedsDeficitStock: deficitStock,
      ehcpAttainment8, tribunalAppeals, insolvencyRisk,
      absenceOverall, persistentAbsence, persistentAbsenceDis, severeAbsence,
      teacherShortfall, teachersFTE, fundingPerPupil, childPoverty,
      neet, neetUnemployed, neetInactiveHealth, neetInactiveOther, neetLongTerm,
      annualCost, cumulativeCost,
    });
  }

  return {
    years, baseYear: BASE_YEAR, endYear: END_YEAR,
    trace: traceYear != null ? { year: traceYear, outcomes: traceOut } : undefined,
  };
}
