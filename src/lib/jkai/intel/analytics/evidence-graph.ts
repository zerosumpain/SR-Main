// The graph with the evidence in it.
//
// The entity graph answers "what is connected to what". It cannot answer "what
// told me that" — the notes are the thing every edge was derived FROM, and they
// are invisible in it. This builds the other view: notes and entities as one
// bipartite graph, an edge wherever a note mentions an entity.
//
// Two clusters of documents that share no entities are two bodies of work; a
// note bridging two entity clusters is the document that connects them. Neither
// is visible in a graph made only of entities.
//
// Deliberately its own builder rather than a flag on `loadSnapshot`: that
// function is the single gate every analytic passes through, and threading a
// second node kind through it would put a branch in the one place this codebase
// relies on having none. What IS shared is the artefact gate — the same
// `channelArtefactIds()` — because an entity that identifies the channel is no
// more use here than there.
import { db } from '$lib/db';
import { sql, type SQL } from 'drizzle-orm';
import { channelArtefactIds } from '../channel-artefacts';
import { pgTextArray } from '$lib/db/sql-array';
import { OWNER_INTEL_SCOPE, spaceIn, type IntelScope } from '../scope';
import { INTEL_DOMAINS, sourcesForDomains } from '../domains';
import { buildIndex } from './model';
import { detectCommunities } from './community';
import { pagerank } from './centrality';
import type { GraphEdge, GraphNode, GraphSnapshot } from './model';

/** Prefix on a note's node id, so a note and an entity can never collide. */
export const EVIDENCE_PREFIX = 'note:';

/** The synthetic entity type every note node carries. */
export const EVIDENCE_TYPE_ID = 'evidence';

export const isEvidenceNode = (id: string) => id.startsWith(EVIDENCE_PREFIX);

/**
 * How each channel is drawn. Colours are the SR accents and status tokens
 * resolved to hex, because the graph paints into a canvas and a WebGL scene —
 * neither reads CSS variables.
 */
const SOURCE_STYLE: Record<string, { icon: string; color: string; label: string }> = {
  email: { icon: '✉', color: '#c4570a', label: 'Email' },
  file: { icon: '▤', color: '#0e5b66', label: 'File' },
  chat: { icon: '◈', color: '#2d7a3a', label: 'Chat' },
  research: { icon: '◎', color: '#7a3a7a', label: 'Research' },
  web: { icon: '◍', color: '#b0892a', label: 'Web' },
  whatsapp: { icon: '◐', color: '#2d7a5a', label: 'WhatsApp' },
  workflow: { icon: '⬡', color: '#5a5a7a', label: 'Workflow' },
};
const DEFAULT_STYLE = { icon: '◇', color: '#8a8072', label: 'Note' };

export const styleForSource = (source: string | null) =>
  SOURCE_STYLE[source ?? ''] ?? DEFAULT_STYLE;

export interface EvidenceGraph {
  snapshot: GraphSnapshot;
  /** Note ids kept, before any render trim. */
  noteCount: number;
  entityCount: number;
}

interface LinkRow {
  note_id: string;
  note_title: string | null;
  note_source: string | null;
  observed_at: string | null;
  created_at: string;
  entity_id: string;
  entity_name: string;
  type_id: string | null;
  type_name: string | null;
  icon: string | null;
  color: string | null;
  summary: string | null;
  confirmed: boolean | null;
  sources: string[] | null;
  note_space: string;
  entity_space: string;
}

/**
 * The notes this view can draw: each one with how many live entities it
 * mentions, keeping only notes that mention more than one. A note linking a
 * single entity adds a leaf and says nothing about how anything relates.
 *
 * One definition shared by the build (which ranks and caps it) and the chip
 * counts (which aggregate it whole), so the two cannot drift apart. `where`
 * carries the build's source and domain predicates; the counts pass none.
 */
function qualifyingNotes(scope: IntelScope, where: SQL = sql``): SQL {
  return sql`
      SELECT ne.note_id, COUNT(DISTINCT ne.entity_id) AS mentions
      FROM intel_note_entities ne
      JOIN intel_notes n ON n.id = ne.note_id
      JOIN intel_entities e ON e.id = ne.entity_id AND e.merged_into_id IS NULL
      WHERE ${spaceIn(sql`n.space_id`, scope)}
        AND ${spaceIn(sql`e.space_id`, scope)}
        ${where}
      GROUP BY ne.note_id
      HAVING COUNT(DISTINCT ne.entity_id) > 1`;
}

/**
 * Qualifying notes per (space, source) over the whole of `scope`, for the
 * space and domain chips.
 *
 * The unit is NOTES — the thing this view's source and domain filters select —
 * and each note has exactly one source, so per-source groups never overlap and
 * summing them into domains counts every note once. Uncapped and unfiltered
 * on purpose: the build is capped at `limit` and narrowed by the request, and
 * a chip counted from that would read 0 for every space the user unticked.
 * Channel artefacts are filtered from the build in JS per mention, not here;
 * they remove entities rather than notes, so the difference is small.
 */
