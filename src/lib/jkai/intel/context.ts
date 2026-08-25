import { db } from '$lib/db';
import { intelEntities, intelEntityTypes, intelRelationships, intelNotes, intelNoteEntities } from '$lib/db/schema';
import { desc, eq, inArray, or, sql } from 'drizzle-orm';
import { generateEmbedding } from './embed';

interface KnowledgeContext {
  entities: Array<{
    name: string;
    type: string;
    icon: string;
    summary: string | null;
    properties: Record<string, unknown> | null;
    relationships: string[];
  }>;
  noteExcerpts: Array<{
    title: string | null;
    excerpt: string;
    date: string;
  }>;
  /**
   * The named neighbourhoods the graph divides into.
   *
   * Included unconditionally rather than by similarity search, because a cluster
   * name is often something the embedding has never seen — the user typed it —
   * and "tell me about the DfE cluster" has to resolve on the name itself. It is
   * a short list of short strings; the whole roster costs less than one note
   * excerpt.
   */
  clusters: Array<{ label: string; size: number; sources: string; narrative: string | null }>;
}

export async function buildKnowledgeContext(userMessage: string): Promise<string> {
  try {
    const context = await findRelevantContext(userMessage);

    if (
      context.entities.length === 0 &&
      context.noteExcerpts.length === 0 &&
      context.clusters.length === 0
    ) {
      return '';
    }

    return formatContext(context);
  } catch (err) {
    console.error('[intel] Failed to build knowledge context:', err);
    return '';
  }
}

/**
 * What the planner should believe a random page costs on this host.
 *
 * Postgres defaults `random_page_cost` to 4.0, a number tuned for spinning
 * disks. Every host this runs on is SSD-backed (`lsblk` reports ROTA=0 on the
 * production VPS), so 4.0 is simply the wrong input — 1.1 is the standard value
 * for solid-state storage.
 *
 * It matters here specifically because it is what decides whether the HNSW
 * indexes get used at all. The embeddings are TOASTed, so `intel_entities`
 * looks like a cheap 857-page table to the planner (seq scan costed at ~1028)
 * while the real work is detoasting 13,720 × 6KB vectors — 150ms. pgvector's
 * HNSW startup estimate scales with `random_page_cost`, so at 4.0 it comes out
 * at 2258, loses to a seq scan that is really 60× slower, and the index sits
 * there unused.
 *
 * Measured on production, same query, 2026-08-24:
 *   random_page_cost 4.0 → Seq Scan,   161.7ms
 *   random_page_cost 2.0 → Index Scan,   7.3ms
 *   random_page_cost 1.1 → Index Scan,   2.5ms
 *
 * Deliberately `SET LOCAL` on these two queries rather than `ALTER SYSTEM`.
 * Setting it database-wide is arguably the more correct fix and would help
 * other index choices too, but it changes every plan in the database and that
 * is an operator's decision, not a side effect of a chat-latency change.
 */
const SSD_RANDOM_PAGE_COST = 1.1;

/**
 * The two vector lookups, in one transaction so `SET LOCAL` covers both and
 * resets itself on commit (safe on a pooled connection — Postgres unwinds
 * `SET LOCAL` at transaction end, so it cannot leak to the next borrower).
 */
