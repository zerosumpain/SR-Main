# JKAI Memory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give JKAI persistent memory of facts about the user, with active tools for saving/recalling and a background job that extracts memories from finished conversations.

**Architecture:** A `jkai_memories` DB table stores categorised facts with versioning via `superseded_by`. Memory tools (`save_memory`, `recall_memories`, `forget_memory`) let JKAI manage memories during conversations. Active memories are injected into the system prompt at each turn. A background `setInterval` job scans stale conversations and uses an LLM call to extract new memories.

**Tech Stack:** Drizzle ORM (PostgreSQL), existing site-tools registry, OpenAI-compatible LLM for extraction

**Spec:** `docs/superpowers/specs/2026-04-15-jkai-memory-design.md`

---

### Task 1: Add `jkai_memories` table and `last_memory_review` column

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Add the `jkai_memories` table**

Add after the `customTools` table (end of file, around line 783):

```typescript
// ==========================================
// JKAI Memories
// ==========================================

export const jkaiMemories = pgTable('jkai_memories', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  category: text('category').notNull(), // people, preferences, places, health, devices, situations
  content: text('content').notNull(),
  sourceConversationId: text('source_conversation_id'),
  confidence: text('confidence').notNull().default('high'), // high, medium
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  supersededBy: text('superseded_by'),
});

export type JkaiMemory = typeof jkaiMemories.$inferSelect;
```

- [ ] **Step 2: Add `lastMemoryReview` column to `conversations`**

In the existing `conversations` table definition (around line 658), add after the `updatedAt` column:

```typescript
  lastMemoryReview: timestamp('last_memory_review', { withTimezone: true }),
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat: add jkai_memories table and last_memory_review column"
```

---

### Task 2: Create memory tools

**Files:**
- Create: `src/lib/workflows/site-tools/tools/memory.ts`

- [ ] **Step 1: Create the memory toolset**

```typescript
// src/lib/workflows/site-tools/tools/memory.ts

import { register } from '../registry-internal';
import { db } from '$lib/db';
import { jkaiMemories } from '$lib/db/schema';
import { eq, and, isNull, ilike, desc } from 'drizzle-orm';

const CATEGORIES = ['people', 'preferences', 'places', 'health', 'devices', 'situations'] as const;

register({
  name: 'save_memory',
  description: 'Save a fact about the user to persistent memory. Use proactively when you learn something important (names, preferences, locations, health details). If this updates an existing memory, the old one is automatically superseded.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: CATEGORIES,
        description: 'Memory category',
      },
      content: {
        type: 'string',
        description: 'The fact to remember, in natural language (e.g. "John\'s mum lives in Whitley Bay")',
      },
    },
    required: ['category', 'content'],
  },
  category: 'Memory',
  toolset: 'memory',
  handler: async (args) => {
    const category = args.category as string;
    const content = args.content as string;

    // Check for existing memories in the same category that this might update
    const existing = await db.select()
      .from(jkaiMemories)
      .where(and(
        eq(jkaiMemories.category, category),
        isNull(jkaiMemories.supersededBy),
      ));

    // Simple keyword overlap check for deduplication
    const contentWords = content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const match = existing.find(m => {
      const memWords = m.content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const overlap = contentWords.filter(w => memWords.includes(w));
      return overlap.length >= Math.min(3, contentWords.length * 0.5);
    });

    const newId = crypto.randomUUID();

    if (match) {
      // Supersede the old memory
      await db.update(jkaiMemories)
        .set({ supersededBy: newId, updatedAt: new Date() })
        .where(eq(jkaiMemories.id, match.id));
    }

    await db.insert(jkaiMemories).values({
      id: newId,
      category,
      content,
      confidence: 'high',
    });

    return {
      success: true,
      data: {
        id: newId,
        category,
        content,
        superseded: match ? { id: match.id, content: match.content } : null,
      },
    };
  },
});

register({
  name: 'recall_memories',
  description: 'Search your memories about the user. Use when a question might benefit from past context. Can filter by query text and/or category.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search text (case-insensitive substring match)',
      },
      category: {
        type: 'string',
        enum: CATEGORIES,
        description: 'Filter by category',
      },
    },
  },
  category: 'Memory',
  toolset: 'memory',
  handler: async (args) => {
    const query = args.query as string | undefined;
    const category = args.category as string | undefined;

    const conditions = [isNull(jkaiMemories.supersededBy)];
    if (category) conditions.push(eq(jkaiMemories.category, category));
    if (query) conditions.push(ilike(jkaiMemories.content, `%${query}%`));

    const rows = await db.select()
      .from(jkaiMemories)
      .where(and(...conditions))
      .orderBy(desc(jkaiMemories.updatedAt))
      .limit(50);

    return { success: true, data: { memories: rows, count: rows.length } };
  },
});

register({
  name: 'forget_memory',
  description: 'Remove a memory. Use when the user says to forget something or when a memory is wrong.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Memory ID to forget',
      },
    },
    required: ['id'],
  },
  category: 'Memory',
  toolset: 'memory',
  handler: async (args) => {
    const id = args.id as string;
    const [memory] = await db.select()
      .from(jkaiMemories)
      .where(eq(jkaiMemories.id, id))
      .limit(1);

    if (!memory) return { success: false, error: 'Memory not found' };

    await db.update(jkaiMemories)
      .set({ supersededBy: 'forgotten', updatedAt: new Date() })
      .where(eq(jkaiMemories.id, id));

    return { success: true, data: { forgotten: memory.content } };
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/workflows/site-tools/tools/memory.ts
git commit -m "feat: add memory toolset — save, recall, forget"
```

