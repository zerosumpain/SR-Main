/**
 * What a development build TEACHES the graph, as pure functions.
 *
 * Until this existed /jkai/develop only ever read from codegraph. Measured on
 * production 2026-09-30: all 239 episodes came from Claude sessions and none
 * from a build, and the one episode a build could write — at local acceptance —
 * was stamped `verified` before CI had even run, with the owner's original ask
 * as its "problem". So the graph learned nothing from the lane that fails most
 * visibly, and the one thing it did record claimed a proof it did not have.
 *
 * Two kinds of episode come out of a build, and both are built here so the
 * shapes can be tested without a database:
 *
 *  1. FAIL→FIX. A gate went red on one candidate and the same gate went green on
 *     a later one. Exactly the session backfill's rule (`episodesFrom` in
 *     scripts/codegraph-backfill.mjs): keyed on the error CLASS, resolution
 *     assembled from recorded facts by template, `verified` only because we
 *     watched the same gate turn green. No LLM writes any of it.
 *  2. THE ACCEPTED FEATURE. Written `unverified` at acceptance and moved by what
 *     happens to its pull request — see `acceptanceVerdict`.
 */
import { fingerprintsIn } from './fingerprint';
import { gateNodePath, normaliseGate } from './gates';
import type { PendingFailure } from '$lib/constants/development';

/** The command the develop lane's gates are read as, everywhere: `observeDevelopmentGate` resolves serves with it too. */
export const DEVELOPMENT_GATE = 'npm run gate';

/** Parked failures per delivery. A long red streak must not grow the jsonb for ever. */
export const MAX_PENDING = 4;

/** Same cap as the backfill: a fix that touched more than this is a feature, not a fix. */
export const MAX_FIX_FILES = 20;

/**
 * Read a failure into something worth parking, or null when it carries no
 * error class.
 *
 * A failure with no fingerprint is dropped deliberately, as the backfill drops
 * one (`!e.fingerprint` → skip): the fingerprint is the only key the hot lane
 * can find an episode by, so an episode without one is a row nothing will ever
 * serve — and a broker timeout dressed as a feature failure is exactly the text
 * that fingerprints to nothing.
 */
export function pendingFailureFrom(input: {
  source: PendingFailure['source']; revision: string | null | undefined; diagnostics: string; at?: string; prNumber?: number;
}): PendingFailure | null {
  if (!input.revision) return null;
  // `fingerprintsIn`, NOT `fingerprintOf`, and the difference is the whole
  // point of the row. The hot lane plans its query with `fingerprintsIn` under
  // the same gate command, and the two disagree on TypeScript: `fingerprintOf`
  // prefixes the code with the command's gate (`gate:TS2345`), `fingerprintsIn`
  // always says `typecheck:TS2345`. An episode keyed the first way is one the
  // next build hitting that exact error can never be served.
  const fingerprint = fingerprintsIn(input.diagnostics, DEVELOPMENT_GATE)[0] ?? null;
  if (!fingerprint) return null;
  return { source: input.source, revision: input.revision, fingerprint, excerpt: input.diagnostics.trim().slice(0, 1500),
    at: input.at ?? new Date().toISOString(), ...(input.prNumber ? { prNumber: input.prNumber } : {}) };
}

/**
 * Park a failure, keeping the FIRST of a streak.
 *
 * The backfill pairs a failure with the next green run and skips the reds in
 * between, so the files it credits are everything changed from the start of
 * the struggle. Same here: a second red with the same source and error class
 * does not replace the first, or the diff would start halfway through the fix.
 * A different class on the same source is its own wall and gets its own entry.
 */
export function queuePendingFailure(pending: PendingFailure[], failure: PendingFailure): PendingFailure[] {
  if (pending.some(p => p.source === failure.source && p.fingerprint === failure.fingerprint)) return pending;
  return [...pending, failure].slice(-MAX_PENDING);
}

/** The episode row a fail→fix pair becomes, in the ingest route's shape. */
export interface DevelopmentEpisode {
  dedupeKey: string; repo: string; sourceKind: 'development'; sourceId: string; title: string;
  problem: string; resolution: string; verification: string; fingerprint: string; gate: string;
  verdict: 'verified'; filesTouched: string[]; prNumber: number | null; occurredAt: Date;
  /** Node paths to link: the files, then the gate node — as ingest links them. */
  nodes: string[];
}

