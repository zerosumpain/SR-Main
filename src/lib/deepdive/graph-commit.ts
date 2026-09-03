/**
 * Committing a research session's graph into the intel knowledge graph.
 *
 * ── The shape of the thing ───────────────────────────────────────────────────
 * A research session builds its OWN graph. `entity` and `relationship` rows are
 * scoped by `session_id`, nothing else reads them, and deleting the session
 * deletes them — so every run is already a private, temporary knowledge graph.
 * That is the right default: most runs are a question you asked once, and the
 * intel graph is the durable picture of what you actually work on. Merging
 * every probe into it makes the durable graph worse.
 *
 * Until now the merge happened anyway, at the end of every investigation
 * (`worker.ts`) and again on every backfill sweep. It is now opt-in: the run
 * keeps its graph to itself, and this module is what runs when the owner says
 * to commit it.
 *
 * ── Why this is a merge and not a re-extraction ──────────────────────────────
 * The old bridge (`./intel-bridge`) flattened the report into a text digest and
 * asked the intel extractor to work out what was in it — with the session's own
 * entities and relationships passed as *hints* in the prose. That threw away
 * the better half of what research knows. The session did entity recognition
 * over full page content, with the sources in front of it; the digest is an
 * executive summary and forty facts. Recall was strictly worse, and the edges
 * were re-guessed from a summary that mostly does not state them.
 *
 * So this hands intel the graph itself. Every session entity becomes an
 * `ExtractedEntity` and every session relationship an `ExtractedRelationship`
 * naming those entities, and `persistExtraction` does the rest — meaning
 * resolution against existing entities by name, canonical name and type;
 * corroboration counts; edge upserts that respect a SUPPRESSED edge; trust
 * refresh; embeddings. None of that is reimplemented here, which is the point:
 * research supplies the structure, intel stays the authority on how the graph
 * absorbs it.
 *
 * The note text is still stored and still embedded, so `@knowledge` recall and
 * search find the research exactly as before. What is skipped is only the model
 * call that would have re-derived a graph this session already has.
 */
import { createHash } from 'crypto';
import { db } from '$lib/db';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  researchSessions,
  entities,
  relationships,
  entityMentions,
  facts,
  intelNotes,
} from '$lib/db/schema';
import type { ResearchReport } from './types';
import { buildResearchDigest, collectFactIds, isOpaqueId } from './intel-bridge';
import { extractIntoIntel, type AutoExtractOutcome } from '$lib/jkai/intel/auto-extract';
import type {
  ExtractionResult,
  ExtractedEntity,
  ExtractedRelationship,
  ExtractedTimelineEvent,
} from '$lib/jkai/intel/extract';

/**
 * Research types that the intel taxonomy does not carry under the same name.
 *
 * Only `other` needs mapping — person, organisation, location, event, concept
 * and product are all active intel types. Left unmapped, `upsertEntity` parks
 * an unknown type under `concept` anyway and logs a warning per entity; doing
 * it here says the same thing once, deliberately, and keeps the log for types
 * that genuinely surprise us.
 */
const TYPE_MAP: Record<string, string> = { other: 'concept', organization: 'organisation' };

/** Cap on dated facts turned into timeline events, so one big dive can't flood it. */
const MAX_TIMELINE_EVENTS = 200;

function intelTypeFor(researchType: string): string {
  const t = (researchType || 'other').toLowerCase().trim();
  return TYPE_MAP[t] ?? t;
}

/**
 * Confidence from corroboration, not from a guess.
 *
 * A research entity has no confidence column — it exists because the extractor
 * asserted it. How many distinct facts mention it is the honest proxy, and it
 * is the same idea intel's own `weightFor` uses for edges: seeing a thing more
 * often is what makes you surer of it.
 */
function confidenceFromMentions(mentions: number): 'high' | 'medium' | 'low' {
  if (mentions >= 3) return 'high';
  if (mentions >= 1) return 'medium';
  return 'low';
}

/** Edge confidence from the extractor's strength, on session-graph's buckets. */
function confidenceFromStrength(strength: number | null): 'high' | 'medium' | 'low' {
  const s = strength ?? 0.5;
  if (s >= 0.75) return 'high';
  if (s >= 0.45) return 'medium';
  return 'low';
}

export interface SessionGraphSummary {
  entities: number;
  relationships: number;
}

