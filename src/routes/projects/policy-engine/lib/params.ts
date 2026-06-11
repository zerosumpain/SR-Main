// params.ts — calibrated parameters for The Whitehall Model. Every value is either
// SOURCED (with a citation) or an explicit ASSUMPTION/tuning prior. Effect sizes carry
// {low, central, high} so Monte-Carlo can propagate uncertainty. Self-contained.
//
// PROVENANCE: full calibration logs in docs/policy-engine-research/. Key sources:
//   EPI Annual Report 2025 (disadvantage gap, months) · DfE EES (KS4/KS2/EHCP/absence/
//   workforce/NEET) · IFS (education spending 2025-26, Green Budget ch.5, early years) ·
//   NFER Teacher Labour Market 2025 · EEF Toolkit · DfE Schools White Paper
//   "Every Child Achieving and Thriving" (CP 1508-I, Feb 2026) · Curriculum & Assessment
//   (Francis) Review 2025 · Children's Wellbeing & Schools Act 2026.

export const HISTORY_START = 2015;
export const BASE_YEAR = 2025;   // calibration / "today" — projection begins here
export const END_YEAR = 2040;

/** A central estimate with a plausible low/high band for Monte-Carlo. */
export interface Band { low: number; central: number; high: number; }
export const band = (low: number, central: number, high: number): Band => ({ low, central, high });

// ---------------------------------------------------------------------------
// Population constants (England, state-funded; approximate, mid-2020s)
// ---------------------------------------------------------------------------
export const POP = {
  pupils: 8.4,            // millions, state-funded school pupils (5-16)   [DfE SWC]
  disadvShare: 0.27,      // FSM-Ever6 share of pupils                     [DfE]
  ppPupils: 2.3,          // millions receiving Pupil Premium             [Commons Lib SN06700]
  under5Disadv: 0.40,     // millions disadvantaged under-5s (EYPP-relevant) [assumption from EYPP coverage]
  ehcpRefPop: 12.05,      // millions, 0-25 reference pop for EHCP prevalence (638.7k / 5.3%) [EES]
  // --- population-simulation denominators (each rate has its OWN correct base — see population.ts) ---
  cohortYearGroup: 0.60,  // millions, one school year-group (synthetic cohort) [ONS births ~0.59m 2023; DfE SWC 8.4m/~14 groups]
  childPop0to17: 13.6,    // millions, England 0-17 — denominator for the child-poverty rate [ONS MYE 2023; DWP HBAI cross-check ~4.2m at 31% AHC]
  youth16to24: 6.55,      // millions, England 16-24 — denominator for the NEET rate [ONS MYE 2023; DfE/ONS NEET ~0.87m at 13.3%]
  teachersFTE0: 468.0,    // '000 FTE teachers Nov 2024                    [DfE SWC 2024]
  paybillBn: 35.0,        // £bn approx teacher paybill                    [assumption / IFS]
  coreSchoolsBn: 65.0,    // £bn core schools budget 2025-26              [IFS SR 2025]
};

// ---------------------------------------------------------------------------
// Baseline state at BASE_YEAR (2025) — all SOURCED unless noted
// ---------------------------------------------------------------------------
export const BASELINE = {
  // equity (EPI months) — EPI Annual Report 2025
  // gapAge3 is the earliest modelled point: the gap is observable from age 3 and ~40% of the
  // age-16 gap is already set by age 5 (EPI). No single official "months at 3" series exists,
  // so 3.3 is an estimate anchored below the age-5 gap (4.7) — an assumption to test, not a fact.
  gapAge3: 3.3, gapKS4: 19.1, gapKS2: 10.0, gapReception: 4.7,
  // attainment levels (all / disadvantaged) — DfE EES KS4/KS2 2024-25, White Paper Annex
  attainment8: 46.0, attainment8Dis: 36.7,        // gap 15.5pts → dis 36.7
  grade5EM: 45.5, grade5EMDis: 25.8,              // gap 27.3pp (≈ ÷2)
  ks2RWM: 62.0, ks2RWMDis: 47.0,                  // 2024/25
  gld: 68.3, gldDis: 51.3,                        // EYFSP 2024/25, FSM gap 21.3pp→ all-vs-FSM 17.0pp
  // SEND — EES EHC plans 2025, IFS Green Budget ch.5
  ehcpPct: 5.3, senSupportPct: 14.2,
  highNeedsSpend: 12.0, highNeedsFunding: 11.1, highNeedsDeficitStock: 3.2,
  ehcpAttainment8: 14.2, tribunalAppeals: 25.0,   // '000 appeals/yr
  // system — DfE EES absence 2024/25, NFER 2025, IFS, EES NEET 2025
  absenceOverall: 6.63, persistentAbsence: 17.63, persistentAbsenceDis: 29.9, severeAbsence: 2.26,
  teacherShortfall: 6.5,    // '000 vs the 6,500 pledge gap (interpretation) [Full Fact / NFER]
  fundingPerPupil: 7100,    // £ real, blended primary/secondary 2024/25    [IFS]
  childPoverty: 31.0,       // % relative AHC                               [CPAG/DWP HBAI]
  neet: 13.3,               // % 16-24                                      [DfE/ONS 2025]
  // NEET composition, England 2025 (ONS Jan–Mar 2026 splits — 39% unemployed-active /
  // 28% inactive-health / 33% inactive-other — applied to the DfE England rate)
  // [ONS NEET bulletin May 2026; Resolution Foundation False Starts 2025]
  neetUnemployed: 5.19, neetInactiveHealth: 3.72, neetInactiveOther: 4.39,
};

