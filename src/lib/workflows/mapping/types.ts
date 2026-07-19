// Edge auto-mapping — shared types. Isomorphic (client + server); no DB/LLM here.
//
// When node A is connected to node B, a "mapping proposal" describes how A's
// output should flow into B, as a list of user-approvable actions. The same
// compatibility primitives also validate whole auto-generated workflows.

/** A single thing the assistant proposes to do to the TARGET node. */
export interface MappingAction {
  /**
   * - `set-config`: set `field` on the target node's config to `value`
   *   (value may contain {{input.*}} templates). These are the auto-appliable
   *   actions — merged into the target config on "Apply".
   * - `insert-node`: advisory — suggests inserting an intermediate node
   *   (e.g. a `transform`) between source and target. NOT auto-applied in v1.
   * - `note`: advisory guidance with no config change.
   */
  kind: 'set-config' | 'insert-node' | 'note';
  /** Human-readable label for the action (shown in the checklist). */
  label: string;
  /** One-line rationale for why this action helps. */
  detail?: string;
  // set-config
  field?: string;
  value?: unknown;
  // insert-node (advisory)
  nodeType?: string;
  nodeConfig?: Record<string, unknown>;
  /** true when a set-config value references an {{input.*}} path the upstream is not known to emit. */
  unverifiedRef?: boolean;
}

export type CompatibilityLevel = 'direct' | 'transform' | 'incompatible' | 'unknown';

/** Deterministic handle-kind compatibility between two node types. */
export interface CompatibilityReport {
  /** true when the source's output kinds and the target's input kinds intersect (or either is `any`). */
  kindMatch: boolean;
  level: CompatibilityLevel;
  /** Kinds emitted by the source's output handles. */
  outputKinds: string[];
  /** Kinds accepted by the target's input handles. */
  inputKinds: string[];
  reasons: string[];
}

/** The full proposal returned for one A→B connection. */
export interface EdgeMappingProposal {
  sourceNodeId: string;
  targetNodeId: string;
  sourceType: string;
  targetType: string;
  sourceLabel: string;
  targetLabel: string;
  compatibility: CompatibilityReport;
  actions: MappingAction[];
  /** Merged patch from every valid `set-config` action — apply this to the target config. */
  configPatch: Record<string, unknown>;
  rationale: string;
  /** 0..1 — the assistant's confidence in the mapping. */
  confidence: number;
  /** Where the proposal came from. */
  provenance: 'llm' | 'heuristic';
}

/** One issue from validating a whole workflow's edges (generator / batch use). */
export interface EdgeCompatibilityIssue {
  sourceNodeId: string;
  targetNodeId: string;
  sourceType: string;
  targetType: string;
  severity: 'error' | 'warning';
  issue: string;
}

/** Context handed to the deterministic + LLM proposers. */
export interface MappingContext {
  sourceType: string;
  targetType: string;
  sourceLabel: string;
  targetLabel: string;
  /** Current config of the target node (we only ever propose changes to the target). */
  targetConfig: Record<string, unknown>;
  /** Config keys the target understands (from its configSchema.properties). */
  targetConfigKeys: string[];
  /** Dot-paths the upstream is known to emit (schema + last-run sample), e.g. "json.company_number". */
  availablePaths: string[];
}
