/**
 * Executing a CGQL plan against Postgres, and packing the result into a
 * character budget.
 *
 * The one loader. Every read of the graph goes through `runPlan`, which is what
 * makes forgetting enforceable: retired lessons, suppressed edges and merged
 * nodes are filtered HERE, once. Scatter that predicate across five callers and
 * "forget" becomes a suggestion — the fourth caller always forgets.
 */
import { db } from '$lib/db';
import { and, desc, eq, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  codegraphEdges,
  codegraphEpisodes,
  codegraphLessons,
  codegraphNodeEpisodes,
  codegraphNodeLessons,
  codegraphNodes,
} from '$lib/db/schema';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { parseCgql, topicTokens, type Pick, type QueryPlan, VERDICTS } from './query';
import { gateSeedToPath } from './gates';
import { relevanceOf, packByRelevance, type RelevanceParts } from './relevance';
import { familyOf, siblingScore } from './family';

export interface RetrievedLesson {
  id: string;
  title: string;
  body: string;
  citedPaths: string[];
  origin: string;
  /** Why this was ranked where it was — surfaced in the UI and the audit. */
  relevance: RelevanceParts;
}

export interface RetrievedEpisode {
  id: string;
  title: string | null;
  problem: string | null;
  resolution: string | null;
  verification: string | null;
  fingerprint: string | null;
  gate: string | null;
  verdict: string;
  filesTouched: string[];
  prNumber: number | null;
  occurredAt: Date | null;
  relevance: RelevanceParts;
}

export interface RetrievedNode {
  id: string;
  canonicalPath: string;
  kind: string;
  episodeCount: number;
  lessonCount: number;
}

export interface RetrievalResult {
  plan: QueryPlan;
  seedNodeIds: string[];
  nodes: RetrievedNode[];
  lessons: RetrievedLesson[];
  episodes: RetrievedEpisode[];
  /** 'served' | 'empty' — never conflated. See buildContextBlock. */
  outcome: 'served' | 'empty';
  durationMs: number;
}

/*
 * Recency, with NULLS LAST — and this is not a nicety.
 *
 * Postgres puts NULLs FIRST on a DESC ordering. 92 of 277 lessons carry no
 * `observedAt` (their memory note has no `modified:` in its frontmatter), so a
 * plain `desc(observedAt)` ranked every undated note above every dated one, in
 * every query, since the graph shipped. The rows fetched before the limit were
 * therefore whichever undated notes the walk happened to touch, and the
 * relevance sort that runs afterwards could not rescue what the cut had already
 * dropped. Seeding on the connector files returned four notes about the admin
 * console and the landing page — all four undated, none of them connected to
 * connectors by anything but a co-change edge.
 *
 * An unknown date is not a recent one. `recencyWeight` already says so, scoring
 * it 0.6 against a fresh 1.0; the SQL simply disagreed with it.
 */
const LESSON_RECENCY = sql`${codegraphLessons.observedAt} DESC NULLS LAST`;
const EPISODE_RECENCY = sql`${codegraphEpisodes.occurredAt} DESC NULLS LAST`;

/** Rank order for verdicts: 'merged' is not 'correct'. */
const VERDICT_RANK = Object.fromEntries(VERDICTS.map((v, i) => [v, i]));

/**
 * A lesson or episode is visible unless it has been explicitly forgotten.
 * `staleAt` deliberately does NOT hide a lesson — a claim whose file moved is
 * often still true, and quarantining on staleness alone silently deleted
 * knowledge in the design review. Staleness ranks it down and flags it in the
 * UI; only a human retiring it, or a real supersession, removes it.
 */
const lessonVisible = () => and(isNull(codegraphLessons.retiredAt), isNull(codegraphLessons.supersededById));
const episodeVisible = () => isNull(codegraphEpisodes.retiredAt);
const nodeVisible = () => isNull(codegraphNodes.mergedIntoId);

