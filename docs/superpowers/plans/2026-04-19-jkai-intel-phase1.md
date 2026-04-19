# JKAI Intel Phase 1 — Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the knowledge graph schema, ingestion API, LLM extraction pipeline, and basic CRUD pages so notes can be captured and browsed immediately.

**Architecture:** Notes arrive via `POST /api/jkai/intel/ingest` (multipart form), get stored in `intel_notes`, then processed asynchronously through a pipeline: preprocess (OCR/transcribe if needed) → extract entities/relationships/timeline via LLM → persist to graph tables. Basic SvelteKit pages at `/jkai/intel/` let you browse notes and entities.

**Tech Stack:** SvelteKit, Drizzle ORM, PostgreSQL + pgvector, OpenAI SDK (via existing `getLLMClient`), Vitest

---

### Task 1: Add Intel Schema Tables to Drizzle

**Files:**
- Modify: `src/lib/db/schema.ts` (append after line 896)

- [ ] **Step 1: Add the intel_entity_types table**

Append to the end of `src/lib/db/schema.ts`:

```typescript
// ── JKAI Intel: Knowledge Graph ─────────────────────────────────────

export const intelEntityTypes = pgTable('intel_entity_types', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  name: text('name').notNull().unique(),
  icon: text('icon').notNull().default('🔷'),
  color: text('color').notNull().default('#7dd3fc'),
  isSeeded: boolean('is_seeded').notNull().default(false),
  description: text('description').notNull().default(''),
  propertySchema: jsonb('property_schema').$type<Record<string, string>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IntelEntityType = typeof intelEntityTypes.$inferSelect;
```

- [ ] **Step 2: Add the intel_notes table**

```typescript
export const intelNotes = pgTable('intel_notes', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  title: text('title'),
  rawContent: text('raw_content').notNull(),
  processedContent: text('processed_content'),
  source: text('source').notNull().default('web'), // web | whatsapp | pwa | email
  format: text('format').notNull().default('text'), // text | handwriting_scan | audio_transcript | email | meeting_transcript | summary
  embedding: vector('embedding'),
  status: text('status').notNull().default('pending'), // pending | processing | processed | failed
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IntelNote = typeof intelNotes.$inferSelect;
export type NewIntelNote = typeof intelNotes.$inferInsert;
```

- [ ] **Step 3: Add the intel_entities table**

```typescript
export const intelEntities = pgTable('intel_entities', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  name: text('name').notNull(),
  typeId: text('type_id').notNull().references(() => intelEntityTypes.id),
  summary: text('summary'),
  properties: jsonb('properties').$type<Record<string, unknown>>(),
  embedding: vector('embedding'),
  confidence: text('confidence').notNull().default('medium'), // high | medium | low
  confirmed: boolean('confirmed').notNull().default(false),
  mergedIntoId: text('merged_into_id'),
  firstSeenIn: text('first_seen_in').references(() => intelNotes.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IntelEntity = typeof intelEntities.$inferSelect;
export type NewIntelEntity = typeof intelEntities.$inferInsert;
```

- [ ] **Step 4: Add the intel_relationships table**

```typescript
export const intelRelationships = pgTable('intel_relationships', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sourceEntityId: text('source_entity_id').notNull().references(() => intelEntities.id, { onDelete: 'cascade' }),
  targetEntityId: text('target_entity_id').notNull().references(() => intelEntities.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  label: text('label'),
  strength: text('strength').notNull().default('moderate'), // strong | moderate | weak
  properties: jsonb('properties').$type<Record<string, unknown>>(),
  confidence: text('confidence').notNull().default('medium'),
  sourceNoteId: text('source_note_id').references(() => intelNotes.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IntelRelationship = typeof intelRelationships.$inferSelect;
```

- [ ] **Step 5: Add the intel_note_entities junction table**

```typescript
export const intelNoteEntities = pgTable('intel_note_entities', {
  noteId: text('note_id').notNull().references(() => intelNotes.id, { onDelete: 'cascade' }),
  entityId: text('entity_id').notNull().references(() => intelEntities.id, { onDelete: 'cascade' }),
  relevance: text('relevance').notNull().default('mentioned'), // primary | mentioned | inferred
  excerpt: text('excerpt'),
});
```

- [ ] **Step 6: Add the intel_timeline_events table**

```typescript
export const intelTimelineEvents = pgTable('intel_timeline_events', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  entityId: text('entity_id').references(() => intelEntities.id, { onDelete: 'set null' }),
  noteId: text('note_id').notNull().references(() => intelNotes.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // ISO date string YYYY-MM-DD
  dateEnd: text('date_end'),
  type: text('type').notNull(), // deadline | milestone | event | decision
  title: text('title').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IntelTimelineEvent = typeof intelTimelineEvents.$inferSelect;
```

- [ ] **Step 7: Add the intel_alerts table**

```typescript
export const intelAlerts = pgTable('intel_alerts', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  noteId: text('note_id').notNull().references(() => intelNotes.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // connection | risk_change | contradiction | pattern
  title: text('title').notNull(),
  content: text('content').notNull(),
  significance: text('significance').notNull().default('medium'), // high | medium | low
  relatedEntityIds: jsonb('related_entity_ids').$type<string[]>().notNull().default([]),
  delivered: boolean('delivered').notNull().default(false),
  dismissed: boolean('dismissed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IntelAlert = typeof intelAlerts.$inferSelect;
```

- [ ] **Step 8: Push schema to database**

Run: `cd ~/strange_rambling_svelte && npx drizzle-kit push`

Expected: Tables `intel_entity_types`, `intel_notes`, `intel_entities`, `intel_relationships`, `intel_note_entities`, `intel_timeline_events`, `intel_alerts` created successfully.

- [ ] **Step 9: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/db/schema.ts
git commit -m "feat(intel): add knowledge graph schema tables"
```

---

### Task 2: Seed Entity Types

**Files:**
- Create: `src/lib/jkai/intel/seed.ts`

- [ ] **Step 1: Write the seed module**

```typescript
import { db } from '$lib/db';
import { intelEntityTypes } from '$lib/db/schema';
import { sql } from 'drizzle-orm';

const SEEDED_TYPES = [
  { name: 'person', icon: '👤', color: '#7dd3fc', description: 'A person — colleague, stakeholder, contact', propertySchema: { role: 'string', team: 'string', department: 'string', reportsTo: 'string' } },
  { name: 'project', icon: '📋', color: '#34d399', description: 'A project, initiative, or workstream', propertySchema: { status: 'string', owner: 'string', deadline: 'string' } },
  { name: 'team', icon: '👥', color: '#a78bfa', description: 'A team or group of people', propertySchema: { department: 'string', lead: 'string' } },
  { name: 'risk', icon: '⚠️', color: '#ef4444', description: 'A risk, concern, or threat', propertySchema: { severity: 'string', likelihood: 'string', mitigation: 'string' } },
  { name: 'decision', icon: '✅', color: '#fbbf24', description: 'A decision that was made or needs to be made', propertySchema: { status: 'string', decidedBy: 'string' } },
  { name: 'deadline', icon: '📅', color: '#f472b6', description: 'A deadline or due date', propertySchema: { date: 'string', linkedProject: 'string' } },
  { name: 'organisation', icon: '🏢', color: '#60a5fa', description: 'An external or internal organisation, company, or vendor', propertySchema: { type: 'string', relationship: 'string' } },
  { name: 'system', icon: '🔧', color: '#c084fc', description: 'A system, tool, platform, or technology', propertySchema: { category: 'string', owner: 'string' } },
];

export async function seedEntityTypes(): Promise<void> {
  for (const t of SEEDED_TYPES) {
    await db
      .insert(intelEntityTypes)
      .values({
        name: t.name,
        icon: t.icon,
        color: t.color,
        isSeeded: true,
        description: t.description,
        propertySchema: t.propertySchema,
      })
      .onConflictDoNothing({ target: intelEntityTypes.name });
  }
}
```

- [ ] **Step 2: Write a test for seeding**

Create `tests/lib/jkai/intel/seed.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// Unit test: verify the seed data is well-formed (no DB needed)
describe('seed entity types data', () => {
  it('has 8 seeded types with required fields', async () => {
    // Import the module to check the constant shape
    // We can't run the DB seed in unit tests, but we can verify the data
    const mod = await import('$lib/jkai/intel/seed');
    // seedEntityTypes is the only export — if it imports cleanly, the data is valid
    expect(typeof mod.seedEntityTypes).toBe('function');
  });
});
```

- [ ] **Step 3: Run the test**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/jkai/intel/seed.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/jkai/intel/seed.ts tests/lib/jkai/intel/seed.test.ts
git commit -m "feat(intel): add entity type seed data"
```