export async function countEvidenceNotes(
  scope: IntelScope,
): Promise<Array<{ space: string; source: string | null; count: number }>> {
  const { rows } = await db.execute(sql`
    SELECT n.space_id AS space, n.source AS source, COUNT(*) AS count
    FROM (${qualifyingNotes(scope)}) q
    JOIN intel_notes n ON n.id = q.note_id
    GROUP BY n.space_id, n.source
  `);
  return (rows as Array<{ space: string; source: string | null; count: number | string }>).map((r) => ({
    space: String(r.space),
    source: r.source,
    // COUNT(*) is bigint, which node-postgres hands back as a string.
    count: Number(r.count),
  }));
}

/**
 * Build the bipartite note↔entity graph.
 *
 * `sources` filters on the NOTE, not the entity — which is the whole point of
 * this view. In the entity graph, asking for chat keeps every entity chat ever
 * mentioned, including the ones whose evidence is overwhelmingly email; here it
 * keeps chat's notes and shows exactly which entities they account for.
 *
 * `domains` filters on the note too, and intersects with `sources`. It goes
 * into the SQL rather than being applied to the built graph for the same reason
 * `sources` does: `limit` picks the top notes, and filtering after the cap
 * would pick the top 400 of everything and then show the few that happened to
 * be research.
 *
 * `scope` is every space the reader may see, narrowed by the caller's chips.
 * Each intel table in the query carries its own predicate — the CTE that ranks
 * notes, the outer select that fetches what they mention, and the
 * relationship subquery — because resolution never crosses a space today, and
 * a reader must not depend on that staying true to stay inside its scope.
 *
 * `limit` caps NOTES, not total nodes: the entities come along because a note
 * mentions them, and dropping an entity would leave an edge pointing at nothing.
 */