// Conversion constants tying disadvantaged sub-levels to the stage gap (months).
// Computed exactly from BASELINE so the 2025 disadvantaged sub-levels reproduce to machine precision.
export const GAP_TO_LEVEL = {
  ks4A8: (BASELINE.attainment8 - BASELINE.attainment8Dis) / BASELINE.gapKS4,  // A8 pts per KS4 month
  ks4G5: (BASELINE.grade5EM - BASELINE.grade5EMDis) / BASELINE.gapKS4,         // grade5 pp per KS4 month
  ks2: (BASELINE.ks2RWM - BASELINE.ks2RWMDis) / BASELINE.gapKS2,               // KS2 RWM pp per KS2 month
  recep: (BASELINE.gld - BASELINE.gldDis) / BASELINE.gapReception,             // GLD pp per reception month
};

// ---------------------------------------------------------------------------
// Government target trajectories (SOURCED targets, shown as reference lines)
// White Paper "Every Child Achieving and Thriving" (CP 1508-I)
// ---------------------------------------------------------------------------
export const TARGETS = {
  attainment8: 50.0,        // national average A8
  gapKS4A8: 7.7,            // halve the 15.5pt A8 gap
  ks2RWM: 65.0,             // above 2019 peak
  gld: 75.0,                // by 2028
  absenceOverall: 5.85,     // by 2028/29
  ehcpPctGov: 4.7,          // government's optimistic 2034-35 path (IFS-disputed)
};

// ---------------------------------------------------------------------------
// Historical context series (HISTORY_START..BASE_YEAR-1). Approximate, for visual
// backdrop only (shaded "observed" region). NaN where assessments were cancelled
// (KS2 SATs 2020 & 2021). Calibrated to published endpoints. [EPI/DfE EES/IFS]
// ---------------------------------------------------------------------------
const N = Number.NaN;
export const HISTORY: Record<string, number[]> = {
  // 2015 .. 2024
  year:            [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024],
  gapKS4:          [18.3, 18.2, 18.1, 18.1, 18.1, 18.2, 18.5, 18.9, 19.2, 19.1],
  gapKS2:          [9.3,  9.3,  9.2,  9.2,  9.2,  9.4,  9.7,  10.1, 10.3, 10.0],
  gapAge3:         [3.1,  3.1,  3.2,  3.2,  3.2,  3.2,  3.3,  3.4,  3.3,  3.3],
  gapReception:    [4.5,  4.5,  4.6,  4.6,  4.6,  4.6,  4.6,  4.8,  4.6,  4.7],
  attainment8:     [46.4, 46.5, 46.6, 46.7, 46.7, 50.2, 50.9, 48.9, 45.9, 46.0],
  grade5EM:        [42.6, 42.9, 43.3, 43.4, 43.2, 49.9, 50.2, 46.2, 45.9, 45.5],
  ks2RWM:          [60,   61,   62,   64.6, 64.9, N,    N,    59.2, 60.7, 62.0],
  gld:             [66.3, 69.3, 70.7, 71.5, 71.8, N,    N,    65.2, 67.2, 68.3],
  absenceOverall:  [4.6,  4.6,  4.7,  4.7,  4.7,  4.7,  7.6,  7.4,  7.15, 6.63],
  persistentAbsence:[10.5,10.6, 10.8, 10.9, 10.9, 12.1, 22.5, 22.3, 19.2, 17.63],
  ehcpPct:         [2.8,  2.9,  3.1,  3.3,  3.6,  3.9,  4.3,  4.7,  4.8,  5.3],
  highNeedsDeficitStock:[0.0,0.2, 0.4,  0.7,  1.0,  1.3,  1.7,  2.2,  2.7,  3.2],
  neet:            [11.6, 11.1, 10.5, 10.8, 11.0, 11.6, 11.0, 11.7, 12.5, 13.0],
  childPoverty:    [29.0, 29.6, 30.3, 30.0, 31.0, 31.0, 27.0, 29.0, 30.5, 31.0],
};