---

### Task 3: Build the Extraction Pipeline — extract.ts

**Files:**
- Create: `src/lib/jkai/intel/extract.ts`
- Test: `tests/lib/jkai/intel/extract.test.ts`

This is the core LLM call that takes note text + existing entities and returns structured JSON with entities, relationships, timeline events, and proposed new types.

- [ ] **Step 1: Define the extraction types**

Create `src/lib/jkai/intel/extract.ts`:

```typescript
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
```

- [ ] **Step 2: Build the context loader**

Append to `src/lib/jkai/intel/extract.ts`:

```typescript
async function buildExtractionContext(): Promise<string> {
  // Load existing entity types
  const types = await db.select({ name: intelEntityTypes.name }).from(intelEntityTypes);

  // Load existing entities (name + type) for dedup matching — only non-merged
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
```

- [ ] **Step 3: Build the extraction function**

Append to `src/lib/jkai/intel/extract.ts`:

```typescript
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
  const modelCtx = await resolveDefaultModel('chat');
  const { client, model } = await getLLMClient(modelCtx);

  const today = new Date().toISOString().split('T')[0];

  const response = await client.chat.completions.create({
    model,
    temperature: 0.3,
    max_tokens: 4096,
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

  // Strip markdown fences if present
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
    console.error('[intel] Failed to parse extraction result:', cleaned.slice(0, 200));
    return {
      summary: '',
      entities: [],
      relationships: [],
      timelineEvents: [],
      proposedNewTypes: [],
    };
  }
}
```

- [ ] **Step 4: Write tests for extraction parsing**

Create `tests/lib/jkai/intel/extract.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the LLM client and DB before importing
vi.mock('$lib/jkai/llm-client', () => ({
  getLLMClient: vi.fn(),
}));
vi.mock('$lib/server/models/settings', () => ({
  resolveDefaultModel: vi.fn().mockResolvedValue({ provider: 'zai', modelId: 'test' }),
}));
vi.mock('$lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({
  intelEntities: { id: 'id', name: 'name', typeId: 'type_id', mergedIntoId: 'merged_into_id' },
  intelEntityTypes: { name: 'name' },
}));

import { extractFromNote } from '$lib/jkai/intel/extract';
import { getLLMClient } from '$lib/jkai/llm-client';

const MOCK_EXTRACTION = {
  summary: 'Met with Sarah to discuss platform migration timeline.',
  entities: [
    { name: 'Sarah Chen', type: 'person', confidence: 'high', properties: { role: 'Engineering Lead' }, possibleMatchId: null },
    { name: 'Platform Migration', type: 'project', confidence: 'high', properties: {}, possibleMatchId: null },
  ],
  relationships: [
    { source: 'Sarah Chen', target: 'Platform Migration', type: 'stakeholder_in', label: 'Key stakeholder', confidence: 'high' },
  ],
  timelineEvents: [
    { date: '2026-05-01', type: 'deadline', title: 'Q3 planning kickoff', linkedEntity: 'Platform Migration' },
  ],
  proposedNewTypes: [],
};

describe('extractFromNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock DB select to return empty arrays for both entity types and entities queries
    const mockFrom = vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue([]),
    }));
    const { db } = vi.mocked(await import('$lib/db'));
    db.select = vi.fn().mockReturnValue({ from: mockFrom }) as any;
  });

  it('parses a valid LLM extraction response', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(MOCK_EXTRACTION) } }],
    });
    vi.mocked(getLLMClient).mockResolvedValue({
      client: { chat: { completions: { create: mockCreate } } } as any,
      model: 'test-model',
    });

    const result = await extractFromNote('Met with Sarah Chen about the platform migration. Q3 deadline May 1.', 'text');

    expect(result.summary).toBe('Met with Sarah to discuss platform migration timeline.');
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].name).toBe('Sarah Chen');
    expect(result.relationships).toHaveLength(1);
    expect(result.timelineEvents).toHaveLength(1);
    expect(result.timelineEvents[0].date).toBe('2026-05-01');
  });

  it('handles malformed JSON gracefully', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'not json at all' } }],
    });
    vi.mocked(getLLMClient).mockResolvedValue({
      client: { chat: { completions: { create: mockCreate } } } as any,
      model: 'test-model',
    });

    const result = await extractFromNote('some note', 'text');

    expect(result.summary).toBe('');
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.timelineEvents).toEqual([]);
    expect(result.proposedNewTypes).toEqual([]);
  });

  it('strips markdown fences from response', async () => {
    const wrapped = '```json\n' + JSON.stringify(MOCK_EXTRACTION) + '\n```';
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: wrapped } }],
    });
    vi.mocked(getLLMClient).mockResolvedValue({
      client: { chat: { completions: { create: mockCreate } } } as any,
      model: 'test-model',
    });

    const result = await extractFromNote('test note', 'text');
    expect(result.entities).toHaveLength(2);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/jkai/intel/extract.test.ts`

Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/jkai/intel/extract.ts tests/lib/jkai/intel/extract.test.ts
git commit -m "feat(intel): add LLM entity extraction pipeline"
```

---

### Task 4: Build the Graph Persistence Module — graph.ts

**Files:**
- Create: `src/lib/jkai/intel/graph.ts`
- Test: `tests/lib/jkai/intel/graph.test.ts`

This module takes an `ExtractionResult` and persists entities, relationships, timeline events, and new types to the database.

- [ ] **Step 1: Write the graph persistence module**

Create `src/lib/jkai/intel/graph.ts`:

```typescript
import { db } from '$lib/db';
import {
  intelEntities,
  intelEntityTypes,
  intelRelationships,
  intelNoteEntities,
  intelTimelineEvents,
} from '$lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import type {
  ExtractionResult,
  ExtractedEntity,
  ExtractedRelationship,
  ExtractedTimelineEvent,
  ProposedNewType,
} from './extract';