/**
 * Pair a parked failure with the green result that followed it.
 *
 * Returns null when the pair proves nothing, by the backfill's own rule ("green
 * with no edits proves nothing"): the SAME revision going green is a flake or a
 * re-run, and an empty file diff is the same thing by another route.
 *
 * `changedFiles` comes from the two candidates' indexed snapshots when both
 * exist (`diffSnapshots` — exactly the files whose content differs between the
 * failing and the passing revision). When one is missing the caller passes the
 * passing candidate's whole change set and says so with `exact: false`, and the
 * resolution says so too rather than claiming a precision it does not have.
 *
 * THE KEY IS NOT THE INGEST HASH. Ingest hashes the episode's `occurredAt`,
 * which here is when the green result was SEEN — so a retry after a crash
 * between "write the episode" and "clear the pending entry" would mint a second
 * row. Failing revision + error class is the natural identity of this fix, in
 * the same readable style as the acceptance episode's `development:` key.
 */
export function fixEpisodeFrom(input: {
  buildId: string; failure: PendingFailure; passRevision: string; passEvidence: string; passAt?: Date;
  changedFiles: string[]; exact: boolean; prNumber?: number | null; repo?: string;
}): DevelopmentEpisode | null {
  const { failure } = input;
  if (!input.passRevision || input.passRevision === failure.revision) return null;
  const files = [...new Set(input.changedFiles.filter(Boolean))].slice(0, MAX_FIX_FILES);
  if (!files.length) return null;
  // The fingerprint's own prefix is the gate it names (`typecheck:TS2345`,
  // `gate:TypeError`), normalised through the one vocabulary gate nodes use.
  const gate = normaliseGate(failure.fingerprint.split(':')[0]);
  const where = failure.source === 'ci' ? `CI on pull request${failure.prNumber ? ` #${failure.prNumber}` : ''}` : 'isolated verification';
  return {
    dedupeKey: `development-fix:${input.buildId}:${failure.source}:${failure.revision}:${failure.fingerprint}`,
    repo: input.repo ?? 'SR-Main', sourceKind: 'development', sourceId: input.buildId,
    title: `${gate}: ${failure.fingerprint}`,
    problem: `${where} failed on candidate ${failure.revision.slice(0, 12)}:\n${failure.excerpt}`.slice(0, 4000),
    resolution: (input.exact
      ? `Fixed by changing ${files.length} file(s) between candidate ${failure.revision.slice(0, 12)} and ${input.passRevision.slice(0, 12)}: ${files.join(', ')}.`
      : `The passing candidate ${input.passRevision.slice(0, 12)} changes ${files.length} file(s) against its base: ${files.join(', ')}. The per-revision diff was unavailable, so this is the whole change set, not only the fix.`).slice(0, 4000),
    verification: input.passEvidence.slice(0, 1000),
    fingerprint: failure.fingerprint, gate, verdict: 'verified', filesTouched: files,
    prNumber: input.prNumber ?? failure.prNumber ?? null, occurredAt: input.passAt ?? new Date(),
    nodes: [...files, gateNodePath(gate)],
  };
}

/**
 * What a release event does to the accepted feature's episode.
 *
 * Acceptance is a LOCAL fact: the broker's isolated checks passed on a batch.
 * CI has not run and production has not served it, so it is `unverified` —
 * which still ranks, at half weight, as "this was built here" — until:
 *
 *  - it is serving in production → `verified`. The strongest thing that can
 *    happen to it, so it wins from any verdict: a red CI run later re-run green
 *    and merged unchanged was a flake, not a repair.
 *  - CI goes red on it → `repaired`: a fix that needed fixing, which is what
 *    `VERDICT_WEIGHT` ranks below neutral for.
 *  - its pull request is closed unmerged → `abandoned`.
 *
 * The last two only move an `unverified` episode. Autopilot closes a red pull
 * request itself (`repairAfterCi`), and that close must not overwrite the
 * `repaired` the CI failure already earned — the closing is the repair starting,
 * not the work being walked away from.
 *
 * Returns null for "leave it alone". Nothing here touches `retiredAt`.
 */
export function acceptanceVerdict(current: string | null | undefined, event: 'deployed' | 'ci_failed' | 'closed'): 'verified' | 'repaired' | 'abandoned' | null {
  if (event === 'deployed') return current === 'verified' ? null : 'verified';
  if (current !== 'unverified') return null;
  return event === 'ci_failed' ? 'repaired' : 'abandoned';
}
