// types.ts — the data model for Keystone, the DfE data-strategy workbench.
// A strategy-design workbench (not a numeric forecaster): the lead manipulates
// posture toggles + allocation sliders and a maturity self-assessment, and a
// deterministic, evidence-weighted rubric (engine.ts) scores how well the chosen
// strategy covers the pressures, advances maturity, and respects legal feasibility.

/** Where a pressure originates. */
export type Origin = 'cross-government' | 'dfe-policy' | 'partners';

/** The three layers of the data-sharing legal stack (mirrors data-standard-designer). */
export type LegalLayer = 'protection-basis' | 'legal-gateway' | 'governance';

/** Shared confidence taxonomy (matches the ConfidenceBadge component). */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'assumption' | 'contested';

export type FrameworkType = 'uk-gov' | 'corporate';

/** An investment / capability bucket — the join between pressures and levers. */
export interface CapabilityArea {
  id: string;
  name: string;
  short: string;
  description: string;
}

/** A strategic posture axis (a real tension), valued −1…+1 (0 = balanced). */
export interface PostureAxis {
  id: string;
  leftLabel: string;
  rightLabel: string;
  description: string;
  /** The tension this axis embodies (shown in tooltips / method). */
  tension: string;
  /** Effect on each capability area's effectiveness as the value moves toward +1
   *  (symmetric toward −1). Modest weights (±0.05…0.25). */
  affects: { area: string; weight: number }[];
  eli5?: string;
}

/** A pressure the strategy must answer to. */
export interface Pressure {
  id: string;
  title: string;
  origin: Origin;
  description: string;
  /** Capability area ids this pressure stresses. */
  demands: string[];
  severity: number; // 1–5: how consequential
  urgency: number; // 1–5: how soon
  sourceName?: string;
  sourceUrl?: string;
  confidence: ConfidenceLevel;
  /** Deep link into the policy-engine field study that evidences this pressure. */
  policyEngineRef?: { label: string; href: string };
  eli5?: string;
}

/** A data-maturity dimension (Data Maturity Assessment for Government). */
export interface MaturityDimension {
  id: string;
  name: string;
  description: string;
  /** Capability areas that drive progress on this dimension. */
  areas: string[];
  govSource?: string;
  corporateCrosswalk?: string;
}

/** A legal instrument / gateway in the registry. */
export interface Legislation {
  id: string;
  name: string;
  citation?: string;
  layer: LegalLayer;
  summary: string;
  relevance: string;
  sourceUrl?: string;
}

/** A data-strategy framework (UK-gov or corporate). */
export interface Framework {
  id: string;
  name: string;
  type: FrameworkType;
  summary: string;
  keyElements: string[];
  sourceUrl?: string;
  /** Sort key for date ordering (YYYY-MM of the current authoritative version). */
  date: string;
  /** Human-readable dating, incl. lineage (e.g. "2018 · renamed Dec 2025"). */
  dateLabel: string;
  /** How load-bearing for a DfE data strategy. */
  role?: 'foundational' | 'core' | 'specialist';
  /** 0–1 positioning weight (foundational ≈ 1, specialist ≈ 0.4). */
  weight?: number;
}

export interface SourceRef {
  org: string;
  what: string;
  url: string;
}

/** The full editable strategy state (persisted + permalinked). */
export interface StrategyState {
  postures: Record<string, number>; // axis id -> −1…1
  allocation: Record<string, number>; // area id -> 0…100 (relative effort)
  maturityCurrent: Record<string, number>; // dim id -> 1…5
  maturityTarget: Record<string, number>; // dim id -> 1…5
}

/** A flagged strategic tension. */
export interface Tension {
  id: string;
  title: string;
  severity: 'high' | 'medium' | 'low';
  explanation: string;
  resolution: string;
  triggers: string[];
  legalRefs?: string[];
}

/** A recommended-focus item (highest leverage gap). */
export interface FocusItem {
  kind: 'pressure' | 'maturity';
  id: string;
  title: string;
  reason: string;
  score: number;
}