// ---------------------------------------------------------------------------
// EFFECT-SIZE COEFFICIENTS. Channels grouped. Each Band is the *maximum* effect at
// full lever deployment; the engine applies diminishing returns + a lag. Confidence
// and the dominant citation are in the comment. Levers referenced by id (see levers.ts).
// ---------------------------------------------------------------------------
export interface ChannelParams {
  // KS4 disadvantage-gap reductions (months) at full lever, by lever id
  gapKS4: Record<string, Band>;
  // Age-3 development-gap reductions (months) at full lever (the earliest, fastest response)
  gapAge3: Record<string, Band>;
  // Reception-gap reductions (months) at full lever
  gapRecep: Record<string, Band>;
  // KS2-gap reductions (months) at full lever
  gapKS2: Record<string, Band>;
  // System attainment LEVEL lift (Attainment-8 points, all pupils) at full lever
  levelA8: Record<string, Band>;
  // KS2 RWM level lift (pp, all pupils)
  levelKS2: Record<string, Band>;
  // GLD level lift (pp, all pupils)
  levelGLD: Record<string, Band>;
  lag: Record<string, number>; // years to ~63% of effect (geometric kernel)
}

export const CH: ChannelParams = {
  // ---- KS4 disadvantage gap (months) — ATTENDANCE is the dominant lever (EPI 2025:
  // the entire post-2019 widening is absence-driven). All disadvantage-targeted. ----
  gapKS4: {
    attendance:    band(0.8, 1.8, 3.0),   // (acts via PA_dis in engine, not this map) [EPI]
    breakfast:     band(0.2, 0.5, 0.9),   // attendance + KS1 attainment, FSM-targeted [EEF Magic Breakfast]
    pupil_premium: band(0.0, 0.25, 0.7),  // ASSUMPTION: no robust £→gap elasticity; quality-moderated, weak [EEF/Gorard]
    fsm:           band(0.0, 0.3, 0.8),   // nutrition + PP trigger; newly-eligible only [IFS FSM pilot — optimistic ceiling]
    eypp:          band(0.1, 0.5, 1.1),   // disadvantage premium, lagged 11y [EEF EY; IFS]
    ey_quality:    band(0.2, 0.7, 1.4),   // quality effects (+5..+7mo) reach KS4 with 11y lag & fade-out [EEF EY]
    ey_access:     band(0.1, 0.4, 0.9),   // disadvantaged access; quantity effect (+3mo) only [EEF; Sutton Trust targeting]
    poverty_action:band(0.2, 0.6, 1.2),   // income → home env/attendance → gap [EPI mediation]
    teachers:      band(0.0, 0.2, 0.5),   // supply hardest in deprived schools [NFER/EPI workforce gap]
    rise:          band(0.0, 0.2, 0.5),   // targets stuck schools (disadv-skewed) [WP; London Challenge analogue]
    place_investment: band(0.1, 0.5, 1.1),// place-based investment closes the cold-spot residual [Local Trust ~7.5pp]
    // The 2026 area missions act mostly REGIONALLY (see regions.ts); their NATIONAL gap effect is small
    // because each touches a minority of pupils (NE ~4.6%; coastal pockets) [White Paper 2026; weak evidence].
    mission_ne:       band(0.0, 0.06, 0.15),
    mission_coastal:  band(0.0, 0.10, 0.25),
    tutoring:      band(0.1, 0.4, 0.9),   // disadvantage-targeted catch-up tutoring [EEF small-group +4mo; NTP]
  },
  // ---- Age-3 development gap (months). The EARLIEST modelled point: EY levers act here
  // first and fastest (the gap is observable from age 3; EPI). Effects are proportionally
  // largest here because intervention is earliest — the Heckman "front-load" logic. ----
  gapAge3: {
    ey_quality:    band(0.5, 1.2, 2.2),   // quality early education has its biggest, earliest effect here [EEF EY; EPPE/EPPSE]
    ey_access:     band(0.2, 0.7, 1.3),   // disadvantaged access at 2-3 (the equity entitlement) [Sutton Trust]
    eypp:          band(0.1, 0.5, 1.0),   // early disadvantage premium [IFS]
    poverty_action:band(0.1, 0.4, 0.9),   // income → home learning environment, the dominant early driver [EPI]
    send_early:    band(0.0, 0.2, 0.5),   // Family Hubs / 2½-yr review early identification & support [Best Start; NAO]
  },
  gapRecep: {
    ey_quality:    band(0.4, 1.1, 2.0),   // largest, soonest effect at age 5 [EEF; Best Start target GLD 75%]
    ey_access:     band(0.2, 0.6, 1.2),   // [Sutton Trust]
    eypp:          band(0.1, 0.4, 0.9),   // [IFS EYPP uplift]
    poverty_action:band(0.1, 0.4, 0.9),   // [EPI: 40% of KS4 gap set by age 5]
  },
  gapKS2: {
    // attendance & breakfast act on the KS2 gap ONLY via the absence term in engine.ts
    // (ABSENCE_TO_GAP_K2 · disadvantaged PA), to avoid double-counting — mirrors the KS4 design.
    pupil_premium: band(0.0, 0.20, 0.55),  // PP stronger at primary but weak evidence [Gorard 2022]
    ey_quality:    band(0.2, 0.6, 1.2),   // EY carryover, ~6y lag
    eypp:          band(0.1, 0.3, 0.7),
    poverty_action:band(0.1, 0.4, 0.8),
    rise:          band(0.0, 0.2, 0.4),
    reading:       band(0.1, 0.4, 0.9),   // reading/oracy/phonics CPD narrows the gap at primary [EEF]
  },
  // ---- System attainment LEVEL (all pupils). Teacher quality is the strong channel;
  // funding routed through teachers, NOT a direct £→outcome elasticity (NFER/IFS). ----
  levelA8: {
    teachers:      band(0.4, 1.2, 2.2),   // teacher quality/supply → 0.1-0.2 SD [Chetty/Hanushek; NFER]
    teacher_pay:   band(0.0, 0.4, 0.9),   // via retention/quality [NFER pay competitiveness]
    bursaries:     band(0.0, 0.3, 0.7),   // shortage-subject specialism [NFER +£5k→+15% trainees]
    attendance:    band(0.1, 0.6, 1.2),   // general absence reduction → attainment [DfE dose-response]
    curriculum:    band(-0.3, 0.4, 1.2),  // ASSUMPTION: un-evaluated, can be ±; effect from 2028 [Francis Review]
    rise:          band(0.0, 0.3, 0.7),   // ASSUMPTION [WP; analogue ~0.1-0.3 SD worst schools]
    breakfast:     band(0.0, 0.2, 0.5),   // KS1 attainment (low security, KS2 null) [EEF revised]
    reading:       band(0.0, 0.3, 0.8),   // reading/oracy CPD — acts now, not gated to 2028 [EEF +2-5mo]
    eal_support:   band(0.0, 0.4, 0.9),   // EAL/new-arrival catch-up — direct attainment, bypasses absence [EPI 2025 EAL]
    // school_funding has NO direct term — it acts via teacher capacity (WORK.fundingRecruitK) [IFS/NFER/Jackson: £→attainment ≈ 0]
  },
  levelKS2: {
    teachers:      band(0.5, 1.5, 3.0),   // pp at expected standard
    attendance:    band(0.2, 1.0, 2.2),
    curriculum:    band(-0.5, 0.6, 2.0),  // 2028 Francis refresh only (reading split out below)
    reading:       band(0.3, 1.2, 2.5),   // Reading Ambition / phonics 90% / Year-8 reading test [EEF +2-5mo]
    rise:          band(0.0, 0.5, 1.2),
    // school_funding acts via teacher capacity, not directly
  },
  levelGLD: {
    ey_quality:    band(1.0, 3.5, 6.5),   // GLD 68→75 target needs ~7pp [Best Start; EEF]
    ey_access:     band(0.3, 1.5, 3.0),
    eypp:          band(0.2, 1.0, 2.2),
    poverty_action:band(0.0, 0.6, 1.5),
  },
  // Lag (years to ~63% of full effect, geometric). Early years to KS4 is the long one.
  lag: {
    attendance: 2, breakfast: 1, pupil_premium: 2, fsm: 3, poverty_action: 3,
    teachers: 4, teacher_pay: 3, bursaries: 3, curriculum: 4, rise: 2, school_funding: 3,
    inclusion_fund: 3, send_early: 3, ehcp_reform: 2, high_needs: 1, reading: 2,
    place_investment: 3, tutoring: 1, eal_support: 2, care_support: 2, behaviour_support: 2,
    mission_ne: 5, mission_coastal: 5,
    send_pipeline: 3, camhs: 2, housing_instability: 2,
    youth_guarantee: 2, careers_gatsby: 3, apprenticeships: 3, post16_premium: 3,
    eypp: 6, ey_quality: 7, ey_access: 6,   // early-years channels are slow
  },
};

