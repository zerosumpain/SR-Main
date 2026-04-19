import { db } from '$lib/db';
import { intelEntities, intelEntityTypes, intelRelationships } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
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
}

export async function buildKnowledgeContext(userMessage: string): Promise<string> {
  try {
    const context = await findRelevantContext(userMessage);

    if (context.entities.length === 0 && context.noteExcerpts.length === 0) {
      return '';
    }

    return formatContext(context);
  } catch (err) {
    console.error('[intel] Failed to build knowledge context:', err);
    return '';
  }
}

async function findRelevantContext(query: string): Promise<KnowledgeContext> {
  let embedding: number[];
  try {
    embedding = await generateEmbedding(query);
  } catch {
    return { entities: [], noteExcerpts: [] };
  }

  const vectorStr = `[${embedding.join(',')}]`;

  const entityRows = await db.execute(sql`
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

  const relevantEntities = (entityRows.rows as any[]).filter((r) => r.distance < 0.6);

  const noteRows = await db.execute(sql`
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

  const relevantNotes = (noteRows.rows as any[]).filter((r) => r.distance < 0.5);

  const entityIds = relevantEntities.map((e: any) => e.id);
  const entities = [];

  for (const row of relevantEntities) {
    const rels = entityIds.length > 0
      ? await db
          .select({
            type: intelRelationships.type,
            label: intelRelationships.label,
            sourceId: intelRelationships.sourceEntityId,
            targetId: intelRelationships.targetEntityId,
          })
          .from(intelRelationships)
          .where(sql`${intelRelationships.sourceEntityId} = ${row.id} OR ${intelRelationships.targetEntityId} = ${row.id}`)
          .limit(10)
      : [];

    const relDescriptions: string[] = [];
    for (const rel of rels) {
      const otherId = rel.sourceId === row.id ? rel.targetId : rel.sourceId;
      const [other] = await db
        .select({ name: intelEntities.name })
        .from(intelEntities)
        .where(eq(intelEntities.id, otherId))
        .limit(1);

      if (other) {
        const direction = rel.sourceId === row.id ? '→' : '←';
        relDescriptions.push(`${direction} ${rel.type.replace(/_/g, ' ')}: ${other.name}`);
      }
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
  };
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

  if (context.noteExcerpts.length > 0) {
    parts.push('\n**Relevant Notes:**');
    for (const note of context.noteExcerpts) {
      parts.push(`\n- "${note.title ?? 'Untitled'}" (${note.date}):`);
      parts.push(`  ${note.excerpt}`);
    }
  }

  return parts.join('\n');
}
