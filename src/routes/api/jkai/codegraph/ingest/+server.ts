/**
 * POST /api/jkai/codegraph/ingest — receive extracted graph units from the
 * homeserv scanner (`scripts/codegraph-backfill.mjs`).
 *
 * The raw transcripts are 858 MB and live only on homeserv; homeserv's own
 * `DATABASE_URL` points at a stale local copy. So extraction happens there and
 * the distilled units come here, exactly like the changelog ingest that already
 * runs every fifteen minutes.
 *
 * IDEMPOTENT by construction: every unit carries a caller-supplied natural key
 * (`repo`+`canonicalPath` for nodes, `repo`+`slug` for lessons, `sourceId`+
 * `fingerprint`+`title` hashed for episodes), and re-posting the same batch
 * updates in place. A backfill that cannot be re-run safely is a backfill
 * nobody dares re-run.
 */
import { json, error } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  codegraphEdges,
  codegraphEpisodes,
  codegraphLessons,
  codegraphNodeEpisodes,
  codegraphNodeLessons,
  codegraphNodes,
} from '$lib/db/schema';
import { codegraphServiceAuthorized } from '$lib/codegraph/auth';
import { familyOf } from '$lib/codegraph/family';
import { pgTextArray } from '$lib/db/sql-array';
import type { RequestHandler } from './$types';

interface NodeIn { kind?: string; canonicalPath: string; repo?: string; displayName?: string; summary?: string; existsOnHead?: boolean }
interface EdgeIn { source: string; target: string; kind: string; weight?: number }
interface EpisodeIn {
  repo?: string; sourceKind?: string; sourceId?: string; title?: string;
  problem?: string; resolution?: string; verification?: string;
  fingerprint?: string; gate?: string; verdict?: string;
  filesTouched?: string[]; prNumber?: number; occurredAt?: string; nodes?: string[];
}
interface LessonIn {
  repo?: string; slug: string; title: string; body: string;
  origin?: string; originRef?: string; citedPaths?: string[]; observedAt?: string;
}

const VERDICTS = new Set(['verified', 'landed', 'unverified', 'repaired', 'abandoned']);
const EDGE_KINDS = new Set(['co_change', 'needs_context', 'gated_by', 'imports', 'fixed_by', 'tests']);
const MAX_BATCH = 5000;