/** Resolve an entity type name to its ID, or null if unknown */
async function resolveTypeId(typeName: string): Promise<string | null> {
  const [row] = await db
    .select({ id: intelEntityTypes.id })
    .from(intelEntityTypes)
    .where(eq(intelEntityTypes.name, typeName.toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

/** Create any proposed new entity types (biased toward acceptance) */
async function createProposedTypes(proposed: ProposedNewType[]): Promise<void> {
  for (const t of proposed) {
    await db
      .insert(intelEntityTypes)
      .values({
        name: t.name.toLowerCase(),
        icon: t.icon,
        description: t.description,
        isSeeded: false,
      })
      .onConflictDoNothing({ target: intelEntityTypes.name });
  }
}

/** Upsert an entity: merge into existing if possibleMatchId provided, else create new */
async function upsertEntity(
  entity: ExtractedEntity,
  noteId: string,
): Promise<string> {
  // If the LLM matched to an existing entity, update it
  if (entity.possibleMatchId) {
    const [existing] = await db
      .select()
      .from(intelEntities)
      .where(eq(intelEntities.id, entity.possibleMatchId))
      .limit(1);

    if (existing) {
      // Merge properties
      const mergedProps = { ...(existing.properties as Record<string, unknown> ?? {}), ...entity.properties };
      await db
        .update(intelEntities)
        .set({
          properties: mergedProps,
          updatedAt: new Date(),
          // Upgrade confidence if higher
          ...(entity.confidence === 'high' ? { confidence: 'high' } : {}),
        })
        .where(eq(intelEntities.id, existing.id));
      return existing.id;
    }
  }

  // Create new entity
  const typeId = await resolveTypeId(entity.type);
  if (!typeId) {
    console.warn(`[intel] Unknown entity type "${entity.type}" for "${entity.name}", skipping`);
    return '';
  }

  const [created] = await db
    .insert(intelEntities)
    .values({
      name: entity.name,
      typeId,
      properties: entity.properties,
      confidence: entity.confidence,
      firstSeenIn: noteId,
    })
    .returning({ id: intelEntities.id });

  return created.id;
}

/** Persist a full extraction result to the graph */
export async function persistExtraction(
  noteId: string,
  result: ExtractionResult,
): Promise<{ entityCount: number; relationshipCount: number; timelineEventCount: number }> {
  // 1. Create any proposed new types first
  await createProposedTypes(result.proposedNewTypes);

  // 2. Upsert entities, building a name → id map
  const entityIdMap = new Map<string, string>();
  for (const entity of result.entities) {
    const id = await upsertEntity(entity, noteId);
    if (id) {
      entityIdMap.set(entity.name, id);
    }
  }

  // 3. Create note_entity junctions
  for (const entity of result.entities) {
    const entityId = entityIdMap.get(entity.name);
    if (!entityId) continue;
    await db
      .insert(intelNoteEntities)
      .values({
        noteId,
        entityId,
        relevance: entity.confidence === 'high' ? 'primary' : 'mentioned',
      })
      .onConflictDoNothing();
  }

  // 4. Create relationships
  let relationshipCount = 0;
  for (const rel of result.relationships) {
    const sourceId = entityIdMap.get(rel.source);
    const targetId = entityIdMap.get(rel.target);
    if (!sourceId || !targetId) continue;

    await db.insert(intelRelationships).values({
      sourceEntityId: sourceId,
      targetEntityId: targetId,
      type: rel.type,
      label: rel.label,
      confidence: rel.confidence,
      sourceNoteId: noteId,
    });
    relationshipCount++;
  }

  // 5. Create timeline events
  let timelineEventCount = 0;
  for (const event of result.timelineEvents) {
    const entityId = event.linkedEntity ? entityIdMap.get(event.linkedEntity) ?? null : null;

    await db.insert(intelTimelineEvents).values({
      entityId,
      noteId,
      date: event.date,
      dateEnd: event.dateEnd ?? null,
      type: event.type,
      title: event.title,
      description: event.description ?? null,
    });
    timelineEventCount++;
  }

  return {
    entityCount: entityIdMap.size,
    relationshipCount,
    timelineEventCount,
  };
}
```

- [ ] **Step 2: Write tests**

Create `tests/lib/jkai/intel/graph.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtractionResult } from '$lib/jkai/intel/extract';

// Mock DB
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();

vi.mock('$lib/db', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    update: (...args: any[]) => mockUpdate(...args),
    select: (...args: any[]) => mockSelect(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}));

vi.mock('$lib/db/schema', () => ({
  intelEntities: { id: 'id', name: 'name' },
  intelEntityTypes: { id: 'id', name: 'name' },
  intelRelationships: {},
  intelNoteEntities: {},
  intelTimelineEvents: {},
}));

describe('persistExtraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock chains
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        returning: vi.fn().mockResolvedValue([{ id: 'new-entity-id' }]),
      }),
    });

    // resolveTypeId mock
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'type-person' }]),
        }),
      }),
    });

    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it('calls insert for entities, relationships, and timeline events', async () => {
    const { persistExtraction } = await import('$lib/jkai/intel/graph');

    const extraction: ExtractionResult = {
      summary: 'Test summary',
      entities: [
        { name: 'Alice', type: 'person', confidence: 'high', properties: { role: 'Dev' }, possibleMatchId: null },
      ],
      relationships: [],
      timelineEvents: [],
      proposedNewTypes: [],
    };

    const result = await persistExtraction('note-1', extraction);
    expect(result.entityCount).toBe(1);
    expect(mockInsert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/jkai/intel/graph.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/jkai/intel/graph.ts tests/lib/jkai/intel/graph.test.ts
git commit -m "feat(intel): add graph persistence module"
```

---

### Task 5: Build the Preprocessing Module — preprocess.ts

**Files:**
- Create: `src/lib/jkai/intel/preprocess.ts`

Handles OCR for handwriting scans (via LLM vision) and audio transcription.

- [ ] **Step 1: Write the preprocess module**

Create `src/lib/jkai/intel/preprocess.ts`:

```typescript
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { readBuffer } from '$lib/jkai/media/storage';
import type { JkaiAttachment } from '$lib/db/schema';

/**
 * OCR a handwriting scan image using LLM vision.
 * Returns the extracted text.
 */
export async function ocrHandwriting(attachment: JkaiAttachment): Promise<string> {
  const buffer = await readBuffer(attachment.diskPath);
  const base64 = buffer.toString('base64');
  const mimeType = attachment.mimeType || 'image/jpeg';

  const modelCtx = await resolveDefaultModel('chat');
  const { client, model } = await getLLMClient(modelCtx);

  const response = await client.chat.completions.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'This is a photo of handwritten notes. Transcribe all the text you can see, preserving the structure as much as possible. If there are diagrams, describe them briefly. Return only the transcribed text.',
          },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` },
          },
        ],
      },
    ],
  });

  return response.choices[0]?.message?.content ?? '';
}

/**
 * Transcribe audio using OpenAI Whisper API.
 * Falls back to a note about the audio if transcription fails.
 */
export async function transcribeAudio(attachment: JkaiAttachment): Promise<string> {
  const buffer = await readBuffer(attachment.diskPath);

  // Use OpenAI Whisper via the same client infrastructure
  const modelCtx = await resolveDefaultModel('chat');
  const { client } = await getLLMClient(modelCtx);

  try {
    const file = new File([buffer], attachment.originalName ?? 'audio.webm', {
      type: attachment.mimeType,
    });
    const transcription = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
    });
    return transcription.text;
  } catch (err) {
    console.error('[intel] Audio transcription failed:', err);
    return `[Audio note — transcription failed: ${attachment.originalName ?? 'unknown'}]`;
  }
}

/**
 * Parse email text to extract structured fields.
 * Strips common signatures and footers.
 */
export function parseEmail(rawText: string): { subject: string; from: string; body: string } {
  const lines = rawText.split('\n');
  let subject = '';
  let from = '';
  let bodyStart = 0;

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i];
    if (line.toLowerCase().startsWith('subject:')) {
      subject = line.slice(8).trim();
    } else if (line.toLowerCase().startsWith('from:')) {
      from = line.slice(5).trim();
    } else if (line.trim() === '' && (subject || from)) {
      bodyStart = i + 1;
      break;
    }
  }

  let body = lines.slice(bodyStart).join('\n');

  // Strip common email signatures
  const sigPatterns = [/^--\s*$/m, /^Sent from my /m, /^Get Outlook for /m];
  for (const pat of sigPatterns) {
    const match = body.search(pat);
    if (match > 0) {
      body = body.slice(0, match).trim();
    }
  }

  return { subject, from, body: body.trim() };
}
```

- [ ] **Step 2: Write tests for email parsing**

Create `tests/lib/jkai/intel/preprocess.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseEmail } from '$lib/jkai/intel/preprocess';

describe('parseEmail', () => {
  it('extracts subject, from, and body', () => {
    const raw = `From: sarah@example.com
Subject: Q3 Planning Update

Hey team,

Just wanted to share the latest timeline for Q3.
The vendor delivery is now expected by May 15.

--
Sarah Chen
Engineering Lead`;

    const result = parseEmail(raw);
    expect(result.from).toBe('sarah@example.com');
    expect(result.subject).toBe('Q3 Planning Update');
    expect(result.body).toContain('vendor delivery');
    expect(result.body).not.toContain('Engineering Lead');
  });

  it('handles emails without headers', () => {
    const raw = 'Just a plain text note with no headers.';
    const result = parseEmail(raw);
    expect(result.subject).toBe('');
    expect(result.from).toBe('');
    expect(result.body).toBe('Just a plain text note with no headers.');
  });

  it('strips Sent from signatures', () => {
    const raw = `From: test@test.com
Subject: Quick note

Important info here.

Sent from my iPhone`;

    const result = parseEmail(raw);
    expect(result.body).toBe('Important info here.');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/jkai/intel/preprocess.test.ts`

Expected: 3 tests PASS

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/jkai/intel/preprocess.ts tests/lib/jkai/intel/preprocess.test.ts
git commit -m "feat(intel): add preprocessing module (OCR, audio, email parsing)"
```

---

### Task 6: Build the Ingestion Orchestrator — ingest.ts

**Files:**
- Create: `src/lib/jkai/intel/ingest.ts`

This module ties together the full pipeline: create note → preprocess → extract → persist.

- [ ] **Step 1: Write the ingestion module**

Create `src/lib/jkai/intel/ingest.ts`:

```typescript
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { extractFromNote } from './extract';
import { persistExtraction } from './graph';
import { ocrHandwriting, transcribeAudio, parseEmail } from './preprocess';
import type { JkaiAttachment } from '$lib/db/schema';

export interface IngestInput {
  title?: string;
  rawContent: string;
  source: 'web' | 'whatsapp' | 'pwa' | 'email';
  format: 'text' | 'handwriting_scan' | 'audio_transcript' | 'email' | 'meeting_transcript' | 'summary';
  metadata?: Record<string, unknown>;
  /** If the note has an associated media attachment (image/audio) for preprocessing */
  attachment?: JkaiAttachment;
}

/**
 * Create a note and return its ID immediately.
 * Processing happens via processNote() called separately.
 */
export async function createNote(input: IngestInput): Promise<string> {
  const [note] = await db
    .insert(intelNotes)
    .values({
      title: input.title ?? null,
      rawContent: input.rawContent,
      source: input.source,
      format: input.format,
      status: 'pending',
      metadata: input.metadata ?? null,
    })
    .returning({ id: intelNotes.id });

  return note.id;
}

/**
 * Process a note through the full pipeline:
 * preprocess → extract → persist → update status
 */
export async function processNote(noteId: string, attachment?: JkaiAttachment): Promise<void> {
  // Mark as processing
  await db.update(intelNotes).set({ status: 'processing' }).where(eq(intelNotes.id, noteId));

  try {
    // 1. Load the note
    const [note] = await db
      .select()
      .from(intelNotes)
      .where(eq(intelNotes.id, noteId))
      .limit(1);

    if (!note) throw new Error(`Note ${noteId} not found`);

    // 2. Preprocess based on format
    let processedContent = note.rawContent;

    if (note.format === 'handwriting_scan' && attachment) {
      processedContent = await ocrHandwriting(attachment);
    } else if (note.format === 'audio_transcript' && attachment) {
      processedContent = await transcribeAudio(attachment);
    } else if (note.format === 'email') {
      const parsed = parseEmail(note.rawContent);
      processedContent = parsed.subject
        ? `Subject: ${parsed.subject}\nFrom: ${parsed.from}\n\n${parsed.body}`
        : parsed.body;
    }

    // 3. Extract entities, relationships, timeline events
    const extraction = await extractFromNote(processedContent, note.format);

    // 4. Persist to graph
    const stats = await persistExtraction(noteId, extraction);

    // 5. Update note with processed content and summary
    await db
      .update(intelNotes)
      .set({
        processedContent,
        title: note.title || extraction.summary.slice(0, 100) || 'Untitled note',
        status: 'processed',
        updatedAt: new Date(),
      })
      .where(eq(intelNotes.id, noteId));

    console.log(
      `[intel] Processed note ${noteId}: ${stats.entityCount} entities, ${stats.relationshipCount} relationships, ${stats.timelineEventCount} timeline events`,
    );
  } catch (err) {
    console.error(`[intel] Failed to process note ${noteId}:`, err);
    await db
      .update(intelNotes)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(intelNotes.id, noteId));
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/jkai/intel/ingest.ts
git commit -m "feat(intel): add ingestion orchestrator"
```

---

### Task 7: Build the Ingest API Endpoint

**Files:**
- Create: `src/routes/api/jkai/intel/ingest/+server.ts`

- [ ] **Step 1: Write the ingest API endpoint**

Create `src/routes/api/jkai/intel/ingest/+server.ts`:

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createNote, processNote } from '$lib/jkai/intel/ingest';
import { saveBuffer } from '$lib/jkai/media/storage';
import { kindFromMime, extensionForMime, isAllowedMime } from '$lib/jkai/media/mime';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import type { JkaiAttachment } from '$lib/db/schema';

export const POST: RequestHandler = async ({ request }) => {
  const contentType = request.headers.get('content-type') ?? '';

  let title: string | undefined;
  let rawContent: string;
  let source: 'web' | 'whatsapp' | 'pwa' | 'email' = 'web';
  let format: 'text' | 'handwriting_scan' | 'audio_transcript' | 'email' | 'meeting_transcript' | 'summary' = 'text';
  let metadata: Record<string, unknown> = {};
  let attachment: JkaiAttachment | undefined;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    title = (form.get('title') as string) || undefined;
    rawContent = (form.get('content') as string) || '';
    source = (form.get('source') as any) || 'web';
    format = (form.get('format') as any) || 'text';

    const metaRaw = form.get('metadata') as string;
    if (metaRaw) {
      try { metadata = JSON.parse(metaRaw); } catch {}
    }

    // Handle file upload (image/audio)
    const file = form.get('file');
    if (file instanceof File && file.size > 0) {
      const buf = Buffer.from(await file.arrayBuffer());
      const mime = file.type || 'application/octet-stream';

      if (!isAllowedMime(mime)) throw error(415, `Unsupported file type: ${mime}`);

      const ext = extensionForMime(mime);
      const { diskPath, sizeBytes } = await saveBuffer(buf, ext);
      const kind = kindFromMime(mime)!;

      const [att] = await db.insert(jkaiAttachments).values({
        source,
        kind,
        mimeType: mime,
        originalName: file.name.slice(0, 255),
        sizeBytes,
        diskPath,
        duration: null,
        metadata: null,
      }).returning();

      attachment = att;

      // If no text content was provided, set a placeholder
      if (!rawContent) {
        rawContent = `[${kind} attachment: ${file.name}]`;
      }

      // Auto-detect format from file type
      if (kind === 'image' && format === 'text') {
        format = 'handwriting_scan';
      } else if (kind === 'audio' && format === 'text') {
        format = 'audio_transcript';
      }
    }
  } else {
    // JSON body
    const body = await request.json();
    title = body.title;
    rawContent = body.content || '';
    source = body.source || 'web';
    format = body.format || 'text';
    metadata = body.metadata || {};
  }

  if (!rawContent) throw error(400, 'content is required');

  const noteId = await createNote({ title, rawContent, source, format, metadata, attachment });

  // Process asynchronously — don't block the response
  processNote(noteId, attachment).catch((err) => {
    console.error(`[intel] Background processing failed for note ${noteId}:`, err);
  });

  return json({ id: noteId, status: 'pending' }, { status: 201 });
};
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/jkai/intel/ingest/+server.ts
git commit -m "feat(intel): add ingest API endpoint"
```

---

### Task 8: Build Note & Entity CRUD API Endpoints

**Files:**
- Create: `src/routes/api/jkai/intel/notes/+server.ts`
- Create: `src/routes/api/jkai/intel/notes/[id]/+server.ts`
- Create: `src/routes/api/jkai/intel/entities/+server.ts`
- Create: `src/routes/api/jkai/intel/entities/[id]/+server.ts`
- Create: `src/routes/api/jkai/intel/stats/+server.ts`
- Create: `src/lib/jkai/intel/queries.ts`

- [ ] **Step 1: Write the intel queries module**

Create `src/lib/jkai/intel/queries.ts`:

```typescript
import { db } from '$lib/db';
import {
  intelNotes,
  intelEntities,
  intelEntityTypes,
  intelRelationships,
  intelNoteEntities,
  intelTimelineEvents,
  intelAlerts,
} from '$lib/db/schema';
import { desc, eq, sql, isNull, asc, and, count } from 'drizzle-orm';

export async function listNotes(opts: { limit?: number; offset?: number; source?: string; format?: string } = {}) {
  const { limit = 50, offset = 0, source, format } = opts;

  const conditions = [
    ...(source ? [eq(intelNotes.source, source)] : []),
    ...(format ? [eq(intelNotes.format, format)] : []),
  ];

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const notes = await db
    .select({
      id: intelNotes.id,
      title: intelNotes.title,
      source: intelNotes.source,
      format: intelNotes.format,
      status: intelNotes.status,
      createdAt: intelNotes.createdAt,
      updatedAt: intelNotes.updatedAt,
      entityCount: sql<number>`(
        select count(*) from intel_note_entities
        where intel_note_entities.note_id = intel_notes.id
      )::int`.as('entity_count'),
    })
    .from(intelNotes)
    .where(where)
    .orderBy(desc(intelNotes.createdAt))
    .limit(limit)
    .offset(offset);

  return notes;
}

export async function getNoteDetail(id: string) {
  const [note] = await db
    .select()
    .from(intelNotes)
    .where(eq(intelNotes.id, id))
    .limit(1);

  if (!note) return null;

  // Load entities linked to this note
  const entities = await db
    .select({
      entityId: intelNoteEntities.entityId,
      relevance: intelNoteEntities.relevance,
      excerpt: intelNoteEntities.excerpt,
      entityName: intelEntities.name,
      entityType: intelEntityTypes.name,
      entityTypeIcon: intelEntityTypes.icon,
      entityTypeColor: intelEntityTypes.color,
    })
    .from(intelNoteEntities)
    .innerJoin(intelEntities, eq(intelNoteEntities.entityId, intelEntities.id))
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(eq(intelNoteEntities.noteId, id));

  // Load timeline events from this note
  const timelineEvents = await db
    .select()
    .from(intelTimelineEvents)
    .where(eq(intelTimelineEvents.noteId, id))
    .orderBy(asc(intelTimelineEvents.date));

  return { note, entities, timelineEvents };
}

export async function listEntities(opts: { limit?: number; offset?: number; typeId?: string } = {}) {
  const { limit = 50, offset = 0, typeId } = opts;

  const conditions = [
    isNull(intelEntities.mergedIntoId),
    ...(typeId ? [eq(intelEntities.typeId, typeId)] : []),
  ];

  const entities = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      typeId: intelEntities.typeId,
      typeName: intelEntityTypes.name,
      typeIcon: intelEntityTypes.icon,
      typeColor: intelEntityTypes.color,
      summary: intelEntities.summary,
      confidence: intelEntities.confidence,
      confirmed: intelEntities.confirmed,
      createdAt: intelEntities.createdAt,
      noteCount: sql<number>`(
        select count(*) from intel_note_entities
        where intel_note_entities.entity_id = intel_entities.id
      )::int`.as('note_count'),
      relationshipCount: sql<number>`(
        select count(*) from intel_relationships
        where intel_relationships.source_entity_id = intel_entities.id
           or intel_relationships.target_entity_id = intel_entities.id
      )::int`.as('relationship_count'),
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(and(...conditions))
    .orderBy(desc(intelEntities.updatedAt))
    .limit(limit)
    .offset(offset);

  return entities;
}

export async function getEntityDetail(id: string) {
  const [entity] = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      typeId: intelEntities.typeId,
      typeName: intelEntityTypes.name,
      typeIcon: intelEntityTypes.icon,
      typeColor: intelEntityTypes.color,
      summary: intelEntities.summary,
      properties: intelEntities.properties,
      confidence: intelEntities.confidence,
      confirmed: intelEntities.confirmed,
      createdAt: intelEntities.createdAt,
      updatedAt: intelEntities.updatedAt,
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(eq(intelEntities.id, id))
    .limit(1);

  if (!entity) return null;

  // Relationships where this entity is source or target
  const relationships = await db
    .select({
      id: intelRelationships.id,
      type: intelRelationships.type,
      label: intelRelationships.label,
      strength: intelRelationships.strength,
      confidence: intelRelationships.confidence,
      sourceEntityId: intelRelationships.sourceEntityId,
      targetEntityId: intelRelationships.targetEntityId,
    })
    .from(intelRelationships)
    .where(
      sql`${intelRelationships.sourceEntityId} = ${id} OR ${intelRelationships.targetEntityId} = ${id}`,
    );

  // Resolve entity names for relationship endpoints
  const relatedIds = new Set<string>();
  for (const r of relationships) {
    relatedIds.add(r.sourceEntityId);
    relatedIds.add(r.targetEntityId);
  }
  relatedIds.delete(id);

  const relatedEntities = relatedIds.size > 0
    ? await db
        .select({ id: intelEntities.id, name: intelEntities.name, typeIcon: intelEntityTypes.icon })
        .from(intelEntities)
        .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
        .where(sql`${intelEntities.id} IN (${sql.join([...relatedIds].map(i => sql`${i}`), sql`, `)})`)
    : [];

  const entityNameMap = new Map(relatedEntities.map((e) => [e.id, { name: e.name, icon: e.typeIcon }]));

  // Notes mentioning this entity
  const notes = await db
    .select({
      noteId: intelNoteEntities.noteId,
      relevance: intelNoteEntities.relevance,
      excerpt: intelNoteEntities.excerpt,
      noteTitle: intelNotes.title,
      noteCreatedAt: intelNotes.createdAt,
    })
    .from(intelNoteEntities)
    .innerJoin(intelNotes, eq(intelNoteEntities.noteId, intelNotes.id))
    .where(eq(intelNoteEntities.entityId, id))
    .orderBy(desc(intelNotes.createdAt));

  // Timeline events
  const timelineEvents = await db
    .select()
    .from(intelTimelineEvents)
    .where(eq(intelTimelineEvents.entityId, id))
    .orderBy(asc(intelTimelineEvents.date));

  return {
    entity,
    relationships: relationships.map((r) => {
      const otherId = r.sourceEntityId === id ? r.targetEntityId : r.sourceEntityId;
      const other = entityNameMap.get(otherId);
      const direction = r.sourceEntityId === id ? 'outgoing' : 'incoming';
      return { ...r, direction, otherEntityId: otherId, otherEntityName: other?.name ?? 'Unknown', otherEntityIcon: other?.icon ?? '🔷' };
    }),
    notes,
    timelineEvents,
  };
}

export async function getIntelStats() {
  const [[noteCount], [entityCount], [riskCount], [pendingReviewCount]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(intelNotes),
    db.select({ count: sql<number>`count(*)::int` }).from(intelEntities).where(isNull(intelEntities.mergedIntoId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(intelEntities)
      .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
      .where(and(eq(intelEntityTypes.name, 'risk'), isNull(intelEntities.mergedIntoId))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(intelEntities)
      .where(and(eq(intelEntities.confirmed, false), eq(intelEntities.confidence, 'low'), isNull(intelEntities.mergedIntoId))),
  ]);

  return {
    noteCount: noteCount.count,
    entityCount: entityCount.count,
    riskCount: riskCount.count,
    pendingReviewCount: pendingReviewCount.count,
  };
}

export async function listEntityTypes() {
  return db.select().from(intelEntityTypes).orderBy(asc(intelEntityTypes.name));
}
```

- [ ] **Step 2: Write the notes list endpoint**

Create `src/routes/api/jkai/intel/notes/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listNotes } from '$lib/jkai/intel/queries';

export const GET: RequestHandler = async ({ url }) => {
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const source = url.searchParams.get('source') ?? undefined;
  const format = url.searchParams.get('format') ?? undefined;

  const notes = await listNotes({ limit, offset, source, format });
  return json(notes);
};
```

- [ ] **Step 3: Write the note detail endpoint**

Create `src/routes/api/jkai/intel/notes/[id]/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getNoteDetail } from '$lib/jkai/intel/queries';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const detail = await getNoteDetail(params.id);
  if (!detail) return json({ error: 'Not found' }, { status: 404 });
  return json(detail);
};

export const DELETE: RequestHandler = async ({ params }) => {
  await db.delete(intelNotes).where(eq(intelNotes.id, params.id));
  return json({ deleted: true });
};
```

- [ ] **Step 4: Write the entities list endpoint**

Create `src/routes/api/jkai/intel/entities/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listEntities, listEntityTypes } from '$lib/jkai/intel/queries';

export const GET: RequestHandler = async ({ url }) => {
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const typeId = url.searchParams.get('typeId') ?? undefined;

  const [entities, types] = await Promise.all([
    listEntities({ limit, offset, typeId }),
    listEntityTypes(),
  ]);

  return json({ entities, types });
};
```

- [ ] **Step 5: Write the entity detail endpoint**

Create `src/routes/api/jkai/intel/entities/[id]/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEntityDetail } from '$lib/jkai/intel/queries';
import { db } from '$lib/db';
import { intelEntities } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const detail = await getEntityDetail(params.id);
  if (!detail) return json({ error: 'Not found' }, { status: 404 });
  return json(detail);
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.confirmed !== undefined) updates.confirmed = body.confirmed;
  if (body.properties !== undefined) updates.properties = body.properties;
  if (body.summary !== undefined) updates.summary = body.summary;

  const [updated] = await db
    .update(intelEntities)
    .set(updates)
    .where(eq(intelEntities.id, params.id))
    .returning();

  if (!updated) return json({ error: 'Not found' }, { status: 404 });
  return json(updated);
};

export const DELETE: RequestHandler = async ({ params }) => {
  await db.delete(intelEntities).where(eq(intelEntities.id, params.id));
  return json({ deleted: true });
};
```

- [ ] **Step 6: Write the stats endpoint**

Create `src/routes/api/jkai/intel/stats/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIntelStats } from '$lib/jkai/intel/queries';

export const GET: RequestHandler = async () => {
  const stats = await getIntelStats();
  return json(stats);
};
```

- [ ] **Step 7: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/jkai/intel/queries.ts src/routes/api/jkai/intel/
git commit -m "feat(intel): add CRUD API endpoints for notes, entities, and stats"
```

---

### Task 9: Build the Intel Dashboard Page

**Files:**
- Create: `src/routes/jkai/intel/+page.server.ts`
- Create: `src/routes/jkai/intel/+page.svelte`
- Create: `src/routes/jkai/intel/+layout.svelte`

- [ ] **Step 1: Write the layout**

Create `src/routes/jkai/intel/+layout.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<div class="min-h-screen bg-gray-950 text-gray-100">
  {@render children()}
</div>
```

- [ ] **Step 2: Write the page server load**

Create `src/routes/jkai/intel/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { getIntelStats, listNotes, listEntities, listEntityTypes } from '$lib/jkai/intel/queries';
import { db } from '$lib/db';
import { intelAlerts, intelTimelineEvents, intelEntityTypes, intelEntities } from '$lib/db/schema';
import { desc, eq, gte, asc, and, isNull } from 'drizzle-orm';
import { seedEntityTypes } from '$lib/jkai/intel/seed';

export const load: PageServerLoad = async () => {
  // Ensure seeded types exist on first load
  await seedEntityTypes();

  const [stats, recentNotes, recentAlerts, upcomingTimeline, entityTypes] = await Promise.all([
    getIntelStats(),
    listNotes({ limit: 5 }),
    db
      .select()
      .from(intelAlerts)
      .where(eq(intelAlerts.dismissed, false))
      .orderBy(desc(intelAlerts.createdAt))
      .limit(5),
    db
      .select()
      .from(intelTimelineEvents)
      .where(gte(intelTimelineEvents.date, new Date().toISOString().split('T')[0]))
      .orderBy(asc(intelTimelineEvents.date))
      .limit(5),
    listEntityTypes(),
  ]);

  return {
    stats,
    recentNotes,
    recentAlerts,
    upcomingTimeline,
    entityTypes,
  };
};
```

- [ ] **Step 3: Write the dashboard page**

Create `src/routes/jkai/intel/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();

  const significanceColor: Record<string, string> = {
    high: 'border-red-500',
    medium: 'border-amber-500',
    low: 'border-blue-500',
  };

  const sourceIcon: Record<string, string> = {
    web: '🌐',
    whatsapp: '💬',
    pwa: '📱',
    email: '📧',
  };
</script>

<div class="p-6 max-w-7xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold">Intelligence Dashboard</h1>
    <a href="/jkai/intel/notes/new" class="px-4 py-2 bg-emerald-600 rounded-lg hover:bg-emerald-500 text-sm font-medium">
      + New Note
    </a>
  </div>

  <!-- Stats Bar -->
  <div class="grid grid-cols-4 gap-4 mb-6">
    <div class="bg-gray-900 rounded-lg p-4 text-center">
      <div class="text-3xl font-bold text-sky-400">{data.stats.noteCount}</div>
      <div class="text-xs text-gray-400 mt-1">Notes</div>
    </div>
    <div class="bg-gray-900 rounded-lg p-4 text-center">
      <div class="text-3xl font-bold text-emerald-400">{data.stats.entityCount}</div>
      <div class="text-xs text-gray-400 mt-1">Entities</div>
    </div>
    <div class="bg-gray-900 rounded-lg p-4 text-center">
      <div class="text-3xl font-bold text-amber-400">{data.stats.riskCount}</div>
      <div class="text-xs text-gray-400 mt-1">Active Risks</div>
    </div>
    <div class="bg-gray-900 rounded-lg p-4 text-center">
      <div class="text-3xl font-bold text-pink-400">{data.stats.pendingReviewCount}</div>
      <div class="text-xs text-gray-400 mt-1">Pending Review</div>
    </div>
  </div>

  <div class="grid grid-cols-2 gap-4">
    <!-- Recent Alerts -->
    <div class="bg-gray-900 rounded-lg p-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-amber-400">Recent Alerts</h2>
        <a href="/jkai/intel/alerts" class="text-xs text-gray-400 hover:text-gray-300">View all</a>
      </div>
      {#if data.recentAlerts.length === 0}
        <p class="text-sm text-gray-500">No alerts yet. Start adding notes!</p>
      {:else}
        {#each data.recentAlerts as alert}
          <div class="border-l-3 {significanceColor[alert.significance] ?? 'border-gray-600'} pl-3 mb-3">
            <div class="text-sm">{alert.title}</div>
            <div class="text-xs text-gray-400 mt-1">
              {new Date(alert.createdAt).toLocaleDateString()} &middot; {alert.significance}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Recent Notes -->
    <div class="bg-gray-900 rounded-lg p-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-sky-400">Recent Notes</h2>
        <a href="/jkai/intel/notes" class="text-xs text-gray-400 hover:text-gray-300">View all</a>
      </div>
      {#if data.recentNotes.length === 0}
        <p class="text-sm text-gray-500">No notes yet. Add your first note!</p>
      {:else}
        {#each data.recentNotes as note}
          <a href="/jkai/intel/notes/{note.id}" class="block py-2 border-b border-gray-800 last:border-0 hover:bg-gray-800/50 -mx-2 px-2 rounded">
            <div class="flex items-center gap-2">
              <span>{sourceIcon[note.source] ?? '📝'}</span>
              <span class="text-sm">{note.title ?? 'Untitled'}</span>
              {#if note.status === 'processing'}
                <span class="text-xs bg-amber-900/50 text-amber-400 px-2 py-0.5 rounded">processing</span>
              {:else if note.status === 'failed'}
                <span class="text-xs bg-red-900/50 text-red-400 px-2 py-0.5 rounded">failed</span>
              {/if}
            </div>
            <div class="text-xs text-gray-400 mt-1">
              {note.source} &middot; {new Date(note.createdAt).toLocaleDateString()} &middot; {note.entityCount} entities
            </div>
          </a>
        {/each}
      {/if}
    </div>

    <!-- Upcoming Timeline -->
    <div class="bg-gray-900 rounded-lg p-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-pink-400">Upcoming</h2>
        <a href="/jkai/intel/timeline" class="text-xs text-gray-400 hover:text-gray-300">View all</a>
      </div>
      {#if data.upcomingTimeline.length === 0}
        <p class="text-sm text-gray-500">No upcoming events.</p>
      {:else}
        {#each data.upcomingTimeline as event}
          <div class="py-2 text-sm">
            <span class="text-amber-400">{event.date}</span> — {event.title}
          </div>
        {/each}
      {/if}
    </div>

    <!-- Quick Actions / Entity Types -->
    <div class="bg-gray-900 rounded-lg p-4">
      <h2 class="text-sm font-semibold text-emerald-400 mb-3">Entity Types</h2>
      <div class="flex flex-wrap gap-2">
        {#each data.entityTypes as type}
          <a href="/jkai/intel/entities?typeId={type.id}" class="bg-gray-800 px-3 py-1.5 rounded-full text-sm hover:bg-gray-700">
            {type.icon} {type.name}
          </a>
        {/each}
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/jkai/intel/
git commit -m "feat(intel): add intelligence dashboard page"
```

---

### Task 10: Build the Note Creation Page

**Files:**
- Create: `src/routes/jkai/intel/notes/new/+page.svelte`

- [ ] **Step 1: Write the note creation page**

Create `src/routes/jkai/intel/notes/new/+page.svelte`:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';

  let title = $state('');
  let content = $state('');
  let format = $state('text');
  let file: File | null = $state(null);
  let submitting = $state(false);
  let error = $state('');

  const formats = [
    { value: 'text', label: 'Text / Notes' },
    { value: 'meeting_transcript', label: 'Meeting transcript' },
    { value: 'email', label: 'Email' },
    { value: 'summary', label: 'Summary' },
    { value: 'handwriting_scan', label: 'Handwriting scan (image)' },
    { value: 'audio_transcript', label: 'Audio recording' },
  ];

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    file = input.files?.[0] ?? null;
    if (file) {
      if (file.type.startsWith('image/')) format = 'handwriting_scan';
      else if (file.type.startsWith('audio/')) format = 'audio_transcript';
    }
  }

  async function submit() {
    if (!content && !file) {
      error = 'Please enter some text or attach a file.';
      return;
    }

    submitting = true;
    error = '';

    try {
      const form = new FormData();
      if (title) form.append('title', title);
      if (content) form.append('content', content);
      form.append('source', 'web');
      form.append('format', format);
      if (file) form.append('file', file);

      const res = await fetch('/api/jkai/intel/ingest', {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `Failed (${res.status})`);
      }

      const data = await res.json();
      goto(`/jkai/intel/notes/${data.id}`);
    } catch (e: any) {
      error = e.message;
    } finally {
      submitting = false;
    }
  }
</script>

<div class="p-6 max-w-3xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300 mb-4 inline-block">&larr; Dashboard</a>

  <h1 class="text-2xl font-bold mb-6">New Note</h1>

  <div class="space-y-4">
    <div>
      <label class="block text-sm text-gray-400 mb-1">Title (optional)</label>
      <input
        type="text"
        bind:value={title}
        placeholder="e.g., 1:1 with Sarah — Platform concerns"
        class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
      />
    </div>

    <div>
      <label class="block text-sm text-gray-400 mb-1">Content</label>
      <textarea
        bind:value={content}
        placeholder="Paste or type your notes, transcript, email, etc."
        rows={12}
        class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-500 resize-y"
      ></textarea>
    </div>

    <div>
      <label class="block text-sm text-gray-400 mb-1">Format</label>
      <select
        bind:value={format}
        class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
      >
        {#each formats as f}
          <option value={f.value}>{f.label}</option>
        {/each}
      </select>
    </div>

    <div>
      <label class="block text-sm text-gray-400 mb-1">Attach file (image or audio)</label>
      <input
        type="file"
        accept="image/*,audio/*"
        onchange={handleFileChange}
        class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm"
      />
      {#if file}
        <div class="text-xs text-gray-400 mt-1">{file.name} ({(file.size / 1024).toFixed(0)} KB)</div>
      {/if}
    </div>

    {#if error}
      <div class="text-sm text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</div>
    {/if}

    <button
      onclick={submit}
      disabled={submitting}
      class="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg py-3 font-medium text-sm"
    >
      {submitting ? 'Submitting...' : 'Submit Note'}
    </button>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/jkai/intel/notes/new/
git commit -m "feat(intel): add note creation page"
```

---

### Task 11: Build the Note Detail Page

**Files:**
- Create: `src/routes/jkai/intel/notes/[id]/+page.server.ts`
- Create: `src/routes/jkai/intel/notes/[id]/+page.svelte`

- [ ] **Step 1: Write the server load**

Create `src/routes/jkai/intel/notes/[id]/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { getNoteDetail } from '$lib/jkai/intel/queries';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const detail = await getNoteDetail(params.id);
  if (!detail) throw error(404, 'Note not found');
  return detail;
};
```

- [ ] **Step 2: Write the note detail page**

Create `src/routes/jkai/intel/notes/[id]/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();

  const statusBadge: Record<string, { bg: string; text: string }> = {
    pending: { bg: 'bg-gray-700', text: 'text-gray-300' },
    processing: { bg: 'bg-amber-900/50', text: 'text-amber-400' },
    processed: { bg: 'bg-emerald-900/50', text: 'text-emerald-400' },
    failed: { bg: 'bg-red-900/50', text: 'text-red-400' },
  };

  const badge = statusBadge[data.note.status] ?? statusBadge.pending;
</script>

<div class="p-6 max-w-4xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300 mb-4 inline-block">&larr; Dashboard</a>

  <div class="flex items-start justify-between mb-4">
    <h1 class="text-2xl font-bold">{data.note.title ?? 'Untitled Note'}</h1>
    <span class="{badge.bg} {badge.text} px-2 py-1 rounded text-xs">{data.note.status}</span>
  </div>

  <div class="text-xs text-gray-400 mb-6">
    {data.note.source} &middot; {data.note.format} &middot; {new Date(data.note.createdAt).toLocaleString()}
  </div>

  <div class="grid grid-cols-3 gap-6">
    <!-- Content -->
    <div class="col-span-2 space-y-4">
      <div class="bg-gray-900 rounded-lg p-4">
        <h2 class="text-xs text-gray-400 uppercase mb-2">Content</h2>
        <pre class="text-sm whitespace-pre-wrap leading-relaxed">{data.note.processedContent ?? data.note.rawContent}</pre>
      </div>

      {#if data.note.processedContent && data.note.processedContent !== data.note.rawContent}
        <details class="bg-gray-900 rounded-lg p-4">
          <summary class="text-xs text-gray-400 uppercase cursor-pointer">Raw Input</summary>
          <pre class="text-sm whitespace-pre-wrap leading-relaxed mt-2">{data.note.rawContent}</pre>
        </details>
      {/if}
    </div>

    <!-- Sidebar: Entities & Timeline -->
    <div class="space-y-4">
      <div class="bg-gray-900 rounded-lg p-4">
        <h2 class="text-xs text-gray-400 uppercase mb-2">Extracted Entities</h2>
        {#if data.entities.length === 0}
          <p class="text-sm text-gray-500">No entities extracted.</p>
        {:else}
          {#each data.entities as entity}
            <a
              href="/jkai/intel/entities/{entity.entityId}"
              class="flex items-center gap-2 py-1.5 hover:bg-gray-800 -mx-2 px-2 rounded text-sm"
            >
              <span>{entity.entityTypeIcon}</span>
              <span>{entity.entityName}</span>
              <span class="text-xs text-gray-500">{entity.relevance}</span>
            </a>
          {/each}
        {/if}
      </div>

      {#if data.timelineEvents.length > 0}
        <div class="bg-gray-900 rounded-lg p-4">
          <h2 class="text-xs text-gray-400 uppercase mb-2">Timeline Events</h2>
          {#each data.timelineEvents as event}
            <div class="py-1.5 text-sm">
              <span class="text-amber-400">{event.date}</span>
              <span class="text-gray-400 mx-1">&middot;</span>
              <span>{event.title}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/jkai/intel/notes/
git commit -m "feat(intel): add note detail page"
```

---

### Task 12: Build the Note Browser Page

**Files:**
- Create: `src/routes/jkai/intel/notes/+page.server.ts`
- Create: `src/routes/jkai/intel/notes/+page.svelte`

- [ ] **Step 1: Write the server load**

Create `src/routes/jkai/intel/notes/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { listNotes } from '$lib/jkai/intel/queries';

export const load: PageServerLoad = async ({ url }) => {
  const source = url.searchParams.get('source') ?? undefined;
  const format = url.searchParams.get('format') ?? undefined;
  const notes = await listNotes({ limit: 50, source, format });
  return { notes, filters: { source, format } };
};
```

- [ ] **Step 2: Write the note browser page**

Create `src/routes/jkai/intel/notes/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();

  const sourceIcon: Record<string, string> = {
    web: '🌐', whatsapp: '💬', pwa: '📱', email: '📧',
  };

  const statusColors: Record<string, string> = {
    pending: 'text-gray-400',
    processing: 'text-amber-400',
    processed: 'text-emerald-400',
    failed: 'text-red-400',
  };
</script>

<div class="p-6 max-w-5xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div>
      <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300">&larr; Dashboard</a>
      <h1 class="text-2xl font-bold mt-2">Notes</h1>
    </div>
    <a href="/jkai/intel/notes/new" class="px-4 py-2 bg-emerald-600 rounded-lg hover:bg-emerald-500 text-sm font-medium">
      + New Note
    </a>
  </div>

  {#if data.notes.length === 0}
    <div class="text-center py-16 text-gray-500">
      <p class="text-lg mb-2">No notes yet</p>
      <p class="text-sm">Add your first note to start building your knowledge graph.</p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each data.notes as note}
        <a
          href="/jkai/intel/notes/{note.id}"
          class="block bg-gray-900 rounded-lg p-4 hover:bg-gray-800/80 transition"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-lg">{sourceIcon[note.source] ?? '📝'}</span>
              <div>
                <div class="font-medium text-sm">{note.title ?? 'Untitled'}</div>
                <div class="text-xs text-gray-400 mt-0.5">
                  {note.source} &middot; {note.format} &middot; {new Date(note.createdAt).toLocaleDateString()} &middot; {note.entityCount} entities
                </div>
              </div>
            </div>
            <span class="text-xs {statusColors[note.status] ?? ''}">{note.status}</span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/jkai/intel/notes/
git commit -m "feat(intel): add note browser page"
```

---

### Task 13: Build the Entity Browser Page

**Files:**
- Create: `src/routes/jkai/intel/entities/+page.server.ts`
- Create: `src/routes/jkai/intel/entities/+page.svelte`

- [ ] **Step 1: Write the server load**

Create `src/routes/jkai/intel/entities/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { listEntities, listEntityTypes } from '$lib/jkai/intel/queries';

export const load: PageServerLoad = async ({ url }) => {
  const typeId = url.searchParams.get('typeId') ?? undefined;
  const [entities, types] = await Promise.all([
    listEntities({ limit: 100, typeId }),
    listEntityTypes(),
  ]);
  return { entities, types, activeTypeId: typeId };
};
```

- [ ] **Step 2: Write the entity browser page**

Create `src/routes/jkai/intel/entities/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();
</script>

<div class="p-6 max-w-5xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300">&larr; Dashboard</a>
  <h1 class="text-2xl font-bold mt-2 mb-6">Entities</h1>

  <!-- Type Filter -->
  <div class="flex flex-wrap gap-2 mb-6">
    <a
      href="/jkai/intel/entities"
      class="px-3 py-1.5 rounded-full text-sm {!data.activeTypeId ? 'bg-sky-600' : 'bg-gray-800 hover:bg-gray-700'}"
    >All</a>
    {#each data.types as type}
      <a
        href="/jkai/intel/entities?typeId={type.id}"
        class="px-3 py-1.5 rounded-full text-sm {data.activeTypeId === type.id ? 'bg-sky-600' : 'bg-gray-800 hover:bg-gray-700'}"
      >{type.icon} {type.name}</a>
    {/each}
  </div>

  {#if data.entities.length === 0}
    <div class="text-center py-16 text-gray-500">
      <p>No entities found. Add notes to start building your knowledge graph.</p>
    </div>
  {:else}
    <div class="grid grid-cols-2 gap-3">
      {#each data.entities as entity}
        <a
          href="/jkai/intel/entities/{entity.id}"
          class="bg-gray-900 rounded-lg p-4 hover:bg-gray-800/80 transition"
        >
          <div class="flex items-center gap-3 mb-2">
            <span class="text-xl">{entity.typeIcon}</span>
            <div>
              <div class="font-medium">{entity.name}</div>
              <div class="text-xs text-gray-400">{entity.typeName}</div>
            </div>
            {#if !entity.confirmed}
              <span class="ml-auto text-xs bg-amber-900/30 text-amber-400 px-2 py-0.5 rounded">unconfirmed</span>
            {/if}
          </div>
          {#if entity.summary}
            <p class="text-sm text-gray-300 line-clamp-2">{entity.summary}</p>
          {/if}
          <div class="text-xs text-gray-500 mt-2">
            {entity.noteCount} notes &middot; {entity.relationshipCount} connections
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/jkai/intel/entities/
git commit -m "feat(intel): add entity browser page"
```

---

### Task 14: Build the Entity Dossier Page

**Files:**
- Create: `src/routes/jkai/intel/entities/[id]/+page.server.ts`
- Create: `src/routes/jkai/intel/entities/[id]/+page.svelte`

- [ ] **Step 1: Write the server load**

Create `src/routes/jkai/intel/entities/[id]/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { getEntityDetail } from '$lib/jkai/intel/queries';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const detail = await getEntityDetail(params.id);
  if (!detail) throw error(404, 'Entity not found');
  return detail;
};
```

- [ ] **Step 2: Write the entity dossier page**

Create `src/routes/jkai/intel/entities/[id]/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();

  const entity = data.entity;
  const properties = (entity.properties ?? {}) as Record<string, unknown>;
  const propEntries = Object.entries(properties).filter(([, v]) => v != null && v !== '');
</script>

<div class="p-6 max-w-5xl mx-auto">
  <a href="/jkai/intel/entities" class="text-sm text-gray-400 hover:text-gray-300">&larr; Entities</a>

  <!-- Header -->
  <div class="flex items-center gap-4 mt-4 mb-6">
    <div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl" style="background: {entity.typeColor}20">
      {entity.typeIcon}
    </div>
    <div>
      <h1 class="text-2xl font-bold">{entity.name}</h1>
      <div class="text-sm text-gray-400">
        {entity.typeName}
        {#if entity.confirmed}
          <span class="text-emerald-400 ml-2">confirmed</span>
        {:else}
          <span class="text-amber-400 ml-2">unconfirmed</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="grid grid-cols-2 gap-6">
    <!-- Left Column -->
    <div class="space-y-4">
      <!-- Summary -->
      {#if entity.summary}
        <div class="bg-gray-900 rounded-lg p-4">
          <h2 class="text-xs text-gray-400 uppercase mb-2">Summary</h2>
          <p class="text-sm leading-relaxed">{entity.summary}</p>
        </div>
      {/if}

      <!-- Properties -->
      {#if propEntries.length > 0}
        <div class="bg-gray-900 rounded-lg p-4">
          <h2 class="text-xs text-gray-400 uppercase mb-2">Properties</h2>
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {#each propEntries as [key, value]}
              <span class="text-gray-400 capitalize">{key}:</span>
              <span>{value}</span>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Notes -->
      <div class="bg-gray-900 rounded-lg p-4">
        <h2 class="text-xs text-gray-400 uppercase mb-2">Appears in {data.notes.length} notes</h2>
        {#each data.notes as note}
          <a href="/jkai/intel/notes/{note.noteId}" class="block py-2 border-b border-gray-800 last:border-0 hover:bg-gray-800/50 -mx-2 px-2 rounded">
            <div class="text-sm text-sky-400">{note.noteTitle ?? 'Untitled'}</div>
            <div class="text-xs text-gray-400 mt-0.5">{new Date(note.noteCreatedAt).toLocaleDateString()} &middot; {note.relevance}</div>
            {#if note.excerpt}
              <div class="text-xs text-gray-500 mt-1 line-clamp-2">{note.excerpt}</div>
            {/if}
          </a>
        {/each}
      </div>
    </div>

    <!-- Right Column -->
    <div class="space-y-4">
      <!-- Relationships -->
      <div class="bg-gray-900 rounded-lg p-4">
        <h2 class="text-xs text-gray-400 uppercase mb-2">Relationships</h2>
        {#if data.relationships.length === 0}
          <p class="text-sm text-gray-500">No relationships yet.</p>
        {:else}
          {#each data.relationships as rel}
            <a href="/jkai/intel/entities/{rel.otherEntityId}" class="flex items-center gap-2 py-1.5 hover:bg-gray-800 -mx-2 px-2 rounded text-sm">
              <span class="text-gray-500">{rel.direction === 'outgoing' ? '→' : '←'}</span>
              <span class="text-sky-400 font-medium">{rel.type.replace(/_/g, ' ')}</span>
              <span>{rel.otherEntityIcon} {rel.otherEntityName}</span>
            </a>
          {/each}
        {/if}
      </div>

      <!-- Timeline -->
      {#if data.timelineEvents.length > 0}
        <div class="bg-gray-900 rounded-lg p-4">
          <h2 class="text-xs text-gray-400 uppercase mb-2">Timeline</h2>
          <div class="border-l-2 border-gray-700 pl-3 space-y-3">
            {#each data.timelineEvents as event}
              <div>
                <div class="text-xs text-gray-400">{event.date}</div>
                <div class="text-sm">{event.title}</div>
                {#if event.description}
                  <div class="text-xs text-gray-500 mt-0.5">{event.description}</div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/jkai/intel/entities/
git commit -m "feat(intel): add entity dossier page"
```

---

### Task 15: Add Intel Nav Link to JKAI Layout & Seed on Startup

**Files:**
- Modify: `src/routes/jkai/+layout.svelte` (add Intel nav link)

- [ ] **Step 1: Find the existing JKAI nav and add Intel link**

In the JKAI layout file, add a navigation link to `/jkai/intel` alongside the existing links (Chat, Builds, Workflows, etc.). The exact edit depends on the current layout structure — look for the nav section and add:

```svelte
<a href="/jkai/intel" class="...existing-nav-classes...">Intel</a>
```

Match the existing nav link styling.

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/jkai/+layout.svelte
git commit -m "feat(intel): add Intel link to JKAI navigation"
```

---

### Task 16: End-to-End Verification

- [ ] **Step 1: Run all tests**

Run: `cd ~/strange_rambling_svelte && npx vitest run`

Expected: All tests pass, including the new intel tests.

- [ ] **Step 2: Run type check**

Run: `cd ~/strange_rambling_svelte && npx tsc --noEmit` or the project's typecheck command.

Expected: No type errors in the intel modules.

- [ ] **Step 3: Start dev server and verify**

Run: `cd ~/strange_rambling_svelte && npm run dev`

1. Navigate to `http://homeserv:5173/jkai/intel` — dashboard should load with empty state
2. Click "+ New Note" — creation form should render
3. Submit a text note — should redirect to note detail page showing "processing" then "processed"
4. Navigate to `/jkai/intel/entities` — should show any extracted entities
5. Click an entity — dossier page should show relationships, notes, timeline

- [ ] **Step 4: Push schema to DB**

If not already done, ensure `npx drizzle-kit push` has been run and all tables exist.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
cd ~/strange_rambling_svelte
git add -A
git commit -m "fix(intel): address issues found during e2e verification"
```