// Early-years → KS4 extra lag: EY levers act on reception fast (~2y) but on KS4 only
// after the cohort ages ~11 years. Modelled by a longer lag for the gapKS4 EY terms.
export const EY_KS4_LAG = 11;
export const EY_FADEOUT = band(0.4, 0.6, 0.8); // fraction of EY cognitive gain RETAINED to KS4 [IFS fade-out]

// ---------------------------------------------------------------------------
// SEND sub-model parameters
// ---------------------------------------------------------------------------
export const SEND = {
  noReformIncrementPP: band(0.26, 0.38, 0.52), // annual EHCP prevalence rise (pp) without reform near 2025 [EES ~+0.5pp/yr; IFS +8-11%/yr]
  prevCeiling: 7.9,                              // logistic ceiling on prevalence [IFS/gov 7.7% peak]
  inclusionMitigation: band(0.0, 0.35, 0.6),     // max fraction of increment removed by full inclusion+early SEND [ASSUMPTION; no published elasticity]
  reformDivertStart: 2030,                        // no EHCP support changes before Sept 2030 [WP]
  reformDivertMax: band(0.10, 0.22, 0.35),       // max annual prevalence reduction (pp) at full EHCP reform from 2029 [gov path 7.7→4.7]
  spendPerPrevalence: 12.0 / 5.3,                 // £bn per pp prevalence (linear) [IFS ~£12bn at 5.3%]
  substitutionSaving: band(0.0, 0.10, 0.20),     // independent→state placement saving as frac of spend [IFS £61.5k vs £24k]
  ehcpAttnInclusionGain: band(0.5, 1.5, 2.8),    // A8 gain for EHCP pupils from full inclusion+early [WP ~½ grade]
  ehcpAttnReformHarm: band(0.5, 2.0, 4.0),       // A8 loss for EHCP pupils if plans narrowed w/o inclusion [sector warning]
  tribunalReformRise: band(3, 9, 16),            // '000 extra appeals at full reform w/ low inclusion [Browne Jacobson trend]
  overrideEndYear: 2028,                          // DSG statutory override ends Mar 2028 [IFS Green Budget]
  insolvencyDeficit: 6.0,                         // £bn deficit stock at which mass council insolvency flagged [CCN]
};

