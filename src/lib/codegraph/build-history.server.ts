/**
 * The release-job pass that teaches the graph from every build already run.
 *
 * WHY HERE, AND WHY EVERY DEPLOY. The session backfill runs on homeserv because
 * that is where Claude transcripts live; build history lives in the production
 * database, so the extraction runs next to it. The release job already calls
 * the ingest route once per deploy (`codegraph-tree-pass.mjs`), and this rides
 * the same route and credential with `{ builds: {} }` — no new route, no new
 * bypass, no new secret. On the first deploy it backfills everything; on every
 * deploy after, it catches up with whatever ran since. Every write is an upsert
 * on a deterministic key, so "everything again" costs one GitHub lookup per
 * unsettled pull request and changes nothing that has not changed.
 *
 * `dry: true` returns what it WOULD write and touches nothing.
 */
import { and, desc, eq, inArray, like, ne, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { codegraphEpisodes, codegraphLessons, codegraphNodeLessons, codegraphNodes, codegraphSnapshots, jkaiBuildDeliveries,
  jkaiBuildDeliveryEvents, jkaiBuilds, jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { extractBuildHistory, historyReport, liveLessons, pullRequestRef, relatedBySnapshot, type HistoryBuild, type HistoryEvent, type LessonUnit, type PullRequestFact } from './build-history';
import type { StructuralSnapshot } from './snapshot';
import { familyOf } from './family';

/** Bounded per run so a cold start cannot spend the release job on GitHub. */
const MAX_PR_LOOKUPS = 60;
/** Well inside the release job's 300-second curl, with the writes still to come. */
const LOOKUP_BUDGET_MS = 90_000;

export async function learnFromBuildHistory(opts: { dry?: boolean } = {}) {
  // Repo builds (a JSON-literal null is an app/studio build) and develop
  // features. Running builds are left for the next deploy: their history is
  // still being written.
  const builds = await db.select({ id: jkaiBuilds.id, title: jkaiBuilds.title, prompt: jkaiBuilds.prompt, status: jkaiBuilds.status, outcome: jkaiBuilds.outcome,
    publishedSlug: jkaiBuilds.publishedSlug, createdAt: jkaiBuilds.createdAt, delivery: jkaiBuildDeliveries.state })
    .from(jkaiBuilds).leftJoin(jkaiBuildDeliveries, eq(jkaiBuildDeliveries.buildId, jkaiBuilds.id))
    .where(and(sql`${jkaiBuilds.status} NOT IN ('running', 'queued')`,
      or(sql`${jkaiBuilds.gitTargetConfig} IS NOT NULL AND ${jkaiBuilds.gitTargetConfig}::text <> 'null'`, sql`${jkaiBuildDeliveries.buildId} IS NOT NULL`)))
    // Newest first: the GitHub lookups are budgeted, and the build that just
    // ran is the one worth learning from this deploy.
    .orderBy(desc(jkaiBuilds.createdAt));
  const ids = builds.map(b => b.id);
  if (!ids.length) return historyReport({ episodes: [], lessons: [], counts: { builds: 0, gateResults: 0, failFix: 0, outcomes: 0, unkeyedFailures: 0, abandonedPrs: 0, openPrs: 0, prsWithoutFacts: 0 } },
    Boolean(opts.dry), { lookups: 0, settled: 0, deferred: 0, token: Boolean(process.env.FORGE_GITHUB_TOKEN) });

  const iterations = await db.select({ id: jkaiIterations.id, buildId: jkaiIterations.buildId, number: jkaiIterations.number, createdAt: jkaiIterations.createdAt, actions: jkaiIterations.actions })
    .from(jkaiIterations).where(inArray(jkaiIterations.buildId, ids));
  // Only the gate verdicts, by the exact prefixes the orchestrator writes —
  // the log table holds every line a build ever printed.
  const logs = await db.select({ buildId: jkaiLogs.buildId, iterationId: jkaiLogs.iterationId, type: jkaiLogs.type, content: jkaiLogs.content, createdAt: jkaiLogs.createdAt })
    .from(jkaiLogs).where(and(inArray(jkaiLogs.buildId, ids), or(like(jkaiLogs.content, 'FAIL Tests:%'), like(jkaiLogs.content, 'PASS Tests:%'), like(jkaiLogs.content, 'Preview/check failure:%'))))
    .orderBy(jkaiLogs.id);
  const events = await db.select({ buildId: jkaiBuildDeliveryEvents.buildId, id: jkaiBuildDeliveryEvents.id, kind: jkaiBuildDeliveryEvents.kind, detail: jkaiBuildDeliveryEvents.detail, createdAt: jkaiBuildDeliveryEvents.createdAt })
    .from(jkaiBuildDeliveryEvents).where(and(inArray(jkaiBuildDeliveryEvents.buildId, ids), inArray(jkaiBuildDeliveryEvents.kind, ['cycle_progress', 'candidate_verified'])))
    .orderBy(jkaiBuildDeliveryEvents.id);

  const history: HistoryBuild[] = builds.map(b => ({ ...b, createdAt: b.createdAt.toISOString(), delivery: b.delivery ?? null }));
  const pullRequests = await pullRequestFacts(history);
  const [deployed] = await db.select({ payload: codegraphSnapshots.payload }).from(codegraphSnapshots)
    .where(and(eq(codegraphSnapshots.repo, 'SR-Main'), eq(codegraphSnapshots.scope, 'deployed'), eq(codegraphSnapshots.active, true))).limit(1);
  const snapshot = deployed?.payload as unknown as StructuralSnapshot | undefined;

  const units = extractBuildHistory({
    builds: history, pullRequests: pullRequests.facts,
    iterations: iterations.map(i => ({ ...i, createdAt: i.createdAt.toISOString() })),
    logs: logs.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })),
    events: events.map(e => ({ ...e, createdAt: e.createdAt.toISOString(), detail: e.detail as unknown as HistoryEvent['detail'] })),
    related: relatedBySnapshot(snapshot),
  });
  units.lessons = liveLessons(units.lessons, snapshot);

  // One bad unit must not fail the pass for ever: every deploy would rerun the
  // same failing write first and learn nothing behind it. Counted instead,
  // and the report's `ok` goes false so the release log shows it.
  let writeFailures = 0;
  if (!opts.dry) {
    const { writeEpisode } = await import('./development.server');
    for (const episode of units.episodes) await writeEpisode(episode).catch(error => { writeFailures++; console.warn('[codegraph] build-history episode', episode.dedupeKey, error); });
    for (const lesson of units.lessons) await writeLesson(lesson).catch(error => { writeFailures++; console.warn('[codegraph] build-history lesson', lesson.slug, error); });
  }
  return historyReport(units, Boolean(opts.dry), pullRequests, writeFailures);
}

