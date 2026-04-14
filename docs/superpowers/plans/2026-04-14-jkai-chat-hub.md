# JKAI Chat Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a centralised chat interface at `/jkai` that wraps all orchestrator capabilities, supports WhatsApp conversation continuation, shows job metrics, and consolidates access to system prompts and chat history.

**Architecture:** New `conversations` table + `conversationId` column on `orchestratorChats` for persistent threads. New API routes for CRUD on conversations, metrics, and WhatsApp thread access. Refactored chat UI from the existing ChatPanel into a full-page layout with conversation sidebar. Existing routes relocated under `/jkai/builds` and `/jkai/prompts`.

**Tech Stack:** SvelteKit (Svelte 5 runes), PostgreSQL via Drizzle ORM, Vitest, existing orchestrator/generalChat infrastructure.

**Spec:** `docs/superpowers/specs/2026-04-14-jkai-chat-hub-design.md`

---

## File Map

### New files

| File | Purpose |
|------|---------|
| `src/lib/db/schema.ts` (modify) | Add `conversations` table, add `conversationId` to `orchestratorChats` |
| `src/routes/api/jkai/conversations/+server.ts` | GET list / POST create conversations |
| `src/routes/api/jkai/conversations/[id]/+server.ts` | GET detail / DELETE conversation |
| `src/routes/api/jkai/metrics/+server.ts` | GET job metrics summary |
| `src/routes/api/jkai/whatsapp-thread/+server.ts` | GET WhatsApp conversation history |
| `src/routes/api/workflows/orchestrator/chat/+server.ts` (modify) | Accept `conversationId`, save/load by conversation |
| `src/lib/components/jkai/ConversationSidebar.svelte` | Conversation list + WhatsApp indicator |
| `src/lib/components/jkai/MetricsStrip.svelte` | Compact metrics bar |
| `src/lib/components/jkai/ChatArea.svelte` | Full-width chat (refactored from ChatPanel) |
| `src/routes/jkai/+page.svelte` (rewrite) | Chat hub page |
| `src/routes/jkai/+page.server.ts` (rewrite) | Load conversations + metrics + WhatsApp thread |
| `src/routes/jkai/builds/+page.svelte` | Builds list (moved from `/jkai`) |
| `src/routes/jkai/builds/+page.server.ts` | Builds list loader (moved) |
| `src/routes/jkai/builds/[id]/+page.svelte` | Build detail (moved from `/jkai/[id]`) |
| `src/routes/jkai/builds/[id]/+page.server.ts` | Build detail loader (moved) |
| `src/routes/jkai/builds/new/+page.svelte` | New build (moved from `/jkai/new`) |
| `src/routes/jkai/prompts/+page.svelte` | System prompt editor (moved from `/workflows/prompts`) |
| `src/routes/+page.svelte` (modify) | Add "jkai" to navbar |
| `tests/lib/jkai/conversations-api.test.ts` | API route tests |

---

## Task 1: Database Schema Changes

**Files:**
- Modify: `src/lib/db/schema.ts:655-668`

- [ ] **Step 1: Add `conversations` table and extend `orchestratorChats`**

Add the following after the orchestratorChats section (around line 668) in `src/lib/db/schema.ts`. Also add the `conversationId` column to the existing `orchestratorChats` table.

First, add the `conversations` table. Insert this after line 668 (`export type NewOrchestratorChat = ...`):

```typescript
// ==========================================
// Conversations (JKAI Chat Hub)
// ==========================================

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  title: text('title'),
  source: text('source').notNull().default('web'), // 'web' | 'whatsapp-continuation'
  whatsappPhoneNumber: text('whatsapp_phone_number'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
```

Then add `conversationId` to the `orchestratorChats` table definition. Add this line after the `workflowId` line (line 660):

```typescript
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
```

- [ ] **Step 2: Push schema to database**

Run: `cd /home/john/strange_rambling_svelte && npx drizzle-kit push`

Expected: Tables created/altered successfully. The `conversations` table is created and `orchestrator_chats` gains a `conversation_id` column.

- [ ] **Step 3: Verify schema push**

Run: `cd /home/john/strange_rambling_svelte && npx drizzle-kit studio` (or check via pgweb at `http://homeserv:8085/pgweb/`)

Verify:
- `conversations` table exists with columns: `id`, `title`, `source`, `whatsapp_phone_number`, `created_at`, `updated_at`
- `orchestrator_chats` table has new `conversation_id` column (nullable)

