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
- For each entity, check if it matches a known entity (by name similarity) and set possibleMatchId
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
/**
 * Rebuild a parseable object from output that was cut off mid-flight.
 *
 * Providers do not honour `max_tokens` uniformly: production saw Cerebras stop
 * at exactly 8192 tokens with `finish_reason: length` while OpenRouter's own
 * endpoint metadata advertises 40960 for it. Since the advertised cap cannot be
 * trusted, truncation has to be survivable rather than merely avoided —
 * recovering 40 of 45 entities beats discarding all 45.
 *
 * Walks the text tracking string state and bracket depth, remembers the last
 * position at which an element was cleanly complete, cuts there and closes the
 * containers that were open AT THAT POINT (not at the end — the depth differs).
 * Returns null when the text was not actually truncated, or when nothing
 * complete was found.
 */
export function salvageTruncatedJson(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  const s = raw.slice(start);

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let cut = -1;
  let cutStack: string[] = [];

  const mark = (idx: number) => {
    // Only inside a container — the outermost object closing is not a cut point.
    if (stack.length >= 1) {
      cut = idx;
      cutStack = stack.slice();
    }
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      stack.pop();
      mark(i + 1); // just after a completed nested value
    } else if (c === ',') {
      // Cut BEFORE the comma so the container ends on a complete element.
      mark(i);
    }
  }

  if (stack.length === 0) return null; // well-formed already — not our problem
  if (cut <= 0) return null;

  return s.slice(0, cut) + cutStack.reverse().join('');
}

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

  // Last resort: output cut off mid-value by a provider ignoring max_tokens.
  const salvaged = salvageTruncatedJson(trimmed);
  if (salvaged) candidates.push(salvaged);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as ExtractionResult;
      // A JSON scalar is valid JSON and useless here — require an object.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      return {
        summary: parsed.summary ?? '',
        entities: parsed.entities ?? [],
        relationships: parsed.relationships ?? [],
        timelineEvents: parsed.timelineEvents ?? [],
        proposedNewTypes: parsed.proposedNewTypes ?? [],
      };
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
  let truncated = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    // A first attempt cut short by the provider's own output ceiling must not
    // simply be resampled against the SAME ceiling. Dropping the throughput pin
    // lets OpenRouter route to an endpoint with room — observed recovering on
    // Groq at 8535 tokens after Cerebras stopped at 8192.
    const response = await createExtraction({ fastest: !truncated });
    const choice = response.choices[0];
    lastRaw = choice?.message?.content ?? '';
    truncated = choice?.finish_reason === 'length';
    lastDiag = `attempt=${attempt} finish=${choice?.finish_reason} provider=${
      (response as { provider?: string }).provider ?? '?'
    } completion_tokens=${response.usage?.completion_tokens ?? '?'} chars=${lastRaw.length}`;

    const parsed = parseExtractionJson(lastRaw);
    if (parsed) {
      if (attempt > 1) console.warn(`[intel] extraction parsed on retry — ${lastDiag}`);
      else if (truncated) console.warn(`[intel] extraction truncated but salvaged — ${lastDiag}`);
      return parsed;
    }
    console.warn(`[intel] extraction output unparseable, ${attempt === 1 ? 'retrying' : 'giving up'} — ${lastDiag}`);
  }

  // Log the WHOLE payload, not a 500-char stub. The stub was what made the
  // production occurrence undiagnosable: every failure looked like a
  // well-formed object that simply stopped at the log boundary.
  console.error(`[intel] extraction failed to parse — ${lastDiag}\n--- RAW ---\n${lastRaw}\n--- END RAW ---`);
  throw new Error(`Intel extraction returned unparseable output (${lastDiag})`);

  async function createExtraction(opts: { fastest: boolean }) {
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
      // Dropped on a truncation retry: the fastest endpoint is also the one that
      // just refused to emit the whole answer, so re-asking it buys nothing.
      //
      // `provider` is an OpenRouter extension the OpenAI SDK does not type, so
      // the body is widened rather than the whole argument cast to `any` — a
      // blanket cast would also stop the compiler checking `messages`/`model`.
      ...(opts.fastest ? { provider: { sort: 'throughput' as const } } : {}),
    } as OpenRouterChatBody);
  }
}
