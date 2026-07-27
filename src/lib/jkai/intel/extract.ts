import type OpenAI from 'openai';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveExtractionModel } from '$lib/server/models/settings';
import { db } from '$lib/db';
import { intelEntities, intelEntityTypes } from '$lib/db/schema';
import { eq, isNull, sql } from 'drizzle-orm';
import { generateEmbedding } from './embed';

export interface ExtractedEntity {
  name: string;
  type: string;
  confidence: 'high' | 'medium' | 'low';
  properties: Record<string, unknown>;
  possibleMatchId: string | null;
}

export interface ExtractedRelationship {
  source: string;
  target: string;
  type: string;
  label: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ExtractedTimelineEvent {
  date: string;
  dateEnd?: string;
  type: 'deadline' | 'milestone' | 'event' | 'decision';
  title: string;
  description?: string;
  linkedEntity?: string;
}

export interface ProposedNewType {
  name: string;
  description: string;
  icon: string;
}

export interface ExtractionResult {
  summary: string;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  timelineEvents: ExtractedTimelineEvent[];
  proposedNewTypes: ProposedNewType[];
}

/**
 * Above this many entities, stop dumping the whole graph into every extraction
 * prompt and retrieve candidates by vector similarity instead. Below it the
 * full list is both cheap and strictly better for resolution.
 */
const FULL_LIST_CEILING = 60;
/** How many nearest entities to offer as match candidates once past the ceiling. */
const CANDIDATE_K = 40;

/**
 * The resolution candidates the extractor is asked to match against.
 *
 * Originally this dumped every non-merged entity into every call, which is fine
 * at tens of entities and untenable at thousands: the prompt grows without
 * bound, and — because the list changes whenever anything is added — the prompt
 * prefix churns on every call and defeats caching entirely.
 *
 * Past FULL_LIST_CEILING we do what deepdive's cross-session linker already
 * does: embed the note once and take the nearest entities from pgvector.
 */
async function buildExtractionContext(noteText: string): Promise<string> {
  // ACTIVE only. Offering a proposed type here would defeat the review gate —
  // the model would use it, entities would accumulate under it, and admitting
  // it later would be a formality rather than a decision.
  const types = await db
    .select({ name: intelEntityTypes.name })
    .from(intelEntityTypes)
    .where(eq(intelEntityTypes.status, 'active'));
  const typeNames = types.map((t) => t.name).join(', ');

  const [{ count: total } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(intelEntities)
    .where(isNull(intelEntities.mergedIntoId));

  let rows: Array<{ id: string; name: string }> = [];
  let scoped = false;

  if (total > FULL_LIST_CEILING) {
    try {
      const embedding = await generateEmbedding(noteText.slice(0, 8000));
      const vec = `[${embedding.join(',')}]`;
      const res = await db.execute(sql`
        SELECT id, name
        FROM intel_entities
        WHERE merged_into_id IS NULL AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vec}::vector
        LIMIT ${CANDIDATE_K}
      `);
      rows = (res.rows as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id),
        name: String(r.name),
      }));
      scoped = true;
    } catch (err) {
      // Vector recall is an optimisation; a failure must not stop extraction.
      console.warn('[intel] candidate recall failed, falling back to full list:', err instanceof Error ? err.message : err);
    }
  }

  if (!scoped) {
    rows = await db
      .select({ id: intelEntities.id, name: intelEntities.name })
      .from(intelEntities)
      .where(isNull(intelEntities.mergedIntoId));
  }

  const entityList = rows.map((e) => `- ${e.name} (id: ${e.id})`).join('\n');
  const heading = scoped
    ? `Existing entities most similar to this note (${rows.length} of ${total} — match against these; if none fit, it is a new entity):`
    : 'Known entities:';

  return `Known entity types: ${typeNames}

${heading}
${entityList || '(none yet)'}`;
}

const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction assistant. Given a note, extract structured information.

