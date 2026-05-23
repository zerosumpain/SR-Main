// Types for the Data Convergence Timeline ("the Spine").
// Self-contained — never imported from outside this route folder.

export type ID = string;

export interface StrandConfig {
  id: ID;
  name: string;
  colour: string;            // hex string, e.g. "#b95431"
  startDate: string;         // ISO date or date-time
  mergeDate: string;         // ISO date or date-time
  mergeInto: ID | 'spine';   // target id or the literal "spine"
  users: number;             // drives thickness
  frequency: number;         // collections per period
  frequencyPeriod: 'day' | 'week' | 'month' | 'quarter';
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
  strandId?: ID;
}

export interface LayoutNode {
  id: ID | 'spine';
  parent: ID | 'spine' | null;       // null => the spine has no parent
  children: ID[];                    // direct merge children, in render order
  offsetFromParent: number;          // px above/below the parent centreline at strand birth
  subtreeWeight: number;             // total users carried by this subtree (incl. self)
}

export interface ResolvedStrand extends StrandConfig {
  startMs: number;
  mergeMs: number;
  /** Collections per day (normalised). Drives oscillation frequency. */
  freqPerDay: number;
  /** Path to spine: this id, parent, grandparent, ... 'spine'. */
  ancestry: (ID | 'spine')[];
  /** Vertical offset from spine at the strand's birth (px). */
  birthOffset: number;
  /** Effective thickness in px once user-scale is applied (own contribution only). */
  thickness: number;
}

export interface ResolvedModel {
  strands: ResolvedStrand[];
  layout: Map<ID | 'spine', LayoutNode>;
  /** Earliest start across all strands (ms). */
  tStart: number;
  /** Latest merge across all strands (ms) — visual end-of-history. */
  tEnd: number;
  /** Highest thickness sum the spine ever reaches (px). */
  spineMaxThickness: number;
  issues: ValidationIssue[];
}