/** Resolve the seed to a set of node ids. */
async function seedNodes(plan: QueryPlan, repo: string): Promise<string[]> {
  const { seed } = plan;

  if (seed.type === 'file') {
    // Globs become LIKE patterns. `sanitisePath` has already refused '%' and
    // '\', so the only wildcard that can reach here is the one the caller
    // actually wrote.
    const clauses: SQL[] = seed.paths.map((p) =>
      p.includes('*')
        ? sql`${codegraphNodes.canonicalPath} LIKE ${p.replace(/\*/g, '%')}`
        : sql`${codegraphNodes.canonicalPath} = ${p}`,
    );
    const rows = await db
      .select({ id: codegraphNodes.id })
      .from(codegraphNodes)
      .where(and(eq(codegraphNodes.repo, repo), nodeVisible(), or(...clauses)))
      .limit(200);
    return rows.map((r) => r.id);
  }

  if (seed.type === 'gate') {
    const rows = await db
      .select({ id: codegraphNodes.id })
      .from(codegraphNodes)
      .where(
        and(eq(codegraphNodes.repo, repo), eq(codegraphNodes.kind, 'gate'), nodeVisible(),
          // Through the SAME normaliser as ingest. A seed is written by a
          // human or an agent — `gate:tsc`, `gate:svelte_check` — and matching
          // raw text would resolve the spellings we happened to store and
          // silently miss the rest, which is a quieter version of the bug this
          // replaces (the lane matched nothing at all, because no gate node
          // existed to match).
          inArray(codegraphNodes.canonicalPath, seed.gates.map(gateSeedToPath))),
      )
      .limit(50);
    return rows.map((r) => r.id);
  }

  // fingerprint / topic seeds address episodes and lessons directly, not nodes.
  return [];
}

/**
 * Degree above which a node is reached but never expanded THROUGH.
 *
 * Measured on the production graph: p50 = 3, p90 = 20, p95 = 30, p99 = 68,
 * max = 805. So 100 sits just above the 99th percentile and excludes exactly
 * **13 nodes of 4,156 (0.3%)** — `src/lib/db/schema.ts` (805 edges, touching
 * 19% of the whole graph), `src/lib/db/index.ts` (593), `workflows/types.ts`
 * (287), `models/settings.ts` (236) and nine others of the same character.
 *
 * These are not well-connected files, they are a different kind of object: a
 * hop through `schema.ts` reaches a fifth of the repo, fills the 400-row edge
 * budget with things that share nothing but a database import, and returns a
 * retrieval that has told the agent nothing. `siblingScore` already caps import
 * in-degree for precisely this reason — "or `schema.ts` wins everything" — and
 * this is that cap applied to traversal.
 *
 * A hub is still a perfectly good SEED and a perfectly good RESULT. What it
 * stops being is a bridge.
 */
const HUB_DEGREE = 100;

/** Expand the seed set by `hops` along the permitted edge kinds. */
async function walk(seedIds: string[], plan: QueryPlan): Promise<string[]> {
  if (!seedIds.length || plan.hops < 1) return seedIds;
  let frontier = seedIds;
  const seen = new Set(seedIds);

  for (let h = 0; h < plan.hops; h++) {
    if (!frontier.length) break;
    const rows = await db
      .select({ a: codegraphEdges.sourceId, b: codegraphEdges.targetId, w: codegraphEdges.weight })
      .from(codegraphEdges)
      .where(
        and(
          eq(codegraphEdges.suppressed, false),
          inArray(codegraphEdges.kind, plan.edgeKinds),
          or(inArray(codegraphEdges.sourceId, frontier), inArray(codegraphEdges.targetId, frontier)),
        ),
      )
      // Strongest ties first, so the cap keeps habits and drops one-offs.
      .orderBy(desc(codegraphEdges.weight))
      .limit(400);

    const next: string[] = [];
    for (const r of rows) {
      for (const id of [r.a, r.b]) {
        if (!seen.has(id)) { seen.add(id); next.push(id); }
      }
    }
    // Hubs stay in `seen` — they are legitimate results — but do not become the
    // next frontier. Reading `degree` off the node rather than counting edges
    // per query is why this costs one indexed lookup instead of a second walk;
    // the column is recomputed at ingest beside episode_count and lesson_count.
    frontier = next.length ? await withoutHubs(next) : next;
  }
  // Bounded: two hops on a dense file graph can reach most of the repo, and a
  // retrieval that returns everything has told the agent nothing.
  return [...seen].slice(0, 300);
}