// ---------------------------------------------------------------------------
// Attendance / NEET / poverty dynamics
// ---------------------------------------------------------------------------
export const SYS = {
  absenceReductionMax: band(0.6, 1.2, 1.9),  // pp overall-absence cut at full attendance+breakfast [DfE; WP -1.3pp target]
  paLeverage: 2.5,                            // persistent-absence moves ~2.5x overall absence [DfE EES ratios]
  paDisLeverage: 1.3,                         // disadvantaged PA more sensitive
  severeDrift: 0.05,                          // pp/yr severe absence keeps rising w/o intensive support [DfE — diverging tail]
  severeMentorCut: band(0.3, 0.8, 1.5),       // pp cut at full mentor coverage [DfE mentor pilot, haircut]
  // reduced from (0.15, 0.35, 0.6) when NEETPIPE.absenceK was added — overlap haircut,
  // since absence now acts on NEET both via attainment and via the direct pipeline term
  neetPerA8: band(0.10, 0.25, 0.45),          // pp NEET fall per +1 A8 point [EPI: unqualified ~2x NEET]
  youthIllHealthDrift: band(0.05, 0.20, 0.40),// pp/yr exogenous NEET rise (mental health) [Milburn 2026: →1.25m]
  povertyActionMax: band(1.5, 3.5, 5.0),      // pp child-poverty cut at full anti-poverty effort [Child Poverty Strategy 550k≈3.7pp]
  fsmPovertyCut: band(0.3, 0.7, 1.2),         // pp from FSM expansion [DfE ~100k, take-up-discounted]
  povertyDrift: 0.20,                          // pp/yr baseline rise (two-child limit etc.) [CPAG trend]
  povertyToGapDrift: 0.10,                     // months/yr KS4 gap drift per +1pp poverty above baseline [ASSUMPTION, mediated]
};

