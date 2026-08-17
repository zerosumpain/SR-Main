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
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  codegraphEdges,
  codegraphEpisodes,
  codegraphLessons,
  codegraphNodeEpisodes,
  codegraphNodeLessons,
  codegraphNodes,
} from '$lib/db/schema';
import { parseCgql, type Pick, type QueryPlan, VERDICTS } from './query';

export interface RetrievedLesson {
  id: string;
  title: string;
  body: string;
  citedPaths: string[];
  origin: string;
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
          inArray(codegraphNodes.canonicalPath, seed.gates)),
      )
      .limit(50);
    return rows.map((r) => r.id);
  }

  // fingerprint / topic seeds address episodes and lessons directly, not nodes.
  return [];
}

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
    frontier = next;
  }
  // Bounded: two hops on a dense file graph can reach most of the repo, and a
  // retrieval that returns everything has told the agent nothing.
  return [...seen].slice(0, 300);
}

/**
 * Split a topic into searchable tokens.
 *
 * Stopwords go, because "how does the tool bridge work" is four noise words and
 * two real ones, and letting "how"/"the" score would rank every note equally.
 * Short tokens go for the same reason.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'how', 'what', 'why', 'when', 'where', 'who', 'which', 'does', 'do', 'did',
  'for', 'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'this', 'that',
  'it', 'its', 'we', 'you', 'i', 'my', 'our', 'work', 'works', 'use', 'used',
]);

export function topicTokens(text: string, max = 8): string[] {
  const out: string[] = [];
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9_.\-/]+/)) {
    const t = raw.replace(/^[-._/]+|[-._/]+$/g, '');
    if (t.length < 3 || STOPWORDS.has(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
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
      .orderBy(desc(codegraphLessons.observedAt)).limit(limit);
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
    .orderBy(sql`(${score}) DESC`, desc(codegraphLessons.observedAt))
    .limit(limit);
}

async function pickLessons(nodeIds: string[], plan: QueryPlan, pick: Pick, repo: string) {
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
        .orderBy(desc(codegraphLessons.observedAt)).limit(pick.limit);
    }
    return topicLessons(plan.seed.text, base, pick.limit);
  }

  const rows = await db
    .select({ l: codegraphLessons })
    .from(codegraphNodeLessons)
    .innerJoin(codegraphLessons, eq(codegraphLessons.id, codegraphNodeLessons.lessonId))
    .where(and(inArray(codegraphNodeLessons.nodeId, nodeIds), base))
    .orderBy(desc(codegraphLessons.observedAt))
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

async function pickEpisodes(nodeIds: string[], plan: QueryPlan, pick: Pick, repo: string) {
  const conds: SQL[] = [eq(codegraphEpisodes.repo, repo), episodeVisible()];
  if (pick.verdicts?.length) conds.push(inArray(codegraphEpisodes.verdict, pick.verdicts));
  if (pick.gate) conds.push(eq(codegraphEpisodes.gate, pick.gate));

  // The hot lane: a fingerprint seed is a plain btree hit and needs no join.
  if (plan.seed.type === 'fingerprint') {
    conds.push(inArray(codegraphEpisodes.fingerprint, plan.seed.fingerprints));
    return db.select().from(codegraphEpisodes).where(and(...conds))
      .orderBy(desc(codegraphEpisodes.occurredAt)).limit(pick.limit);
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
        .orderBy(sql`(${hits}) DESC`, desc(codegraphEpisodes.occurredAt)).limit(pick.limit);
    }
    return db.select().from(codegraphEpisodes).where(and(...conds))
      .orderBy(desc(codegraphEpisodes.occurredAt)).limit(pick.limit);
  }

  if (!nodeIds.length) return [];

  const rows = await db
    .select({ e: codegraphEpisodes })
    .from(codegraphNodeEpisodes)
    .innerJoin(codegraphEpisodes, eq(codegraphEpisodes.id, codegraphNodeEpisodes.episodeId))
    .where(and(inArray(codegraphNodeEpisodes.nodeId, nodeIds), ...conds))
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

/** Execute a parsed plan. Throws only on infrastructure failure. */
export async function runPlan(plan: QueryPlan, opts: { repo?: string } = {}): Promise<RetrievalResult> {
  const started = Date.now();
  const repo = opts.repo ?? 'SR-Main';

  const seeds = await seedNodes(plan, repo);
  const nodeIds = await walk(seeds, plan);

  const lessons: RetrievedLesson[] = [];
  const episodes: RetrievedEpisode[] = [];
  const nodes: RetrievedNode[] = [];

  for (const pick of plan.picks) {
    if (pick.kind === 'lessons') {
      for (const l of await pickLessons(nodeIds, plan, pick, repo)) {
        lessons.push({
          id: l.id, title: l.title, body: l.body,
          citedPaths: (l.citedPaths as string[]) ?? [], origin: l.origin,
        });
      }
    } else if (pick.kind === 'episodes') {
      for (const e of await pickEpisodes(nodeIds, plan, pick, repo)) {
        episodes.push({
          id: e.id, title: e.title, problem: e.problem, resolution: e.resolution,
          verification: e.verification, fingerprint: e.fingerprint, gate: e.gate,
          verdict: e.verdict, filesTouched: (e.filesTouched as string[]) ?? [],
          prNumber: e.prNumber, occurredAt: e.occurredAt,
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
  // Lessons first: a rule is shorter and more general than an episode, so it
  // buys more per character when the budget is tight.
  if (result.lessons.length) {
    lines.push('', '### Rules that apply here');
    for (const l of result.lessons) {
      const body = trim(l.body, 700);
      const entry = `\n**${l.title}**\n${body}`;
      if (used + entry.length > budget) break;
      lines.push(entry);
      used += entry.length;
    }
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
      if (used + entry.length > budget) break;
      lines.push(entry);
      used += entry.length;
    }
  }

  if (result.nodes.length) {
    const names = result.nodes.slice(0, 10).map((n) => n.canonicalPath).join(', ');
    const entry = `\n### Related files\n${names}`;
    if (used + entry.length <= budget) lines.push(entry);
  }

  lines.push(
    '',
    '_Retrieved from the build-history graph. Verdicts: `verified` proved by a gate,',
    '`landed` merged, `repaired` later corrected — weigh them accordingly._',
  );
  return lines.join('\n');
}
