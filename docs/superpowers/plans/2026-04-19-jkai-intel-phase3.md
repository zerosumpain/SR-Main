# JKAI Intel Phase 3 — Semantic Recall & Alerts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a note arrives, embed it, find semantically similar existing notes/entities, have the LLM evaluate connections for significance, generate alerts, and push high-significance alerts to WhatsApp via OpenClaw.

**Architecture:** Adds an embedding module (`embed.ts`), a recall module (`recall.ts`), and a notification module (`notify.ts`). The ingestion pipeline (`ingest.ts`) is extended to call recall after extraction. pgvector's cosine distance operator (`<=>`) powers the vector search.

**Tech Stack:** SvelteKit, Drizzle ORM, PostgreSQL + pgvector, OpenAI SDK (embeddings + chat), OpenClaw WhatsApp

---

### Task 1: Embedding Module

**Files:**
- Create: `src/lib/jkai/intel/embed.ts`
- Test: `tests/lib/jkai/intel/embed.test.ts`

- [ ] **Step 1: Create the embedding module**

Create `src/lib/jkai/intel/embed.ts`:

```typescript
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { db } from '$lib/db';
import { intelNotes, intelEntities } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Generate a vector embedding for text using the OpenAI embeddings API.
 * Uses text-embedding-3-small (1536 dimensions) via the configured provider.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const modelCtx = await resolveDefaultModel('chat');
  const { client } = await getLLMClient(modelCtx);

  // Truncate to ~8000 tokens worth of text (~32000 chars) to stay within limits
  const truncated = text.slice(0, 32000);

  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: truncated,
  });

  return response.data[0].embedding;
}

/**
 * Embed a note and store the vector in the database.
 */
export async function embedNote(noteId: string): Promise<void> {
  const [note] = await db
    .select({ id: intelNotes.id, processedContent: intelNotes.processedContent, rawContent: intelNotes.rawContent })
    .from(intelNotes)
    .where(eq(intelNotes.id, noteId))
    .limit(1);

  if (!note) return;

  const text = note.processedContent || note.rawContent;
  if (!text) return;

  const embedding = await generateEmbedding(text);

  await db
    .update(intelNotes)
    .set({ embedding })
    .where(eq(intelNotes.id, noteId));
}

/**
 * Embed an entity (based on its name, type, summary, and properties) and store.
 */
export async function embedEntity(entityId: string): Promise<void> {
  const [entity] = await db
    .select()
    .from(intelEntities)
    .where(eq(intelEntities.id, entityId))
    .limit(1);

  if (!entity) return;

  const parts = [
    entity.name,
    entity.summary ?? '',
    entity.properties ? JSON.stringify(entity.properties) : '',
  ].filter(Boolean);

  const text = parts.join(' — ');
  if (!text) return;

  const embedding = await generateEmbedding(text);

  await db
    .update(intelEntities)
    .set({ embedding })
    .where(eq(intelEntities.id, entityId));
}
```

- [ ] **Step 2: Write test**

Create `tests/lib/jkai/intel/embed.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/jkai/llm-client', () => ({
  getLLMClient: vi.fn().mockResolvedValue({
    client: {
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: new Array(1536).fill(0.1) }],
        }),
      },
    },
    model: 'test',
  }),
}));
vi.mock('$lib/server/models/settings', () => ({
  resolveDefaultModel: vi.fn().mockResolvedValue({ provider: 'zai', modelId: 'test' }),
}));
vi.mock('$lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: '1', processedContent: 'test content', rawContent: 'test' }]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({
  intelNotes: { id: 'id', processedContent: 'processed_content', rawContent: 'raw_content', embedding: 'embedding' },
  intelEntities: { id: 'id', embedding: 'embedding' },
}));

import { generateEmbedding } from '$lib/jkai/intel/embed';

describe('generateEmbedding', () => {
  it('returns a 1536-dimension vector', async () => {
    const result = await generateEmbedding('test text');
    expect(result).toHaveLength(1536);
    expect(result[0]).toBe(0.1);
  });
});
```

- [ ] **Step 3: Run test**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/jkai/intel/embed.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/lib/jkai/intel/embed.ts tests/lib/jkai/intel/embed.test.ts
git commit -m "feat(intel): add embedding module for notes and entities"
```

---

### Task 2: Semantic Recall Module

**Files:**
- Create: `src/lib/jkai/intel/recall.ts`

This module runs after a note is ingested and embedded. It finds semantically similar existing notes/entities, then uses the LLM to evaluate whether connections are genuine and significant.

- [ ] **Step 1: Create the recall module**

Create `src/lib/jkai/intel/recall.ts`:

```typescript
import { db } from '$lib/db';
import { intelNotes, intelEntities, intelEntityTypes, intelAlerts } from '$lib/db/schema';
import { eq, sql, ne, and, isNull } from 'drizzle-orm';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';

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