// ---------------------------------------------------------------------------
// Post-16 / skills / youth mental health (the NEET exit boundary — the Milburn review)
// ---------------------------------------------------------------------------
export const POST16 = {
  // post16_skills RE-SCOPED 2026-06: the Youth Guarantee and apprenticeships are now
  // their own levers (below), so this is T/V-levels + Skills England + study-programme
  // quality only — reduced from (0.5, 1.2, 2.2) to avoid double-counting.
  neetMax: band(0.3, 0.8, 1.5),          // [DfE Post-16 White Paper 2025]
  // youth mental-health support: Milburn 2026 finds inactivity is now health/mental-health-driven
  mhNeetMax: band(0.4, 1.0, 1.8),        // pp NEET reduction at full mental-health support
  mhDriftMitig: band(0.3, 0.55, 0.8),    // fraction of the exogenous youth-ill-health NEET drift removed
  mhSevereMax: band(0.2, 0.6, 1.2),      // pp severe-absence cut at full MH support [mental ill-health drives severe absence]
  // ---- 2026-06 NEET levers (effects land on segments — see engine.ts) ----
  youthGuaranteeMax: band(0.3, 0.8, 1.5),   // pp off unemployed-NEET at full rollout [Youth Contract keyworker ≈+1.8pp re-engagement; £820m + 18–24 Jobs Guarantee; confidence low–medium]
  careersMax: band(0.2, 0.7, 1.4),          // pp off NEET inflow at full Gatsby coverage [CEC/Gatsby: −8% NEET likelihood, −20% in disadvantaged schools — CORRELATIONAL]
  apprenticeshipsMax: band(0.2, 0.8, 1.8),  // pp off unemployed-NEET at full 16–24 start recovery [YFF toolkit: high impact / LOW evidence security — deliberately wide]
  post16PremiumMax: band(0.1, 0.5, 1.0),    // pp off NEET (U+O) via post-16 retention [EPI 16–19 premium proposal; no causal estimate exists]
};

// ---------------------------------------------------------------------------
// NEET segment dynamics. The single NEET scalar is decomposed into three stocks
// with different drivers and stickiness [ONS May 2026; Milburn interim 2026;
// Resolution Foundation False Starts 2025 / Lost in Transition 2026].
// ---------------------------------------------------------------------------
export const NEETSEG = {
  // share of the attainment elasticity (SYS.neetPerA8) landing on each segment —
  // qualifications move employability (U) most, health-driven inactivity least
  a8Share: { unemployed: 0.6, other: 0.3, health: 0.1 },
  // share of the upstream pipeline pressure landing on each segment
  pipeShare: { unemployed: 0.45, other: 0.35, health: 0.20 },
  // health-segment stickiness: 8 in 10 health-inactive NEETs are still NEET 2+ yrs
  // later (Milburn) — modelled as a slower lever response on that stock
  healthLag: 4,
  // ---- persistence (the long-term-NEET stock) ----
  // Annual P(still NEET next year) per segment. Health calibrated to Milburn's 8-in-10
  // over 2+ years (√0.8 ≈ 0.89, haircut for measurement); unemployed churns cyclically;
  // 6 in 10 NEETs have never worked (up from 4 in 10 in 2005) — persistence is the story.
  persist: {
    unemployed: band(0.30, 0.40, 0.50),
    health: band(0.78, 0.86, 0.93),
    other: band(0.50, 0.60, 0.70),
  },
  // re-engagement levers act on the EXISTING stock, not just inflow:
  persistCutU: band(0.05, 0.12, 0.22),   // absolute cut in unemployed persistence at full Youth/Jobs Guarantee [Youth Contract keyworker model]
  persistCutIH: band(0.03, 0.08, 0.15),  // absolute cut in health persistence at full MH+CAMHS [ASSUMPTION — no UK estimate exists]
};

// Upstream pipeline pressure: pp of headline NEET per unit deviation of the modelled
// mediators, derived from DfE "Risk factors for becoming NEET" (May 2026) relative
// risks (persistent absence 3.9×; EHCP ~⅓ NEET at 17–19; FSM/poverty ~2×) scaled by
// cohort shares. ASSOCIATIONAL, not causal — confidence: medium. Acts with the
// stock-turnover lag (school cohorts age into the 16–24 stock gradually).
export const NEETPIPE = {
  absenceK: band(0.05, 0.11, 0.20),   // pp NEET per pp disadvantaged persistent absence above 29.9
  povertyK: band(0.02, 0.05, 0.10),   // pp NEET per pp child poverty above 31.0
  ehcpK:    band(0.10, 0.30, 0.60),   // pp NEET per pp EHCP prevalence above 5.3 (composition pressure)
  lag: 4,                              // years for school-cohort pressure to propagate into the 16–24 stock
};