/**
 * GitHub's word on each proposal, inside a time budget.
 *
 * A build whose outcome episode already carries any verdict but `unverified`
 * is SETTLED — merged (`landed`), closed or never proposed (`abandoned`) — and
 * nothing GitHub could say would move it, so it is not asked again. Only open
 * proposals and new builds are looked up, newest first, and the loop stops at
 * `LOOKUP_BUDGET_MS` so the release job's 300-second curl is never the thing
 * that ends the pass; what is left is counted as deferred and taken next deploy.
 */
async function pullRequestFacts(builds: HistoryBuild[]) {
  const facts = new Map<string, PullRequestFact>();
  const token = process.env.FORGE_GITHUB_TOKEN;
  const proposing = builds.filter(b => pullRequestRef(b));
  if (!token || !proposing.length) return { facts, lookups: 0, settled: 0, deferred: 0, token: Boolean(token) };
  const settled = new Set((await db.select({ sourceId: codegraphEpisodes.sourceId }).from(codegraphEpisodes).where(and(
    inArray(codegraphEpisodes.sourceId, proposing.map(b => b.id)), ne(codegraphEpisodes.verdict, 'unverified'),
    or(like(codegraphEpisodes.dedupeKey, 'change-request:%'), like(codegraphEpisodes.dedupeKey, 'development:%'))))).map(r => r.sourceId));
  const { SR_MAIN_GIT_TARGET } = await import('$lib/jkai/git-targets');
  const { repoSlugFromUrl } = await import('$lib/github/pr');
  const repo = repoSlugFromUrl(SR_MAIN_GIT_TARGET.repoUrl);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'codegraph-build-history' };
  const get = async <T>(path: string): Promise<T | null> => {
    const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, { headers, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    return r?.ok ? (r.json() as Promise<T>) : null;
  };
  const started = Date.now();
  let lookups = 0, deferred = 0;
  for (const build of proposing) {
    if (settled.has(build.id)) continue;
    if (lookups >= MAX_PR_LOOKUPS || Date.now() - started > LOOKUP_BUDGET_MS) { deferred++; continue; }
    lookups++;
    const ref = pullRequestRef(build)!;
    let number: number | null;
    if ('number' in ref) number = ref.number;
    else {
      const found = await get<Array<{ number: number }>>(`pulls?state=all&head=${repo.split('/')[0]}:${encodeURIComponent(ref.branch)}`);
      if (!found) continue; // the lookup failed, which is not the same as "none"
      number = found[0]?.number ?? null;
    }
    if (number === null) { facts.set(build.id, { number: null, merged: false, closed: true, files: [] }); continue; }
    const pr = await get<{ merged?: boolean; state?: string; merge_commit_sha?: string | null; merged_at?: string | null }>(`pulls/${number}`);
    if (!pr) continue;
    const files = pr.merged ? ((await get<Array<{ filename: string }>>(`pulls/${number}/files?per_page=100`)) ?? []).map(f => f.filename) : [];
    facts.set(build.id, { number, merged: Boolean(pr.merged), closed: pr.state === 'closed', mergeSha: pr.merge_commit_sha ?? null, mergedAt: pr.merged_at ?? null, files });
  }
  return { facts, lookups, settled: settled.size, deferred, token: true };
}

