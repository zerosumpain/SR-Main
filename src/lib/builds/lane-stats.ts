/**
 * Success and iteration cost, split by the thing that actually predicts them.
 *
 * Across the first 83 production builds the lane changed median iterations to
 * success by roughly 10x (repo 1, app 4, studio 10) while success rate barely
 * moved — so the lane, not the model and not the prompt, is the number worth
 * watching. Nothing here existed before; every figure comes out of columns the
 * page already loads.
 *
 * Two counting traps this deliberately avoids:
 *
 *  - `git_target_config` holds JSON `null`, not SQL NULL, on most rows, so
 *    `IS NOT NULL` matches every build ever created. The lane is decided on
 *    `repoUrl` being present.
 *  - 24 of those 83 rows never ran an iteration — 15 are chat registrations
 *    that file `completed` before a file exists. Counting them inflated the
 *    success rate and dragged the median toward zero. Rates here are over
 *    builds that actually ran.
 *
 * A third trap, fixed later: `completed` is claimed by materially different
 * endings. Only `delivered` means the builder produced the thing that was asked
 * for — an open PR is still a proposal, and budget cap-outs, hand-kills and chat
 * registrations are not deliveries either. Rates here are over deliveries.
 *
 * Imports nothing but its sibling pure module: it is unit-tested, and anything
 * reaching `$lib/workflows` boots WhatsApp for real under vitest.
 */

import { bucketOf } from "./build-status";

export type Lane = "repo" | "app" | "studio";

export interface LaneInput {
  origin: string | null;
  gitTargetConfig: unknown;
  status: string;
  /** Null on rows written before the column existed; read as delivered. */
  outcome: string | null;
  planStatus?: string | null;
  iterationCount: number;
  publishedSlug: string | null;
}

export interface LaneStat {
  lane: Lane;
  /** Rows filed under this lane, including ones that never ran. */
  total: number;
  /** Rows that ran at least one iteration — the denominator for every rate. */
  ran: number;
  /** Ended as `completed`, whatever that turned out to mean. */
  completed: number;
  /** Ended as `completed` AND actually produced the work. The honest numerator. */
  delivered: number;
  /** Repo candidate proposed in a PR, not yet known here to be deployed. */
  proposed: number;
  failed: number;
  /** Ran out of budget and filed `completed`. */
  capped: number;
  /** Stopped by hand, either before or after reaching `completed`. */
  stopped: number;
  /** Filed from chat without the builder ever running. */
  registered: number;
  /** Delivered / ran, as a percentage. Null when nothing ran. */
  successRate: number | null;
  /** Median iterations across delivered builds. Null when none delivered. */
  medianIterations: number | null;
  published: number;
  /** Filed but never started: registrations, queue removals, pre-launch deaths. */
  neverRan: number;
}

export function laneOf(
  build: Pick<LaneInput, "origin" | "gitTargetConfig">,
): Lane {
  const cfg = build.gitTargetConfig as { repoUrl?: unknown } | null | undefined;
  if (
    cfg &&
    typeof cfg === "object" &&
    typeof cfg.repoUrl === "string" &&
    cfg.repoUrl.trim()
  ) {
    return "repo";
  }
  if (build.origin === "studio") return "studio";
  return "app";
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const LANES: Lane[] = ["repo", "app", "studio"];

export function laneStats(builds: LaneInput[]): LaneStat[] {
  return LANES.map((lane) => {
    const rows = builds.filter((b) => laneOf(b) === lane);
    const ran = rows.filter((b) => b.iterationCount > 0);
    const completed = ran.filter((b) => b.status === "completed");
    const failed = ran.filter((b) => b.status === "failed");
    const inBucket = (name: string) => ran.filter((b) => bucketOf(b) === name);
    const delivered = inBucket("delivered");
    return {
      lane,
      total: rows.length,
      ran: ran.length,
      completed: completed.length,
      delivered: delivered.length,
      proposed: inBucket("proposed").length,
      failed: failed.length,
      capped: inBucket("capped").length,
      stopped: inBucket("stopped").length,
      // Registrations never run, so this counts the whole lane, not `ran`.
      registered: rows.filter((b) => bucketOf(b) === "registered").length,
      successRate: ran.length
        ? Math.round((delivered.length / ran.length) * 100)
        : null,
      medianIterations: median(delivered.map((b) => b.iterationCount)),
      published: ran.filter((b) => b.publishedSlug).length,
      neverRan: rows.length - ran.length,
    };
  });
}
