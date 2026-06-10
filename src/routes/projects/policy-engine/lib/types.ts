// types.ts — domain types for "The Whitehall Model", an England education-policy
// simulation engine. Self-contained: never imported from outside this route folder.
//
// The model is a system-dynamics + cohort-projection hybrid. Each annual step applies
// research-calibrated response functions (elasticities with diminishing returns and
// distributed lags) to a small set of state variables, mediated through a causal spine
// in which ATTENDANCE is the central hub (disadvantage & SEND raise absence; absence
// lowers attainment; attainment lowers NEET; early-years investment sets the gap with a
// long lag). Every parameter carries a source + confidence; see params.ts.

export type LeverId = string;
export type OutcomeId = string;
export type Confidence = 'high' | 'medium' | 'low' | 'assumption';
export type LeverGroup =
  | 'early'        // early years & childcare
  | 'disadvantage' // pupil premium, FSM, breakfast clubs, child poverty
  | 'send'         // SEND / EHCP reform
  | 'workforce'    // teachers
  | 'standards'    // curriculum, accountability, RISE
  | 'attendance'   // attendance support
  | 'post16'       // post-16 / skills / youth mental health (the NEET exit boundary)
  | 'identification' // SEND/EHCP identification intensity by child age (costing scale)
  | 'indirect'     // wider determinants & services that act through the mediators
  | 'macro';       // school funding trajectory

/** A policy lever the user can move. Its value feeds the engine's response functions. */
export interface LeverDef {
  id: LeverId;
  group: LeverGroup;
  label: string;
  /** Short unit shown next to the value, e.g. '£/pupil', '%', 'k/yr'. */
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Status-quo / "do nothing new" value — the baseline scenario sits here. */
  baseline: number;
  /** The value representing the policy as actually announced/funded (used by presets & annotations). */
  policy: number;
  /** Optional formatter for display. */
  format?: (v: number) => string;
  /** One-line plain-English description of what the lever does. */
  blurb: string;
  /** What the evidence says about its effect — shown in the tooltip. */
  evidence: string;
  /** Citation string (source name) and URL. */
  source: string;
  url?: string;
  confidence: Confidence;
  /** Which real policy / Act / white paper this lever represents. */
  policyRef: string;
}

/** A lever configuration: id -> value. */
export type LeverState = Record<LeverId, number>;

/** Everything the engine produces for a single simulated year. */
export interface YearResult {
  year: number;
  isProjection: boolean; // true for years after the base year (2025)

  // --- Equity: the disadvantage attainment gap, in EPI "months of learning" ---
  gapReception: number; // age 5 (GLD-derived)
  gapKS2: number;       // age 11
  gapKS4: number;       // age 16 (headline)

  // --- Attainment levels (all pupils / disadvantaged pupils) ---
  gld: number; gldDis: number;             // % good level of development (age 5)
  ks2RWM: number; ks2RWMDis: number;       // % reaching expected standard reading+writing+maths
  attainment8: number; attainment8Dis: number; // Attainment 8 score (0-90)
  grade5EM: number; grade5EMDis: number;   // % achieving grade 5+ in English & maths

  // --- SEND sub-system ---
  ehcpCount: number;       // number of EHC plans (England)
  ehcpPct: number;         // % of pupils with an EHCP
  senSupportPct: number;   // % of pupils on SEN support
  highNeedsSpend: number;  // £bn annual high-needs spend
  highNeedsDeficitStock: number; // cumulative DSG high-needs deficit, £bn
  ehcpAttainment8: number; // Attainment 8 for EHCP pupils (outcome of provision adequacy)
  tribunalAppeals: number; // SEND tribunal appeals per year (000s)
  insolvencyRisk: boolean; // DSG override has ended and deficit breaches the insolvency threshold

  // --- System health ---
  absenceOverall: number;       // overall absence rate %
  persistentAbsence: number;    // % persistently absent (all)
  persistentAbsenceDis: number; // % persistently absent (disadvantaged)
  severeAbsence: number;        // % severely absent
  teacherShortfall: number;     // FTE shortfall vs need (000s); negative = surplus
  teachersFTE: number;          // total teacher FTE (000s)
  fundingPerPupil: number;      // real-terms £ per pupil (2025 prices)
  childPoverty: number;         // % children in relative poverty (AHC)
  neet: number;                 // % NEET 16-24 (headline = sum of the three segments)
  neetUnemployed: number;       // % 16-24, unemployed-active segment (cyclical)
  neetInactiveHealth: number;   // % 16-24, inactive-health segment (sticky; the Milburn fault line)
  neetInactiveOther: number;    // % 16-24, inactive-other segment (caring / discouraged)

  // --- Money ---
  annualCost: number;     // £bn additional annual programme cost vs baseline
  cumulativeCost: number; // £bn cumulative since base year
}

export interface SimResult {
  years: YearResult[];
  baseYear: number;
  endYear: number;
}

/** A P10/P50/P90 fan for one outcome across the timeline (Monte-Carlo output). */
export interface BandedSeries {
  years: number[];
  p10: number[];
  p50: number[];
  p90: number[];
}

export interface MonteCarloResult {
  draws: number;
  /** Keyed by a subset of YearResult numeric fields. */
  bands: Record<string, BandedSeries>;
}

/** One bar of the sensitivity (tornado) chart: how much a lever swing moves a KPI. */
export interface SensitivityBar {
  leverId: LeverId;
  label: string;
  low: number;    // KPI value at lever min
  high: number;   // KPI value at lever max
  baseline: number; // KPI value at current scenario
  swing: number;  // |high - low|
}

/** A saved scenario (mirrors data-convergence's store pattern). */
export interface Scenario {
  id: string;
  name: string;
  description?: string;
  levers: LeverState;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioStore {
  activeId: string;
  scenarios: Scenario[];
}

/** Outcomes selectable as the focus KPI for the scorecard & sensitivity chart. */
export interface OutcomeMeta {
  id: keyof YearResult & string;
  label: string;
  short: string;
  unit: string;
  /** true if higher is better (drives colour-coding). */
  goodIfUp: boolean;
  /** number of decimals to show. */
  dp: number;
  group: 'equity' | 'attainment' | 'send' | 'system' | 'money';
  blurb: string;
}