export interface CommitState extends SessionGraphSummary {
  /** Whether this session's graph is already in the intel graph. */
  committed: boolean;
  committedAt: string | null;
  /** The derived intel note, when there is one. */
  noteId: string | null;
}

/**
 * Whether a session has been committed, and how big its graph is.
 *
 * Commit state is read from the derived intel note rather than a new column on
 * `research_session`. The note IS the record — it is what `persistExtraction`
 * hangs entities off, what a purge removes, and what makes the answer to "is
 * this in the graph?" true rather than merely recorded. A flag column could
 * disagree with the graph; this cannot.
 */
export async function commitState(sessionId: string): Promise<CommitState> {
  const [[entityCount], [relCount], [note]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(entities)
      .where(eq(entities.sessionId, sessionId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(relationships)
      .where(eq(relationships.sessionId, sessionId)),
    db
      .select({ id: intelNotes.id, createdAt: intelNotes.createdAt, updatedAt: intelNotes.updatedAt })
      .from(intelNotes)
      .where(
        and(
          sql`${intelNotes.metadata}->>'autoKind' = 'research'`,
          sql`${intelNotes.metadata}->>'refId' = ${sessionId}`,
          eq(intelNotes.graphState, 'admitted'),
        ),
      )
      .limit(1),
  ]);

  return {
    entities: entityCount?.n ?? 0,
    relationships: relCount?.n ?? 0,
    committed: !!note,
    committedAt: note ? (note.updatedAt ?? note.createdAt)?.toISOString() ?? null : null,
    noteId: note?.id ?? null,
  };
}

/**
 * Read one session's graph and map it. The queries live here; every decision
 * about the mapping lives in `mapSessionGraph`.
 */
export async function buildSessionExtraction(sessionId: string): Promise<{
  extraction: ExtractionResult;
  summary: SessionGraphSummary;
}> {
  const [entityRows, relRows, mentionRows, datedFacts] = await Promise.all([
    db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        description: entities.description,
      })
      .from(entities)
      .where(eq(entities.sessionId, sessionId)),
    db
      .select({
        fromEntityId: relationships.fromEntityId,
        toEntityId: relationships.toEntityId,
        relationshipType: relationships.relationshipType,
        sentiment: relationships.sentiment,
        strength: relationships.strength,
      })
      .from(relationships)
      .where(eq(relationships.sessionId, sessionId)),
    // Mentions per entity, for the corroboration-derived confidence. One
    // grouped query rather than a count per entity: a finished investigation
    // holds over a thousand entities and this used to be the shape of query
    // that made intel's own persist path slow.
    db
      .select({ entityId: entityMentions.entityId, n: sql<number>`count(*)::int` })
      .from(entityMentions)
      .innerJoin(entities, eq(entities.id, entityMentions.entityId))
      .where(eq(entities.sessionId, sessionId))
      .groupBy(entityMentions.entityId),
    // Facts the session managed to date. These are the timeline the digest path
    // used to ask a model to invent from prose; the session already has them as
    // data, with the date the extractor read off the source.
    db
      .select({ id: facts.id, content: facts.content, eventDate: facts.eventDate })
      .from(facts)
      .where(
        and(
          eq(facts.sessionId, sessionId),
          eq(facts.isCounterfactual, false),
          isNotNull(facts.eventDate),
        ),
      )
      // Ordered, because there is a LIMIT. Without it "the first 200" is
      // whatever order the heap hands back, so a big dive would contribute an
      // arbitrary scatter of dates rather than a timeline.
      .orderBy(facts.eventDate)
      .limit(MAX_TIMELINE_EVENTS),
  ]);


  return mapSessionGraph(
    {
      entities: entityRows,
      relationships: relRows,
      mentions: mentionRows,
      datedFacts,
    },
    sessionId,
  );
}

/** The row shapes `mapSessionGraph` needs. Named so the tests can build them. */
export interface SessionGraphRows {
  entities: Array<{ id: string; name: string; type: string; description: string | null }>;
  relationships: Array<{
    fromEntityId: string | null;
    toEntityId: string | null;
    relationshipType: string;
    sentiment: string | null;
    strength: number | null;
  }>;
  /** Fact mentions per entity id, for corroboration-derived confidence. */
  mentions: Array<{ entityId: string; n: number }>;
  /** Dated, non-counterfactual facts, for the timeline. */
  datedFacts: Array<{ id: string; content: string; eventDate: Date | null }>;
}