/** The subset of `ids` that may be expanded through. See `HUB_DEGREE`. */
async function withoutHubs(ids: string[]): Promise<string[]> {
  const rows = await db
    .select({ id: codegraphNodes.id })
    .from(codegraphNodes)
    .where(and(inArray(codegraphNodes.id, ids), lte(codegraphNodes.degree, HUB_DEGREE)));
  const keep = new Set(rows.map((r) => r.id));
  // Preserve the caller's ordering: `rows` comes back in whatever order the
  // planner chose, and the frontier order decides which edges the next hop's
  // 400-row cap sees first.
  return ids.filter((id) => keep.has(id));
}

/**
 * Score lessons against a topic: every token that appears scores, a token in
 * the title scores more than one buried in the body, and a lesson matching more
 * of the query outranks one matching less. Requires at least half the tokens,
 * so a stray common word cannot drag in an unrelated note.
 */
async function topicLessons(text: string, base: SQL | undefined, limit: number) {
  const tokens = topicTokens(text);
  if (!tokens.length) {
    return db.select().from(codegraphLessons).where(base)
      .orderBy(LESSON_RECENCY).limit(limit);
  }

  const titleScore = tokens.map((t) => sql`(CASE WHEN ${codegraphLessons.title} ILIKE ${'%' + t + '%'} THEN 3 ELSE 0 END)`);
  const bodyScore = tokens.map((t) => sql`(CASE WHEN ${codegraphLessons.body} ILIKE ${'%' + t + '%'} THEN 1 ELSE 0 END)`);
  const score = sql.join([...titleScore, ...bodyScore], sql` + `);
  const hits = sql.join(
    tokens.map((t) => sql`(CASE WHEN (${codegraphLessons.title} || ' ' || ${codegraphLessons.body}) ILIKE ${'%' + t + '%'} THEN 1 ELSE 0 END)`),
    sql` + `,
  );
  const needed = Math.max(1, Math.ceil(tokens.length / 2));

  return db
    .select()
    .from(codegraphLessons)
    .where(and(base, sql`(${hits}) >= ${needed}`))
    .orderBy(sql`(${score}) DESC`, LESSON_RECENCY)
    .limit(limit);
}

/**
 * Rank what is attached to the files the caller actually named above what the
 * walk merely reached.
 *
 * One hop off a file in this repo reaches up to 300 nodes, and every lesson on
 * any of them competed on equal terms with the lessons on the seed itself. A
 * note about the connector monitor, attached to `src/lib/connectors/monitor.ts`,
 * lost its place to a note attached to an admin route that had once been edited
 * in the same session. Proximity to the seed is the strongest signal a
 * structural query has; it should not be the one thing the ordering ignores.
 *
 * Expressed through `inArray` rather than a bound array literal — a raw `= ANY`
 * needs the array binding this codebase has been bitten by before.
 */
function seedFirst(column: AnyPgColumn, seedIds: string[]): SQL | null {
  if (!seedIds.length) return null;
  return sql`(CASE WHEN ${inArray(column, seedIds)} THEN 0 ELSE 1 END)`;
}

