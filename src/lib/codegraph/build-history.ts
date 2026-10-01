/**
 * Learning from builds that have ALREADY run, as pure functions.
 *
 * The live writers (`observeDevelopmentGate`, `observeDevelopmentCi`,
 * `observeDevelopmentRelease`) only see what happens after they shipped. Fifty
 * change-request builds and nine /jkai/develop features ran before them, and
 * every fact the graph needs about those runs is still in production: each
 * gate result is a `jkai_logs` row tied to its iteration, each edit is in
 * `jkai_iterations.actions`, each candidate is in the delivery event stream,
 * and each pull request is a URL in `published_slug`.
 *
 * So this reads those rows and produces the SAME units the live path writes —
 * the same `fixEpisodeFrom`, the same dedupe keys — so a backfilled episode and
 * a later live write of the same event collide on one row instead of
 * duplicating. Nothing here touches a database: the server half
 * (`build-history.server.ts`) loads the rows, and this half is what the tests
 * and the read-only dry run exercise.
 *
 * What it deliberately does NOT do, by the codebase's own rules:
 *
 *  - No episode from a failure without an error class (`pendingFailureFrom`
 *    returns null), and none from an infrastructure failure: the develop lane's
 *    own `failureKind` says which failures were the feature's, and only those
 *    are read. A broker timeout is not something code can learn from.
 *  - No outcome episode for a pull request that never merged. A closed
 *    proposal is not a precedent anyone should copy; merged is `landed`, and
 *    only merged AND serving is `verified` (see `acceptanceVerdict`).
 *  - Lessons only for the one pattern that is durable and was invisible until
 *    measured — see `blockerLessons`.
 */
import { editedPathsFromActions } from './build-context';
import { fixEpisodeFrom, pendingFailureFrom, queuePendingFailure, type DevelopmentEpisode } from './development-episodes';
import type { PendingFailure } from '$lib/constants/development';
import { impactOf, type StructuralSnapshot } from './snapshot';

export interface HistoryBuild {
  id: string; title: string | null; prompt: string; status: string; outcome: string | null;
  publishedSlug: string | null; createdAt: string;
  /** The delivery row's state, for /jkai/develop features; null for a change request. */
  delivery: { acceptedAt?: string | null; candidate?: string | null; originalAsk?: string; release?: { revision?: string; prNumber?: number } } | null;
}
export interface HistoryIteration { id: string; buildId: string; number: number; createdAt: string; actions: unknown }
export interface HistoryLog { buildId: string; iterationId: string | null; type: string; content: string; createdAt: string }
export interface HistoryEvent { buildId: string; id: number; kind: string; createdAt: string; detail: { candidate?: string | null; cycle?: { failureKind?: string; failure?: string } | null } }
/** What GitHub says about a build's pull request, looked up by the server half. */
/** `number: null` means the branch was found but no pull request was ever opened for it. */
export interface PullRequestFact { number: number | null; merged: boolean; closed: boolean; mergeSha?: string | null; mergedAt?: string | null; files: string[] }

/** One gate verdict in a build's history, in time order. */
export interface GateResult {
  kind: 'fail' | 'pass'; source: PendingFailure['source']; revision: string; at: string;
  /** Position of the iteration it judged, for the edit window. */
  iteration: number; text: string;
}

const CHANGE_REQUEST_FAIL = /^FAIL Tests:/;
const CHANGE_REQUEST_PASS = /^PASS Tests:/;
const DEVELOP_FAIL = /^Preview\/check failure:/;
/** Isolated verification's own words when it passes (development-workspace.server.ts). */
export const ISOLATED_PASS_EVIDENCE = 'Isolated structural, type, repository test, production build, release sidecar and feature browser checks passed.';

/**
 * Every gate verdict a build left behind, oldest first.
 *
 * Two lanes, two vocabularies, both read here because a /jkai/develop feature
 * from early September ran the change-request gate before isolated
 * verification existed:
 *
 *  - change requests log `FAIL Tests:` / `PASS Tests:` against the iteration
 *    the gate judged (`orchestrator.ts`, after `resolveBuildServes`);
 *  - isolated verification logs `Preview/check failure:` and then writes a
 *    `cycle_progress` event carrying the candidate and the failure's KIND. Only
 *    `feature` is read — `infrastructure` and `deadline` are the broker's
 *    failures, not the code's. A pass is a `candidate_verified` event.
 */