- [ ] **Step 4: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/db/schema.ts
git commit -m "feat: add conversations table and conversationId to orchestratorChats"
```

---

## Task 2: Conversations API Routes

**Files:**
- Create: `src/routes/api/jkai/conversations/+server.ts`
- Create: `src/routes/api/jkai/conversations/[id]/+server.ts`

- [ ] **Step 1: Create conversations list/create endpoint**

Create `src/routes/api/jkai/conversations/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      source: conversations.source,
      whatsappPhoneNumber: conversations.whatsappPhoneNumber,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      messageCount: sql<number>`(
        select count(*) from orchestrator_chats
        where orchestrator_chats.conversation_id = ${conversations.id}
      )`.as('message_count'),
      lastMessage: sql<string>`(
        select content from orchestrator_chats
        where orchestrator_chats.conversation_id = ${conversations.id}
        order by created_at desc limit 1
      )`.as('last_message'),
    })
    .from(conversations)
    .orderBy(desc(conversations.updatedAt));

  return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { title, source, whatsappPhoneNumber } = body;

  const [conv] = await db
    .insert(conversations)
    .values({
      title: title || null,
      source: source || 'web',
      whatsappPhoneNumber: whatsappPhoneNumber || null,
    })
    .returning();

  return json(conv, { status: 201 });
};
```

- [ ] **Step 2: Create conversation detail/delete endpoint**

Create `src/routes/api/jkai/conversations/[id]/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations, orchestratorChats, whatsappConversations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.id))
    .limit(1);

  if (!conv) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  // Load web messages
  const webMessages = await db
    .select({
      id: orchestratorChats.id,
      role: orchestratorChats.role,
      content: orchestratorChats.content,
      metadata: orchestratorChats.metadata,
      createdAt: orchestratorChats.createdAt,
    })
    .from(orchestratorChats)
    .where(eq(orchestratorChats.conversationId, params.id))
    .orderBy(asc(orchestratorChats.createdAt));

  // If WhatsApp continuation, also load WhatsApp messages
  let whatsappMessages: Array<{
    id: string;
    role: string;
    content: string;
    metadata: unknown;
    createdAt: Date;
    source: 'whatsapp';
  }> = [];

  if (conv.whatsappPhoneNumber) {
    const waRows = await db
      .select()
      .from(whatsappConversations)
      .where(eq(whatsappConversations.phoneNumber, conv.whatsappPhoneNumber))
      .orderBy(asc(whatsappConversations.createdAt));

    whatsappMessages = waRows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      metadata: r.metadata,
      createdAt: r.createdAt,
      source: 'whatsapp' as const,
    }));
  }

  // Merge chronologically
  const allMessages = [
    ...whatsappMessages,
    ...webMessages.map((m) => ({ ...m, source: 'web' as const })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return json({ conversation: conv, messages: allMessages });
};

export const DELETE: RequestHandler = async ({ params }) => {
  await db.delete(conversations).where(eq(conversations.id, params.id));
  return json({ deleted: true });
};
```

- [ ] **Step 3: Verify the API works**

Run the dev server: `cd /home/john/strange_rambling_svelte && npm run dev`

Test create:
```bash
curl -s -X POST http://homeserv:5173/api/jkai/conversations \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test conversation","source":"web"}' | jq .
```
Expected: JSON with `id`, `title`, `source`, `createdAt`, `updatedAt`.

Test list:
```bash
curl -s http://homeserv:5173/api/jkai/conversations | jq .
```
Expected: Array containing the just-created conversation.

Test delete (using the id from create):
```bash
curl -s -X DELETE http://homeserv:5173/api/jkai/conversations/<id> | jq .
```
Expected: `{ "deleted": true }`

- [ ] **Step 4: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/routes/api/jkai/conversations/
git commit -m "feat: add conversations CRUD API routes"
```

---

## Task 3: Metrics and WhatsApp Thread API Routes

**Files:**
- Create: `src/routes/api/jkai/metrics/+server.ts`
- Create: `src/routes/api/jkai/whatsapp-thread/+server.ts`

- [ ] **Step 1: Create metrics endpoint**

Create `src/routes/api/jkai/metrics/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowRuns, workflowSchedules } from '$lib/db/schema';
import { eq, sql, and, gte } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  // Count runs by status (last 24h)
  const since = new Date(Date.now() - 86400000);

  const runCounts = await db
    .select({
      status: workflowRuns.status,
      count: sql<number>`count(*)::int`,
    })
    .from(workflowRuns)
    .where(gte(workflowRuns.startedAt, since))
    .groupBy(workflowRuns.status);

  // Count enabled schedules
  const [scheduleCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workflowSchedules)
    .where(eq(workflowSchedules.enabled, true));

  const metrics: Record<string, number> = {
    scheduled: scheduleCount?.count ?? 0,
    running: 0,
    completed: 0,
    failed: 0,
    pending: 0,
  };

  for (const row of runCounts) {
    if (row.status in metrics) {
      metrics[row.status] = row.count;
    }
  }

  return json(metrics);
};
```

- [ ] **Step 2: Create WhatsApp thread endpoint**

Create `src/routes/api/jkai/whatsapp-thread/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { whatsappConversations } from '$lib/db/schema';
import { asc, desc, sql } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  // Find the most recent phone number with conversations
  const [latest] = await db
    .select({ phoneNumber: whatsappConversations.phoneNumber })
    .from(whatsappConversations)
    .orderBy(desc(whatsappConversations.createdAt))
    .limit(1);

  if (!latest) {
    return json({ phoneNumber: null, messages: [] });
  }

  const { phoneNumber } = latest;

  // Load all messages for that phone number
  const messages = await db
    .select({
      id: whatsappConversations.id,
      role: whatsappConversations.role,
      content: whatsappConversations.content,
      createdAt: whatsappConversations.createdAt,
    })
    .from(whatsappConversations)
    .where(sql`${whatsappConversations.phoneNumber} = ${phoneNumber}`)
    .orderBy(asc(whatsappConversations.createdAt));

  return json({ phoneNumber, messages });
};
```

- [ ] **Step 3: Verify both endpoints**

```bash
curl -s http://homeserv:5173/api/jkai/metrics | jq .
```
Expected: `{ "scheduled": N, "running": N, "completed": N, "failed": N, "pending": N }`

```bash
curl -s http://homeserv:5173/api/jkai/whatsapp-thread | jq .
```
Expected: `{ "phoneNumber": "...", "messages": [...] }` or `{ "phoneNumber": null, "messages": [] }`

- [ ] **Step 4: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/routes/api/jkai/metrics/ src/routes/api/jkai/whatsapp-thread/
git commit -m "feat: add metrics and whatsapp-thread API routes"
```

---

## Task 4: Extend Orchestrator Chat API for conversationId

**Files:**
- Modify: `src/routes/api/workflows/orchestrator/chat/+server.ts`

- [ ] **Step 1: Update POST handler to accept and use conversationId**

In `src/routes/api/workflows/orchestrator/chat/+server.ts`, modify the POST handler.

Add `conversationId` to the destructured body (line 55):

```typescript
  const { message, workflowId, mode, currentNodes, currentEdges, conversationId } = body;
```

In the general chat branch (the `else` block starting around line 175), update the history loading to also support `conversationId`:

Replace the existing else block (lines 175-198) with:

```typescript
      } else {
        // Default: general-purpose chat (same as WhatsApp)
        let conversationHistory: Array<{ role: string; content: string }> = [];

        if (conversationId) {
          // Load from conversation
          const { eq, asc } = await import('drizzle-orm');
          const convMessages = await db
            .select({ role: orchestratorChats.role, content: orchestratorChats.content })
            .from(orchestratorChats)
            .where(eq(orchestratorChats.conversationId, conversationId))
            .orderBy(asc(orchestratorChats.createdAt));
          conversationHistory = convMessages;

          // If this conversation has a WhatsApp phone number, also load that history
          const { conversations, whatsappConversations } = await import('$lib/db/schema');
          const [conv] = await db
            .select()
            .from(conversations)
            .where(eq(conversations.id, conversationId))
            .limit(1);

          if (conv?.whatsappPhoneNumber) {
            const waMessages = await db
              .select({ role: whatsappConversations.role, content: whatsappConversations.content, createdAt: whatsappConversations.createdAt })
              .from(whatsappConversations)
              .where(eq(whatsappConversations.phoneNumber, conv.whatsappPhoneNumber))
              .orderBy(asc(whatsappConversations.createdAt));

            // Merge WhatsApp + web messages chronologically, take last 30
            const allHistory = [
              ...waMessages.map(m => ({ ...m, createdAt: m.createdAt })),
              ...convMessages.map((m, i) => ({ ...m, createdAt: new Date(Date.now() - (convMessages.length - i) * 1000) })),
            ];
            // Since web messages don't have createdAt in the select, re-query with it
            const webWithDates = await db
              .select({ role: orchestratorChats.role, content: orchestratorChats.content, createdAt: orchestratorChats.createdAt })
              .from(orchestratorChats)
              .where(eq(orchestratorChats.conversationId, conversationId))
              .orderBy(asc(orchestratorChats.createdAt));

            const merged = [
              ...waMessages.map(m => ({ role: m.role, content: m.content, ts: m.createdAt.getTime() })),
              ...webWithDates.map(m => ({ role: m.role, content: m.content, ts: m.createdAt.getTime() })),
            ].sort((a, b) => a.ts - b.ts);

            conversationHistory = merged.slice(-30).map(m => ({ role: m.role, content: m.content }));
          }
        } else if (workflowId) {
          const history = await getChatHistory(workflowId);
          conversationHistory = history.map(h => ({ role: h.role, content: h.content }));
        }

        const { response: responseText } = await generalChat(message, conversationHistory, {
          workflowId,
          onProgress,
        });

        if (abortController.signal.aborted) throw new Error('Job cancelled');

        // Save chat history
        if (conversationId) {
          await db.insert(orchestratorChats).values({ conversationId, role: 'user', content: message });
          await db.insert(orchestratorChats).values({ conversationId, role: 'assistant', content: responseText });
          // Update conversation title if first message
          const { conversations } = await import('$lib/db/schema');
          const { eq } = await import('drizzle-orm');
          const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
          if (conv && !conv.title) {
            await db.update(conversations)
              .set({ title: message.slice(0, 50), updatedAt: new Date() })
              .where(eq(conversations.id, conversationId));
          } else if (conv) {
            await db.update(conversations)
              .set({ updatedAt: new Date() })
              .where(eq(conversations.id, conversationId));
          }
        } else if (workflowId) {
          await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: message });
          await db.insert(orchestratorChats).values({ workflowId, role: 'assistant', content: responseText });
        }

        job.result = { success: true, workflow: null, message: responseText };
      }