async function pickLessons(
  nodeIds: string[],
  plan: QueryPlan,
  pick: Pick,
  repo: string,
  seedIds: string[] = [],
) {
  const base = and(eq(codegraphLessons.repo, repo), lessonVisible());

  if (plan.seed.type === 'topic' || !nodeIds.length) {
    // No structural anchor: fall back to text.
    //
    // Deliberately TOKENISED, not a whole-phrase ILIKE. This repo has already
    // paid for that mistake once: the tool catalogue's search was a raw
    // substring match, so "create tool" and "add a tool" both returned zero and
    // the cheap authoring lanes were unfindable in natural language while the
    // expensive one surfaced. A whole-phrase match here fails the same way —
    // `topic:"ci-release allow-list rsync"` matched nothing, because no note
    // contains that exact string.
    //
    // Scored, too. Substring matching without ranking returns whatever sorts
    // first, which is how a search for "rsync" answered with a note about Azure.
    if (plan.seed.type !== 'topic') {
      return db.select().from(codegraphLessons).where(base)
        .orderBy(LESSON_RECENCY).limit(pick.limit);
    }
    return topicLessons(plan.seed.text, base, pick.limit);
  }

  const nearestLesson = seedFirst(codegraphNodeLessons.nodeId, seedIds);
  const rows = await db
    .select({ l: codegraphLessons })
    .from(codegraphNodeLessons)
    .innerJoin(codegraphLessons, eq(codegraphLessons.id, codegraphNodeLessons.lessonId))
    .where(and(inArray(codegraphNodeLessons.nodeId, nodeIds), base))
    .orderBy(...(nearestLesson ? [nearestLesson, LESSON_RECENCY] : [LESSON_RECENCY]))
    .limit(pick.limit * 3);

  // Dedupe: one lesson attached to four of the seed's files must appear once.
  const seen = new Set<string>();
  const out: typeof codegraphLessons.$inferSelect[] = [];
  for (const r of rows) {
    if (seen.has(r.l.id)) continue;
    seen.add(r.l.id);
    out.push(r.l);
    if (out.length >= pick.limit) break;
  }
  return out;
}

async function pickEpisodes(
  nodeIds: string[],
  plan: QueryPlan,
  pick: Pick,
  repo: string,
  seedIds: string[] = [],
) {
  const conds: SQL[] = [eq(codegraphEpisodes.repo, repo), episodeVisible()];
  if (pick.verdicts?.length) conds.push(inArray(codegraphEpisodes.verdict, pick.verdicts));
  if (pick.gate) conds.push(eq(codegraphEpisodes.gate, pick.gate));

  // The hot lane: a fingerprint seed is a plain btree hit and needs no join.
  if (plan.seed.type === 'fingerprint') {
    conds.push(inArray(codegraphEpisodes.fingerprint, plan.seed.fingerprints));
    return db.select().from(codegraphEpisodes).where(and(...conds))
      .orderBy(EPISODE_RECENCY).limit(pick.limit);
  }

  if (plan.seed.type === 'topic') {
    // Tokenised and scored, for the same reason as lessons above — a
    // whole-phrase ILIKE returns silence on any multi-word question.
    const tokens = topicTokens(plan.seed.text);
    if (tokens.length) {
      const hay = sql`(coalesce(${codegraphEpisodes.title}, '') || ' ' || coalesce(${codegraphEpisodes.problem}, '') || ' ' || coalesce(${codegraphEpisodes.resolution}, ''))`;
      const hits = sql.join(
        tokens.map((t) => sql`(CASE WHEN ${hay} ILIKE ${'%' + t + '%'} THEN 1 ELSE 0 END)`),
        sql` + `,
      );
      conds.push(sql`(${hits}) >= ${Math.max(1, Math.ceil(tokens.length / 2))}`);
      return db.select().from(codegraphEpisodes).where(and(...conds))
        .orderBy(sql`(${hits}) DESC`, EPISODE_RECENCY).limit(pick.limit);
    }
    return db.select().from(codegraphEpisodes).where(and(...conds))
      .orderBy(EPISODE_RECENCY).limit(pick.limit);
  }

  if (!nodeIds.length) return [];

  // Same proximity rule as lessons: an episode on the file the caller named
  // beats one on a file the walk merely reached. The unordered fetch below took
  // whatever the planner returned, so a wide walk decided it by accident.
  const nearestEpisode = seedFirst(codegraphNodeEpisodes.nodeId, seedIds);
  const rows = await db
    .select({ e: codegraphEpisodes })
    .from(codegraphNodeEpisodes)
    .innerJoin(codegraphEpisodes, eq(codegraphEpisodes.id, codegraphNodeEpisodes.episodeId))
    .where(and(inArray(codegraphNodeEpisodes.nodeId, nodeIds), ...conds))
    .orderBy(...(nearestEpisode ? [nearestEpisode, EPISODE_RECENCY] : [EPISODE_RECENCY]))
    .limit(pick.limit * 4);

  const seen = new Set<string>();
  const out: typeof codegraphEpisodes.$inferSelect[] = [];
  for (const r of rows) {
    if (!seen.has(r.e.id)) { seen.add(r.e.id); out.push(r.e); }
  }
  // Rank by verdict tier first, recency second — what demonstrably worked
  // outranks what merely happened lately.
  out.sort((a, b) => {
    const va = VERDICT_RANK[a.verdict] ?? 99;
    const vb = VERDICT_RANK[b.verdict] ?? 99;
    if (va !== vb) return va - vb;
    return (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0);
  });
  return out.slice(0, pick.limit);
}


