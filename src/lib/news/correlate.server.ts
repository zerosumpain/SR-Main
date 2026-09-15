// Building the anchors — the "important elements" half of news correlation.
//
// THIS HALF TOUCHES THE DB. The maths lives in `correlate.ts`, which is pure and
// therefore testable without a database and safe for a client bundle. Same split
// as thread-graph / thread-graph.server, and for the same reason.
//
// "Important" is not one number the schema already holds, so it is computed from
// what each source can honestly support:
//
//   entity    connectedness (relationship degree), plus a lift for `watched`
//             and `confirmed` — the two flags that mean a person said so
//   research  recency of a completed session; you researched it, it matters
//   memory    the stored confidence, which the memory writer set
//   chat      an entity whose evidence is a chat note, i.e. something the
//             conversations themselves keep returning to
//
// Every one is bounded to 0–1 so `correlate.ts` can compare across sources
// without knowing where a number came from.

import { db } from '$lib/db';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  intelEntities,
  intelEntityTypes,
  jkaiMemories,
  researchSessions,
} from '$lib/db/schema';
import type { Anchor } from './correlate';

/**
 * Anchors are three DB queries and the desk re-renders on every tab, sort and
 * filter click, so they are cached in-process. Ten minutes: what the graph
 * considers important moves on the scale of days, and a stale anchor costs a
 * missed badge rather than a wrong one.
 */
const ANCHOR_TTL_MS = 10 * 60 * 1000;
let anchorCache: { value: { anchors: Anchor[]; gathered: string[] }; expiresAt: number } | null = null;

/** Test isolation, and a way for an ingest to force a rebuild. */
export function clearAnchorCache(): void {
  anchorCache = null;
}

/** How many of each source to take. The matcher is O(stories × anchors) over
 *  ~50 short strings, so this is a relevance budget, not a performance one. */
const ENTITY_LIMIT = 120;
const RESEARCH_LIMIT = 20;
const MEMORY_LIMIT = 25;
const RESEARCH_WINDOW_DAYS = 60;
const MEMORY_WINDOW_DAYS = 45;

/** Degree at which an entity is treated as fully important. Above it the score
 *  saturates: the difference between 20 and 60 connections is not four times
 *  the interest, and letting it scale linearly buried everything else. */
const DEGREE_SATURATION = 12;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Entities worth watching the news for: the best-connected ones, with a lift for
 * the two flags that record a human decision.
 *
 * Degree is counted in one grouped query over both ends of the relationship
 * table rather than a correlated subquery per entity — `intel_relationships` is
 * large and the per-row shape is exactly the pattern this repo has had to index
 * its way out of before.
 */
async function entityAnchors(): Promise<Anchor[]> {
  const degrees = db.$with('degrees').as(
    db
      .select({
        entityId: sql<string>`x.entity_id`.as('entity_id'),
        degree: sql<number>`count(*)::int`.as('degree'),
      })
      .from(
        sql`(
          SELECT source_entity_id AS entity_id FROM intel_relationships
          UNION ALL
          SELECT target_entity_id AS entity_id FROM intel_relationships
        ) x`,
      )
      .groupBy(sql`x.entity_id`),
  );

  // Note counts come back with the entities rather than per-row later: the desk
  // draws up to 75 rows and a count query per row is the shape this repo has
  // had to index its way out of before.
  const evidence = db.$with('evidence').as(
    db
      .select({
        entityId: sql<string>`ne.entity_id`.as('ev_entity_id'),
        notes: sql<number>`count(distinct ne.note_id)::int`.as('ev_notes'),
        lastSeen: sql<string | null>`max(n.created_at)`.as('ev_last_seen'),
      })
      .from(sql`intel_note_entities ne JOIN intel_notes n ON n.id = ne.note_id`)
      .groupBy(sql`ne.entity_id`),
  );

  const rows = await db
    .with(degrees, evidence)
    .select({
      id: intelEntities.id,
      notes: sql<number>`coalesce(${evidence.notes}, 0)`,
      lastSeen: sql<string | null>`${evidence.lastSeen}`,
      name: intelEntities.name,
      aliases: intelEntities.aliases,
      canonicalName: intelEntities.canonicalName,
      watched: intelEntities.watched,
      confirmed: intelEntities.confirmed,
      type: intelEntityTypes.name,
      degree: sql<number>`coalesce(${degrees.degree}, 0)`,
    })
    .from(intelEntities)
    .leftJoin(degrees, eq(degrees.entityId, intelEntities.id))
    .leftJoin(evidence, eq(evidence.entityId, intelEntities.id))
    .leftJoin(intelEntityTypes, eq(intelEntityTypes.id, intelEntities.typeId))
    .where(
      and(
        // A merged entity is a tombstone; its surviving twin carries the aliases.
        isNull(intelEntities.mergedIntoId),
        // THE ANCHOR RULE. "Keep in graph" on a story writes an intel note
        // carrying `metadata.newsKey`, which mints entities — so without this,
        // keeping one story makes the next story about it look relevant, and
        // the desk ends up recommending what it already recommended. An entity
        // whose ONLY evidence is news therefore cannot be an anchor.
        //
        // Watched and confirmed survive regardless: both record a person
        // deciding this matters, which is evidence from outside the loop and
        // the strongest kind there is. Same rule the mail relevance work
        // arrived at, one hop away.
        sql`(
          ${intelEntities.watched}
          OR ${intelEntities.confirmed}
          OR EXISTS (
            SELECT 1 FROM intel_note_entities ne
            JOIN intel_notes n ON n.id = ne.note_id
            WHERE ne.entity_id = ${intelEntities.id}
              AND n.metadata->>'newsKey' IS NULL
          )
          OR NOT EXISTS (
            SELECT 1 FROM intel_note_entities ne
            WHERE ne.entity_id = ${intelEntities.id}
          )
        )`,
      ),
    )
    .orderBy(desc(sql`(${intelEntities.watched})::int`), desc(sql`coalesce(${degrees.degree}, 0)`))
    .limit(ENTITY_LIMIT);

  return rows.map((r) => {
    const base = clamp01(Number(r.degree ?? 0) / DEGREE_SATURATION);
    // Watched is an explicit "tell me about this", so it floors the score high
    // rather than merely adding to it.
    const importance = clamp01(r.watched ? Math.max(0.85, base) : r.confirmed ? Math.max(0.5, base) : base * 0.8);
    const aliases = [...new Set([...(r.aliases ?? []), r.canonicalName ?? ''].filter(Boolean))];
    return {
      id: r.id,
      name: r.name,
      aliases,
      kind: 'entity' as const,
      importance,
      why: r.watched
        ? 'a watched entity in your knowledge graph'
        : `${r.type ?? 'entity'} in your knowledge graph, ${Number(r.degree ?? 0)} connection(s)`,
      evidence: {
        notes: Number(r.notes ?? 0),
        lastSeen: r.lastSeen ? new Date(r.lastSeen).toISOString() : null,
      },
    };
  });
}

