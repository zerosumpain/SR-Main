/**
 * Entity + relationship extraction for research, on the same contract the intel
 * graph uses.
 *
 * ── Why this module exists ───────────────────────────────────────────────────
 * Research recognised entities and almost never recorded an edge between them.
 * Production on 2026-09-03: every completed session but one held ZERO
 * relationships, including a 453-entity run finished that morning. The entity
 * network was a field of isolated dots and the Word export drew an empty graph.
 *
 * Three separate faults produced that, and this module is the answer to the
 * third — the one that would have kept biting after the other two were fixed:
 *
 *   1. `brief` never asked for relationships at all (see brief.ts).
 *   2. phase2's relationship pass was gated on `config.analysisDepth === 'deep'`,
 *      and a session inserted without a config gets `{}` — so a run whose
 *      `depth` column said `investigation` still fell through to `'standard'`
 *      and skipped the pass (see worker.ts, which now derives the config from
 *      the depth column).
 *   3. THIS one: relationships were extracted by a SECOND LLM call that was
 *      never shown the entity list. It named its endpoints however it liked
 *      ("the Department", "Ofsted's board"), and the writer then resolved those
 *      strings with an exact `lower(trim(name)) =` lookup against the session's
 *      entity table. Anything the two calls spelled differently was dropped
 *      silently — no log, no counter.
 *
 * `$lib/jkai/intel/extract` solved this a long time ago and the fix is
 * structural, not a better prompt: ONE call returns entities and relationships
 * together, and a relationship may only name an entity **from its own
 * `entities` array**. Resolution then runs against the in-memory name→id map
 * built while storing that same response (`persistExtraction` in
 * `$lib/jkai/intel/graph` does exactly this), so the endpoints cannot drift
 * apart. That is what this module ports to the research pipeline.
 *
 * The research schema is not the intel schema — `relationship` rows are
 * session-scoped and carry `sentiment`/`strength` where intel carries
 * `confidence`/`weight`/`observationCount` — so the row shape stays research's.
 * What is borrowed is the contract and the resolution order.
 */
import { db } from '$lib/db';
import { entities, relationships } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { emitArtefact } from './desk-events';

/** The entity types the research schema recognises. */
export const RESEARCH_ENTITY_TYPES = [
  'person',
  'organisation',
  'location',
  'event',
  'concept',
  'product',
  'other',
] as const;

export interface ExtractedEntity {
  name: string;
  type: string;
  description: string;
}

export interface ExtractedRelationship {
  from_entity: string;
  to_entity: string;
  relationship_type: string;
  sentiment?: string;
  strength?: number;
}

/** What an extraction call is asked to return alongside its facts. */
export interface ExtractedGraph {
  entities?: ExtractedEntity[];
  relationships?: ExtractedRelationship[];
}

/**
 * The entities + relationships half of an extraction prompt.
 *
 * Kept as one exported string so brief.ts and phase2.ts cannot drift into
 * asking for different shapes — the drift between two prompts is precisely what
 * broke resolution before.
 *
 * The wording follows `$lib/jkai/intel/extract`'s system prompt where the same
 * rule applies: be generous, treat a country as a location even when the text
 * casts it as an actor, and — the load-bearing line — relationship endpoints
 * MUST be names that appear in the entities array of this same response.
 */
export const GRAPH_EXTRACTION_PROMPT = `ENTITIES: named things the content mentions. For each:
- name: the entity name
- type: one of ${RESEARCH_ENTITY_TYPES.join(', ')}
- description: a one-sentence description

Be generous — capture every named thing, not just people and organisations.
This includes PLACES (countries, regions, cities, jurisdictions) and named
standards, products, policies, programmes, datasets and reports. A country is a
"location" even when the text casts it as an actor: "Estonia runs X-Road" makes
Estonia a location, while "the Estonian Information System Authority" is an
organisation.

RELATIONSHIPS: how those entities connect. For each:
- from_entity: the name of the first entity
- to_entity: the name of the second entity
- relationship_type: a short lower_snake_case verb phrase, e.g. "employs",
  "funds", "regulates", "part_of", "founded", "opposed_to", "caused"
- sentiment: positive, negative, neutral, or contested
- strength: 0.0-1.0, how firmly the content supports the link

RULES FOR RELATIONSHIPS — these matter more than the count:
- from_entity and to_entity MUST each be spelled EXACTLY as they appear in the
  entities array above. Do not invent a name, abbreviate one, or refer to
  something by a description ("the department", "his employer"). If a link's
  endpoint is not in the entities array, add it there first.
- Never link an entity to itself.
- Extract every connection the content actually asserts. A document naming ten
  entities and no relationships between them is almost always an extraction
  failure, not a fact about the document.`;

/**
 * A name → entity-id index for one session, matched the way names actually
 * vary.
 *
 * Lookup is layered, cheapest first, mirroring `upsertEntity`'s resolution
 * order in `$lib/jkai/intel/graph`:
 *   1. exact, case- and whitespace-insensitive
 *   2. punctuation and legal-suffix stripped ("Acme Ltd." → "acme")
 *   3. leading article dropped ("the Department for Education" → same as
 *      "Department for Education")
 *
 * Deliberately NOT fuzzy beyond that. A bigram or embedding match here would
 * fuse entities the extractor kept apart on purpose, and the in-response
 * contract above means near-misses should be rare enough not to need it.
 */