/**
 * Files of the same shape as `path`, best precedent first.
 *
 * Runs as a normal seed so `nodeVisible()` applies: a node merged away is not a
 * precedent, and that predicate stays in this one loader rather than being
 * reimplemented by whoever wants examples. It is the only thing that can ever
 * express "stop holding that file up as an example".
 *
 * In-degree is counted from `imports` edges — 6,681 of them, built by parsing
 * the tree and, until now, never read by any query. A file many others import is
 * the one that set the convention.
 */
async function siblingNodes(path: string, repo: string, limit: number): Promise<RetrievedNode[]> {
  const family = familyOf(path);
  if (!family) return [];

  const candidates = await db
    .select({
      id: codegraphNodes.id,
      canonicalPath: codegraphNodes.canonicalPath,
      kind: codegraphNodes.kind,
      episodeCount: codegraphNodes.episodeCount,
      lessonCount: codegraphNodes.lessonCount,
    })
    .from(codegraphNodes)
    .where(
      and(
        eq(codegraphNodes.repo, repo),
        eq(codegraphNodes.family, family),
        nodeVisible(),
        // A deleted file cannot be copied. This is the one query where
        // liveness HIDES rather than ranks down: a lesson about a moved file
        // is often still true, a precedent that is not in the tree is not.
        eq(codegraphNodes.existsOnHead, true),
      ),
    )
    .limit(600);

  const others = candidates.filter((c) => c.canonicalPath !== path);
  if (!others.length) return [];

  const inDegree = new Map<string, number>();
  const rows = await db
    .select({ target: codegraphEdges.targetId })
    .from(codegraphEdges)
    .where(
      and(
        eq(codegraphEdges.kind, 'imports'),
        eq(codegraphEdges.suppressed, false),
        inArray(codegraphEdges.targetId, others.map((o) => o.id)),
      ),
    );
  for (const r of rows) inDegree.set(r.target, (inDegree.get(r.target) ?? 0) + 1);

  return others
    .map((c) => ({
      node: c,
      score: siblingScore(path, {
        path: c.canonicalPath,
        inDegree: inDegree.get(c.id) ?? 0,
        episodes: c.episodeCount ?? 0,
        lessons: c.lessonCount ?? 0,
      }),
    }))
    .sort((a, b) => b.score - a.score || a.node.canonicalPath.localeCompare(b.node.canonicalPath))
    .slice(0, limit)
    .map((x) => x.node);
}