---

### Task 3: Register memory toolset

**Files:**
- Modify: `src/lib/workflows/site-tools/registry.ts`
- Modify: `src/lib/workflows/site-tools/meta-tools.ts`
- Modify: `src/lib/workflows/site-tools/keyword-classifier.ts`

- [ ] **Step 1: Import memory tools in registry.ts**

In `src/lib/workflows/site-tools/registry.ts`, add after the existing domain module imports (after line 16 `import './tools/diagnostics';`):

```typescript
import './tools/memory';
```

- [ ] **Step 2: Add `memory` to TOOLSET_NAMES in meta-tools.ts**

In `src/lib/workflows/site-tools/meta-tools.ts`, update the `TOOLSET_NAMES` array (line 9-12):

```typescript
const TOOLSET_NAMES = [
  'health', 'blog', 'builds', 'research',
  'workflows', 'home', 'whatsapp', 'diagnostics', 'memory',
] as const;
```

- [ ] **Step 3: Add memory description to toolsetDescriptions in registry.ts**

In the `getToolsetManifest()` function in `src/lib/workflows/site-tools/registry.ts`, add to the `toolsetDescriptions` object (around line 54-63):

```typescript
    memory: 'Persistent memory — save, recall, and forget facts about the user',
```

- [ ] **Step 4: Add memory keyword pattern**

In `src/lib/workflows/site-tools/keyword-classifier.ts`, add to the `TOOLSET_PATTERNS` array:

```typescript
  { toolset: 'memory', pattern: /remember|forget|do you know|what do you know|recall|you told me|i told you|last time/i },
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/site-tools/registry.ts src/lib/workflows/site-tools/meta-tools.ts src/lib/workflows/site-tools/keyword-classifier.ts
git commit -m "feat: register memory toolset with keyword classification"
```

---

### Task 4: Inject memories into system prompt

**Files:**
- Modify: `src/lib/workflows/chat/general-chat.ts`

- [ ] **Step 1: Add memory loading function**

Add imports at the top of `general-chat.ts`:

```typescript
import { jkaiMemories } from '$lib/db/schema';
import { isNull, desc } from 'drizzle-orm';
```

Note: `db` and `eq` are already imported.

Add this function before the `generalChat` export:

```typescript
const MEMORY_BUDGET = 4000; // max chars for memory section

async function buildMemorySection(): Promise<string> {
  let rows;
  try {
    rows = await db.select()
      .from(jkaiMemories)
      .where(isNull(jkaiMemories.supersededBy))
      .orderBy(desc(jkaiMemories.updatedAt));
  } catch {
    return '';
  }

  if (rows.length === 0) return '';

  // Group by category
  const grouped: Record<string, string[]> = {};
  let totalChars = 0;

  for (const row of rows) {
    if (totalChars + row.content.length > MEMORY_BUDGET) break;
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push(row.content);
    totalChars += row.content.length;
  }

  const sections = Object.entries(grouped).map(([cat, items]) => {
    const label = cat.charAt(0).toUpperCase() + cat.slice(1);
    return `**${label}:**\n${items.map(i => `- ${i}`).join('\n')}`;
  });

  return `\n\n--- Memory ---\n${sections.join('\n\n')}`;
}
```

- [ ] **Step 2: Inject memory section into system prompt**

In the `generalChat` function, after the line that builds `systemContent` (around line 46):

```typescript
  const systemContent = `${basePrompt}${siteSection}`;
```

Replace with:

```typescript
  const memorySection = await buildMemorySection();
  const systemContent = `${basePrompt}${siteSection}${memorySection}`;
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/chat/general-chat.ts
git commit -m "feat: inject active memories into JKAI system prompt"
```

---

### Task 5: Background memory review job

**Files:**
- Create: `src/lib/workflows/chat/memory-review.ts`
- Modify: `src/lib/workflows/index.ts`

- [ ] **Step 1: Create the memory review module**

