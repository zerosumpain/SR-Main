/**
 * What a build actually ended as, kept separate from the coarse `status`.
 *
 * `status` is free text with ten non-test consumers, and several of them really
 * mean "is this terminal?" — BuildDetailV2, cockpit-metrics, BuildPill,
 * followup.ts. Introducing `capped` or `stopped` as statuses would have made a
 * capped-out build read as still running in every one of them. So the outcome
 * rides its own nullable column and `status` keeps the meaning it already had:
 * the same split the `failure` envelope uses to say *why* a build failed
 * without changing what `failed` means.
 *
 * The bucket lives here rather than in BuildsListV2 because a function inside a
 * .svelte file cannot be unit-tested, and its old last line — `return
 * 'completed'` for anything unrecognised — quietly filed all 8 `cancelled`
 * builds as successes. An unknown status must be visible, not flattering.
 *
 * Pure module, no imports: anything reaching `$lib/workflows` boots WhatsApp
 * for real under vitest. Same reason as lane-stats.ts.
 */

/** Why a build stopped. Null on rows written before this column existed. */
export type BuildOutcome =
  "delivered" | "budget_cap" | "stopped_by_user" | "registered";

export const BUILD_OUTCOMES: readonly BuildOutcome[] = [
  "delivered",
  "budget_cap",
  "stopped_by_user",
  "registered",
] as const;

export function isBuildOutcome(value: unknown): value is BuildOutcome {
  return (
    typeof value === "string" &&
    (BUILD_OUTCOMES as readonly string[]).includes(value)
  );
}

export type BuildBucket =
  | "running"
  | "queued"
  | "paused"
  | "awaiting"
  | "failed"
  | "delivered"
  | "capped"
  | "stopped"
  | "registered"
  | "unknown";

export interface BucketInput {
  status: string;
  planStatus?: string | null;
  outcome?: string | null;
}

/**
 * Ordering is load-bearing and matches the original: the awaiting test runs
 * before the terminal ones, because `planStatus === 'pending'` outranks a
 * status of `completed` on a build whose plan is still waiting on approval.
 */
export function bucketOf(b: BucketInput): BuildBucket {
  if (b.status === "running") return "running";
  if (b.status === "queued" || b.status === "pending") return "queued";
  if (b.status === "paused") return "paused";
  if (
    b.status === "awaiting_plan_approval" ||
    b.status === "awaiting_iter_approval" ||
    b.planStatus === "pending"
  ) {
    return "awaiting";
  }
  if (b.status === "failed") return "failed";
  // A hand-kill before the row ever reached `completed`. Same thing to a
  // reader as `stopped_by_user`, so it lands in the same bucket.
  if (b.status === "cancelled") return "stopped";
  if (b.status === "completed") {
    if (b.outcome === "budget_cap") return "capped";
    if (b.outcome === "stopped_by_user") return "stopped";
    if (b.outcome === "registered") return "registered";
    // Null outcome is a row written before the column existed, or one an
    // operator set by hand. Reading it as delivered is the conservative
    // choice: it can only overstate delivery, never invent a cap-out.
    return "delivered";
  }
  return "unknown";
}

/** Only these count as the builder having produced the thing that was asked for. */
export function isDelivered(b: BucketInput): boolean {
  return bucketOf(b) === "delivered";
}

const LABELS: Record<BuildBucket, string> = {
  running: "Running",
  queued: "Queued",
  paused: "Paused",
  awaiting: "Awaiting",
  failed: "Failed",
  delivered: "Delivered",
  capped: "Hit cap",
  stopped: "Stopped",
  registered: "Registered",
  unknown: "Unknown",
};

export function bucketLabel(bucket: BuildBucket): string {
  return LABELS[bucket];
}

/** One line explaining a non-delivered ending, for the row that shows it. */
export function outcomeNote(bucket: BuildBucket): string | null {
  if (bucket === "capped")
    return "Stopped on its budget, not because the work was done";
  if (bucket === "stopped") return "Stopped by hand";
  if (bucket === "registered") return "Filed by Hermes — the builder never ran";
  if (bucket === "unknown") return "Unrecognised status";
  return null;
}