/**
 * The file paired with `path` by a `tests` edge, in whichever direction.
 *
 * Both directions on purpose. Given a module it answers "what covers this";
 * given a test it answers "what does this cover" — and a build writing tests
 * wants the second as much as a build changing code wants the first.
 *
 * This is the cheapest fix on the board for a measured failure: agents guessing
 * test filenames produced 19 ENOENTs across three builds, looking for
 * `test-runner.test.ts` when the real file is `test-runner.diagnostics.test.ts`.
 * The edge has existed since the first backfill and nothing ever read it.
 */
async function testNodes(path: string, repo: string, limit: number): Promise<RetrievedNode[]> {
  const [target] = await db
    .select({ id: codegraphNodes.id })
    .from(codegraphNodes)
    .where(and(eq(codegraphNodes.repo, repo), eq(codegraphNodes.canonicalPath, path), nodeVisible()))
    .limit(1);
  if (!target) return [];

  const edges = await db
    .select({ source: codegraphEdges.sourceId, target: codegraphEdges.targetId })
    .from(codegraphEdges)
    .where(
      and(
        eq(codegraphEdges.kind, 'tests'),
        eq(codegraphEdges.suppressed, false),
        or(eq(codegraphEdges.sourceId, target.id), eq(codegraphEdges.targetId, target.id)),
      ),
    )
    .limit(20);

  const otherIds = [...new Set(edges.flatMap((e) => [e.source, e.target]))].filter((id) => id !== target.id);
  if (!otherIds.length) return [];

  return db
    .select({
      id: codegraphNodes.id,
      canonicalPath: codegraphNodes.canonicalPath,
      kind: codegraphNodes.kind,
      episodeCount: codegraphNodes.episodeCount,
      lessonCount: codegraphNodes.lessonCount,
    })
    .from(codegraphNodes)
    // Liveness hides here for the same reason it does for siblings: a build
    // cannot open a test that is no longer in the tree, and naming one is
    // exactly the guess this is meant to stop.
    .where(and(inArray(codegraphNodes.id, otherIds), nodeVisible(), eq(codegraphNodes.existsOnHead, true)))
    .limit(limit);
}

