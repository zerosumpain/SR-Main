# JKAI Intel Phase 4 — Chat Enhancement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the existing JKAI chat with knowledge graph awareness — when a user asks a question, embed it, find relevant entities/notes via vector search, and inject that context into the LLM system prompt so it can answer with awareness of the knowledge graph.

**Architecture:** Create a `context.ts` module that builds knowledge graph context from a query. Hook it into `general-chat.ts` where the system prompt is assembled (after the memory section). Also allow chat to act as an ingestion source for quick knowledge capture.

**Tech Stack:** SvelteKit, Drizzle ORM, PostgreSQL + pgvector, OpenAI SDK

---

### Task 1: Knowledge Graph Context Builder

**Files:**
- Create: `src/lib/jkai/intel/context.ts`

This module takes a user message (or recent conversation history), embeds it, searches the knowledge graph, and returns formatted context to inject into the system prompt.

- [ ] **Step 1: Create the context module**

Create `src/lib/jkai/intel/context.ts`:

```typescript
import { db } from '$lib/db';
import { intelEntities, intelEntityTypes, intelNotes, intelRelationships, intelNoteEntities } from '$lib/db/schema';
import { eq, sql, desc, isNull } from 'drizzle-orm';
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

/**
 * Build knowledge graph context relevant to a user message.
 * Returns formatted markdown to inject into the system prompt.
 */
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
    // If embedding fails, fall back to empty context
    return { entities: [], noteExcerpts: [] };
  }

  const vectorStr = `[${embedding.join(',')}]`;

  // Find relevant entities via vector similarity
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

  // Find relevant note excerpts via vector similarity
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

  // Load relationships for relevant entities
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

    // Resolve relationship names
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/jkai/intel/context.ts
git commit -m "feat(intel): add knowledge graph context builder for chat"
```

---

### Task 2: Inject Context into Chat System Prompt

**Files:**
- Modify: `src/lib/workflows/chat/general-chat.ts`

- [ ] **Step 1: Add knowledge graph context to system prompt assembly**

Read `src/lib/workflows/chat/general-chat.ts`. Find the system prompt assembly section (around line 249-253):

```typescript
const basePrompt = await getCompiledPrompt();
const siteSection = buildSiteSystemPromptSection();
const memorySection = await buildMemorySection();
const systemContent = `${basePrompt}${siteSection}${memorySection}`;
```

Add the knowledge graph context after the memory section:

1. Add import at top:
```typescript
import { buildKnowledgeContext } from '$lib/jkai/intel/context';
```

2. Modify the system prompt assembly to include knowledge graph context. The user message is available as `userMessage` (or similar variable — check the actual variable name). Add:

```typescript
const graphSection = await buildKnowledgeContext(userMessage);
const systemContent = `${basePrompt}${siteSection}${memorySection}${graphSection}`;
```

The `buildKnowledgeContext` returns an empty string if no relevant context is found, so this is safe to always call.

- [ ] **Step 2: Commit**

```bash
git add src/lib/workflows/chat/general-chat.ts
git commit -m "feat(intel): inject knowledge graph context into chat system prompt"
```

---

### Task 3: Chat-as-Ingestion

**Files:**
- Modify: `src/lib/workflows/chat/general-chat.ts`

Allow the chat to capture knowledge when the user explicitly says something like "remember that..." or "note that...". After the LLM response is generated, check if the user's message looks like a knowledge capture request, and if so, ingest it as a note.

- [ ] **Step 1: Add knowledge capture detection**

Add a function and hook it after the LLM response:

```typescript
import { createNote, processNote } from '$lib/jkai/intel/ingest';

/**
 * Check if a user message is a knowledge capture request.
 * If so, ingest it as a note in the background.
 */
async function maybeIngestAsNote(userMessage: string): Promise<void> {
  const capturePatterns = [
    /^(?:remember|note|record|save|store)\s+(?:that|this|the following)/i,
    /^(?:fyi|for the record|for reference)/i,
    /^intel:/i,
  ];

  const isCapture = capturePatterns.some((p) => p.test(userMessage.trim()));
  if (!isCapture) return;

  try {
    const noteId = await createNote({
      rawContent: userMessage,
      source: 'web',
      format: 'text',
      metadata: { capturedFrom: 'chat' },
    });

    processNote(noteId).catch((err) => {
      console.error(`[intel] Chat capture processing failed:`, err);
    });

    console.log(`[intel] Captured chat message as note ${noteId}`);
  } catch (err) {
    console.error('[intel] Chat capture failed:', err);
  }
}
```

Call `maybeIngestAsNote(userMessage)` early in the chat handler (fire-and-forget, don't block the response).

- [ ] **Step 2: Commit**

```bash
git add src/lib/workflows/chat/general-chat.ts
git commit -m "feat(intel): add chat-as-ingestion for knowledge capture"
```
