import { db } from '$lib/db';
import { intelNotes, intelAlerts } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { getLLMClient } from '$lib/llm/client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { currentSessionModel } from '$lib/context/chat';

interface SimilarNote {
  id: string;
  title: string | null;
  snippet: string;
  distance: number;
}

interface SimilarEntity {
  id: string;
  name: string;
  typeName: string;
  summary: string | null;
  distance: number;
}

interface EvaluatedConnection {
  type: 'connection' | 'risk_change' | 'contradiction' | 'pattern';
  title: string;
  content: string;
  significance: 'high' | 'medium' | 'low';
  relatedEntityIds: string[];
}

async function findSimilarNotes(noteId: string, limit = 10): Promise<SimilarNote[]> {
  const rows = await db.execute(sql`
    SELECT n.id, n.title,
           substring(n.processed_content from 1 for 300) as snippet,
           n.embedding <=> (SELECT embedding FROM intel_notes WHERE id = ${noteId}) as distance
    FROM intel_notes n
    WHERE n.id != ${noteId}
      -- Same reason as searchIntel: a note held at the mail gate is embedded so
      -- the queue can cluster it, not so it can be recalled as evidence.
      AND n.graph_state = 'admitted'
      AND n.embedding IS NOT NULL
      AND (SELECT embedding FROM intel_notes WHERE id = ${noteId}) IS NOT NULL
    ORDER BY distance ASC
    LIMIT ${limit}
  `);

  return (rows.rows as any[]).filter((r) => r.distance < 0.5).map((r) => ({
    id: r.id,
    title: r.title,
    snippet: r.snippet ?? '',
    distance: Number(r.distance),
  }));
}

async function findSimilarEntities(noteId: string, limit = 10): Promise<SimilarEntity[]> {
  const rows = await db.execute(sql`
    SELECT e.id, e.name, et.name as type_name, e.summary,
           e.embedding <=> (SELECT embedding FROM intel_notes WHERE id = ${noteId}) as distance
    FROM intel_entities e
    JOIN intel_entity_types et ON e.type_id = et.id
    WHERE e.embedding IS NOT NULL
      AND e.merged_into_id IS NULL
      AND (SELECT embedding FROM intel_notes WHERE id = ${noteId}) IS NOT NULL
    ORDER BY distance ASC
    LIMIT ${limit}
  `);

  return (rows.rows as any[]).filter((r) => r.distance < 0.6).map((r) => ({
    id: r.id,
    name: r.name,
    typeName: r.type_name,
    summary: r.summary,
    distance: Number(r.distance),
  }));
}

async function evaluateConnections(
  noteContent: string,
  similarNotes: SimilarNote[],
  similarEntities: SimilarEntity[],
): Promise<EvaluatedConnection[]> {
  if (similarNotes.length === 0 && similarEntities.length === 0) return [];

  const modelCtx = currentSessionModel() ?? (await resolveDefaultModel());
  const { client, model } = await getLLMClient(modelCtx);

  const notesContext = similarNotes
    .map((n) => `- "${n.title ?? 'Untitled'}" (similarity: ${(1 - n.distance).toFixed(2)}): ${n.snippet}`)
    .join('\n');

  const entitiesContext = similarEntities
    .map((e) => `- ${e.name} (${e.typeName}, similarity: ${(1 - e.distance).toFixed(2)}): ${e.summary ?? 'no summary'}`)
    .join('\n');

  const response = await client.chat.completions.create({
    model,
    temperature: 0.3,
    max_tokens: 1500,
    messages: [
      {
        role: 'system',
        content: `You evaluate whether a new note has genuine, significant connections to existing knowledge.

Return ONLY valid JSON: an array of connections found. Each connection:
{
  "type": "connection | risk_change | contradiction | pattern",
  "title": "Short title (under 80 chars)",
  "content": "1-2 sentence explanation of the connection and why it matters",
  "significance": "high | medium | low",
  "relatedEntityNames": ["entity names involved"]
}

Rules:
- Only report GENUINE connections, not superficial word overlaps
- "high" significance: risk changes, contradictions, urgent cross-references the user should know NOW
- "medium" significance: interesting patterns, new links between known entities
- "low" significance: minor reinforcements of known information
- Return empty array [] if no genuine connections found
- Be conservative — false positives waste the user's attention`,
      },
      {
        role: 'user',
        content: `NEW NOTE:\n${noteContent.slice(0, 2000)}\n\nSIMILAR EXISTING NOTES:\n${notesContext || '(none)'}\n\nRELATED ENTITIES:\n${entitiesContext || '(none)'}\n\nWhat genuine connections exist between the new note and existing knowledge?`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? '[]';
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as Array<{
      type: string;
      title: string;
      content: string;
      significance: string;
      relatedEntityNames?: string[];
    }>;

    return parsed.map((c) => ({
      type: (c.type as EvaluatedConnection['type']) || 'connection',
      title: c.title,
      content: c.content,
      significance: (c.significance as EvaluatedConnection['significance']) || 'medium',
      relatedEntityIds: [],
    }));
  } catch {
    console.error('[intel] Failed to parse connection evaluation:', cleaned.slice(0, 200));
    return [];
  }
}

export async function recallAndAlert(noteId: string): Promise<number> {
  try {
    const [note] = await db
      .select({ processedContent: intelNotes.processedContent, rawContent: intelNotes.rawContent })
      .from(intelNotes)
      .where(eq(intelNotes.id, noteId))
      .limit(1);

    if (!note) return 0;
    const content = note.processedContent || note.rawContent;
    if (!content) return 0;

    const [similarNotes, similarEntities] = await Promise.all([
      findSimilarNotes(noteId),
      findSimilarEntities(noteId),
    ]);

    if (similarNotes.length === 0 && similarEntities.length === 0) return 0;

    const connections = await evaluateConnections(content, similarNotes, similarEntities);

    let alertCount = 0;
    for (const conn of connections) {
      await db.insert(intelAlerts).values({
        noteId,
        type: conn.type,
        title: conn.title,
        content: conn.content,
        significance: conn.significance,
        relatedEntityIds: conn.relatedEntityIds,
      });
      alertCount++;
    }

    if (alertCount > 0) {
      console.log(`[intel] Created ${alertCount} alerts for note ${noteId}`);
    }

    return alertCount;
  } catch (err) {
    console.error(`[intel] Recall failed for note ${noteId}:`, err);
    return 0;
  }
}