/** Execute a parsed plan. Throws only on infrastructure failure. */
export async function runPlan(plan: QueryPlan, opts: { repo?: string } = {}): Promise<RetrievalResult> {
  const started = Date.now();
  const repo = opts.repo ?? 'SR-Main';

  // The siblings seed answers with nodes and nothing else — no walk, no prose.
  // It is a different question from "what have we learned about this file", and
  // mixing them would make the caller's budget impossible to attribute.
  if (plan.seed.type === 'siblings' || plan.seed.type === 'tests') {
    const limit = plan.picks.find((p) => p.kind === 'nodes')?.limit ?? 2;
    const nodes = plan.seed.type === 'siblings'
      ? await siblingNodes(plan.seed.path, repo, limit)
      : await testNodes(plan.seed.path, repo, limit);
    return {
      plan,
      seedNodeIds: [],
      nodes,
      lessons: [],
      episodes: [],
      outcome: nodes.length ? 'served' : 'empty',
      durationMs: Date.now() - started,
    };
  }

  const seeds = await seedNodes(plan, repo);
  const nodeIds = await walk(seeds, plan);

  const lessons: RetrievedLesson[] = [];
  const episodes: RetrievedEpisode[] = [];
  const nodes: RetrievedNode[] = [];

  for (const pick of plan.picks) {
    if (pick.kind === 'lessons') {
      for (const l of await pickLessons(nodeIds, plan, pick, repo, seeds)) {
        lessons.push({
          id: l.id, title: l.title, body: l.body,
          citedPaths: (l.citedPaths as string[]) ?? [], origin: l.origin,
          relevance: relevanceOf({
            served: l.servedCount ?? 0,
            helpful: l.helpfulCount ?? 0,
            unhelpful: l.unhelpfulCount ?? 0,
            // observedAt only — updatedAt is the ingest clock, identical for
            // every backfilled row. See relevance/+page.server.ts.
            observedAt: l.observedAt ?? null,
            stale: Boolean(l.staleAt),
          }),
        });
      }
    } else if (pick.kind === 'episodes') {
      for (const e of await pickEpisodes(nodeIds, plan, pick, repo, seeds)) {
        episodes.push({
          id: e.id, title: e.title, problem: e.problem, resolution: e.resolution,
          verification: e.verification, fingerprint: e.fingerprint, gate: e.gate,
          verdict: e.verdict, filesTouched: (e.filesTouched as string[]) ?? [],
          prNumber: e.prNumber, occurredAt: e.occurredAt,
          relevance: relevanceOf({
            served: e.servedCount ?? 0,
            helpful: e.helpfulCount ?? 0,
            unhelpful: e.unhelpfulCount ?? 0,
            observedAt: e.occurredAt ?? null,
            // Without this the multiplier exists and never fires. An unverified
            // episode would rank level with one we watched go green.
            verdict: e.verdict,
          }),
        });
      }
    } else if (nodeIds.length) {
      const rows = await db
        .select({
          id: codegraphNodes.id, canonicalPath: codegraphNodes.canonicalPath,
          kind: codegraphNodes.kind, episodeCount: codegraphNodes.episodeCount,
          lessonCount: codegraphNodes.lessonCount,
        })
        .from(codegraphNodes)
        .where(and(inArray(codegraphNodes.id, nodeIds), nodeVisible()))
        .orderBy(desc(codegraphNodes.episodeCount))
        .limit(pick.limit);
      nodes.push(...rows);
    }
  }

  // Rank by measured relevance before anything is spent on it. This is the
  // point at which atrophy reaches a build: a lesson that has never helped
  // sinks here, and the budget below simply never reaches it.
  lessons.sort((a, b) => b.relevance.score - a.relevance.score);
  episodes.sort((a, b) => b.relevance.score - a.relevance.score);

  return {
    plan,
    seedNodeIds: seeds,
    nodes,
    lessons,
    episodes,
    outcome: lessons.length || episodes.length || nodes.length ? 'served' : 'empty',
    durationMs: Date.now() - started,
  };
}

/** Parse and execute in one call. */
export async function runCgql(query: string, opts: { repo?: string } = {}): Promise<RetrievalResult> {
  return runPlan(parseCgql(query), opts);
}