```typescript
// src/lib/workflows/chat/memory-review.ts

import { db } from '$lib/db';
import { conversations, orchestratorChats, jkaiMemories } from '$lib/db/schema';
import { eq, and, isNull, lt, desc, gt, or } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';

const REVIEW_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // conversation idle for 30 min

const EXTRACTION_PROMPT = `Review this conversation and extract facts worth remembering about the user.

Categories: people, preferences, places, health, devices, situations

Rules:
- Only extract facts useful in future conversations
- Do not extract ephemeral task details ("user asked to turn on lights")
- Do not extract sensitive data (passwords, financial details)
- Assign confidence: "high" if explicitly stated, "medium" if inferred
- If a fact updates something already in memory, set "updates" to the old memory content it replaces

Existing memories (avoid duplicates):
{EXISTING_MEMORIES}

Return a JSON array (no markdown, no code fences):
[{ "category": "...", "content": "...", "confidence": "high|medium", "updates": "content of memory it replaces, or null" }]

Return an empty array [] if nothing is worth remembering.`;

async function reviewConversation(conversationId: string): Promise<number> {
  // Get the conversation
  const [conv] = await db.select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!conv) return 0;

  // Get messages since last review
  const conditions = [eq(orchestratorChats.conversationId, conversationId)];
  if (conv.lastMemoryReview) {
    conditions.push(gt(orchestratorChats.createdAt, conv.lastMemoryReview));
  }

  const messages = await db.select()
    .from(orchestratorChats)
    .where(and(...conditions))
    .orderBy(orchestratorChats.createdAt);

  if (messages.length === 0) {
    // No new messages — just update the marker
    await db.update(conversations)
      .set({ lastMemoryReview: new Date() })
      .where(eq(conversations.id, conversationId));
    return 0;
  }

  // Build conversation text for extraction
  const conversationText = messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n\n');

  // Load existing memories for dedup context
  const existingMemories = await db.select()
    .from(jkaiMemories)
    .where(isNull(jkaiMemories.supersededBy));

  const existingText = existingMemories.length > 0
    ? existingMemories.map(m => `[${m.category}] ${m.content}`).join('\n')
    : '(none)';

  const prompt = EXTRACTION_PROMPT.replace('{EXISTING_MEMORIES}', existingText);

  // Call LLM for extraction
  const client = getOpenAIClient();
  const model = getModel();

  let response;
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: conversationText },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    });
  } catch (err) {
    console.error(`[memory-review] LLM call failed for conversation ${conversationId}:`, err instanceof Error ? err.message : err);
    return 0;
  }

  const raw = response.choices[0]?.message?.content?.trim() || '[]';
  let extractions: Array<{ category: string; content: string; confidence: string; updates: string | null }>;
  try {
    extractions = JSON.parse(raw);
  } catch {
    console.warn(`[memory-review] Failed to parse LLM output for conversation ${conversationId}:`, raw.slice(0, 200));
    // Update marker even on parse failure to avoid retrying the same messages
    await db.update(conversations)
      .set({ lastMemoryReview: new Date() })
      .where(eq(conversations.id, conversationId));
    return 0;
  }

  if (!Array.isArray(extractions) || extractions.length === 0) {
    await db.update(conversations)
      .set({ lastMemoryReview: new Date() })
      .where(eq(conversations.id, conversationId));
    return 0;
  }

  let saved = 0;
  for (const ext of extractions) {
    if (!ext.category || !ext.content) continue;

    const newId = crypto.randomUUID();

    // If this updates an existing memory, supersede it
    if (ext.updates) {
      const match = existingMemories.find(m =>
        m.content.toLowerCase().includes(ext.updates!.toLowerCase().slice(0, 50))
        || ext.updates!.toLowerCase().includes(m.content.toLowerCase().slice(0, 50))
      );
      if (match) {
        await db.update(jkaiMemories)
          .set({ supersededBy: newId, updatedAt: new Date() })
          .where(eq(jkaiMemories.id, match.id));
      }
    }

    await db.insert(jkaiMemories).values({
      id: newId,
      category: ext.category,
      content: ext.content,
      sourceConversationId: conversationId,
      confidence: ext.confidence === 'medium' ? 'medium' : 'high',
    });
    saved++;
  }

  // Update the review marker
  await db.update(conversations)
    .set({ lastMemoryReview: new Date() })
    .where(eq(conversations.id, conversationId));

  if (saved > 0) {
    console.log(`[memory-review] Extracted ${saved} memory/memories from conversation ${conversationId}`);
  }

  return saved;
}

async function runMemoryReview(): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  // Find conversations with messages older than threshold that haven't been reviewed since
  // We need conversations where:
  // 1. The latest message is older than staleThreshold (conversation is idle)
  // 2. Either never reviewed OR reviewed before the latest message
  try {
    const allConvs = await db.select({ id: conversations.id, lastMemoryReview: conversations.lastMemoryReview })
      .from(conversations);

    for (const conv of allConvs) {
      // Get the latest message timestamp
      const [latest] = await db.select({ createdAt: orchestratorChats.createdAt })
        .from(orchestratorChats)
        .where(eq(orchestratorChats.conversationId, conv.id))
        .orderBy(desc(orchestratorChats.createdAt))
        .limit(1);

      if (!latest) continue;

      // Skip if conversation is still active (last message is recent)
      if (latest.createdAt > staleThreshold) continue;

      // Skip if already reviewed after the latest message
      if (conv.lastMemoryReview && conv.lastMemoryReview >= latest.createdAt) continue;

      await reviewConversation(conv.id);
    }
  } catch (err) {
    console.error('[memory-review] Review sweep failed:', err instanceof Error ? err.message : err);
  }
}

let reviewInterval: ReturnType<typeof setInterval> | null = null;

export function startMemoryReview(): void {
  if (reviewInterval) return;
  reviewInterval = setInterval(runMemoryReview, REVIEW_INTERVAL_MS);
  console.log('[memory-review] Background review started (every 30 min)');
  // Run once on startup after a short delay
  setTimeout(runMemoryReview, 10_000);
}

export function stopMemoryReview(): void {
  if (reviewInterval) {
    clearInterval(reviewInterval);
    reviewInterval = null;
  }
}
```

