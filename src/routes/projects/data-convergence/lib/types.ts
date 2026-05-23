// Types for the Data Convergence Timeline ("the Spine"). V2.
// Self-contained — never imported from outside this route folder.

export type ID = string;

/** Cadence categories — used to choose oscillation period for the source bar
 *  and the visual rhythm for reference-data ticks. */
export type Cadence =
  | 'daily'
  | 'termly'      // ~3× a year
  | 'annual'
  | 'biannual'
  | 'adhoc'
  | 'continuous'; // reference data — semi-regular metadata feed

export interface StrandConfig {
  id: ID;
  name: string;
  colour: string;
  startDate: string;
  mergeDate: string;
  mergeInto: ID | 'spine';
  users: number;
  cadence: Cadence;
  outputs?: ID[];
  isReference?: boolean;
  /** Per-row visibility — filtered out of the renderer when false. */
  visible?: boolean;
  /** This dataset's *schema*. Each of the ~10 sources has its own — that
   *  separateness is the whole reason converging them is hard. We surface
   *  the field list in the tooltip and config to reinforce the point. */
  schema?: string[];
}

/** A consuming "business activity" — analyses, funding rounds, dashboards.
 *  Rendered as a labelled circle off the spine, connected by a curve to each
 *  contributing source (or to the spine when that source has merged in). */
export interface OutputConfig {
  id: ID;
  name: string;
  colour: string;
  side?: 'above' | 'below';
  anchorDate?: string;
  visible?: boolean;
}

/** A named scenario — full config snapshot, plus metadata. */
export interface Scenario {
  id: ID;
  name: string;
  description?: string;
  strands: StrandConfig[];
  outputs: OutputConfig[];
  createdAt: string;
  updatedAt: string;
}

/** The bundle persisted to localStorage — multiple scenarios + which one is active. */
export interface ScenarioStore {
  activeId: ID;
  scenarios: Scenario[];
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
  strandId?: ID;
  outputId?: ID;
}

export interface LayoutNode {
  id: ID | 'spine';
  parent: ID | 'spine' | null;
  children: ID[];
  offsetFromParent: number;
  subtreeWeight: number;
}

export interface ResolvedStrand extends StrandConfig {
  startMs: number;
  mergeMs: number;
  /** Approximate collections per day, derived from cadence. */
  freqPerDay: number;
  /** Path to spine: this id, parent, …, 'spine'. */
  ancestry: (ID | 'spine')[];
  /** Vertical offset from spine at the strand's birth (raw, pre-yScale). */
  birthOffset: number;
  thickness: number;
}

export interface ResolvedOutput extends OutputConfig {
  /** Resolved IDs (filtered against the strand set so errors don't crash render). */
  sourceIds: ID[];
  /** Resolved side. */
  resolvedSide: 'above' | 'below';
  /** Time anchor in ms. */
  anchorMs: number;
}

export interface ResolvedModel {
  strands: ResolvedStrand[];
  outputs: ResolvedOutput[];
  layout: Map<ID | 'spine', LayoutNode>;
  tStart: number;
  tEnd: number;
  spineMaxThickness: number;
  issues: ValidationIssue[];
}

/** Zoom presets — calibrated so the spine has a clean visual rhythm per view. */
export type ZoomLevel = '6m' | '1y' | '10y' | 'adult';

export const ZOOM_SPECS: Record<ZoomLevel, {
  /** Total visible span, in milliseconds. */
  spanMs: number;
  /** How many oscillations of the spine bar across the visible span. */
  oscCount: number;
  /** Short label shown in the UI. */
  label: string;
  /** Long-form description for the tooltip. */
  desc: string;
}> = {
  '6m':    { spanMs: 1000 * 60 * 60 * 24 * 182,        oscCount: 182, label: '6 months', desc: 'Each oscillation = 1 day' },
  '1y':    { spanMs: 1000 * 60 * 60 * 24 * 365,        oscCount: 52,  label: '1 year',   desc: 'Each oscillation = 1 week' },
  '10y':   { spanMs: 1000 * 60 * 60 * 24 * 365 * 10,   oscCount: 120, label: '10 years', desc: 'Each oscillation = 1 month' },
  'adult': { spanMs: 1000 * 60 * 60 * 24 * 365 * 80,   oscCount: 80,  label: 'Lifetime', desc: 'Each oscillation = 1 year' },
};