/**
 * Find notes semantically similar to the given note using pgvector cosine distance.
 */
async function findSimilarNotes(noteId: string, limit = 10): Promise<SimilarNote[]> {
  const rows = await db.execute(sql`
    SELECT n.id, n.title,
           substring(n.processed_content from 1 for 300) as snippet,
           n.embedding <=> (SELECT embedding FROM intel_notes WHERE id = ${noteId}) as distance
    FROM intel_notes n
    WHERE n.id != ${noteId}
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

/**
 * Find entities semantically similar to the given note.
 */
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

/**
 * Use LLM to evaluate whether semantic matches represent genuine, significant connections.
 */
async function evaluateConnections(
  noteContent: string,
  similarNotes: SimilarNote[],
  similarEntities: SimilarEntity[],
): Promise<EvaluatedConnection[]> {
  if (similarNotes.length === 0 && similarEntities.length === 0) return [];

  const modelCtx = await resolveDefaultModel('chat');
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

    // Resolve entity names to IDs
    return parsed.map((c) => ({
      type: (c.type as EvaluatedConnection['type']) || 'connection',
      title: c.title,
      content: c.content,
      significance: (c.significance as EvaluatedConnection['significance']) || 'medium',
      relatedEntityIds: [], // Will be resolved below
    }));
  } catch {
    console.error('[intel] Failed to parse connection evaluation:', cleaned.slice(0, 200));
    return [];
  }
}

/**
 * Run semantic recall for a newly processed note:
 * 1. Find similar notes and entities via vector search
 * 2. Have LLM evaluate connections
 * 3. Create alerts for genuine connections
 * Returns the number of alerts created.
 */
export async function recallAndAlert(noteId: string): Promise<number> {
  try {
    // Get the note content
    const [note] = await db
      .select({ processedContent: intelNotes.processedContent, rawContent: intelNotes.rawContent })
      .from(intelNotes)
      .where(eq(intelNotes.id, noteId))
      .limit(1);

    if (!note) return 0;
    const content = note.processedContent || note.rawContent;
    if (!content) return 0;

    // Find semantic matches
    const [similarNotes, similarEntities] = await Promise.all([
      findSimilarNotes(noteId),
      findSimilarEntities(noteId),
    ]);

    if (similarNotes.length === 0 && similarEntities.length === 0) return 0;

    // Evaluate connections
    const connections = await evaluateConnections(content, similarNotes, similarEntities);

    // Create alerts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/jkai/intel/recall.ts
git commit -m "feat(intel): add semantic recall module with vector search and alert generation"
```

---

### Task 3: WhatsApp Notification Module

**Files:**
- Create: `src/lib/jkai/intel/notify.ts`

Sends high-significance alerts to WhatsApp via OpenClaw.

- [ ] **Step 1: Create the notification module**

Create `src/lib/jkai/intel/notify.ts`:

```typescript
import { db } from '$lib/db';
import { intelAlerts } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

const OPENCLAW_BASE = 'http://localhost:18789';
const WHATSAPP_NUMBER = '+447359228511';
const SITE_URL = 'https://strangeramblings.com';

/**
 * Send high-significance alerts to WhatsApp via OpenClaw.
 * Called after recall generates alerts.
 */
export async function pushHighAlerts(noteId: string): Promise<number> {
  // Find undelivered high-significance alerts for this note
  const alerts = await db
    .select()
    .from(intelAlerts)
    .where(
      and(
        eq(intelAlerts.noteId, noteId),
        eq(intelAlerts.significance, 'high'),
        eq(intelAlerts.delivered, false),
      ),
    );

  if (alerts.length === 0) return 0;

  let delivered = 0;

  for (const alert of alerts) {
    const typeEmoji: Record<string, string> = {
      risk_change: '🔴',
      contradiction: '⚠️',
      connection: '🔗',
      pattern: '🔄',
    };

    const emoji = typeEmoji[alert.type] ?? '🔔';
    const message = `${emoji} Intel Alert: ${alert.title}\n\n${alert.content}\n\nView: ${SITE_URL}/jkai/intel/alerts`;

    try {
      const res = await fetch(`${OPENCLAW_BASE}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: WHATSAPP_NUMBER,
          message,
        }),
      });

      if (res.ok) {
        await db
          .update(intelAlerts)
          .set({ delivered: true })
          .where(eq(intelAlerts.id, alert.id));
        delivered++;
      } else {
        console.error(`[intel] WhatsApp send failed for alert ${alert.id}: ${res.status}`);
      }
    } catch (err) {
      console.error(`[intel] WhatsApp send error for alert ${alert.id}:`, err);
    }
  }

  return delivered;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/jkai/intel/notify.ts