export function gateResults(iterations: HistoryIteration[], logs: HistoryLog[], events: HistoryEvent[]): GateResult[] {
  const ordered = [...iterations].sort((a, b) => a.number - b.number);
  const byId = new Map(ordered.map((it, i) => [it.id, i]));
  // An event has no iteration id; the iteration running at the time is the one.
  const at = (time: string) => {
    let index = -1;
    for (let i = 0; i < ordered.length; i++) if (Date.parse(ordered[i].createdAt) <= Date.parse(time)) index = i;
    return index;
  };
  const cycles = events.filter(e => e.kind === 'cycle_progress').sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const out: GateResult[] = [];
  for (const log of logs) {
    const iteration = log.iterationId && byId.has(log.iterationId) ? byId.get(log.iterationId)! : at(log.createdAt);
    if (CHANGE_REQUEST_FAIL.test(log.content) || CHANGE_REQUEST_PASS.test(log.content)) {
      if (iteration < 0) continue;
      out.push({ kind: CHANGE_REQUEST_FAIL.test(log.content) ? 'fail' : 'pass', source: 'gate', revision: ordered[iteration].id, at: log.createdAt, iteration,
        text: CHANGE_REQUEST_PASS.test(log.content) ? `The repository gate passed in iteration ${ordered[iteration].number}: ${log.content.split('\n', 1)[0]}` : log.content });
    } else if (log.type === 'error' && DEVELOP_FAIL.test(log.content)) {
      // The cycle event is written moments after the log line; a minute is slack, not a window.
      const cycle = cycles.find(e => Date.parse(e.createdAt) >= Date.parse(log.createdAt) - 2000 && Date.parse(e.createdAt) - Date.parse(log.createdAt) < 60_000);
      if (cycle?.detail.cycle?.failureKind !== 'feature' || !cycle.detail.candidate) continue;
      out.push({ kind: 'fail', source: 'verification', revision: cycle.detail.candidate, at: log.createdAt, iteration,
        // Raw: `pendingFailureFrom` normalises it through `failureExcerpt`,
        // the same function the live path's `String(error)` goes through.
        text: log.content });
    }
  }
  for (const e of events) {
    if (e.kind !== 'candidate_verified' || !e.detail.candidate) continue;
    out.push({ kind: 'pass', source: 'verification', revision: e.detail.candidate, at: e.createdAt, iteration: at(e.createdAt), text: ISOLATED_PASS_EVIDENCE });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * Pair red with the next green of the same source, exactly as the live path
 * does (`queuePendingFailure` keeps the first of a streak) and as the session
 * backfill does: the fix is every file edited AFTER the failing run, up to and
 * including the iteration the passing run judged. A green with no edits in
 * between proves nothing and `fixEpisodeFrom` declines it.
 */
export function failFixEpisodes(buildId: string, results: GateResult[], editsByIteration: string[][]): { episodes: DevelopmentEpisode[]; unkeyed: number } {
  let pending: PendingFailure[] = [];
  const startedAt = new Map<string, number>();
  const key = (p: PendingFailure) => `${p.source}:${p.fingerprint}`;
  const episodes: DevelopmentEpisode[] = [];
  let unkeyed = 0;
  for (const r of results) {
    if (r.kind === 'fail') {
      const failure = pendingFailureFrom({ source: r.source, revision: r.revision, diagnostics: r.text, at: r.at });
      if (!failure) { unkeyed++; continue; }
      const next = queuePendingFailure(pending, failure);
      if (next !== pending) { pending = next; startedAt.set(key(failure), r.iteration); }
      continue;
    }
    for (const failure of pending.filter(p => p.source === r.source)) {
      const from = startedAt.get(key(failure)) ?? r.iteration;
      const edits = editsByIteration.slice(from + 1, r.iteration + 1).flat();
      const episode = fixEpisodeFrom({ buildId, failure, passRevision: r.revision, passEvidence: r.text, passAt: new Date(r.at), changedFiles: edits, exact: true });
      if (episode) episodes.push(episode);
    }
    pending = pending.filter(p => p.source !== r.source);
  }
  return { episodes, unkeyed };
}

/** The pull request a build proposed: a number, or the branch a compare URL names. */
export function pullRequestRef(build: Pick<HistoryBuild, 'publishedSlug' | 'delivery'>): { number: number } | { branch: string } | null {
  if (build.delivery?.release?.prNumber) return { number: build.delivery.release.prNumber };
  const slug = build.publishedSlug ?? '';
  const pr = /\/pull\/(\d+)\b/.exec(slug);
  if (pr) return { number: Number(pr[1]) };
  const compare = /\.\.\.((?:agent|jkai)\/[\w./-]+)$/.exec(slug);
  return compare ? { branch: compare[1] } : null;
}

/**
 * What a settled proposal teaches, and the record that it IS settled.
 *
 * MERGED IS `landed`, NEVER `verified`, from here. "Production serves a commit
 * containing the merge" is true of every merge ever made that was not
 * reverted by force-push — including the 17.1% of merged PRs that were
 * themselves repaired later — so asking it after the fact grades almost
 * everything `verified` for free. `verified` is earned only where the merge
 * reaching production was WATCHED, which is the live develop path
 * (`observeDevelopmentRelease`); `writeEpisode` will not lower that to
 * `landed` when this pass meets the same row.
 *
 * CLOSED UNMERGED, or a branch nobody proposed, is `abandoned` — written as a
 * marker so the next deploy does not ask GitHub again, and harmless to
 * retrieval: no files, no fingerprint, no gate, so no seed can reach it. For a
 * develop feature it lands on the acceptance episode's key, where it is the
 * same verdict `acceptanceVerdict` gives a closed pull request.
 *
 * Still open: null, and asked again next time.
 */
export function outcomeEpisodeFrom(build: HistoryBuild, fact: PullRequestFact): DevelopmentEpisode | null {
  if (!fact.merged && !fact.closed) return null;
  const files = fact.merged ? [...new Set(fact.files.filter(Boolean))].slice(0, 40) : [];
  const revision = build.delivery?.release?.revision ?? build.delivery?.candidate ?? null;
  const dedupeKey = build.delivery && revision ? `development:${build.id}:${revision}`
    : `change-request:${build.id}:${fact.number ? `pr-${fact.number}` : 'unproposed'}`;
  const sha = fact.mergeSha?.slice(0, 12) ?? 'unknown';
  const pr = fact.number ? `pull request #${fact.number}` : 'no pull request';
  return {
    dedupeKey, repo: 'SR-Main', sourceKind: 'development', sourceId: build.id,
    title: (build.title ?? build.prompt).replace(/\s+/g, ' ').trim().slice(0, 200),
    problem: (build.delivery?.originalAsk ?? build.prompt).slice(0, 1500),
    resolution: (fact.merged ? `Merged as ${pr} (${sha}), changing ${files.length} file(s): ${files.join(', ')}.`
      : fact.number ? `Proposed as ${pr} and closed without merging.` : 'The branch was pushed but never proposed as a pull request.').slice(0, 4000),
    verification: fact.merged ? `${pr} merged as ${sha}. Not watched reaching production, so graded landed, not verified.` : 'Not merged.',
    // Not gate-derived, so no fingerprint and no gate node: hanging every merged
    // proposal off `gate:gate` would make it the largest hub in the graph.
    fingerprint: null, gate: null, verdict: fact.merged ? 'landed' : 'abandoned',
    filesTouched: files, prNumber: fact.number, occurredAt: new Date(fact.mergedAt ?? build.createdAt),
    nodes: files,
  };
}

/** A lesson unit, in the ingest route's shape. */
export interface LessonUnit { slug: string; title: string; body: string; origin: 'build'; originRef: string; citedPaths: string[]; observedAt: Date }

/** A test file named in a failure, and whether it failed to LOAD rather than assert. */
export function failingTests(text: string): Array<{ path: string; suite: boolean; error: string | null }> {
  const suites = text.split(/Failed Suites/)[1]?.split(/Failed Tests/)[0] ?? '';
  const out = new Map<string, { path: string; suite: boolean; error: string | null }>();
  // The error is read from a window AFTER the match rather than consumed by
  // it: vitest prints failures back to back, and a pattern that ate the next
  // few lines would swallow the next file's FAIL line with them.
  for (const m of text.matchAll(/FAIL\s+(\S+\.(?:test|spec)\.[jt]sx?)(\s+\[\s*\S+\s*\])?/g)) {
    const path = m[1];
    // vitest prints `FAIL  file [ file ]` for a file that never loaded, and
    // lists a file whose beforeAll threw under "Failed Suites".
    const suite = Boolean(m[2]) || suites.includes(path);
    const after = text.slice(m.index + m[0].length).split('\n').slice(1, 5).join('\n');
    const error = /^\s*((?:\w*Error|\w*Exception)\b[^\n]{0,200})/m.exec(after)?.[1]?.trim() ?? null;
    const seen = out.get(path);
    out.set(path, { path, suite: suite || Boolean(seen?.suite), error: seen?.error ?? error });
  }
  return [...out.values()];
}

/** Does a test file plausibly exercise what the build changed? The name-only floor; the server adds the import graph. */
export function testNamesAnEdit(test: string, edits: string[]): boolean {
  const stem = test.slice(test.lastIndexOf('/') + 1).replace(/\.(?:test|spec)\.[jt]sx?$/, '');
  return edits.some(e => e === test || e.slice(e.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '') === stem);
}

/** Below this, a repeat is a build struggling with its own change, not a wall. */
export const BLOCKER_MIN_FAILURES = 3;

/**
 * "This test fails for changes that never touch it."
 *
 * The one lesson a build history can state that nothing else in the graph
 * knows, and that cost real rounds to learn. Build f3a6c096 (2026-09-27) failed
 * isolated verification eight times on `feed-checks.test.ts`, which threw
 * `Requires a loopback test database` against the broker's non-loopback preview
 * database — for EVERY candidate, whatever the feature did — and autopilot
 * coached the feature to fix it for five rounds. Four develop features in early
 * September hit the same shape on `grounding/authored.test.ts`.
 *
 * A test qualifies only when, within one build, it failed at least
 * `BLOCKER_MIN_FAILURES` times across at least two revisions, the build never
 * edited it, and `related` says nothing the build changed reaches it. Then it
 * must ALSO be either a suite that failed to load (it never got as far as the
 * feature's code) or seen in two or more builds — so one build breaking a test
 * it did not open is not mistaken for a wall. Keyed on the path, so every build
 * that hits the same wall refreshes one lesson rather than adding another.
 */
export function blockerLessons(
  failures: Array<{ buildId: string; revision: string; at: string; text: string }>,
  editsByBuild: Map<string, string[]>,
  related: (test: string, edits: string[]) => boolean = testNamesAnEdit,
): LessonUnit[] {
  type Seen = { builds: Map<string, { count: number; revisions: Set<string>; lastAt: string }>; suite: boolean; error: string | null };
  const byTest = new Map<string, Seen>();
  for (const f of failures) {
    for (const t of failingTests(f.text)) {
      const seen = byTest.get(t.path) ?? { builds: new Map(), suite: false, error: null };
      const b = seen.builds.get(f.buildId) ?? { count: 0, revisions: new Set<string>(), lastAt: f.at };
      b.count++; b.revisions.add(f.revision); if (f.at > b.lastAt) b.lastAt = f.at;
      seen.builds.set(f.buildId, b); seen.suite ||= t.suite; seen.error ??= t.error;
      byTest.set(t.path, seen);
    }
  }
  const lessons: LessonUnit[] = [];
  for (const [path, seen] of byTest) {
    const walls = [...seen.builds].filter(([buildId, b]) => {
      const edits = editsByBuild.get(buildId) ?? [];
      return b.count >= BLOCKER_MIN_FAILURES && b.revisions.size >= 2 && !edits.includes(path) && !related(path, edits);
    });
    if (!walls.length || !(seen.suite || walls.length >= 2)) continue;
    const runs = walls.reduce((n, [, b]) => n + b.count, 0);
    const last = walls.reduce((a, b) => (b[1].lastAt > a[1].lastAt ? b : a));
    lessons.push({
      slug: `build-blocker:${path}`, origin: 'build', originRef: `/jkai/develop/${last[0]}`, citedPaths: [path], observedAt: new Date(last[1].lastAt),
      title: `${path.slice(path.lastIndexOf('/') + 1)} fails verification for changes that never touch it`,
      body: [
        `\`${path}\` failed ${runs} gate or verification run(s) across ${walls.length} build(s) (${walls.map(([id]) => id.slice(0, 8)).join(', ')}) that never edited it or anything it is known to test${seen.suite ? ', and it failed to load or set up rather than failing an assertion' : ''}.`,
        seen.error ? `It said: ${seen.error}` : '',
        'A failure outside the change set is the test or the environment, not the feature: repair the test or its environment rather than coaching the feature round after round. A test that needs a resource it cannot get should skip, not throw.',
        'Recheck against the current file first; it may have been fixed since.',
      ].filter(Boolean).join('\n'),
    });
  }
  return lessons;
}

export interface HistoryUnits {
  episodes: DevelopmentEpisode[];
  lessons: LessonUnit[];
  counts: { builds: number; gateResults: number; failFix: number; outcomes: number; unkeyedFailures: number; abandonedPrs: number; openPrs: number; prsWithoutFacts: number };
}

/** Everything the graph should learn from these builds. Deterministic, so a re-run writes the same rows. */
export function extractBuildHistory(input: {
  builds: HistoryBuild[]; iterations: HistoryIteration[]; logs: HistoryLog[]; events: HistoryEvent[];
  pullRequests: Map<string, PullRequestFact>;
  related?: (test: string, edits: string[]) => boolean;
}): HistoryUnits {
  const counts = { builds: input.builds.length, gateResults: 0, failFix: 0, outcomes: 0, unkeyedFailures: 0, abandonedPrs: 0, openPrs: 0, prsWithoutFacts: 0 };
  const episodes: DevelopmentEpisode[] = [];
  const failures: Array<{ buildId: string; revision: string; at: string; text: string }> = [];
  const editsByBuild = new Map<string, string[]>();
  const group = <T extends { buildId: string }>(rows: T[]) => rows.reduce((m, r) => m.set(r.buildId, [...(m.get(r.buildId) ?? []), r]), new Map<string, T[]>());
  const iterations = group(input.iterations), logs = group(input.logs), events = group(input.events);
  for (const build of input.builds) {
    const its = [...(iterations.get(build.id) ?? [])].sort((a, b) => a.number - b.number);
    const edits = its.map(it => editedPathsFromActions(it.actions, 40));
    editsByBuild.set(build.id, [...new Set(edits.flat())]);
    const results = gateResults(its, logs.get(build.id) ?? [], events.get(build.id) ?? []);
    counts.gateResults += results.length;
    for (const r of results) if (r.kind === 'fail') failures.push({ buildId: build.id, revision: r.revision, at: r.at, text: r.text });
    const pairs = failFixEpisodes(build.id, results, edits);
    episodes.push(...pairs.episodes); counts.failFix += pairs.episodes.length; counts.unkeyedFailures += pairs.unkeyed;
    if (pullRequestRef(build)) {
      const fact = input.pullRequests.get(build.id);
      if (!fact) counts.prsWithoutFacts++;
      else {
        const outcome = outcomeEpisodeFrom(build, fact);
        if (!outcome) counts.openPrs++;
        else { episodes.push(outcome); if (outcome.verdict === 'abandoned') counts.abandonedPrs++; else counts.outcomes++; }
      }
    }
  }
  return { episodes, lessons: blockerLessons(failures, editsByBuild, input.related), counts };
}

/**
 * `related` for `blockerLessons`, with the import graph where the name alone
 * cannot tell: a test that imports what the build changed is the build's own
 * breakage, never a wall.
 */
export function relatedBySnapshot(snapshot: StructuralSnapshot | null | undefined): (test: string, edits: string[]) => boolean {
  return (test, edits) => {
    if (testNamesAnEdit(test, edits)) return true;
    if (!snapshot || !edits.length) return false;
    const impact = impactOf(snapshot, edits);
    return impact.tests.includes(test) || impact.dependants.includes(test);
  };
}

/** A wall in a file that no longer exists is history, not guidance. */
export function liveLessons(lessons: LessonUnit[], snapshot: StructuralSnapshot | null | undefined): LessonUnit[] {
  return snapshot ? lessons.filter(l => l.citedPaths.every(p => snapshot.files.includes(p))) : lessons;
}

/** What a pass did — or, dry, would do. The release job prints the head of it. */
export function historyReport(units: HistoryUnits, dry: boolean, github: { lookups: number; settled: number; deferred: number; token: boolean }, writeFailures = 0) {
  const byKind: Record<string, number> = {};
  for (const e of units.episodes) { const k = `${e.dedupeKey.split(':')[0]}/${e.verdict}`; byKind[k] = (byKind[k] ?? 0) + 1; }
  // FIRST in the object, because the release job prints only the head of it:
  // a pass that cannot see GitHub learns nothing about outcomes and must say
  // so where someone will read it, not skip quietly.
  const warning = github.token ? (github.deferred ? `${github.deferred} pull request lookup(s) deferred to the next deploy (time budget)` : null)
    : 'FORGE_GITHUB_TOKEN MISSING on this host: no pull request outcomes were learned';
  return { warning, ok: writeFailures === 0, dry, counts: { ...units.counts, lessons: units.lessons.length, writeFailures,
    prLookups: github.lookups, prSettled: github.settled, prDeferred: github.deferred }, byKind,
    samples: [...units.episodes.filter(e => e.fingerprint).slice(0, 3), ...units.episodes.filter(e => !e.fingerprint).slice(0, 2)]
      .map(e => ({ ...e, problem: e.problem.slice(0, 500) })),
    lessons: units.lessons };
}