/**
 * Upsert on (repo, slug), the ingest route's rule: refresh the text, the paths
 * and the date; never `retiredAt`, never the usage counters. Then hang it off
 * the node it cites, so a file-seeded query reaches it.
 */
async function writeLesson(lesson: LessonUnit) {
  const [row] = await db.insert(codegraphLessons).values({ repo: 'SR-Main', ...lesson }).onConflictDoUpdate({
    target: [codegraphLessons.repo, codegraphLessons.slug],
    set: { title: lesson.title, body: lesson.body, citedPaths: lesson.citedPaths, observedAt: lesson.observedAt, originRef: lesson.originRef, updatedAt: new Date() },
  }).returning({ id: codegraphLessons.id });
  await db.insert(codegraphNodes).values(lesson.citedPaths.map(path => ({ repo: 'SR-Main', canonicalPath: path, kind: 'file',
    displayName: path.split('/').pop()!, existsOnHead: false, family: familyOf(path) }))).onConflictDoNothing();
  const nodes = await db.select({ id: codegraphNodes.id }).from(codegraphNodes).where(and(eq(codegraphNodes.repo, 'SR-Main'), inArray(codegraphNodes.canonicalPath, lesson.citedPaths)));
  if (!nodes.length) return;
  await db.insert(codegraphNodeLessons).values(nodes.map(n => ({ nodeId: n.id, lessonId: row.id }))).onConflictDoNothing();
  // Named in full for the reason `linkEpisode` gives: a bare "id" binds inside the subquery.
  await db.update(codegraphNodes).set({ lessonCount: sql`(SELECT count(*) FROM codegraph_node_lessons y WHERE y.node_id = codegraph_nodes.id)` })
    .where(inArray(codegraphNodes.id, nodes.map(n => n.id)));
}