Return ONLY valid JSON matching this schema:
{
  "summary": "A cleaned, structured summary of the note (1-3 sentences)",
  "entities": [
    {
      "name": "Display name",
      "type": "entity type (must be from known types or propose a new one)",
      "confidence": "high | medium | low",
      "properties": { "key": "value" },
      "possibleMatchId": "id of existing entity if this is the same entity, or null"
    }
  ],
  "relationships": [
    {
      "source": "Entity name (must match an entity in the entities array)",
      "target": "Entity name",
      "type": "relationship_type (e.g. reports_to, works_on, owns, blocks, stakeholder_in, collaborates_with, flagged_risk)",
      "label": "Human-readable description",
      "confidence": "high | medium | low"
    }
  ],
  "timelineEvents": [
    {
      "date": "YYYY-MM-DD",
      "dateEnd": "YYYY-MM-DD or omit",
      "type": "deadline | milestone | event | decision",
      "title": "Short title",
      "description": "Optional detail",
      "linkedEntity": "Entity name or omit"
    }
  ],
  "proposedNewTypes": [
    {
      "name": "lowercase_type_name",
      "description": "What this type represents",
      "icon": "single emoji"
    }
  ]
}

Rules:
- Extract ALL people, projects, teams, risks, decisions, deadlines, organisations, and systems mentioned
- For each entity, check if it matches a known entity (by name similarity) and set possibleMatchId
- Only propose new types if an entity genuinely doesn't fit any known type
- Be generous with extraction — capture everything mentioned, even briefly
- Set confidence to "low" if the entity is ambiguous or only vaguely referenced
- Dates should be ISO format. If only a relative date is given (e.g. "next Thursday"), calculate from today's date provided in the prompt
- Return ONLY the JSON object, no markdown fences or commentary`;

/** A chat body plus OpenRouter's non-standard `provider` routing preference.
 *  Pinned to the NON-streaming params so the overload still resolves to a
 *  ChatCompletion rather than the streaming union. */
type OpenRouterChatBody = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
  provider?: { sort?: 'throughput' | 'price' | 'latency' };
};

export async function extractFromNote(
  noteText: string,
  noteFormat: string,
): Promise<ExtractionResult> {
  const context = await buildExtractionContext(noteText);
  const modelCtx = await resolveExtractionModel();
  const { client, model } = await getLLMClient(modelCtx);

  const today = new Date().toISOString().split('T')[0];

  const response = await client.chat.completions.create({
    model,
    temperature: 0.3,
    max_tokens: 16384,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Today's date: ${today}
Note format: ${noteFormat}

${context}

--- NOTE ---
${noteText}
--- END NOTE ---

Extract all entities, relationships, timeline events, and any proposed new types from this note.`,
      },
    ],
    // OpenRouter routes to the cheapest endpoint by default; this asks for the
    // fastest one instead. Measured over 4 trials on the same note: default
    // routing 0.4–0.9s (CoreWeave/Google), throughput-sorted 0.2–0.4s
    // (consistently Cerebras), same extraction quality. Applied ONLY here — ER
    // is the one call a user waits on without seeing any output.
    //
    // `provider` is an OpenRouter extension the OpenAI SDK does not type, so the
    // body is widened rather than the whole argument cast to `any` — a blanket
    // cast would also stop the compiler checking `messages` and `model`.
    provider: { sort: 'throughput' },
  } as OpenRouterChatBody);

  const raw = response.choices[0]?.message?.content ?? '{}';
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as ExtractionResult;
    return {
      summary: parsed.summary ?? '',
      entities: parsed.entities ?? [],
      relationships: parsed.relationships ?? [],
      timelineEvents: parsed.timelineEvents ?? [],
      proposedNewTypes: parsed.proposedNewTypes ?? [],
    };
  } catch {
    console.error('[intel] Failed to parse extraction result:', cleaned.slice(0, 500));
    return {
      summary: '',
      entities: [],
      relationships: [],
      timelineEvents: [],
      proposedNewTypes: [],
    };
  }
}