export class SessionEntityIndex {
  private byKey = new Map<string, string>();

  /** Register a stored entity so later relationships can resolve onto it. */
  add(name: string, id: string): void {
    for (const key of SessionEntityIndex.keysFor(name)) {
      // First writer wins: an entity stored earlier in the run is the one a
      // later duplicate spelling should collapse onto.
      if (!this.byKey.has(key)) this.byKey.set(key, id);
    }
  }

  /** The entity id for a name the extractor used, or null. */
  resolve(name: string): string | null {
    for (const key of SessionEntityIndex.keysFor(name)) {
      const id = this.byKey.get(key);
      if (id) return id;
    }
    return null;
  }

  get size(): number {
    return this.byKey.size;
  }

  /** Progressively looser keys for one name, most specific first. */
  static keysFor(name: string): string[] {
    const exact = name.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!exact) return [];
    const keys = [exact];

    const stripped = exact
      .replace(/[.,'"`’]/g, '')
      .replace(/\b(ltd|limited|plc|inc|incorporated|llc|llp|gmbh|corp|corporation|co)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (stripped && stripped !== exact) keys.push(stripped);

    const deArticled = stripped.replace(/^(the|a|an)\s+/, '');
    if (deArticled && !keys.includes(deArticled)) keys.push(deArticled);

    return keys.filter(Boolean);
  }
}

/**
 * Load every entity already stored for this session into an index.
 *
 * Sources are processed in parallel, so an extraction can legitimately name an
 * entity a DIFFERENT source created a moment ago. Seeding from the table keeps
 * those links rather than dropping them for being outside this one response.
 */
export async function loadSessionEntityIndex(sessionId: string): Promise<SessionEntityIndex> {
  const rows = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(eq(entities.sessionId, sessionId));
  const index = new SessionEntityIndex();
  for (const r of rows) index.add(r.name, r.id);
  return index;
}

export interface StoreRelationshipsResult {
  stored: number;
  /** Endpoints that matched no entity — the signal that extraction is drifting. */
  unresolved: number;
  /** Links already recorded for this session. */
  duplicates: number;
}

/**
 * Persist the relationships from one extraction, resolving endpoints through
 * `index`.
 *
 * Returns counts rather than nothing, because the silent-drop failure this
 * module exists to fix was invisible precisely because nobody counted. The
 * callers log `unresolved` when it is non-zero.
 */
export async function storeRelationships(
  sessionId: string,
  sourceId: string | null,
  extracted: ExtractedRelationship[],
  index: SessionEntityIndex,
): Promise<StoreRelationshipsResult> {
  const result: StoreRelationshipsResult = { stored: 0, unresolved: 0, duplicates: 0 };

  // Within one response the model repeats itself often enough to be worth a
  // local guard — cheaper than a round trip per duplicate.
  const seen = new Set<string>();

  for (const rel of extracted ?? []) {
    if (!rel?.from_entity || !rel?.to_entity || !rel?.relationship_type) continue;

    const fromId = index.resolve(rel.from_entity);
    const toId = index.resolve(rel.to_entity);
    if (!fromId || !toId) {
      result.unresolved++;
      continue;
    }
    // A self-loop carries no information and breaks force layouts — the same
    // rule persistExtraction applies in the intel graph.
    if (fromId === toId) continue;

    const type = String(rel.relationship_type).trim().slice(0, 120);
    if (!type) continue;

    const key = `${fromId}|${toId}|${type.toLowerCase()}`;
    if (seen.has(key)) {
      result.duplicates++;
      continue;
    }
    seen.add(key);

    const existing = await db
      .select({ id: relationships.id })
      .from(relationships)
      .where(
        and(
          eq(relationships.sessionId, sessionId),
          eq(relationships.fromEntityId, fromId),
          eq(relationships.toEntityId, toId),
          sql`lower(${relationships.relationshipType}) = ${type.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (existing.length) {
      result.duplicates++;
      continue;
    }

    const [stored] = await db
      .insert(relationships)
      .values({
        sessionId,
        fromEntityId: fromId,
        toEntityId: toId,
        relationshipType: type,
        sentiment: coerceSentiment(rel.sentiment),
        strength: coerceStrength(rel.strength),
        sourceId,
      })
      .returning();

    result.stored++;

    // Desk: relationships render as edges only (orthPath), never cards.
    emitArtefact(sessionId, 'relationship', 2, {
      id: stored.id,
      fromEntityId: stored.fromEntityId,
      toEntityId: stored.toEntityId,
      relationshipType: stored.relationshipType,
      sentiment: stored.sentiment,
      strength: stored.strength,
      sourceId: stored.sourceId,
    });
  }

  return result;
}

const SENTIMENTS = new Set(['positive', 'negative', 'neutral', 'contested']);

export function coerceSentiment(value: unknown): string {
  const s = typeof value === 'string' ? value.toLowerCase().trim() : '';
  return SENTIMENTS.has(s) ? s : 'neutral';
}

export function coerceStrength(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