git commit -m "feat(intel): add WhatsApp notification module for high-significance alerts"
```

---

### Task 4: Wire Recall into Ingestion Pipeline

**Files:**
- Modify: `src/lib/jkai/intel/ingest.ts`

Add embedding, recall, and notification steps to `processNote`.

- [ ] **Step 1: Modify ingest.ts**

Read `src/lib/jkai/intel/ingest.ts` and add imports at the top:

```typescript
import { embedNote } from './embed';
import { recallAndAlert } from './recall';
import { pushHighAlerts } from './notify';
```

Then in the `processNote` function, after the line that updates the note status to 'processed' (after `persistExtraction` and the `db.update` call), add:

```typescript
    // 4. Embed the note for semantic search
    await embedNote(noteId);

    // 5. Find connections to existing knowledge and generate alerts
    const alertCount = await recallAndAlert(noteId);

    // 6. Push high-significance alerts to WhatsApp
    if (alertCount > 0) {
      await pushHighAlerts(noteId);
    }
```

The numbered comments should replace the existing comment numbering — the full flow becomes:
1. Load the note
2. Preprocess based on format
3. Extract entities, relationships, timeline events
4. Persist to graph
5. Update note status
6. Embed the note
7. Find connections and generate alerts
8. Push high alerts to WhatsApp

- [ ] **Step 2: Commit**

```bash
git add src/lib/jkai/intel/ingest.ts
git commit -m "feat(intel): wire embedding, recall, and notifications into ingestion pipeline"
```

---

### Task 5: Semantic Search API Endpoint

**Files:**
- Modify: `src/routes/api/jkai/intel/search/+server.ts`

Enhance the existing keyword search to also do vector similarity search when results are sparse.

- [ ] **Step 1: Add vector search fallback to search endpoint**

Read `src/routes/api/jkai/intel/search/+server.ts` and add a vector search section. After the existing ILIKE queries, if combined results are fewer than 5, run a vector search:

Add this import at the top:
```typescript
import { generateEmbedding } from '$lib/jkai/intel/embed';
```

After the existing `const [notes, entities] = await Promise.all([...])`, add:

```typescript
  // If keyword search returns few results, supplement with vector search
  if (notes.length + entities.length < 5) {
    try {
      const embedding = await generateEmbedding(q);
      const vectorStr = `[${embedding.join(',')}]`;

      const vectorNotes = await db.execute(sql`
        SELECT id, title, source, format, status, created_at as "createdAt",
               substring(processed_content from 1 for 200) as snippet,
               embedding <=> ${vectorStr}::vector as distance
        FROM intel_notes
        WHERE embedding IS NOT NULL
        ORDER BY distance ASC
        LIMIT 10
      `);

      const vectorEntities = await db.execute(sql`
        SELECT e.id, e.name, et.name as "typeName", et.icon as "typeIcon",
               e.summary, e.confidence, e.confirmed,
               e.embedding <=> ${vectorStr}::vector as distance
        FROM intel_entities e
        JOIN intel_entity_types et ON e.type_id = et.id
        WHERE e.embedding IS NOT NULL AND e.merged_into_id IS NULL
        ORDER BY distance ASC
        LIMIT 10
      `);

      // Merge results, dedup by ID
      const noteIds = new Set(notes.map((n) => n.id));
      for (const row of vectorNotes.rows as any[]) {
        if (!noteIds.has(row.id) && Number(row.distance) < 0.5) {
          notes.push({ ...row, createdAt: row.createdAt });
        }
      }

      const entityIds = new Set(entities.map((e) => e.id));
      for (const row of vectorEntities.rows as any[]) {
        if (!entityIds.has(row.id) && Number(row.distance) < 0.5) {
          entities.push(row as any);
        }
      }
    } catch (err) {
      console.error('[intel] Vector search fallback failed:', err);
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/api/jkai/intel/search/+server.ts
git commit -m "feat(intel): add vector search fallback to search endpoint"
```

---

### Task 6: Embed Entities During Summary Generation

**Files:**
- Modify: `src/lib/jkai/intel/graph.ts`

After an entity summary is generated/updated, also update its embedding.

- [ ] **Step 1: Add embedding call to updateEntitySummaries in graph.ts**

Read `src/lib/jkai/intel/graph.ts`. In the `updateEntitySummaries` function, after the line that updates the entity summary:

```typescript
        await db
          .update(intelEntities)
          .set({ summary, updatedAt: new Date() })
          .where(eq(intelEntities.id, entityId));
```

Add:

```typescript
        // Also update the entity's embedding with the new summary
        const { embedEntity } = await import('./embed');
        await embedEntity(entityId);
```

Using dynamic import to avoid circular dependency issues.

- [ ] **Step 2: Commit**

```bash
git add src/lib/jkai/intel/graph.ts
git commit -m "feat(intel): embed entities after summary generation"
```
