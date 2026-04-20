import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { db } from '$lib/db';
import { intelEntities, intelEntityTypes } from '$lib/db/schema';
import { isNull } from 'drizzle-orm';

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

async function buildExtractionContext(): Promise<string> {
  const types = await db.select({ name: intelEntityTypes.name }).from(intelEntityTypes);

  const entities = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      typeId: intelEntities.typeId,
    })
    .from(intelEntities)
    .where(isNull(intelEntities.mergedIntoId));

  const typeNames = types.map((t) => t.name).join(', ');
  const entityList = entities
    .map((e) => `- ${e.name} (id: ${e.id})`)
    .join('\n');

  return `Known entity types: ${typeNames}

Known entities:
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

export async function extractFromNote(
  noteText: string,
  noteFormat: string,
): Promise<ExtractionResult> {
  const context = await buildExtractionContext();
  const modelCtx = await resolveDefaultModel('builder');
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
  });

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