/**
 * Map one session's rows onto the structure intel persists.
 *
 * Split from the queries deliberately: this is where every judgement lives —
 * the type mapping, the confidence derivation, the duplicate-name collapse and
 * the edge dedup — and none of it should need a database to test.
 */
export function mapSessionGraph(
  rows: SessionGraphRows,
  sessionId: string,
): { extraction: ExtractionResult; summary: SessionGraphSummary } {
  const { entities: entityRows, relationships: relRows, mentions: mentionRows, datedFacts } = rows;

  const mentionsById = new Map(mentionRows.map((m) => [m.entityId, m.n]));

  /**
   * Two session entities can share a name — the check-then-insert in phase 2
   * races between parallel sources. `persistExtraction` keys its id map by
   * NAME, so a duplicate would silently overwrite the first and take its edges
   * with it. Deduped here, keeping the better-evidenced row.
   */
  const byName = new Map<string, (typeof entityRows)[number]>();
  for (const e of entityRows) {
    const key = e.name.toLowerCase().trim();
    if (!key) continue;
    const prior = byName.get(key);
    if (!prior || (mentionsById.get(e.id) ?? 0) > (mentionsById.get(prior.id) ?? 0)) {
      byName.set(key, e);
    }
  }
  /** The name every entity id should be written as, after dedup. */
  const canonicalNameById = new Map<string, string>();
  for (const e of entityRows) {
    const winner = byName.get(e.name.toLowerCase().trim());
    if (winner) canonicalNameById.set(e.id, winner.name);
  }

  const extractedEntities: ExtractedEntity[] = [...byName.values()].map((e) => ({
    name: e.name,
    type: intelTypeFor(e.type),
    confidence: confidenceFromMentions(mentionsById.get(e.id) ?? 0),
    properties: {
      ...(e.description ? { description: e.description } : {}),
      researchType: e.type,
      researchSessionId: sessionId,
    },
    // Resolution is left to `upsertEntity`, which matches on name, canonical
    // name and type against the live graph. Naming a match id here would mean
    // duplicating that logic, worse, in a second place.
    possibleMatchId: null,
  }));

  const seenEdge = new Set<string>();
  const extractedRelationships: ExtractedRelationship[] = [];
  for (const r of relRows) {
    const source = r.fromEntityId ? canonicalNameById.get(r.fromEntityId) : null;
    const target = r.toEntityId ? canonicalNameById.get(r.toEntityId) : null;
    // An edge whose endpoint did not survive dedup, or points at a row from
    // another session, carries nothing. `persistExtraction` would drop it a
    // moment later anyway; dropping it here keeps the reported count honest.
    if (!source || !target || source === target) continue;

    const type = r.relationshipType.trim();
    if (!type) continue;
    const key = `${source.toLowerCase()}|${target.toLowerCase()}|${type.toLowerCase()}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);

    extractedRelationships.push({
      source,
      target,
      type,
      // The label is what a reader sees on the edge. Sentiment is real signal
      // the research schema carries and intel's does not, so it is folded into
      // the human-readable half rather than dropped.
      label:
        r.sentiment && r.sentiment !== 'neutral'
          ? `${type.replace(/_/g, ' ')} (${r.sentiment})`
          : type.replace(/_/g, ' '),
      confidence: confidenceFromStrength(r.strength),
    });
  }

  const timelineEvents: ExtractedTimelineEvent[] = datedFacts
    .filter((f) => f.eventDate)
    .map((f) => ({
      date: f.eventDate!.toISOString().slice(0, 10),
      type: 'event' as const,
      title: f.content.slice(0, 160),
      description: f.content.length > 160 ? f.content : undefined,
    }));

  return {
    extraction: {
      summary: '',
      entities: extractedEntities,
      relationships: extractedRelationships,
      timelineEvents,
      // Never from a commit. Proposing a type is a decision that goes through
      // the review gate on the strength of evidence a human looked at; a bulk
      // import of a thousand research entities is not that, and research types
      // are a fixed set that intel already carries.
      proposedNewTypes: [],
    },
    summary: {
      entities: extractedEntities.length,
      relationships: extractedRelationships.length,
    },
  };
}

export type CommitOutcome =
  | { status: 'committed'; noteId?: string; entities: number; relationships: number }
  | { status: 'empty'; entities: 0; relationships: 0 }
  | { status: 'failed' | 'disabled'; reason: string };

/**
 * Merge a session's graph into the intel graph.
 *
 * Idempotent by content hash, like every other path into `extractIntoIntel`:
 * committing twice with nothing changed is free, and committing after the
 * session grew re-merges the difference (edges corroborate rather than
 * duplicate — see `persistExtraction`).
 */
export async function commitSessionGraph(
  sessionId: string,
  opts: { force?: boolean } = {},
): Promise<CommitOutcome> {
  const [session] = await db
    .select({
      id: researchSessions.id,
      topic: researchSessions.topic,
      report: researchSessions.report,
    })
    .from(researchSessions)
    .where(eq(researchSessions.id, sessionId))
    .limit(1);

  if (!session) return { status: 'failed', reason: 'Session not found' };

  const { extraction, summary } = await buildSessionExtraction(sessionId);
  if (summary.entities === 0) {
    // Nothing recognised means nothing to merge. Reported rather than silently
    // succeeding, because "committed 0 entities" reads like it worked.
    return { status: 'empty', entities: 0, relationships: 0 };
  }

  // The note body. Still the report digest — that is what a person reads in
  // /jkai/intel and what recall searches over. Only the graph half comes from
  // the structure now.
  const report = (session.report ?? {}) as ResearchReport;
  const factText = await loadFactText(report);
  const digest = buildResearchDigest(session.topic, report, factText);
  const body = digest.trim() || `Research topic: ${session.topic}`;
  extraction.summary = report.executive_summary?.slice(0, 400) ?? session.topic;

  const outcome: AutoExtractOutcome = await extractIntoIntel({
    kind: 'research',
    refId: sessionId,
    title: session.topic,
    text: body,
    // The hash covers the GRAPH as well as the prose. Hashing the digest alone
    // meant a session whose entities changed but whose report did not was
    // reported 'unchanged' and never re-merged.
    contentHash: createHash('sha256')
      .update(body)
      .update(`\n--graph--\n${summary.entities}:${summary.relationships}`)
      .update(JSON.stringify(extraction.relationships))
      .digest('hex'),
    metadata: {
      sessionId,
      sourceUrl: `/research/${sessionId}`,
      committedGraph: true,
      graphEntities: summary.entities,
      graphRelationships: summary.relationships,
    },
    extraction,
    // A commit the owner asked for is an instruction: redo it even when the
    // hash matches, because they may be re-committing after correcting the
    // research. A sweep is housekeeping and honours the hash — otherwise every
    // backfill would rewrite every committed session for nothing.
    force: opts.force ?? false,
  });

  if (outcome.status === 'extracted') {
    return {
      status: 'committed',
      noteId: outcome.noteId,
      entities: summary.entities,
      relationships: summary.relationships,
    };
  }
  if (outcome.status === 'unchanged') {
    // Already in the graph, and nothing has changed since. Reported as a
    // commit because from the caller's point of view it is one: the session IS
    // in the graph. Only a sweep can see this, since an explicit commit forces.
    return {
      status: 'committed',
      noteId: outcome.noteId,
      entities: summary.entities,
      relationships: summary.relationships,
    };
  }
  if (outcome.status === 'disabled') {
    return { status: 'disabled', reason: 'Intel auto-extraction is switched off on this host' };
  }
  if (outcome.status === 'held') {
    // The note landed in the admission queue rather than the graph. Only the
    // mail path asks for that, so it should be unreachable here — but reporting
    // it as a plain failure would say the wrong thing about where the data went.
    return { status: 'failed', reason: 'The note is waiting to be admitted to the graph' };
  }
  return { status: 'failed', reason: `Intel refused the merge (${outcome.status})` };
}

/** fact id → content, for the ids the report references. Mirrors ./intel-bridge. */
async function loadFactText(report: ResearchReport): Promise<Map<string, string>> {
  const ids = collectFactIds(report).filter(isOpaqueId);
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: facts.id, content: facts.content })
    .from(facts)
    .where(inArray(facts.id, ids));
  return new Map(rows.map((r) => [r.id, r.content]));
}