function ts(v: string | undefined | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Resolve canonical paths to node ids, creating any that are missing. */
async function ensureNodes(paths: string[], repo: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return map;

  for (let i = 0; i < unique.length; i += 500) {
    const slice = unique.slice(i, i + 500);
    const rows = await db
      .select({ id: codegraphNodes.id, p: codegraphNodes.canonicalPath })
      .from(codegraphNodes)
      .where(and(eq(codegraphNodes.repo, repo), inArray(codegraphNodes.canonicalPath, slice)));
    for (const r of rows) map.set(r.p, r.id);
  }

  const missing = unique.filter((p) => !map.has(p));
  for (let i = 0; i < missing.length; i += 500) {
    const slice = missing.slice(i, i + 500);
    const inserted = await db
      .insert(codegraphNodes)
      .values(slice.map((p) => ({
        repo,
        canonicalPath: p,
        kind: p.includes('.') ? 'file' : 'dir',
        displayName: p.split('/').pop() ?? p,
        // Stamped HERE, never taken from the body. Family is a pure function of
        // the path, so the server can always compute it — and a caller that
        // disagreed (an older tree pass, a hand-rolled curl) would silently
        // split one family in two and make "the siblings of X" wrong.
        family: familyOf(p),
      })))
      .onConflictDoUpdate({
        target: [codegraphNodes.repo, codegraphNodes.canonicalPath],
        set: { updatedAt: new Date(), family: sql`excluded.family` },
      })
      .returning({ id: codegraphNodes.id, p: codegraphNodes.canonicalPath });
    for (const r of inserted) map.set(r.p, r.id);
  }
  return map;
}

export const POST: RequestHandler = async ({ request }) => {
  if (!codegraphServiceAuthorized(request)) throw error(401, 'unauthorized');

  const body = (await request.json().catch(() => null)) as {
    repo?: string; nodes?: NodeIn[]; edges?: EdgeIn[]; episodes?: EpisodeIn[]; lessons?: LessonIn[];
    liveness?: { ref?: string; paths?: string[] };
  } | null;
  if (!body) throw error(400, 'invalid json');

  const repo = body.repo || 'SR-Main';
  const nodesIn = body.nodes ?? [];
  const edgesIn = body.edges ?? [];
  const episodesIn = body.episodes ?? [];
  const lessonsIn = body.lessons ?? [];

  if (nodesIn.length + edgesIn.length + episodesIn.length + lessonsIn.length > MAX_BATCH) {
    throw error(413, `batch too large (max ${MAX_BATCH} units)`);
  }

  const counts = { nodes: 0, edges: 0, episodes: 0, lessons: 0 };
  // Reported separately: liveness is a stamp over the whole repo, not a count
  // of units received, and conflating them hid a 64% error rate once already.
  let liveness: { live: number; dead: number } | { skipped: string } | null = null;

  // --- Nodes -------------------------------------------------------------
  if (nodesIn.length) {
    for (let i = 0; i < nodesIn.length; i += 500) {
      const slice = nodesIn.slice(i, i + 500).filter((n) => n?.canonicalPath);
      if (!slice.length) continue;
      await db.insert(codegraphNodes).values(slice.map((n) => ({
        repo: n.repo || repo,
        canonicalPath: n.canonicalPath,
        kind: n.kind || 'file',
        displayName: n.displayName ?? n.canonicalPath.split('/').pop(),
        summary: n.summary ?? null,
        family: familyOf(n.canonicalPath),
        existsOnHead: n.existsOnHead ?? true,
        lastSeenAt: new Date(),
      }))).onConflictDoUpdate({
        target: [codegraphNodes.repo, codegraphNodes.canonicalPath],
        set: {
          // NOT updated here. A new node is presumed live on insert, but the
          // only writer that may CHANGE liveness is the whole-tree statement
          // below, which knows which commit it is looking at. Left in this set,
          // a history writer that simply omitted the field would silently
          // resurrect every deleted file it mentioned, because the column
          // defaults to true.
          summary: sql`coalesce(excluded.summary, ${codegraphNodes.summary})`,
          family: sql`excluded.family`,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });
      counts.nodes += slice.length;
    }
  }

  /*
   * Liveness, and why it is guarded like this.
   *
   * A full tree arrives from `codegraph-tree-pass.mjs` at a NAMED ref, so the
   * honest thing to do is mark everything else deleted. The last time this repo
   * stamped liveness it did so from a working copy on the wrong branch and
   * marked 216 files gone, 138 of them wrongly — including codegraph's own
   * source. That was not caught by a sentinel check, because the two sentinel
   * files it looked for exist on every branch.
   *
   * So the guard is not "do these files exist" but "is this plausibly a whole
   * tree". A partial payload cannot be told from a truncated one, and the cost
   * of being wrong is asymmetric: a stale `true` is a precedent that no longer
   * compiles, a wrong `false` deletes the graph's memory of a live file.
   */
  if (body.liveness?.paths?.length) {
    const paths = body.liveness.paths.filter((p) => typeof p === 'string' && p);
    const MIN_TREE = 1000;
    if (paths.length < MIN_TREE) {
      liveness = { skipped: `${paths.length} paths is below the ${MIN_TREE} floor` };
    } else {
      const live = await db
        .update(codegraphNodes)
        .set({ existsOnHead: true, lastSeenAt: new Date() })
        .where(and(
          eq(codegraphNodes.repo, repo),
          sql`${codegraphNodes.canonicalPath} = ANY(${pgTextArray(paths)}::text[])`,
        ))
        .returning({ id: codegraphNodes.id });

      const dead = await db
        .update(codegraphNodes)
        .set({ existsOnHead: false })
        .where(
          and(
            eq(codegraphNodes.repo, repo),
            eq(codegraphNodes.kind, 'file'),
            // `pgTextArray`, not a bare array. Drizzle binds a JS array as a
            // TUPLE — `<> ALL(($4, $5, …))` — which Postgres reads as a row
            // expression and rejects, 500ing the whole ingest. This repo has
            // paid for that once already; see src/lib/db/sql-array.ts.
            sql`${codegraphNodes.canonicalPath} <> ALL(${pgTextArray(paths)}::text[])`,
          ),
        )
        .returning({ id: codegraphNodes.id });

      liveness = { live: live.length, dead: dead.length };
    }
  }

  // --- Lessons -----------------------------------------------------------
  if (lessonsIn.length) {
    const valid = lessonsIn.filter((l) => l?.slug && l?.title && l?.body);
    for (let i = 0; i < valid.length; i += 200) {
      const slice = valid.slice(i, i + 200);
      const rows = await db.insert(codegraphLessons).values(slice.map((l) => ({
        repo: l.repo || repo,
        slug: l.slug,
        title: l.title.slice(0, 500),
        body: l.body,
        origin: l.origin || 'memory-note',
        originRef: l.originRef ?? null,
        citedPaths: l.citedPaths ?? [],
        observedAt: ts(l.observedAt),
      }))).onConflictDoUpdate({
        target: [codegraphLessons.repo, codegraphLessons.slug],
        set: {
          title: sql`excluded.title`,
          body: sql`excluded.body`,
          citedPaths: sql`excluded.cited_paths`,
          observedAt: sql`excluded.observed_at`,
          updatedAt: new Date(),
        },
      }).returning({ id: codegraphLessons.id, slug: codegraphLessons.slug });
      counts.lessons += rows.length;

      // Attach each lesson to the nodes it names, so a file-seeded query finds it.
      const bySlug = new Map(rows.map((r) => [r.slug!, r.id]));
      const allPaths = slice.flatMap((l) => l.citedPaths ?? []);
      const nodeMap = await ensureNodes(allPaths, repo);
      const links: Array<{ nodeId: string; lessonId: string }> = [];
      for (const l of slice) {
        const lid = bySlug.get(l.slug);
        if (!lid) continue;
        for (const p of l.citedPaths ?? []) {
          const nid = nodeMap.get(p);
          if (nid) links.push({ nodeId: nid, lessonId: lid });
        }
      }
      if (links.length) {
        await db.insert(codegraphNodeLessons).values(links).onConflictDoNothing();
      }
    }
  }

  // --- Episodes ----------------------------------------------------------
  if (episodesIn.length) {
    for (const e of episodesIn) {
      if (!e) continue;
      const verdict = VERDICTS.has(e.verdict ?? '') ? e.verdict! : 'unverified';
      const files = (e.filesTouched ?? []).filter(Boolean).slice(0, 40);

      // The natural key. Computed server-side so every caller gets the same
      // one — a client-supplied key would drift the moment a second ingester
      // existed, which is exactly how the duplicate-episode bug would come back.
      const dedupeKey = createHash('sha256')
        .update([
          e.repo || repo,
          e.sourceId ?? '',
          e.fingerprint ?? '',
          e.occurredAt ?? '',
          files.join(','),
        ].join('|'))
        .digest('hex')
        .slice(0, 40);

      const [row] = await db.insert(codegraphEpisodes).values({
        dedupeKey,
        repo: e.repo || repo,
        sourceKind: e.sourceKind || 'session',
        sourceId: e.sourceId ?? null,
        title: e.title?.slice(0, 500) ?? null,
        problem: e.problem?.slice(0, 4000) ?? null,
        resolution: e.resolution?.slice(0, 4000) ?? null,
        verification: e.verification?.slice(0, 1000) ?? null,
        fingerprint: e.fingerprint ?? null,
        gate: e.gate ?? null,
        verdict,
        filesTouched: files,
        prNumber: e.prNumber ?? null,
        occurredAt: ts(e.occurredAt),
      }).onConflictDoUpdate({
        target: codegraphEpisodes.dedupeKey,
        set: {
          // Refresh the mutable facts; never touch retiredAt/servedCount, or a
          // nightly re-ingest would silently un-retire what someone forgot on
          // purpose and reset the usage evidence.
          problem: sql`excluded.problem`,
          resolution: sql`excluded.resolution`,
          verification: sql`excluded.verification`,
          verdict: sql`excluded.verdict`,
          prNumber: sql`excluded.pr_number`,
        },
      }).returning({ id: codegraphEpisodes.id });
      // An upsert that updated an existing row returns it too, so this counts
      // "units accepted", not "new rows" — the log says posted, the table says
      // distinct, and those are different numbers by design.
      counts.episodes += 1;

      const nodeMap = await ensureNodes([...files, ...(e.nodes ?? [])], repo);
      const links = [...nodeMap.values()].map((nodeId) => ({ nodeId, episodeId: row.id }));
      if (links.length) await db.insert(codegraphNodeEpisodes).values(links).onConflictDoNothing();
    }
  }

  // --- Edges -------------------------------------------------------------
  if (edgesIn.length) {
    const paths = edgesIn.flatMap((e) => [e.source, e.target]);
    const nodeMap = await ensureNodes(paths, repo);
    const values = edgesIn
      .filter((e) => EDGE_KINDS.has(e.kind) && nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        sourceId: nodeMap.get(e.source)!,
        targetId: nodeMap.get(e.target)!,
        kind: e.kind,
        weight: Math.max(1, Math.min(10_000, e.weight ?? 1)),
        lastSeenAt: new Date(),
      }))
      .filter((e) => e.sourceId !== e.targetId);

    for (let i = 0; i < values.length; i += 500) {
      const slice = values.slice(i, i + 500);
      if (!slice.length) continue;
      // REPLACE the weight, do not add to it — and the caller must therefore
      // send the TOTAL for that pair, not one occurrence.
      //
      // This looks like the wrong operator and is not. `weight + excluded.weight`
      // is the obvious reading of "count how often these change together", but
      // it makes the ingest non-idempotent: every re-run of the backfill would
      // inflate every weight, exactly as re-running once doubled the episode
      // table before it got a natural key. The scanner aggregates per pair
      // across the whole corpus in memory and posts each edge once, so REPLACE
      // is both correct and re-runnable.
      //
      // Until 2026-08-17 the caller sent 1 per occurrence and this replaced with
      // 1, so every edge in the graph had weight exactly 1: p50 and max alike.
      // Nothing could distinguish a habit from a coincidence, the force layout
      // pulled every pair equally, and half the graph read as unclustered noise.
      await db.insert(codegraphEdges).values(slice).onConflictDoUpdate({
        target: [codegraphEdges.sourceId, codegraphEdges.targetId, codegraphEdges.kind],
        set: { weight: sql`excluded.weight`, lastSeenAt: new Date() },
      });
      counts.edges += slice.length;
    }
  }

  // Denormalised counts drive the ER map's node sizing; recompute rather than
  // increment, so a re-run cannot inflate them.
  await db.execute(sql`
    UPDATE codegraph_nodes n SET
      episode_count = (SELECT count(*) FROM codegraph_node_episodes x WHERE x.node_id = n.id),
      lesson_count  = (SELECT count(*) FROM codegraph_node_lessons  y WHERE y.node_id = n.id)
    WHERE n.repo = ${repo}
  `);

  return json({ ok: true, counts, liveness });
};