export async function buildEvidenceGraph(opts: {
  sources?: string[];
  domains?: string[];
  limit?: number;
  scope?: IntelScope;
} = {}): Promise<EvidenceGraph> {
  const artefacts = await channelArtefactIds();
  const limit = Math.max(1, Math.min(opts.limit ?? 400, 2000));
  const sources = (opts.sources ?? []).filter(Boolean);
  // Intel domains (../domains), not the sender domains parsed from `sources` below.
  const wantedDomains = (opts.domains ?? []).filter(Boolean);
  const scope = opts.scope ?? OWNER_INTEL_SCOPE;

  // Facet values ('email:bulk', 'email@linkedin.com') are matched against the
  // note's own metadata rather than the entity's aggregated source array — the
  // entity array is a union across all its notes, so using it here would keep a
  // thread because some OTHER thread about the same person was bulk.
  const plain = sources.filter((s) => !s.includes(':') && !s.includes('@'));
  const kinds = sources.filter((s) => s.includes(':')).map((s) => s.split(':'));
  const domains = sources.filter((s) => s.includes('@')).map((s) => s.split('@'));

  const conditions: ReturnType<typeof sql>[] = [];
  // Bound as ONE parameter and cast, never interpolated: these values come off
  // the query string. `pgTextArray` also sidesteps the row-constructor trap
  // Drizzle falls into when a bare array is passed to ANY().
  if (plain.length) conditions.push(sql`n.source = ANY(${pgTextArray(plain)}::text[])`);
  for (const [source, kind] of kinds) {
    conditions.push(
      kind === 'important'
        ? sql`(n.source = ${source} AND n.metadata->>'important' = 'true')`
        : sql`(n.source = ${source} AND n.metadata->>'emailKind' = ${kind})`,
    );
  }
  for (const [source, domain] of domains) {
    conditions.push(sql`(n.source = ${source} AND n.metadata->>'senderDomain' = ${domain})`);
  }

  const where = conditions.length
    ? sql`AND (${sql.join(conditions, sql` OR `)})`
    : sql``;

  // Domains, as a second group ANDed with the sources above. 'other' has no
  // source list — it is whatever no domain claims — so it is the complement of
  // every mapped source rather than an expansion. A note with no source fails
  // both (NULL compares to nothing), matching the entity view's no-exemption
  // rule in filter.ts.
  const domainConditions: ReturnType<typeof sql>[] = [];
  const domainSources = sourcesForDomains(wantedDomains);
  if (domainSources.length) {
    domainConditions.push(sql`n.source = ANY(${pgTextArray(domainSources)}::text[])`);
  }
  if (wantedDomains.includes('other')) {
    const mapped = INTEL_DOMAINS.flatMap((d) => [...d.sources]);
    domainConditions.push(sql`n.source <> ALL(${pgTextArray(mapped)}::text[])`);
  }
  const domainWhere = domainConditions.length
    ? sql`AND (${sql.join(domainConditions, sql` OR `)})`
    : wantedDomains.length
      ? sql`AND FALSE` // only unknown domain ids asked for: nothing, not everything
      : sql``;

  // The notes worth drawing are the ones that mention the most entities.
  const { rows } = await db.execute(sql`
    WITH ranked AS (
      ${qualifyingNotes(scope, sql`${where} ${domainWhere}`)}
      ORDER BY mentions DESC
      LIMIT ${limit}
    )
    SELECT n.id            AS note_id,
           n.title         AS note_title,
           n.source        AS note_source,
           n.created_at    AS created_at,
           n.space_id      AS note_space,
           (SELECT MAX(r.last_seen_at) FROM intel_relationships r
             WHERE r.source_note_id = n.id AND r.suppressed IS NOT TRUE
               AND ${spaceIn(sql`r.space_id`, scope)}) AS observed_at,
           e.id            AS entity_id,
           e.name          AS entity_name,
           t.id            AS type_id,
           t.name          AS type_name,
           t.icon          AS icon,
           t.color         AS color,
           e.summary       AS summary,
           e.confirmed     AS confirmed,
           e.space_id      AS entity_space
    FROM ranked
    JOIN intel_note_entities ne ON ne.note_id = ranked.note_id
    JOIN intel_notes n          ON n.id = ranked.note_id
                               AND ${spaceIn(sql`n.space_id`, scope)}
    JOIN intel_entities e       ON e.id = ne.entity_id AND e.merged_into_id IS NULL
                               AND ${spaceIn(sql`e.space_id`, scope)}
    LEFT JOIN intel_entity_types t ON t.id = e.type_id
  `);

  const noteNodes = new Map<string, GraphNode>();
  const entityNodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const mentionCount = new Map<string, number>();

  for (const raw of rows as unknown as LinkRow[]) {
    if (artefacts.has(String(raw.entity_id))) continue;

    const noteId = `${EVIDENCE_PREFIX}${raw.note_id}`;
    const observed = raw.observed_at ? new Date(raw.observed_at).getTime() : 0;
    const created = raw.created_at ? new Date(raw.created_at).getTime() : 0;

    if (!noteNodes.has(noteId)) {
      const style = styleForSource(raw.note_source);
      noteNodes.set(noteId, {
        id: noteId,
        name: raw.note_title?.trim() || `Untitled ${style.label.toLowerCase()}`,
        typeId: EVIDENCE_TYPE_ID,
        typeName: style.label,
        icon: style.icon,
        color: style.color,
        summary: null,
        confidence: 'medium',
        confidenceScore: null,
        confirmed: true,
        createdAt: created,
        updatedAt: observed || created,
        noteCount: 1,
        lastSeenAt: observed || created,
        evidenceAt: observed || created,
        categories: [],
        // The note's own channel, so the source picker's plain values still
        // select these nodes exactly as they select entities.
        sources: raw.note_source ? [raw.note_source] : [],
        aliases: [],
        space: String(raw.note_space),
      });
    }

    if (!entityNodes.has(raw.entity_id)) {
      entityNodes.set(raw.entity_id, {
        id: raw.entity_id,
        name: raw.entity_name,
        typeId: raw.type_id ?? 'unknown',
        typeName: raw.type_name ?? 'Entity',
        icon: raw.icon ?? '◦',
        color: raw.color ?? '#8a8072',
        summary: raw.summary,
        confidence: 'medium',
        confidenceScore: null,
        confirmed: Boolean(raw.confirmed),
        createdAt: created,
        updatedAt: observed || created,
        noteCount: 0,
        lastSeenAt: observed || created,
        evidenceAt: observed || created,
        categories: [],
        sources: raw.note_source ? [raw.note_source] : [],
        aliases: [],
        space: String(raw.entity_space),
      });
    }

    const entity = entityNodes.get(raw.entity_id)!;
    entity.noteCount += 1;
    // An entity reached by several channels should be selectable under any of
    // them, exactly as in the entity graph.
    if (raw.note_source && !entity.sources.includes(raw.note_source)) {
      entity.sources.push(raw.note_source);
    }
    if ((observed || created) > entity.evidenceAt) {
      entity.evidenceAt = observed || created;
      entity.lastSeenAt = observed || created;
    }

    mentionCount.set(noteId, (mentionCount.get(noteId) ?? 0) + 1);

    edges.push({
      id: `${noteId}->${raw.entity_id}`,
      source: noteId,
      target: raw.entity_id,
      type: 'mentions',
      label: null,
      confidence: 'medium',
      strength: 'medium',
      createdAt: created,
      weight: 0.5,
      lastSeenAt: observed || created,
      sourceKind: raw.note_source,
    });
  }

  for (const [id, count] of mentionCount) {
    const note = noteNodes.get(id);
    if (note) note.noteCount = count;
  }

  return {
    snapshot: { nodes: [...noteNodes.values(), ...entityNodes.values()], edges },
    noteCount: noteNodes.size,
    entityCount: entityNodes.size,
  };
}

/**
 * Communities and importance over the bipartite graph.
 *
 * Run here rather than reusing the entity graph's partition: the clusters worth
 * seeing in this view are groups of DOCUMENTS and the entities they share, which
 * is a different partition of a different graph. Reusing the entity clusters
 * would colour notes by a structure they had no part in.
 */
export function analyseEvidenceGraph(snapshot: GraphSnapshot) {
  const index = buildIndex(snapshot);
  const community = detectCommunities(index);
  // Pagerank only — betweenness is O(V·E) and this graph is deliberately dense
  // on one side, so it would dominate the request for a number the view does
  // not draw.
  const rank = pagerank(index);
  return { index, community, rank };
}