/** Topics of research sessions that actually produced a report. A draft that
 *  never ran says nothing about what matters. */
async function researchAnchors(): Promise<Anchor[]> {
  const since = new Date(Date.now() - RESEARCH_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({ id: researchSessions.id, topic: researchSessions.topic, createdAt: researchSessions.createdAt })
    .from(researchSessions)
    .where(and(gte(researchSessions.createdAt, since), sql`${researchSessions.report} is not null`))
    .orderBy(desc(researchSessions.createdAt))
    .limit(RESEARCH_LIMIT);

  return rows.map((r) => {
    const ageDays = (Date.now() - r.createdAt.getTime()) / 86_400_000;
    // Linear decay across the window, floored so an older topic still counts.
    const importance = clamp01(0.45 + 0.45 * (1 - ageDays / RESEARCH_WINDOW_DAYS));
    return {
      id: `research:${r.id}`,
      name: r.topic,
      aliases: [],
      kind: 'research' as const,
      importance,
      why: 'you researched this',
    };
  });
}

const MEMORY_CONFIDENCE: Record<string, number> = { high: 0.8, medium: 0.55, low: 0.3 };

/**
 * Recent memories, as anchors on whatever they name.
 *
 * A memory is a sentence, not a name, so the whole string would never match a
 * headline. The capitalised runs inside it are the part that could — the same
 * observation `daydream/ponder/lookups.ts` makes about diary titles.
 */
async function memoryAnchors(): Promise<Anchor[]> {
  const since = new Date(Date.now() - MEMORY_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: jkaiMemories.id,
      content: jkaiMemories.content,
      category: jkaiMemories.category,
      confidence: jkaiMemories.confidence,
    })
    .from(jkaiMemories)
    .where(and(isNull(jkaiMemories.supersededBy), gte(jkaiMemories.createdAt, since)))
    .orderBy(desc(jkaiMemories.createdAt))
    .limit(MEMORY_LIMIT);

  const out: Anchor[] = [];
  for (const row of rows) {
    const weight = MEMORY_CONFIDENCE[row.confidence] ?? 0.4;
    for (const term of properNouns(row.content)) {
      out.push({
        id: `memory:${row.id}:${term.toLowerCase()}`,
        name: term,
        aliases: [],
        kind: 'memory',
        importance: weight,
        why: `something you remembered (${row.category})`,
      });
    }
  }
  return out;
}

/**
 * Capitalised runs from free text. Mid-sentence only would miss a memory that
 * opens with the name, so the first word is included and the generic-word floor
 * in `correlate.ts` is what stops "The" and friends becoming anchors.
 */
export function properNouns(text: string, max = 4): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9'&.-]{2,})(?:\s+([A-Z][A-Za-z0-9'&.-]{2,}))?/g)) {
    const term = [m[1], m[2]].filter(Boolean).join(' ');
    if (!found.includes(term)) found.push(term);
  }
  // Multi-word first — the same preference `namedTerms` applies, and for the
  // same reason: a two-word name is a thing, one capitalised word is a sentence
  // opener as often as it is a name.
  found.sort((a, b) => Number(b.includes(' ')) - Number(a.includes(' ')));
  return found.slice(0, max);
}

/**
 * Everything the knowledge base says matters, as one list.
 *
 * Best-effort per source, like `gatherBriefingSignals`: a source that throws
 * contributes nothing and the rest still answer. An empty anchor list is a
 * valid result meaning "nothing correlates", not an error.
 */
export async function loadAnchors(): Promise<{ anchors: Anchor[]; gathered: string[] }> {
  const now = Date.now();
  if (anchorCache && anchorCache.expiresAt > now) return anchorCache.value;

  const gathered: string[] = [];
  const anchors: Anchor[] = [];

  for (const [name, load] of [
    ['entities', entityAnchors],
    ['research', researchAnchors],
    ['memories', memoryAnchors],
  ] as const) {
    try {
      const got = await load();
      if (got.length) {
        anchors.push(...got);
        gathered.push(name);
      }
    } catch (err) {
      console.error(`[news-correlate] ${name} anchors failed:`, err instanceof Error ? err.message : err);
    }
  }

  const value = { anchors, gathered };
  // Only cache a result that actually gathered something. An empty list after
  // three failed queries is a transient outage, and caching it would hide the
  // graph for ten minutes after a blip.
  if (gathered.length > 0) anchorCache = { value, expiresAt: Date.now() + ANCHOR_TTL_MS };
  return value;
}