```

Note: The existing imports at the top of the file already include `db`, `orchestratorChats`, `eq`, `asc`. Add `conversations` and `whatsappConversations` to the schema import at line 7:

```typescript
import { workflows, workflowNodes, workflowEdges, orchestratorChats, conversations, whatsappConversations } from '$lib/db/schema';
```

And ensure `asc` is in the drizzle-orm import at line 8:

The current import is `import { eq, asc } from 'drizzle-orm';` — already has `asc`. Good. Remove the dynamic imports from the else block above and use the top-level imports instead. The final else block should use the already-imported symbols directly rather than dynamic `import()`.

- [ ] **Step 2: Verify the API change**

Create a test conversation and send a message to it:

```bash
# Create conversation
CONV_ID=$(curl -s -X POST http://homeserv:5173/api/jkai/conversations \
  -H 'Content-Type: application/json' \
  -d '{"source":"web"}' | jq -r .id)

# Send a chat message with conversationId
JOB_ID=$(curl -s -X POST http://homeserv:5173/api/workflows/orchestrator/chat \
  -H 'Content-Type: application/json' \
  -d "{\"message\":\"Hello, what can you do?\",\"conversationId\":\"$CONV_ID\"}" | jq -r .jobId)

# Poll for result
sleep 5
curl -s "http://homeserv:5173/api/workflows/orchestrator/chat?jobId=$JOB_ID" | jq .status
```
Expected: `"done"`

Verify the conversation now has a title and messages:
```bash
curl -s http://homeserv:5173/api/jkai/conversations/$CONV_ID | jq .
```
Expected: Conversation with title set from first message, messages array with user + assistant entries.

- [ ] **Step 3: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/routes/api/workflows/orchestrator/chat/+server.ts
git commit -m "feat: extend orchestrator chat API to support conversationId"
```

---

## Task 5: Move Existing Routes

**Files:**
- Move: `src/routes/jkai/+page.svelte` → `src/routes/jkai/builds/+page.svelte`
- Move: `src/routes/jkai/+page.server.ts` → `src/routes/jkai/builds/+page.server.ts`
- Move: `src/routes/jkai/[id]/` → `src/routes/jkai/builds/[id]/`
- Move: `src/routes/jkai/new/` → `src/routes/jkai/builds/new/`
- Move: `src/routes/workflows/prompts/+page.svelte` → `src/routes/jkai/prompts/+page.svelte`

- [ ] **Step 1: Create builds directory and move files**

```bash
cd /home/john/strange_rambling_svelte
mkdir -p src/routes/jkai/builds
cp src/routes/jkai/+page.svelte src/routes/jkai/builds/+page.svelte
cp src/routes/jkai/+page.server.ts src/routes/jkai/builds/+page.server.ts
cp -r src/routes/jkai/\[id\] src/routes/jkai/builds/
cp -r src/routes/jkai/new src/routes/jkai/builds/
```