- [ ] **Step 2: Start the review job on boot**

In `src/lib/workflows/index.ts`, add the import at the top:

```typescript
import { startMemoryReview } from './chat/memory-review';
```

Then add the startup call after the `loadCustomTools` block (after line 180):

```typescript
startMemoryReview();
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/chat/memory-review.ts src/lib/workflows/index.ts
git commit -m "feat: add background memory review job — extracts memories from stale conversations"
```

---

### Task 6: System prompt for memory

**Files:**
- Create: `data/prompts/07-memory.md`

- [ ] **Step 1: Create the memory prompt**

```markdown
# Memory

You have persistent memory. Facts you've learned about John are loaded at the start of each conversation in the Memory section below your instructions.

## Using Memory

- Use `recall_memories` when a question might benefit from past context — check what you already know before asking John to repeat himself.
- Your memories are automatically populated after conversations, but you should also use `save_memory` proactively when you notice important facts:
  - Names and relationships ("John's mum is called Margaret")
  - Preferences and habits ("John prefers running in the morning")
  - Locations ("John lives in Newcastle")
  - Health details relevant to fitness ("Training for a half marathon in September")
  - Devices and services ("John drives a Tesla Model 3")
  - Ongoing situations ("Kitchen renovation happening in April")
- Watch for implicit facts too — "I'm visiting my sister in Edinburgh" implies both the sister's location and a planned trip.
- If you learn something that contradicts an existing memory, save the updated version — the old one is automatically superseded.
- Use `forget_memory` when John asks you to forget something or when a memory is clearly wrong.

## What Not to Remember

- Ephemeral task details ("turned on the living room lights")
- Sensitive data (passwords, financial specifics, medical details beyond fitness context)
- Things that are obvious from context (the current date, what tools are available)
```

- [ ] **Step 2: Commit**

```bash
git add data/prompts/07-memory.md
git commit -m "feat: add memory system prompt for JKAI"
```

---

### Task 7: Build, push schema, and verify

**Files:** None (runtime verification)

- [ ] **Step 1: Build the project**

Run: `cd ~/strange_rambling_svelte && npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Create DB tables (local)**

```bash
docker exec strange_rambling-app-db-1 psql -U app -d strange_rambling -c "
CREATE TABLE IF NOT EXISTS jkai_memories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  source_conversation_id TEXT,
  confidence TEXT NOT NULL DEFAULT 'high',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by TEXT
);

ALTER TABLE jkai_conversations ADD COLUMN IF NOT EXISTS last_memory_review TIMESTAMPTZ;
"
```

- [ ] **Step 3: Create DB tables (VPS)**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "docker exec strange-rambling-app-db-1 psql -U app -d strange_rambling -c \"
CREATE TABLE IF NOT EXISTS jkai_memories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  source_conversation_id TEXT,
  confidence TEXT NOT NULL DEFAULT 'high',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by TEXT
);

ALTER TABLE jkai_conversations ADD COLUMN IF NOT EXISTS last_memory_review TIMESTAMPTZ;
\""
```

- [ ] **Step 4: Push and deploy**

```bash
git push origin master
cd ~/strange_rambling_svelte && bash scripts/deploy.sh
```

- [ ] **Step 5: Verify**

Open JKAI chat and test:
1. "Remember that my mum lives in Whitley Bay" — should call `save_memory`
2. "What do you know about my family?" — should call `recall_memories` and find the memory
3. Check startup logs for `[memory-review] Background review started`
4. After 30+ minutes of inactivity, check logs for memory extraction from the conversation