export interface CoverageTraceTerm {
  area: string;
  cap: number;
  weight: number;
}

// ---- the commitments ledger (white-paper landscape) ----

/** The kind of source document a commitment comes from. */
export type DocType =
  | 'white-paper'
  | 'act'
  | 'bill'
  | 'strategy'
  | 'action-plan'
  | 'review'
  | 'consultation'
  | 'roadmap'
  | 'framework'
  | 'guidance'
  | 'blog'
  | 'evidence';

export type DocStatus = 'published' | 'enacted' | 'in-passage' | 'in-consultation' | 'announced';

/** What kind of data obligation a commitment creates. */
export type CommitmentTheme =
  | 'identifiers'
  | 'data-sharing'
  | 'new-service'
  | 'register'
  | 'standards'
  | 'ai'
  | 'analytics'
  | 'infrastructure'
  | 'safeguarding'
  | 'accountability'
  | 'workforce'
  | 'funding';

/** How hard the commitment binds. */
export type CommitmentStatus =
  | 'statutory-duty'
  | 'legislated-not-commenced'
  | 'in-delivery'
  | 'announced'
  | 'proposed'
  | 'consulting';

/** DfE's part in delivering the commitment. */
export type DfeRole = 'owner' | 'deliverer' | 'partner' | 'complier';

/** A white paper / act / strategy the ledger draws commitments from. */
export interface PolicyDocument {
  id: string;
  title: string;
  shortName: string;
  type: DocType;
  publisher: string;
  date: string; // YYYY-MM
  url: string;
  oneLiner: string;
  status: DocStatus;
}

/** A new flow of data between two organisations that a commitment creates. */
export interface DataFlow {
  from: string; // org id
  to: string; // org id
  what: string;
}

/** A government commitment with data implications DfE must deliver, support or comply with. */
export interface Commitment {
  id: string;
  docId: string;
  title: string;
  /** Plain-English: what has been committed to. */
  what: string;
  /** Short verbatim quote from the source (<30 words). */
  quote?: string;
  theme: CommitmentTheme;
  status: CommitmentStatus;
  timeframe?: string; // human-readable, e.g. 'from Sept 2026'
  timeframeDate?: string; // YYYY-MM, for the timeline
  dfeRole: DfeRole;
  /** The new data flows this creates (the "new connections between partners"). */
  flows: DataFlow[];
  newServices: string[];
  identifiers: string[];
  standards: string[];
  partners: string[];
  /** What a DfE data strategy must say or do because of this. */
  strategyImplication: string;
  eli5?: string;
  /** Capability areas (engine) this commitment demands. */
  capabilityIds: string[];
  /** Existing Keystone pressures this commitment evidences. */
  pressureIds?: string[];
  /** Match terms for the Author's coverage sweep. */
  aliases: string[];
  confidence: ConfidenceLevel;
  sourceUrls: string[];
}

/** An organisation node in the data-flow map. */
export interface Org {
  id: string;
  name: string;
  short: string;
  group: 'dfe' | 'alb' | 'delivery' | 'department' | 'centre' | 'public' | 'research';
  ring: 0 | 1 | 2 | 3;
  angle: number; // degrees, for the radial layout
}

/** The full output of the alignment engine. */
export interface AlignmentResult {
  capability: Record<string, number>; // area id -> 0…1 effective strength
  capabilityBase: Record<string, number>; // before posture modulation
  capabilityMult: Record<string, number>; // posture multiplier applied
  coverage: Record<string, number>; // pressure id -> 0…1
  coverageTrace: Record<string, CoverageTraceTerm[]>;
  overallCoverage: number; // 0…1 (severity-weighted)
  coverageByOrigin: Record<Origin, number>;
  maturityProgress: Record<string, number>; // dim id -> 0…1 toward target
  maturityProjected: Record<string, number>; // dim id -> projected level
  tensions: Tension[];
  legalImplicated: string[]; // legislation ids
  focus: FocusItem[];
}