// ---------------------------------------------------------------------------
// WIDER DETERMINANTS & SERVICES — indirect drivers that act THROUGH the model's
// mediators (per the indirect-impacts research). Effects are deviations from each
// lever's baseline, so the 2025 anchor is unchanged. Most are flagged ASSUMPTION:
// the evidence gives direction/UK magnitudes but rarely a clean policy elasticity.
// ---------------------------------------------------------------------------
export const IND = {
  // SEND specialist-capacity throttle (EP/SALT/OT) — the provision side of the SEND mediator
  pipelineEhcpAttn: band(0.5, 1.4, 2.6),     // A8 boost for EHCP pupils from adequate specialist provision [NAO/BPS/RCSLT]
  pipelineTribunal: band(2.0, 6.0, 11.0),    // '000 tribunal appeals cut at full capacity (needs met → fewer appeals)
  pipelinePA: band(0.2, 0.6, 1.2),           // pp disadvantaged-PA cut (supported SEND pupils attend more)
  pipelineSubSaving: band(0.0, 0.06, 0.14),  // extra high-needs deficit saving via better-targeted provision
  // CAMHS / NHS mental-health access — gate on absence + SEMH demand (complements school mental_health)
  camhsSevere: band(0.1, 0.4, 0.9),          // pp severe-absence cut [BMA 385k waiting; EBSA]
  camhsNeet: band(0.1, 0.3, 0.7),            // pp NEET cut
  camhsDemandDamp: band(0.0, 0.08, 0.18),    // fraction of the SEMH EHCP-demand increment damped
  // EAL / recent-arrival catch-up support — direct to attainment, NOT via absence
  // (effect lives in CH.levelA8.eal_support); flagged here for provenance only [EPI 2025 EAL]
  // Care-experienced support (virtual schools / Pupil Premium Plus) — vulnerable stratum
  careNeet: band(0.3, 0.9, 1.8),             // pp NEET cut (LAC ~38-40% NEET vs ~13-15%) [EPI/DfE EES]
  careA8: band(0.0, 0.4, 0.9),               // A8 boost for vulnerable pupils
  careSubSaving: band(0.0, 0.0, 0.02),       // tiny coordination saving only — care support is NOT a placement-substitution story
  // Inclusion & behaviour support — cut the exclusion/off-rolling → AP → NEET pipeline
  behaviourNeet: band(0.2, 0.6, 1.2),        // pp NEET cut [DfE: 15% of excluded pupils NEET 2+ yrs vs 3%]
  behaviourSevere: band(0.1, 0.3, 0.7),      // pp severe-absence cut
  // Housing instability — an exogenous inflow to disadvantaged persistent absence
  housingPA: band(2.0, 5.0, 9.0),            // pp disadvantaged-PA swing across the full instability range [UCL/MCS +15.5 days]
  housingGap: band(0.0, 0.15, 0.4),          // small extra months KS4 gap (home environment) per full swing
  // Place-based investment teacher-supply boost (cold-spot residual; gap effect is in CH.gapKS4)
  placeNeet: band(0.1, 0.4, 0.9),            // pp NEET cut from place-based regeneration/cold-spot investment
};

// ---------------------------------------------------------------------------
// SEND/EHCP identification-by-age (a costing scale with a light outcome effect)
// ---------------------------------------------------------------------------
export const AGEID = {
  sendPrevalence: 0.20,                       // ~19.6% of pupils have identified SEN [DfE EES]
  earlyShiftEhcpAttn: band(0.0, 1.2, 2.6),    // A8 boost to EHCP pupils when identification is front-loaded
  earlyShiftPrevention: band(0.0, 0.06, 0.14),// pp/yr long-run EHCP-increment reduction at full front-loading (prevention)
  earlyShiftShortRunBump: band(0.0, 0.08, 0.18), // pp short-run EHCP-increment rise (more children flagged early)
};