- [ ] **Step 2: Update internal links in the moved builds page**

In `src/routes/jkai/builds/+page.svelte`, update the link to create new builds and view build details. The "New Build" link should change from `/jkai/new` to `/jkai/builds/new`, and the build detail link from `/jkai/{build.id}` to `/jkai/builds/{build.id}`:

Replace `href="/jkai/new"` with `href="/jkai/builds/new"`.
Replace `href="/jkai/{build.id}"` with `href="/jkai/builds/{build.id}"`.

Also add a back link to the chat page. Replace the header `<div>` block:

```svelte
    <div>
      <div class="flex items-center gap-3">
        <a href="/jkai" class="text-sm" style="color: var(--text-ghost);">&larr; Chat</a>
      </div>
      <h1 class="display text-[32px] sm:text-[40px]" style="color: var(--text-primary);">
        BUILDS
      </h1>
      <p class="text-sm mt-1" style="color: var(--text-secondary);">
        Autonomous AI development projects
      </p>
    </div>
```

- [ ] **Step 3: Move prompts page**

```bash
cd /home/john/strange_rambling_svelte
mkdir -p src/routes/jkai/prompts
cp src/routes/workflows/prompts/+page.svelte src/routes/jkai/prompts/+page.svelte
```

In `src/routes/jkai/prompts/+page.svelte`, update the back link from `/workflows` to `/jkai`:

Replace `<a href="/workflows" class="text-sm" style="color: var(--text-ghost);">&larr; Workflows</a>` with `<a href="/jkai" class="text-sm" style="color: var(--text-ghost);">&larr; Chat</a>`.

- [ ] **Step 4: Remove old routes**

```bash
cd /home/john/strange_rambling_svelte
rm src/routes/workflows/prompts/+page.svelte
rmdir src/routes/workflows/prompts
```

Note: Keep the old `/jkai/+page.svelte` and `/jkai/+page.server.ts` — we'll overwrite them in Task 7. Keep `/jkai/[id]` and `/jkai/new` — remove after confirming builds work at the new paths.

- [ ] **Step 5: Verify moved routes work**

Open `http://homeserv:5173/jkai/builds` — should show the builds list.
Open `http://homeserv:5173/jkai/builds/new` — should show the new build form.
Open `http://homeserv:5173/jkai/prompts` — should show the system prompts editor.

- [ ] **Step 6: Remove old route directories**

```bash
cd /home/john/strange_rambling_svelte
rm -rf src/routes/jkai/\[id\]
rm -rf src/routes/jkai/new
```

- [ ] **Step 7: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add -A src/routes/jkai/ src/routes/workflows/prompts/
git commit -m "refactor: move builds to /jkai/builds and prompts to /jkai/prompts"
```

---

## Task 6: MetricsStrip and ConversationSidebar Components

**Files:**
- Create: `src/lib/components/jkai/MetricsStrip.svelte`
- Create: `src/lib/components/jkai/ConversationSidebar.svelte`

- [ ] **Step 1: Create MetricsStrip component**

Create `src/lib/components/jkai/MetricsStrip.svelte`:

```svelte
<script lang="ts">
  let {
    metrics,
  }: {
    metrics: { scheduled: number; running: number; completed: number; failed: number };
  } = $props();
</script>