function trim(s: string | null | undefined, n: number): string {
  const t = (s ?? '').trim().replace(/\s+\n/g, '\n');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * Render a result as the markdown block that goes into a build's context.
 *
 * INFORMATIVE ABSENCE. An empty result renders as an explicit "no precedent"
 * note, not as nothing. Rendering nothing would be indistinguishable from the
 * retrieval never having run — which is precisely how the tool bridge stayed
 * broken for sixty days while logging that it was fine. The agent is told the
 * graph was consulted and had nothing, so it treats the ground as new instead
 * of inferring that the area is uncovered.
 */
export function buildContextBlock(result: RetrievalResult): string {
  const budget = result.plan.budgetChars;

  // A siblings query is answering a different question, so it gets its own
  // heading. The pull channel prints this; the push channel ignores it and
  // injects the source itself (see codegraph/precedent.ts).
  if (result.plan.seed.type === 'tests') {
    const p = result.plan.seed.path;
    return result.nodes.length
      ? [
          '## The tests for this file',
          '',
          ...result.nodes.map((n) => `- \`${n.canonicalPath}\``),
          '',
          'Update them alongside your change. Do not guess at the filename — this is it.',
        ].join('\n')
      : [
          '## The tests for this file',
          '',
          `NO PRECEDENT — the graph holds no test paired with \`${p}\`.`,
          'If you add one, put it where this repo puts the others for that area.',
        ].join('\n');
  }

  if (result.plan.seed.type === 'siblings') {
    if (!result.nodes.length) {
      return [
        '## Files of the same shape',
        '',
        `NO PRECEDENT — nothing in the graph shares a shape with \`${result.plan.seed.path}\`.`,
        'Either it is a new kind of file here, or the tree pass has not seen it yet.',
      ].join('\n');
    }
    return [
      '## Files of the same shape',
      '',
      'Closest precedents first — same directory, then import centrality, then recorded history.',
      '',
      ...result.nodes.map((n, i) => `${i + 1}. \`${n.canonicalPath}\``),
      '',
      'Read them before writing. Copy their structure, naming, error handling and helpers.',
    ].join('\n');
  }

  const lines: string[] = ['## What this codebase has already learned'];

  if (result.outcome === 'empty') {
    lines.push(
      '',
      'NO PRECEDENT — the build-history graph was consulted and holds nothing for',
      'this file set or error. That means this is new ground, **not** that the area',
      'is safe or uncovered. Proceed on the code in front of you.',
    );
    return lines.join('\n');
  }

  let used = lines[0].length;

  /*
   * The related-file list is costed FIRST and held back, then appended last.
   *
   * It used to be assembled after lessons and episodes had spent the budget,
   * guarded by an `if it still fits` — and since the lessons packer fills the
   * budget by design, it never fitted. The section existed, was never rendered,
   * and no counter said so. It is ~200 characters against a 5,000 budget and it
   * is the only part of the block that answers "what else moves with this
   * file", so it gets its space before the prose does.
   *
   * The seed files are dropped: naming the agent the files it just told us
   * about is pure cost, and it crowds out the neighbours that are the point.
   */
  const seedPaths = new Set(result.plan.seed.type === 'file' ? result.plan.seed.paths : []);
  const related = result.nodes
    .filter((n) => !seedPaths.has(n.canonicalPath))
    .slice(0, 10)
    .map((n) => n.canonicalPath);
  const relatedEntry = related.length
    ? `\n### Files that change alongside these\n${related.join(', ')}`
    : '';
  const reserved = relatedEntry.length;
  // Lessons first: a rule is shorter and more general than an episode, so it
  // buys more per character when the budget is tight.
  //
  // Packed BY RELEVANCE rather than in list order, and with `break` replaced by
  // a skip: one oversized lesson used to end the section, silently costing
  // every smaller high-relevance rule behind it.
  if (result.lessons.length) {
    lines.push('', '### Rules that apply here');
    const entries = result.lessons.map((l) => ({
      item: `\n**${l.title}**\n${trim(l.body, 700)}`,
      score: l.relevance.score,
      cost: trim(l.body, 700).length + l.title.length + 6,
    }));
    const packed = packByRelevance(entries, Math.max(0, budget - used - reserved));
    for (const e of packed.chosen) lines.push(e);
    used += packed.spent;
  }

  if (result.episodes.length) {
    lines.push('', '### What happened last time');
    for (const e of result.episodes) {
      const bits = [
        `\n**${e.title ?? e.fingerprint ?? 'Earlier change'}** — \`${e.verdict}\`` +
          (e.prNumber ? ` (PR #${e.prNumber})` : ''),
        e.problem ? `- Problem: ${trim(e.problem, 300)}` : '',
        e.resolution ? `- Fix: ${trim(e.resolution, 400)}` : '',
        e.verification ? `- Verified by: \`${trim(e.verification, 160)}\`` : '',
        e.filesTouched.length ? `- Files: ${e.filesTouched.slice(0, 6).join(', ')}` : '',
      ].filter(Boolean);
      const entry = bits.join('\n');
      if (used + entry.length > budget - reserved) break;
      lines.push(entry);
      used += entry.length;
    }
  }

  if (relatedEntry) lines.push(relatedEntry);

  lines.push(
    '',
    '_Retrieved from the build-history graph. Verdicts: `verified` proved by a gate,',
    '`landed` merged, `repaired` later corrected — weigh them accordingly._',
  );
  return lines.join('\n');
}