// ---------------------------------------------------------------------------
// Workforce dynamics
// ---------------------------------------------------------------------------
export const WORK = {
  baseAttritionK: 1.0,                      // '000/yr net loss absent new recruitment effort [NFER 9.6% leaving]
  recruitPayMult: band(0.0, 0.2, 0.5),      // extra k/yr recruitment per +1%/yr real pay [NFER directional]
  recruitBursaryMult: band(0.0, 0.4, 0.9),  // bursary contribution to recruitment [NFER +£5k→+15%]
  fundingRecruitK: band(0.0, 0.25, 0.5),    // extra '000 net teachers/yr per +1%/yr real core funding (posts/TAs/retention) [ASSUMPTION — the funding→capacity channel]
  shortfallToCapacity: 13.0,                // shortfall ('000) mapping to a full unit of teacher-capacity index
};

// ---------------------------------------------------------------------------
// COSTS — £bn additional annual cost vs baseline, per unit of lever. Used by the
// cost-accounting block. Sourced unit costs where available.
// ---------------------------------------------------------------------------
export const COST = {
  ppPerPound: POP.ppPupils * 1e6 / 1e9,      // £bn per £1/pupil over 2.3m pupils
  eyppPerPound: POP.under5Disadv * 1e6 / 1e9,// £bn per £1/child over 0.4m
  fsmFullBn: 1.0,                             // £bn at "all UC" (index 60) [IFS ~£1bn long-run]
  fsmUniversalBn: 1.8,                        // £bn at universal (index 100)
  breakfastFullBn: 0.40,                      // £bn universal primary breakfast [gov £80m start → ~£0.4bn full]
  povertyActionFullBn: 4.0,                   // £bn full anti-poverty (two-child limit ~£3.5bn + UC) [CPAG/IFS]
  teacherPerK: 0.060,                         // £bn per 1,000 teachers (≈£60k loaded) [EEF £45,352 + on-costs]
  payPerPctBn: 0.35,                          // £bn per +1% paybill
  bursaryFullBn: 0.30,                        // £bn full shortage-subject bursaries
  inclusionDirect: 1.0,                       // inclusion_fund lever is already £bn/yr (×1)
  sendEarlyFullBn: 0.50,                      // £bn full early-SEND intervention
  highNeedsPerPctBn: POP.coreSchoolsBn * 0 + 0.11, // £bn per +1%/yr on ~£11bn high-needs
  eyQualityFullBn: 2.0,                       // £bn full EY quality uplift [IFS EY funding gap]
  eyAccessFullBn: 1.2,                        // £bn full disadvantaged EY access
  curriculumImplBn: 0.15,                     // £bn implementation
  riseFullBn: 0.10,                           // £bn full RISE coverage [gov £20m+ scaled]
  attendanceFullBn: 0.10,                     // £bn full mentor coverage [gov £15m/3yr scaled]
  fundingPerPctBn: 0.65,                      // £bn per +1%/yr core schools funding
  post16FullBn: 1.0,                          // £bn full post-16/skills effort (re-scoped: YG/apprenticeships split out)
  mentalHealthFullBn: 0.6,                    // £bn full youth mental-health support
  youthGuaranteeFullBn: 1.2,                  // £bn/yr full Youth+Jobs Guarantee (£820m/3yr + £1bn 18–24 expansion ≈ £1.2bn/yr at scale) [Commons Library CBP-10827]
  careersFullBn: 0.3,                         // £bn full Gatsby-benchmark careers infrastructure (CEC scale-up)
  apprenticeshipsFullBn: 1.0,                 // £bn full 16–24 start recovery (SME full funding + levy reform headroom)
  post16PremiumPerPound: 0.43e6 / 1e9,        // £bn per £1/student over ~0.43m disadvantaged 16–18s [IFS/EPI]
  readingFullBn: 0.15,                        // £bn full reading/oracy CPD programme [Reading Ambition]
  // wider determinants & services
  sendPipelineFullBn: 0.6,                    // £bn full EP/SALT/OT specialist-capacity expansion
  camhsFullBn: 0.7,                           // £bn full CAMHS access expansion
  ealSupportFullBn: 0.3,                      // £bn full EAL/new-arrival catch-up support
  careSupportFullBn: 0.4,                     // £bn full care-experienced support (virtual schools / PP+)
  placeInvestFullBn: 0.8,                     // £bn full place-based investment (cold-spot residual)
  // area missions — no budget published; illustrative London-Challenge-scale (~£40m/yr) place-based cost [ASSUMPTION]
  missionNeFullBn: 0.15,
  missionCoastalFullBn: 0.2,
  behaviourFullBn: 0.3,                       // £bn full inclusion & behaviour support
  tutoringFullBn: 0.5,                        // £bn full catch-up tutoring programme [NTP-scale]
  // housing_instability has no education-budget cost (an exogenous context slider)
};