<div class="flex items-center gap-4 text-[11px]" style="font-family: var(--font-mono); color: var(--text-ghost);">
  <span>{metrics.scheduled} scheduled</span>
  <span style="color: var(--text-ghost);">|</span>
  {#if metrics.running > 0}
    <span style="color: #569cd6;">{metrics.running} running</span>
  {:else}
    <span>{metrics.running} running</span>
  {/if}
  <span style="color: var(--text-ghost);">|</span>
  <span>{metrics.completed} completed</span>
  <span style="color: var(--text-ghost);">|</span>
  {#if metrics.failed > 0}
    <span style="color: #b43232;">{metrics.failed} failed</span>
  {:else}
    <span>{metrics.failed} failed</span>
  {/if}
</div>
```

- [ ] **Step 2: Create ConversationSidebar component**

Create `src/lib/components/jkai/ConversationSidebar.svelte`:

```svelte
<script lang="ts">
  interface ConversationItem {
    id: string;
    title: string | null;
    source: string;
    updatedAt: string;
    lastMessage: string | null;
    messageCount: number;
  }

  interface WhatsAppThread {
    phoneNumber: string | null;
    messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
  }

  let {
    conversations,
    whatsappThread,
    activeConversationId,
    onSelect,
    onNew,
    onWhatsAppSelect,
    onDelete,
    collapsed = false,
    onToggleCollapse,
  }: {
    conversations: ConversationItem[];
    whatsappThread: WhatsAppThread | null;
    activeConversationId: string | null;
    onSelect: (id: string) => void;
    onNew: () => void;
    onWhatsAppSelect: () => void;
    onDelete: (id: string) => void;
    collapsed?: boolean;
    onToggleCollapse: () => void;
  } = $props();

  function relativeTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return 'now';
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
    if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
    return `${Math.floor(ms / 86400000)}d`;
  }

  function truncate(text: string | null, len: number): string {
    if (!text) return '';
    return text.length > len ? text.slice(0, len) + '...' : text;
  }
</script>

{#if collapsed}
  <button
    onclick={onToggleCollapse}
    class="px-2 py-4 border-r flex items-center"
    style="border-color: var(--card-border); color: var(--text-ghost);"
    title="Expand sidebar"
  >
    <span class="text-sm">&#9654;</span>
  </button>
{:else}
  <div
    class="w-64 flex-shrink-0 border-r flex flex-col h-full"
    style="border-color: var(--card-border);"
  >
    <!-- Header -->
    <div class="px-3 py-3 flex items-center justify-between border-b" style="border-color: var(--card-border);">
      <span class="text-xs uppercase tracking-wider font-medium" style="color: var(--text-secondary);">
        Conversations
      </span>
      <button
        onclick={onToggleCollapse}
        class="text-sm px-1"
        style="color: var(--text-ghost);"
        title="Collapse sidebar"
      >
        &#9664;
      </button>
    </div>

    <!-- Scrollable list -->
    <div class="flex-1 overflow-y-auto">
      <!-- WhatsApp thread indicator -->
      {#if whatsappThread?.phoneNumber && whatsappThread.messages.length > 0}
        <button
          onclick={onWhatsAppSelect}
          class="w-full text-left px-3 py-3 border-b transition-colors"
          style="border-color: var(--card-border); background: {activeConversationId === 'whatsapp' ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent'};"
        >
          <div class="flex items-center gap-2 mb-1">
            <span class="text-[10px] px-1.5 py-0.5 rounded" style="background: rgba(37, 211, 102, 0.15); color: #25d366;">
              WA
            </span>
            <span class="text-xs font-medium" style="color: var(--text-primary);">
              WhatsApp thread
            </span>
          </div>
          <p class="text-[11px] line-clamp-1" style="color: var(--text-ghost);">
            {truncate(whatsappThread.messages[whatsappThread.messages.length - 1]?.content, 40)}
          </p>
        </button>
      {/if}

      <!-- Web conversations -->
      {#each conversations as conv (conv.id)}
        <button
          onclick={() => onSelect(conv.id)}
          class="w-full text-left px-3 py-2.5 border-b transition-colors group"
          style="border-color: var(--card-border); background: {activeConversationId === conv.id ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent'};"
        >
          <div class="flex items-center justify-between mb-0.5">
            <span
              class="text-xs font-medium line-clamp-1 flex-1"
              style="color: {activeConversationId === conv.id ? 'var(--accent)' : 'var(--text-primary)'};"
            >
              {conv.title || 'New conversation'}
            </span>
            <span class="text-[10px] shrink-0 ml-2" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {relativeTime(conv.updatedAt)}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <p class="text-[11px] line-clamp-1 flex-1" style="color: var(--text-ghost);">
              {truncate(conv.lastMessage, 35)}
            </p>
            <button
              onclick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
              class="text-[10px] px-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              style="color: var(--text-ghost);"
              title="Delete conversation"
            >
              &times;
            </button>
          </div>
        </button>
      {/each}
    </div>

    <!-- New conversation button -->
    <div class="px-3 py-3 border-t" style="border-color: var(--card-border);">
      <button
        onclick={onNew}
        class="w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors border"
        style="border-color: var(--card-border); color: var(--text-secondary);"
      >
        + New conversation
      </button>
    </div>
  </div>
{/if}
```

- [ ] **Step 3: Commit**

```bash
cd /home/john/strange_rambling_svelte
mkdir -p src/lib/components/jkai
git add src/lib/components/jkai/MetricsStrip.svelte src/lib/components/jkai/ConversationSidebar.svelte
git commit -m "feat: add MetricsStrip and ConversationSidebar components"
```

---

## Task 7: ChatArea Component

**Files:**
- Create: `src/lib/components/jkai/ChatArea.svelte`

- [ ] **Step 1: Create ChatArea component**

This is a refactored version of `src/lib/components/workflows/ChatPanel.svelte`, adapted for full-width layout and conversation-based history. Create `src/lib/components/jkai/ChatArea.svelte`:

```svelte
<script lang="ts">
  import ChatMessage from '$lib/components/workflows/ChatMessage.svelte';
  import type { OrchestratorThinking } from '$lib/workflows/orchestrator/types';

  let {
    conversationId,
    initialMessages = [],
  }: {
    conversationId: string | null;
    initialMessages?: Array<{
      id: string;
      role: string;
      content: string;
      metadata?: any;
      source?: string;
      createdAt?: string;
    }>;
  } = $props();

  interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: { workflowGenerated?: boolean };
    thinking?: OrchestratorThinking;
    isProgress?: boolean;
    progressSteps?: string[];
    source?: string;
  }

  let messages = $state<Message[]>([]);
  let input = $state('');
  let loading = $state(false);
  let showThinking = $state(false);
  let currentJobId = $state<string | null>(null);
  let chatContainer: HTMLDivElement;

  // Sync messages when initialMessages or conversationId changes
  $effect(() => {
    messages = initialMessages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      metadata: m.metadata,
      source: m.source,
    }));
    scrollToBottom();
  });

  async function cancelJob() {
    if (!currentJobId) return;
    try {
      await fetch(`/api/workflows/orchestrator/chat?jobId=${currentJobId}`, { method: 'DELETE' });
    } catch { /* ignore */ }
  }

  function formatProgress(raw: string): string {
    const trimmed = raw.replace(/\n$/, '').trim();
    const toolMatch = trimmed.match(/^(\w+):\s*(.+)/);
    if (toolMatch) {
      const [, tool, args] = toolMatch;
      const labels: Record<string, string> = {
        search_nodes: 'Searching',
        use_node: 'Adding node',
        create_node: 'Creating node',
        connect_nodes: 'Connecting',
        ask_user: 'Asking',
        finalize_workflow: 'Finalizing',
      };
      const label = labels[tool] || tool;
      try {
        const parsed = JSON.parse(args.replace(/\.{3}$/, ''));
        if (parsed.query) return `${label}: "${parsed.query}"`;
        if (parsed.label) return `${label}: ${parsed.label}`;
        if (parsed.name) return `${label}: ${parsed.name}`;
        if (parsed.sourceId) return `${label}: ${parsed.sourceId} → ${parsed.targetId}`;
      } catch {
        const queryMatch = args.match(/"query"\s*:\s*"([^"]+)"/);
        if (queryMatch) return `${label}: "${queryMatch[1]}"`;
        const labelMatch = args.match(/"label"\s*:\s*"([^"]+)"/);
        if (labelMatch) return `${label}: ${labelMatch[1]}`;
        const nameMatch = args.match(/"name"\s*:\s*"([^"]+)"/);
        if (nameMatch) return `${label}: ${nameMatch[1]}`;
      }
      return label;
    }
    return trimmed.replace(/\.\.\.\n?$/, '');
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || !conversationId) return;

    input = '';
    loading = true;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      source: 'web',
    };
    messages = [...messages, userMsg];
    scrollToBottom();

    const progressId = crypto.randomUUID();
    messages = [...messages, {
      id: progressId,
      role: 'assistant',
      content: 'Thinking...',
      isProgress: true,
      progressSteps: [],
    }];
    scrollToBottom();

    try {
      const postRes = await fetch('/api/workflows/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId,
        }),
      });

      const postData = await postRes.json().catch(() => null);

      if (!postRes.ok) {
        throw new Error(postData?.error || `Server error (${postRes.status})`);
      }

      const jobId = postData?.jobId;
      if (!jobId) throw new Error('No job ID returned');
      currentJobId = jobId;

      let done = false;
      let lastProgress = 0;
      const startTime = Date.now();
      const TIMEOUT = 300000;

      while (!done && Date.now() - startTime < TIMEOUT) {
        await new Promise((r) => setTimeout(r, 1500));

        try {
          const pollRes = await fetch(`/api/workflows/orchestrator/chat?jobId=${jobId}`);
          if (!pollRes.ok) continue;

          const data = await pollRes.json();

          if (data.progress && data.progress.length > lastProgress) {
            const steps = data.progress.map(formatProgress);
            const latestStep = steps[steps.length - 1];
            messages = messages.map((m) =>
              m.id === progressId ? { ...m, content: latestStep, progressSteps: steps } : m,
            );
            lastProgress = data.progress.length;
            scrollToBottom();
          }

          if (data.status === 'cancelled') {
            done = true;
            messages = messages.map((m) =>
              m.id === progressId ? { ...m, isProgress: false, content: 'Job cancelled.' } : m,
            );
          } else if (data.status === 'done' || data.status === 'error') {
            done = true;
            const result = data.result || {};

            const finalMsg: Message = {
              id: progressId,
              role: 'assistant',
              content: result.message || result.error || data.error || 'No response.',
              metadata: { workflowGenerated: !!result.workflow },
              thinking: result.thinking || undefined,
              isProgress: false,
              source: 'web',
            };
            messages = messages.map((m) => (m.id === progressId ? finalMsg : m));
          }
        } catch {
          // Network error — keep polling
        }
      }

      if (!done) {
        messages = messages.map((m) =>
          m.id === progressId
            ? { ...m, isProgress: false, content: 'Still working... check back shortly.' }
            : m,
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      messages = messages.map((m) =>
        m.id === progressId ? { ...m, isProgress: false, content: `Error: ${errMsg}` } : m,
      );
    }

    loading = false;
    currentJobId = null;
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<div class="flex flex-col h-full">
  <!-- Chat header -->
  <div class="px-4 py-2 border-b flex items-center justify-between" style="border-color: var(--card-border);">
    <p class="text-[11px]" style="color: var(--text-ghost);">
      {#if !conversationId}
        Select or start a conversation
      {:else}
        Chat with the orchestrator — ask anything, build workflows, control your home
      {/if}
    </p>
    {#if conversationId}
      <button
        onclick={() => { showThinking = !showThinking; }}
        class="text-[10px] px-2 py-1 rounded border transition-colors shrink-0"
        style="border-color: {showThinking ? 'var(--accent)' : 'var(--card-border)'}; color: {showThinking ? 'var(--accent)' : 'var(--text-ghost)'};"
      >
        {showThinking ? 'Hide' : 'Show'} thinking
      </button>
    {/if}
  </div>

  <!-- Messages -->
  <div bind:this={chatContainer} class="flex-1 overflow-y-auto p-4">
    {#if !conversationId}
      <div class="flex items-center justify-center h-full">
        <p class="text-sm" style="color: var(--text-ghost);">
          Start a new conversation or select one from the sidebar.
        </p>
      </div>
    {:else if messages.length === 0}
      <div class="flex items-center justify-center h-full">
        <div class="text-center max-w-md">
          <p class="text-sm mb-2" style="color: var(--text-ghost);">
            Ask me anything — control your smart home, check health data, manage blog posts, start builds, or create workflows.
          </p>
        </div>
      </div>
    {:else}
      <div class="max-w-3xl mx-auto">
        {#each messages as msg (msg.id)}
          {#if msg.isProgress}
            <div class="mb-3 rounded-lg border overflow-hidden" style="border-color: var(--accent); background: var(--card-bg);">
              <div class="px-3 py-2 flex items-center gap-2" style="background: color-mix(in srgb, var(--accent) 10%, transparent);">
                <span class="w-2 h-2 rounded-full animate-pulse" style="background: var(--accent);"></span>
                <span class="text-[11px] uppercase tracking-wider font-medium" style="color: var(--accent);">
                  {msg.progressSteps && msg.progressSteps.length > 0 ? 'Working' : 'Thinking'}
                </span>
                <button
                  onclick={cancelJob}
                  class="ml-auto text-[10px] px-2 py-0.5 rounded border transition-colors"
                  style="border-color: var(--card-border); color: var(--text-ghost);"
                >
                  Cancel
                </button>
              </div>
              {#if msg.progressSteps && msg.progressSteps.length > 0}
                <div class="px-3 py-2 space-y-1">
                  {#each msg.progressSteps as step, i}
                    <div class="flex items-center gap-2">
                      <span class="text-[10px] shrink-0" style="color: {i === msg.progressSteps.length - 1 ? 'var(--accent)' : 'var(--text-ghost)'};">
                        {i === msg.progressSteps.length - 1 ? '>' : '\u2713'}
                      </span>
                      <span
                        class="text-[11px]"
                        style="color: {i === msg.progressSteps.length - 1 ? 'var(--text-primary)' : 'var(--text-ghost)'}; font-family: var(--font-mono);"
                      >
                        {step}
                      </span>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="px-3 py-2">
                  <span class="text-[11px] animate-pulse" style="color: var(--text-ghost); font-family: var(--font-mono);">
                    {msg.content}
                  </span>
                </div>
              {/if}
            </div>
          {:else}
            <div class="relative">
              {#if msg.source === 'whatsapp'}
                <span
                  class="absolute -left-6 top-2 text-[9px] px-1 py-0.5 rounded"
                  style="background: rgba(37, 211, 102, 0.15); color: #25d366;"
                  title="From WhatsApp"
                >
                  WA
                </span>
              {/if}
              <ChatMessage
                role={msg.role}
                content={msg.content}
                metadata={msg.metadata}
                thinking={msg.thinking}
                {showThinking}
              />
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <!-- Input -->
  {#if conversationId}
    <div class="p-4 border-t" style="border-color: var(--card-border);">
      <div class="max-w-3xl mx-auto flex gap-2">
        <textarea
          bind:value={input}
          onkeydown={handleKeydown}
          placeholder="Ask anything..."
          disabled={loading}
          class="flex-1 px-4 py-3 rounded-lg text-sm border resize-none"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); min-height: 44px; max-height: 160px;"
          rows="1"
        ></textarea>
        <button
          onclick={send}
          disabled={loading || !input.trim()}
          class="px-4 py-3 rounded-lg text-sm font-medium transition-colors self-end"
          style="background: var(--accent); color: white; opacity: {loading || !input.trim() ? 0.5 : 1};"
        >
          Send
        </button>
      </div>
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/components/jkai/ChatArea.svelte
git commit -m "feat: add ChatArea component for jkai chat hub"
```

---

## Task 8: JKAI Chat Hub Page

**Files:**
- Rewrite: `src/routes/jkai/+page.server.ts`
- Rewrite: `src/routes/jkai/+page.svelte`

- [ ] **Step 1: Rewrite page server load**

Rewrite `src/routes/jkai/+page.server.ts`:

```typescript
import { db } from '$lib/db';
import { conversations, orchestratorChats, workflowRuns, workflowSchedules, whatsappConversations } from '$lib/db/schema';
import { desc, eq, sql, gte, asc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  // Load conversations with preview
  const convList = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      source: conversations.source,
      whatsappPhoneNumber: conversations.whatsappPhoneNumber,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      messageCount: sql<number>`(
        select count(*) from orchestrator_chats
        where orchestrator_chats.conversation_id = ${conversations.id}
      )`.as('message_count'),
      lastMessage: sql<string>`(
        select content from orchestrator_chats
        where orchestrator_chats.conversation_id = ${conversations.id}
        order by created_at desc limit 1
      )`.as('last_message'),
    })
    .from(conversations)
    .orderBy(desc(conversations.updatedAt));

  // Load metrics (last 24h)
  const since = new Date(Date.now() - 86400000);
  const runCounts = await db
    .select({
      status: workflowRuns.status,
      count: sql<number>`count(*)::int`,
    })
    .from(workflowRuns)
    .where(gte(workflowRuns.startedAt, since))
    .groupBy(workflowRuns.status);

  const [scheduleCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workflowSchedules)
    .where(eq(workflowSchedules.enabled, true));

  const metrics: Record<string, number> = {
    scheduled: scheduleCount?.count ?? 0,
    running: 0,
    completed: 0,
    failed: 0,
  };
  for (const row of runCounts) {
    if (row.status in metrics) {
      metrics[row.status] = row.count;
    }
  }

  // Check for WhatsApp thread
  const [latestWa] = await db
    .select({ phoneNumber: whatsappConversations.phoneNumber })
    .from(whatsappConversations)
    .orderBy(desc(whatsappConversations.createdAt))
    .limit(1);

  let whatsappThread: { phoneNumber: string; messages: any[] } | null = null;
  if (latestWa) {
    const waMessages = await db
      .select({
        id: whatsappConversations.id,
        role: whatsappConversations.role,
        content: whatsappConversations.content,
        createdAt: whatsappConversations.createdAt,
      })
      .from(whatsappConversations)
      .where(eq(whatsappConversations.phoneNumber, latestWa.phoneNumber))
      .orderBy(asc(whatsappConversations.createdAt));

    whatsappThread = { phoneNumber: latestWa.phoneNumber, messages: waMessages };
  }

  return { conversations: convList, metrics, whatsappThread };
};
```

- [ ] **Step 2: Rewrite the chat hub page**

Rewrite `src/routes/jkai/+page.svelte`:

```svelte
<script lang="ts">
  import ConversationSidebar from '$lib/components/jkai/ConversationSidebar.svelte';
  import MetricsStrip from '$lib/components/jkai/MetricsStrip.svelte';
  import ChatArea from '$lib/components/jkai/ChatArea.svelte';

  let { data } = $props();

  let conversationList = $state(data.conversations);
  let metrics = $state(data.metrics);
  let whatsappThread = $state(data.whatsappThread);
  let activeConversationId = $state<string | null>(null);
  let activeMessages = $state<any[]>([]);
  let sidebarCollapsed = $state(false);

  async function selectConversation(id: string) {
    activeConversationId = id;
    try {
      const res = await fetch(`/api/jkai/conversations/${id}`);
      if (res.ok) {
        const data = await res.json();
        activeMessages = data.messages || [];
      }
    } catch {
      activeMessages = [];
    }
  }

  async function createConversation() {
    try {
      const res = await fetch('/api/jkai/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'web' }),
      });
      if (res.ok) {
        const conv = await res.json();
        conversationList = [
          { ...conv, messageCount: 0, lastMessage: null },
          ...conversationList,
        ];
        activeConversationId = conv.id;
        activeMessages = [];
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  }

  async function selectWhatsApp() {
    if (!whatsappThread?.phoneNumber) return;

    // Create a whatsapp-continuation conversation
    try {
      const res = await fetch('/api/jkai/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'whatsapp-continuation',
          whatsappPhoneNumber: whatsappThread.phoneNumber,
          title: 'WhatsApp continuation',
        }),
      });
      if (res.ok) {
        const conv = await res.json();
        conversationList = [
          { ...conv, messageCount: 0, lastMessage: null },
          ...conversationList,
        ];
        activeConversationId = conv.id;
        // Load merged messages
        const detailRes = await fetch(`/api/jkai/conversations/${conv.id}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          activeMessages = detail.messages || [];
        }
      }
    } catch (err) {
      console.error('Failed to create WhatsApp continuation:', err);
    }
  }

  async function deleteConversation(id: string) {
    try {
      await fetch(`/api/jkai/conversations/${id}`, { method: 'DELETE' });
      conversationList = conversationList.filter((c) => c.id !== id);
      if (activeConversationId === id) {
        activeConversationId = null;
        activeMessages = [];
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  }
</script>

<svelte:head>
  <title>JKAI — Chat</title>
</svelte:head>

<div class="flex flex-col h-screen" style="background: var(--bg);">
  <!-- Header -->
  <div class="px-4 py-3 border-b flex items-center justify-between flex-shrink-0" style="border-color: var(--card-border);">
    <div class="flex items-center gap-6">
      <h1 class="display text-[24px]" style="color: var(--text-primary);">JKAI</h1>
      <nav class="flex items-center gap-4">
        <a href="/jkai/builds" class="text-xs uppercase tracking-wider transition-colors" style="color: var(--text-secondary);">
          Builds
        </a>
        <a href="/jkai/prompts" class="text-xs uppercase tracking-wider transition-colors" style="color: var(--text-secondary);">
          Prompts
        </a>
      </nav>
    </div>
    <MetricsStrip {metrics} />
  </div>

  <!-- Main area: sidebar + chat -->
  <div class="flex flex-1 min-h-0">
    <ConversationSidebar
      conversations={conversationList}
      {whatsappThread}
      {activeConversationId}
      onSelect={selectConversation}
      onNew={createConversation}
      onWhatsAppSelect={selectWhatsApp}
      onDelete={deleteConversation}
      collapsed={sidebarCollapsed}
      onToggleCollapse={() => { sidebarCollapsed = !sidebarCollapsed; }}
    />

    <div class="flex-1 min-w-0">
      <ChatArea
        conversationId={activeConversationId}
        initialMessages={activeMessages}
      />
    </div>
  </div>
</div>
```

- [ ] **Step 3: Verify the chat hub page**

Open `http://homeserv:5173/jkai` in the browser.

Expected:
- Header with "JKAI", "Builds" link, "Prompts" link, and metrics strip
- Sidebar showing any existing WhatsApp thread at top, empty conversation list below, "+ New conversation" button at bottom
- Chat area showing "Start a new conversation or select one from the sidebar"
- Click "+ New conversation" → creates a conversation, sidebar updates, chat area shows empty state
- Type a message and send → orchestrator responds, message appears in chat
- Sidebar shows conversation title (first message truncated) and relative time

- [ ] **Step 4: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/routes/jkai/+page.svelte src/routes/jkai/+page.server.ts
git commit -m "feat: implement jkai chat hub page with sidebar, metrics, and chat area"
```

---

## Task 9: Add jkai to Navbar

**Files:**
- Modify: `src/routes/+page.svelte:63-67`

- [ ] **Step 1: Add jkai link to navbar**

In `src/routes/+page.svelte`, find the nav element (around line 63):

```svelte
    <nav class="flex gap-6 pt-1">
      <a href="/projects" class="nav-link">Projects</a>
      <a href="/blog" class="nav-link">Writing</a>
      <a href="/health" class="nav-link">Health</a>
    </nav>
```

Replace with:

```svelte
    <nav class="flex gap-6 pt-1">
      <a href="/projects" class="nav-link">Projects</a>
      <a href="/blog" class="nav-link">Writing</a>
      <a href="/health" class="nav-link">Health</a>
      <a href="/jkai" class="nav-link">jkai</a>
    </nav>
```

- [ ] **Step 2: Check for navbars on other pages**

Search for other nav elements across pages that might need the same link added. Check `/projects`, `/blog`, `/health` pages. If they have their own nav, add the `jkai` link there too.

- [ ] **Step 3: Verify navbar**

Open `http://homeserv:5173/` — confirm "jkai" appears in the navbar and links to `/jkai`.

- [ ] **Step 4: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/routes/+page.svelte
git commit -m "feat: add jkai link to site navbar"
```

---

## Task 10: End-to-End Verification

- [ ] **Step 1: Full flow test — new web conversation**

1. Open `http://homeserv:5173/jkai`
2. Click "+ New conversation"
3. Type "What's the weather like?" and send
4. Verify: orchestrator responds, message appears in chat, conversation gets a title in sidebar

- [ ] **Step 2: Full flow test — WhatsApp continuation**

1. If WhatsApp thread exists, verify it shows in the sidebar with "WA" badge
2. Click the WhatsApp thread
3. Verify: WhatsApp messages load with "WA" indicators on bubbles
4. Type a new message and send
5. Verify: response appears, new messages don't have WA badge

- [ ] **Step 3: Verify sub-pages**

1. Click "Builds" in header → navigates to `/jkai/builds`, shows builds list
2. Click "Prompts" in header → navigates to `/jkai/prompts`, shows prompt editor
3. Back links on both pages return to `/jkai`

- [ ] **Step 4: Verify metrics**

1. Metrics strip in header shows counts
2. If there are scheduled workflows or recent runs, verify numbers are non-zero

- [ ] **Step 5: Verify sidebar operations**

1. Create multiple conversations
2. Switch between them — chat history loads correctly for each
3. Delete a conversation — it disappears from sidebar
4. Collapse/expand sidebar toggle works

- [ ] **Step 6: Final commit (if any fixes needed)**

```bash
cd /home/john/strange_rambling_svelte
git add -A
git commit -m "fix: address issues found during e2e verification"
```