async function vectorLookups(vectorStr: string): Promise<[unknown[], unknown[]]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL random_page_cost = ${sql.raw(String(SSD_RANDOM_PAGE_COST))}`);

    const entityRows = await tx.execute(sql`
      SELECT e.id, e.name, et.name as type_name, et.icon, e.summary,
             e.properties,
             e.embedding <=> ${vectorStr}::vector as distance
      FROM intel_entities e
      JOIN intel_entity_types et ON e.type_id = et.id
      WHERE e.embedding IS NOT NULL
        AND e.merged_into_id IS NULL
      ORDER BY distance ASC
      LIMIT 8
    `);

    const noteRows = await tx.execute(sql`
      SELECT n.id, n.title,
             substring(n.processed_content from 1 for 400) as excerpt,
             n.created_at,
             n.embedding <=> ${vectorStr}::vector as distance
      FROM intel_notes n
      WHERE n.embedding IS NOT NULL
        AND n.status = 'processed'
      ORDER BY distance ASC
      LIMIT 5
    `);

    return [entityRows.rows, noteRows.rows] as [unknown[], unknown[]];
  });
}

async function findRelevantContext(query: string): Promise<KnowledgeContext> {
  let embedding: number[];
  try {
    embedding = await generateEmbedding(query);
  } catch {
    return { entities: [], noteExcerpts: [], clusters: await describeClusters() };
  }

  const vectorStr = `[${embedding.join(',')}]`;

  const [entityRows, noteRows] = await vectorLookups(vectorStr);

  const relevantEntities = (entityRows as any[]).filter((r) => r.distance < 0.6);
  const relevantNotes = (noteRows as any[]).filter((r) => r.distance < 0.5);

  const entityIds = relevantEntities.map((e: any) => e.id);

  // Two queries, not 1 + N + M.
  //
  // This ran one relationships query per relevant entity, then a separate
  // single-row name lookup per relationship, every one of them awaited inside
  // nested `for` loops. Production holds 16,505 relationships at 2.46 per
  // entity, so a typical turn made roughly thirty sequential database round
  // trips — plus an external embedding call above — before the first token of
  // the reply could even be requested. The work is the same; the waiting was
  // the cost.
  const REL_PER_ENTITY = 10;

  const allRels =
    entityIds.length > 0
      ? await db
          .select({
            type: intelRelationships.type,
            label: intelRelationships.label,
            sourceId: intelRelationships.sourceEntityId,
            targetId: intelRelationships.targetEntityId,
          })
          .from(intelRelationships)
          .where(
            or(
              inArray(intelRelationships.sourceEntityId, entityIds),
              inArray(intelRelationships.targetEntityId, entityIds),
            ),
          )
          // Generous headroom over the per-entity cap applied below. A hub
          // entity with hundreds of edges must not drag the whole batch.
          .limit(entityIds.length * REL_PER_ENTITY * 3 + 50)
      : [];

  // Bucket by entity, capped per entity — the same shape the old per-entity
  // `.limit(10)` produced.
  const relsByEntity = new Map<string, typeof allRels>();
  for (const id of entityIds) relsByEntity.set(id, []);
  for (const rel of allRels) {
    // A self-relationship touches one bucket once, not twice.
    const sides = rel.sourceId === rel.targetId ? [rel.sourceId] : [rel.sourceId, rel.targetId];
    for (const side of sides) {
      const bucket = relsByEntity.get(side);
      if (bucket && bucket.length < REL_PER_ENTITY) bucket.push(rel);
    }
  }

  // Every name the descriptions will need, in one lookup.
  const otherIds = [
    ...new Set(allRels.flatMap((r) => [r.sourceId, r.targetId]).filter((id): id is string => !!id)),
  ];
  const nameRows =
    otherIds.length > 0
      ? await db
          .select({ id: intelEntities.id, name: intelEntities.name })
          .from(intelEntities)
          .where(inArray(intelEntities.id, otherIds))
      : [];
  const nameById = new Map(nameRows.map((r) => [r.id, r.name]));

  const entities = [];
  for (const row of relevantEntities) {
    const relDescriptions: string[] = [];
    for (const rel of relsByEntity.get(row.id) ?? []) {
      const otherId = rel.sourceId === row.id ? rel.targetId : rel.sourceId;
      const otherName = otherId ? nameById.get(otherId) : undefined;
      // An edge whose other end has been merged away or deleted described
      // nothing before either — it just cost a query to discover that.
      if (!otherName) continue;
      const direction = rel.sourceId === row.id ? '→' : '←';
      relDescriptions.push(`${direction} ${rel.type.replace(/_/g, ' ')}: ${otherName}`);
    }

    entities.push({
      name: row.name,
      type: row.type_name,
      icon: row.icon,
      summary: row.summary,
      properties: row.properties as Record<string, unknown> | null,
      relationships: relDescriptions,
    });
  }

  return {
    entities,
    noteExcerpts: relevantNotes.map((n: any) => ({
      title: n.title,
      excerpt: n.excerpt,
      date: new Date(n.created_at).toLocaleDateString(),
    })),
    clusters: await describeClusters(),
  };
}

/**
 * The tracked clusters, as one short line each.
 *
 * Reads the roster directly rather than reconciling: this runs on every chat
 * turn, and re-detecting communities to answer a question about them would put
 * a Louvain sweep in the latency path of ordinary conversation. A roster that
 * has never been built yields nothing, which is correct — there are no named
 * clusters until someone has opened the graph.
 *
 * The first sentence of the narrative only. A dozen full narratives is several
 * thousand tokens on every turn, and the opening line is the part that says
 * what the cluster is.
 */
async function describeClusters(): Promise<KnowledgeContext['clusters']> {
  try {
    const { loadClusters } = await import('./cluster-store');
    const clusters = await loadClusters();
    return clusters
      .filter((c) => c.live)
      .sort((a, b) => b.size - a.size)
      .slice(0, MAX_CLUSTERS)
      .map((c) => ({
        label: c.name ?? c.autoLabel,
        size: c.size,
        sources: sourceMixOf(c.members.length),
        narrative: firstSentence(c.narrative),
      }));
  } catch (err) {
    console.error('[intel] Failed to read the cluster roster:', err);
    return [];
  }
}

/** How many clusters the chat context carries. */
const MAX_CLUSTERS = 12;

/**
 * A short provenance phrase for a cluster.
 *
 * The roster stores membership, not composition, and resolving the source mix
 * would mean loading every member of every cluster on every chat turn. The
 * member count is what the roster can say for free and is enough for the model
 * to know how much weight a cluster carries.
 */
function sourceMixOf(members: number): string {
  return `${members} linked entities`;
}

/** The opening claim of a narrative, with its markdown heading stripped. */
function firstSentence(narrative: string | null): string | null {
  if (!narrative) return null;
  const body = narrative
    .split('\n')
    .filter((line) => !line.trim().startsWith('#') && line.trim().length > 0)
    .join(' ')
    .replace(/\[\d+\]/g, '')
    .trim();
  if (!body) return null;
  const stop = body.indexOf('. ');
  return stop === -1 ? body.slice(0, 240) : body.slice(0, stop + 1);
}

function formatContext(context: KnowledgeContext): string {
  const parts: string[] = ['\n\n--- Knowledge Graph Context ---'];
  parts.push('The following information is from the user\'s personal knowledge graph. Use it to inform your responses when relevant. Cite source notes when possible.\n');

  if (context.entities.length > 0) {
    parts.push('**Known Entities:**');
    for (const entity of context.entities) {
      parts.push(`\n${entity.icon} **${entity.name}** (${entity.type})`);
      if (entity.summary) {
        parts.push(`  Summary: ${entity.summary}`);
      }
      if (entity.properties && Object.keys(entity.properties).length > 0) {
        const props = Object.entries(entity.properties)
          .filter(([, v]) => v != null && v !== '')
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        if (props) parts.push(`  Properties: ${props}`);
      }
      if (entity.relationships.length > 0) {
        parts.push(`  Relationships: ${entity.relationships.join('; ')}`);
      }
    }
  }

  if (context.clusters.length > 0) {
    parts.push('\n**Clusters** — the named neighbourhoods this graph divides into:');
    for (const cluster of context.clusters) {
      parts.push(`\n- **${cluster.label}** — ${cluster.size} entities, from ${cluster.sources}`);
      if (cluster.narrative) parts.push(`  ${cluster.narrative}`);
    }
  }

  if (context.noteExcerpts.length > 0) {
    parts.push('\n**Relevant Notes:**');
    for (const note of context.noteExcerpts) {
      parts.push(`\n- "${note.title ?? 'Untitled'}" (${note.date}):`);
      parts.push(`  ${note.excerpt}`);
    }
  }

  return parts.join('\n');
}

/**
 * Grounding block for entities the user named with `@entity` in the composer.
 *
 * Naming an entity should mean the turn starts from what the graph actually
 * holds about it, rather than from whatever the model happens to recall. Gives
 * each entity its summary, its strongest connections with the relationship
 * describing each, its recent timeline, and the sources — so the reply can
 * cite rather than assert.
 *
 * Returns '' when nothing resolves, so the caller can skip the block entirely.
 */
export async function buildEntityGrounding(entityIds: string[]): Promise<string> {
  if (!entityIds.length) return '';

  const { getGraphAnalysis } = await import('./analytics/load');
  const { index } = await getGraphAnalysis();

  const blocks: string[] = [];

  for (const id of entityIds) {
    const node = index.byId.get(id);
    if (!node) continue;

    const lines: string[] = [`### ${node.name} (${node.typeName})`];
    if (node.summary) lines.push(node.summary);

    const neighbours = [...(index.neighbours.get(id) ?? [])]
      .map((nb) => index.byId.get(nb))
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .sort((a, b) => (index.degree.get(b.id) ?? 0) - (index.degree.get(a.id) ?? 0))
      .slice(0, 10);
    if (neighbours.length) {
      lines.push(`Connected to: ${neighbours.map((n) => `${n.name} (${n.typeName})`).join(', ')}`);
    }

    // Evidence, so the model can cite rather than assert. The excerpt is the
    // sentence the claim was actually made in.
    const notes = await db
      .select({
        title: intelNotes.title,
        source: intelNotes.source,
        excerpt: intelNoteEntities.excerpt,
      })
      .from(intelNoteEntities)
      .innerJoin(intelNotes, eq(intelNoteEntities.noteId, intelNotes.id))
      .where(eq(intelNoteEntities.entityId, id))
      .orderBy(desc(intelNotes.createdAt))
      .limit(4);

    const cited = notes.filter((n) => n.excerpt);
    if (cited.length) {
      lines.push('Evidence:');
      for (const n of cited) lines.push(`- ${n.title ?? n.source}: "${n.excerpt}"`);
    } else if (notes.length) {
      lines.push(`Sources: ${notes.map((n) => n.title ?? n.source).join('; ')}`);
    }

    blocks.push(lines.join('\n'));
  }

  if (!blocks.length) return '';
  return [
    'INTEL GRAPH CONTEXT — the user named these entities explicitly.',
    'Use this as the factual basis for your answer, and say so when you rely on it.',
    '',
    ...blocks,
  ].join('\n');
}
