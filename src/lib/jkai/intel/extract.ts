import { z } from 'zod';
import type OpenAI from 'openai';
import { getLLMClient } from '$lib/llm/client';
import { resolveExtractionModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
import { db } from '$lib/db';
import { intelEntityTypes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export interface ExtractedEntity {
  name: string;
  mentionId?: string;
  mention?: { text: string; start?: number; end?: number; context?: string };
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

/** Type definitions guide extraction; identities are resolved per grounded mention. */
async function buildExtractionContext(_noteText: string): Promise<string> {
  const types = await db.select({ name: intelEntityTypes.name, description: intelEntityTypes.description })
    .from(intelEntityTypes).where(eq(intelEntityTypes.status, 'active'));
  return `Allowed entity types and definitions:\n${types.map(t => `- ${t.name}: ${t.description}`).join('\n')}\nExtract mentions only. Identity is resolved separately; possibleMatchId must be null.`;
}

const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction assistant. Given a note, extract structured information.

Return ONLY valid JSON matching this schema:
{
  "summary": "A cleaned, structured summary of the note (1-3 sentences)",
  "entities": [
    {
      "mentionId": "m1 (unique within this extraction)",
      "name": "Display name",
      "mention": {"text": "exact text copied from this source", "start": 0, "end": 12},
      "type": "entity type (must be from known types or propose a new one)",
      "confidence": "high | medium | low",
      "properties": { "key": "value" },
      "possibleMatchId": "id of existing entity if this is the same entity, or null"
    }
  ],
  "relationships": [
    {
      "source": "mentionId of the source entity",
      "target": "mentionId of the target entity",
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
- Extract EVERY named thing the note mentions. The list of known entity types
  given below is the authority on what counts — work through it and ask, for
  each type, "does the note name one of these?". Do not restrict yourself to
  people and organisations.
- This explicitly includes PLACES: countries, nations, jurisdictions, regions,
  cities, and named administrative areas. A note comparing what several
  countries do must yield one entity per country. Estonia, Denmark, Ontario and
  New Zealand are entities in exactly the way a person or a department is.
- A country, nation, state, region or city is a "location" — INCLUDING when the
  note casts it as an actor. "Estonia runs X-Road" still makes Estonia a
  location, not an organisation. Reserve "organisation" for named bodies:
  departments, agencies, ministries, companies, institutions. So "Estonia" is a
  location and "the Estonian Information System Authority" is an organisation;
  "India" is a location and "the National Health Authority" is an organisation.
- It also includes standards, products, policies, programmes, datasets and
  named documents, reports or surveys.
- Assign a unique mentionId to each distinct entity and use those IDs for relationship endpoints. Two people with the same name must have different IDs and source spans.
- Copy the exact source mention into mention.text, with character offsets when possible. Never invent an entity absent from the source.
- Set possibleMatchId to null; a separate resolver handles identity.
- Entity types describe things, relationship types describe connections. A visit to a city does not prove residence.
- Only propose new types if an entity genuinely doesn't fit any known type
- Be generous with extraction — capture everything mentioned, even briefly
- Set confidence to "low" if the entity is ambiguous or only vaguely referenced
- Ignore the conversational scaffolding itself: do not create entities for the
  assistant, the user, the chat, or the tools used to answer
- Dates should be ISO format. If only a relative date is given (e.g. "next Thursday"), calculate from today's date provided in the prompt
- Return ONLY the JSON object, no markdown fences or commentary`;

/**
 * Recover the JSON object from a model response.
 *
 * The old cleanup was a single multiline-flagged replace of an opening code
 * fence — which strips the fence and LEAVES anything before it. So the moment
 * the model prefixed its answer with a sentence ("Here is the JSON:"), the
 * result was prose followed by an object, JSON.parse threw, and the caller
 * swallowed it into an empty extraction. Silent, and intermittent because
 * whether a preamble appears is a coin toss — measured at 2 of 6 extractions in
 * production on 2026-07-27, each one a thread that quietly learned nothing.
 *
 * `response_format: json_object` is supposed to prevent this, but the request is
 * throughput-routed across providers and adherence is not uniform, so the parse
 * has to be defensive rather than trusting.
 *
 * Strategy: try the raw string, then a fence-stripped form, then the widest
 * brace-delimited slice. Returns null only if none of those is valid JSON.
 */
export function parseExtractionJson(raw: string): ExtractionResult | null {
  const candidates: string[] = [];
  const trimmed = raw.trim();
  if (trimmed) candidates.push(trimmed);

  // Content of the first fenced block, if any.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  // Widest {...} span — drops both a preamble and any trailing commentary.
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const confidence = z.enum(['high', 'medium', 'low']);
      const schema = z.object({
        summary: z.string().default(''),
        entities: z.array(z.object({ name: z.string().trim().min(1), mentionId: z.string().min(1).optional(), type: z.string().min(1), confidence,
          properties: z.record(z.string(), z.unknown()).default({}), possibleMatchId: z.string().nullable().default(null),
          mention: z.object({ text: z.string().min(1), start: z.number().int().nonnegative().optional(), end: z.number().int().nonnegative().optional() }).optional(),
        })).max(300).default([]),
        relationships: z.array(z.object({ source: z.string(), target: z.string(), type: z.string(), label: z.string(), confidence })).default([]),
        timelineEvents: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateEnd: z.string().optional(), type: z.enum(['deadline', 'milestone', 'event', 'decision']), title: z.string(), description: z.string().optional(), linkedEntity: z.string().optional() })).default([]),
        proposedNewTypes: z.array(z.object({ name: z.string(), description: z.string(), icon: z.string() })).default([]),
      });
      const parsed = schema.parse(JSON.parse(candidate));
      const ids = parsed.entities.map(e=>e.mentionId).filter(Boolean);
      if (new Set(ids).size !== ids.length) continue;
      const names = new Set(parsed.entities.flatMap(e => [e.name,...(e.mentionId?[e.mentionId]:[])]));
      if (parsed.relationships.some(r => !names.has(r.source) || !names.has(r.target))) continue;
      return parsed;
    } catch {
      // try the next shape
    }
  }
  return null;
}

/** A chat body plus OpenRouter's non-standard `provider` routing preference.
 *  Pinned to the NON-streaming params so the overload still resolves to a
 *  ChatCompletion rather than the streaming union. */
type OpenRouterChatBody = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
  provider?: { sort?: 'throughput' | 'price' | 'latency' };
};

/**
 * Extract from a note.
 *
 * Throws when the model's output cannot be parsed after a retry. It used to
 * return an EMPTY result in that case, which the caller could not distinguish
 * from "this note genuinely contains nothing" — so the note was marked
 * `processed`, the thread showed no entities, and nothing anywhere said a word
 * had gone wrong. A thrown error is caught by extractIntoIntel and surfaces as
 * `failed`, which is re-runnable.
 */
export async function extractFromNote(
  noteText: string,
  noteFormat: string,
): Promise<ExtractionResult> {
  const context = await buildExtractionContext(noteText);
  const modelCtx = await resolveExtractionModel();
  const { client, model } = await getLLMClient(modelCtx);

  const today = new Date().toISOString().split('T')[0];

  // Two attempts. Parse failures are non-deterministic (a stray preamble, a
  // provider that ignored response_format), so resampling usually fixes what
  // reparsing cannot.
  let lastRaw = '';
  let lastDiag = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    // Tagged so the ledger attributes this spend to the extraction role
    // rather than the anonymous 'gateway' bucket — see $lib/context/activity.
    const response = await withActivity('extraction', createExtraction);
    const choice = response.choices[0];
    lastRaw = choice?.message?.content ?? '';
    lastDiag = `attempt=${attempt} finish=${choice?.finish_reason} provider=${
      (response as { provider?: string }).provider ?? '?'
    } completion_tokens=${response.usage?.completion_tokens ?? '?'} chars=${lastRaw.length}`;

    const parsed = parseExtractionJson(lastRaw);
    if (parsed) {
      if (attempt > 1) console.warn(`[intel] extraction parsed on retry — ${lastDiag}`);
      return parsed;
    }
    console.warn(`[intel] extraction output unparseable, ${attempt === 1 ? 'retrying' : 'giving up'} — ${lastDiag}`);
  }

  // Log the WHOLE payload, not a 500-char stub. The stub was what made the
  // production occurrence undiagnosable: every failure looked like a
  // well-formed object that simply stopped at the log boundary.
  console.error(`[intel] extraction failed to parse — ${lastDiag}\n--- RAW ---\n${lastRaw}\n--- END RAW ---`);
  throw new Error(`Intel extraction returned unparseable output (${lastDiag})`);

  async function createExtraction() {
    return client.chat.completions.create({
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
      // `provider` is an OpenRouter extension the OpenAI SDK does not type, so
      // the body is widened rather than the whole argument cast to `any` — a
      // blanket cast would also stop the compiler checking `messages`/`model`.
      provider: { sort: 'throughput' },
    } as OpenRouterChatBody);
  }
}
