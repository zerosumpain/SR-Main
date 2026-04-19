# JKAI Intel Phase 2 — Intelligence Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the navigation layer with timeline view, alerts feed, review queue, semantic search, and enhanced entity dossier summaries.

**Architecture:** Builds on Phase 1 foundation — all schema tables and core modules exist. This phase adds the remaining SvelteKit pages, a search API endpoint, and entity summary generation during ingestion.

**Tech Stack:** SvelteKit, Drizzle ORM, PostgreSQL, Tailwind CSS

---

### Task 1: Timeline View Page

**Files:**
- Create: `src/routes/jkai/intel/timeline/+page.server.ts`
- Create: `src/routes/jkai/intel/timeline/+page.svelte`
- Modify: `src/lib/jkai/intel/queries.ts` (add `listTimelineEvents`)

- [ ] **Step 1: Add timeline query to queries.ts**

Add to `src/lib/jkai/intel/queries.ts`:

```typescript
export async function listTimelineEvents(opts: { limit?: number; entityId?: string; type?: string } = {}) {
  const { limit = 100, entityId, type } = opts;

  const conditions = [
    ...(entityId ? [eq(intelTimelineEvents.entityId, entityId)] : []),
    ...(type ? [eq(intelTimelineEvents.type, type)] : []),
  ];

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select({
      id: intelTimelineEvents.id,
      date: intelTimelineEvents.date,
      dateEnd: intelTimelineEvents.dateEnd,
      type: intelTimelineEvents.type,
      title: intelTimelineEvents.title,
      description: intelTimelineEvents.description,
      entityId: intelTimelineEvents.entityId,
      entityName: intelEntities.name,
      entityTypeIcon: intelEntityTypes.icon,
      noteId: intelTimelineEvents.noteId,
      createdAt: intelTimelineEvents.createdAt,
    })
    .from(intelTimelineEvents)
    .leftJoin(intelEntities, eq(intelTimelineEvents.entityId, intelEntities.id))
    .leftJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(where)
    .orderBy(asc(intelTimelineEvents.date))
    .limit(limit);
}
```

- [ ] **Step 2: Create timeline server load**

Create `src/routes/jkai/intel/timeline/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { listTimelineEvents } from '$lib/jkai/intel/queries';

export const load: PageServerLoad = async ({ url }) => {
  const entityId = url.searchParams.get('entityId') ?? undefined;
  const type = url.searchParams.get('type') ?? undefined;
  const events = await listTimelineEvents({ limit: 200, entityId, type });
  return { events, filters: { entityId, type } };
};
```

- [ ] **Step 3: Create timeline page**

Create `src/routes/jkai/intel/timeline/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();

  const typeColors: Record<string, string> = {
    deadline: 'border-red-500 bg-red-500',
    milestone: 'border-emerald-500 bg-emerald-500',
    event: 'border-sky-500 bg-sky-500',
    decision: 'border-amber-500 bg-amber-500',
  };

  const typeFilters = ['deadline', 'milestone', 'event', 'decision'];

  // Group events by month
  function groupByMonth(events: typeof data.events) {
    const groups = new Map<string, typeof data.events>();
    for (const event of events) {
      const month = event.date.slice(0, 7); // YYYY-MM
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month)!.push(event);
    }
    return [...groups.entries()];
  }

  const grouped = $derived(groupByMonth(data.events));
</script>

<div class="p-6 max-w-4xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300">&larr; Dashboard</a>
  <h1 class="text-2xl font-bold mt-2 mb-6">Timeline</h1>

  <!-- Type Filter -->
  <div class="flex flex-wrap gap-2 mb-6">
    <a
      href="/jkai/intel/timeline"
      class="px-3 py-1.5 rounded-full text-sm {!data.filters.type ? 'bg-sky-600' : 'bg-gray-800 hover:bg-gray-700'}"
    >All</a>
    {#each typeFilters as t}
      <a
        href="/jkai/intel/timeline?type={t}"
        class="px-3 py-1.5 rounded-full text-sm {data.filters.type === t ? 'bg-sky-600' : 'bg-gray-800 hover:bg-gray-700'}"
      >{t}</a>
    {/each}
  </div>

  {#if data.events.length === 0}
    <div class="text-center py-16 text-gray-500">
      <p>No timeline events yet. Events are extracted automatically from your notes.</p>
    </div>
  {:else}
    <div class="border-l-2 border-gray-700 ml-4">
      {#each grouped as [month, events]}
        <div class="mb-8">
          <div class="text-sm font-semibold text-gray-400 mb-3 -ml-4 pl-8">
            {new Date(month + '-01').toLocaleDateString('en-GB', { year: 'numeric', month: 'long' })}
          </div>
          {#each events as event}
            <div class="relative pl-8 pb-4 group">
              <div class="absolute left-[-5px] top-1.5 w-2.5 h-2.5 rounded-full {typeColors[event.type] ?? 'bg-gray-500'}"></div>
              <div class="bg-gray-900 rounded-lg p-3 hover:bg-gray-800/80 transition">
                <div class="flex items-center gap-2 text-xs text-gray-400 mb-1">
                  <span>{event.date}</span>
                  {#if event.dateEnd}
                    <span>— {event.dateEnd}</span>
                  {/if}
                  <span class="px-1.5 py-0.5 rounded text-xs {typeColors[event.type]?.split(' ')[0] ?? ''} border bg-transparent">{event.type}</span>
                </div>
                <div class="text-sm font-medium">{event.title}</div>
                {#if event.description}
                  <div class="text-xs text-gray-400 mt-1">{event.description}</div>
                {/if}
                {#if event.entityName}
                  <a href="/jkai/intel/entities/{event.entityId}" class="inline-flex items-center gap-1 text-xs text-sky-400 mt-1 hover:underline">
                    {event.entityTypeIcon} {event.entityName}
                  </a>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/jkai/intel/queries.ts src/routes/jkai/intel/timeline/
git commit -m "feat(intel): add timeline view page"
```

---

### Task 2: Alerts Feed Page

**Files:**
- Create: `src/routes/jkai/intel/alerts/+page.server.ts`
- Create: `src/routes/jkai/intel/alerts/+page.svelte`
- Create: `src/routes/api/jkai/intel/alerts/[id]/+server.ts`
- Modify: `src/lib/jkai/intel/queries.ts` (add `listAlerts`)

- [ ] **Step 1: Add alerts query to queries.ts**

Add to `src/lib/jkai/intel/queries.ts`:

```typescript
export async function listAlerts(opts: { limit?: number; significance?: string; includeDismissed?: boolean } = {}) {
  const { limit = 50, significance, includeDismissed = false } = opts;

  const conditions = [
    ...(significance ? [eq(intelAlerts.significance, significance)] : []),
    ...(!includeDismissed ? [eq(intelAlerts.dismissed, false)] : []),
  ];

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(intelAlerts)
    .where(where)
    .orderBy(desc(intelAlerts.createdAt))
    .limit(limit);
}
```

- [ ] **Step 2: Create alert dismiss endpoint**

Create `src/routes/api/jkai/intel/alerts/[id]/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelAlerts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const PUT: RequestHandler = async ({ params }) => {
  const [updated] = await db
    .update(intelAlerts)
    .set({ dismissed: true })
    .where(eq(intelAlerts.id, params.id))
    .returning();

  if (!updated) return json({ error: 'Not found' }, { status: 404 });
  return json(updated);
};
```

- [ ] **Step 3: Create alerts page server load**

Create `src/routes/jkai/intel/alerts/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { listAlerts } from '$lib/jkai/intel/queries';

export const load: PageServerLoad = async ({ url }) => {
  const significance = url.searchParams.get('significance') ?? undefined;
  const showDismissed = url.searchParams.get('dismissed') === 'true';
  const alerts = await listAlerts({ limit: 100, significance, includeDismissed: showDismissed });
  return { alerts, filters: { significance, showDismissed } };
};
```

- [ ] **Step 4: Create alerts page**

Create `src/routes/jkai/intel/alerts/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();

  let alerts = $state(data.alerts);

  const significanceColors: Record<string, { border: string; bg: string; text: string }> = {
    high: { border: 'border-red-500', bg: 'bg-red-900/20', text: 'text-red-400' },
    medium: { border: 'border-amber-500', bg: 'bg-amber-900/20', text: 'text-amber-400' },
    low: { border: 'border-blue-500', bg: 'bg-blue-900/20', text: 'text-blue-400' },
  };

  const typeIcons: Record<string, string> = {
    connection: '🔗',
    risk_change: '⚠️',
    contradiction: '❌',
    pattern: '🔄',
  };

  async function dismiss(id: string) {
    const res = await fetch(`/api/jkai/intel/alerts/${id}`, { method: 'PUT' });
    if (res.ok) {
      alerts = alerts.filter((a) => a.id !== id);
    }
  }
</script>

<div class="p-6 max-w-4xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300">&larr; Dashboard</a>
  <h1 class="text-2xl font-bold mt-2 mb-6">Alerts</h1>

  <!-- Filter -->
  <div class="flex flex-wrap gap-2 mb-6">
    <a href="/jkai/intel/alerts" class="px-3 py-1.5 rounded-full text-sm {!data.filters.significance ? 'bg-sky-600' : 'bg-gray-800 hover:bg-gray-700'}">All</a>
    <a href="/jkai/intel/alerts?significance=high" class="px-3 py-1.5 rounded-full text-sm {data.filters.significance === 'high' ? 'bg-red-600' : 'bg-gray-800 hover:bg-gray-700'}">High</a>
    <a href="/jkai/intel/alerts?significance=medium" class="px-3 py-1.5 rounded-full text-sm {data.filters.significance === 'medium' ? 'bg-amber-600' : 'bg-gray-800 hover:bg-gray-700'}">Medium</a>
    <a href="/jkai/intel/alerts?significance=low" class="px-3 py-1.5 rounded-full text-sm {data.filters.significance === 'low' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}">Low</a>
  </div>

  {#if alerts.length === 0}
    <div class="text-center py-16 text-gray-500">
      <p>No alerts. Alerts are generated when new notes surface connections to existing knowledge.</p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each alerts as alert}
        {@const colors = significanceColors[alert.significance] ?? significanceColors.medium}
        <div class="border-l-3 {colors.border} {colors.bg} rounded-lg p-4">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2 mb-1">
              <span>{typeIcons[alert.type] ?? '🔔'}</span>
              <span class="font-medium text-sm">{alert.title}</span>
              <span class="text-xs {colors.text} px-1.5 py-0.5 rounded bg-gray-900/50">{alert.significance}</span>
            </div>
            <button
              onclick={() => dismiss(alert.id)}
              class="text-xs text-gray-500 hover:text-gray-300 px-2 py-1"
              title="Dismiss"
            >dismiss</button>
          </div>
          <p class="text-sm text-gray-300 mt-1">{alert.content}</p>
          <div class="text-xs text-gray-500 mt-2">
            {new Date(alert.createdAt).toLocaleString()}
            {#if alert.delivered}
              <span class="ml-2 text-emerald-500">sent to WhatsApp</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/intel/queries.ts src/routes/jkai/intel/alerts/ src/routes/api/jkai/intel/alerts/
git commit -m "feat(intel): add alerts feed page with dismiss"
```

---

### Task 3: Review Queue Page

**Files:**
- Create: `src/routes/jkai/intel/review/+page.server.ts`
- Create: `src/routes/jkai/intel/review/+page.svelte`
- Create: `src/routes/api/jkai/intel/review/[id]/+server.ts`
- Modify: `src/lib/jkai/intel/queries.ts` (add `listPendingReview`)

- [ ] **Step 1: Add review query to queries.ts**

Add to `src/lib/jkai/intel/queries.ts`:

```typescript
export async function listPendingReview() {
  // Low-confidence unconfirmed entities needing review
  const entities = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      typeId: intelEntities.typeId,
      typeName: intelEntityTypes.name,
      typeIcon: intelEntityTypes.icon,
      confidence: intelEntities.confidence,
      properties: intelEntities.properties,
      createdAt: intelEntities.createdAt,
      noteTitle: intelNotes.title,
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .leftJoin(intelNotes, eq(intelEntities.firstSeenIn, intelNotes.id))
    .where(and(
      eq(intelEntities.confirmed, false),
      isNull(intelEntities.mergedIntoId),
    ))
    .orderBy(asc(intelEntities.confidence), desc(intelEntities.createdAt));

  // Emergent (non-seeded) entity types for review
  const newTypes = await db
    .select()
    .from(intelEntityTypes)
    .where(eq(intelEntityTypes.isSeeded, false))
    .orderBy(desc(intelEntityTypes.createdAt));

  return { entities, newTypes };
}
```

- [ ] **Step 2: Create review accept/reject endpoint**

Create `src/routes/api/jkai/intel/review/[id]/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelEntities, intelEntityTypes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

// POST /api/jkai/intel/review/[id]?action=accept|reject|delete-type
export const POST: RequestHandler = async ({ params, url }) => {
  const action = url.searchParams.get('action');

  if (action === 'accept') {
    // Confirm an entity
    const [updated] = await db
      .update(intelEntities)
      .set({ confirmed: true, updatedAt: new Date() })
      .where(eq(intelEntities.id, params.id))
      .returning();
    if (!updated) return json({ error: 'Not found' }, { status: 404 });
    return json(updated);
  }

  if (action === 'reject') {
    // Delete an unconfirmed entity
    await db.delete(intelEntities).where(eq(intelEntities.id, params.id));
    return json({ deleted: true });
  }

  if (action === 'delete-type') {
    // Delete an emergent entity type
    await db.delete(intelEntityTypes).where(eq(intelEntityTypes.id, params.id));
    return json({ deleted: true });
  }

  return json({ error: 'Invalid action' }, { status: 400 });
};
```

- [ ] **Step 3: Create review page server load**

Create `src/routes/jkai/intel/review/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { listPendingReview } from '$lib/jkai/intel/queries';

export const load: PageServerLoad = async () => {
  return listPendingReview();
};
```

- [ ] **Step 4: Create review page**

Create `src/routes/jkai/intel/review/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();

  let entities = $state(data.entities);
  let newTypes = $state(data.newTypes);

  async function reviewEntity(id: string, action: 'accept' | 'reject') {
    const res = await fetch(`/api/jkai/intel/review/${id}?action=${action}`, { method: 'POST' });
    if (res.ok) {
      entities = entities.filter((e) => e.id !== id);
    }
  }

  async function deleteType(id: string) {
    const res = await fetch(`/api/jkai/intel/review/${id}?action=delete-type`, { method: 'POST' });
    if (res.ok) {
      newTypes = newTypes.filter((t) => t.id !== id);
    }
  }

  const confidenceColors: Record<string, string> = {
    low: 'text-red-400',
    medium: 'text-amber-400',
    high: 'text-emerald-400',
  };
</script>

<div class="p-6 max-w-4xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300">&larr; Dashboard</a>
  <h1 class="text-2xl font-bold mt-2 mb-6">Review Queue</h1>

  <!-- Emergent Types -->
  {#if newTypes.length > 0}
    <div class="mb-8">
      <h2 class="text-sm font-semibold text-purple-400 mb-3">New Entity Types</h2>
      <div class="space-y-2">
        {#each newTypes as type}
          <div class="bg-gray-900 rounded-lg p-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-xl">{type.icon}</span>
              <div>
                <div class="font-medium text-sm">{type.name}</div>
                <div class="text-xs text-gray-400">{type.description}</div>
              </div>
            </div>
            <button
              onclick={() => deleteType(type.id)}
              class="text-xs text-red-400 hover:text-red-300 px-3 py-1 border border-red-800 rounded hover:bg-red-900/30"
            >Remove</button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Unconfirmed Entities -->
  <h2 class="text-sm font-semibold text-amber-400 mb-3">Unconfirmed Entities ({entities.length})</h2>

  {#if entities.length === 0}
    <div class="text-center py-12 text-gray-500">
      <p>Nothing to review. All entities are confirmed.</p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each entities as entity}
        <div class="bg-gray-900 rounded-lg p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-lg">{entity.typeIcon}</span>
              <div>
                <div class="font-medium text-sm">{entity.name}</div>
                <div class="text-xs text-gray-400">
                  {entity.typeName}
                  <span class="ml-2 {confidenceColors[entity.confidence] ?? ''}">{entity.confidence} confidence</span>
                  {#if entity.noteTitle}
                    <span class="ml-2">from: {entity.noteTitle}</span>
                  {/if}
                </div>
              </div>
            </div>
            <div class="flex gap-2">
              <button
                onclick={() => reviewEntity(entity.id, 'accept')}
                class="text-xs text-emerald-400 hover:text-emerald-300 px-3 py-1 border border-emerald-800 rounded hover:bg-emerald-900/30"
              >Confirm</button>
              <button
                onclick={() => reviewEntity(entity.id, 'reject')}
                class="text-xs text-red-400 hover:text-red-300 px-3 py-1 border border-red-800 rounded hover:bg-red-900/30"
              >Reject</button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/intel/queries.ts src/routes/jkai/intel/review/ src/routes/api/jkai/intel/review/
git commit -m "feat(intel): add review queue page for entity confirmation"
```

---

### Task 4: Search Endpoint and Page

**Files:**
- Create: `src/routes/api/jkai/intel/search/+server.ts`
- Create: `src/routes/jkai/intel/search/+page.svelte`

- [ ] **Step 1: Create search API endpoint**

Create `src/routes/api/jkai/intel/search/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelNotes, intelEntities, intelEntityTypes } from '$lib/db/schema';
import { sql, isNull, or, ilike } from 'drizzle-orm';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();
  if (!q || q.length < 2) return json({ notes: [], entities: [] });

  const pattern = `%${q}%`;

  const [notes, entities] = await Promise.all([
    db
      .select({
        id: intelNotes.id,
        title: intelNotes.title,
        source: intelNotes.source,
        format: intelNotes.format,
        status: intelNotes.status,
        createdAt: intelNotes.createdAt,
        snippet: sql<string>`substring(${intelNotes.processedContent} from 1 for 200)`.as('snippet'),
      })
      .from(intelNotes)
      .where(
        or(
          ilike(intelNotes.title, pattern),
          ilike(intelNotes.rawContent, pattern),
          ilike(intelNotes.processedContent, pattern),
        ),
      )
      .orderBy(sql`${intelNotes.createdAt} DESC`)
      .limit(20),

    db
      .select({
        id: intelEntities.id,
        name: intelEntities.name,
        typeName: intelEntityTypes.name,
        typeIcon: intelEntityTypes.icon,
        summary: intelEntities.summary,
        confidence: intelEntities.confidence,
        confirmed: intelEntities.confirmed,
      })
      .from(intelEntities)
      .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
      .where(
        sql`${isNull(intelEntities.mergedIntoId)} AND (
          ${intelEntities.name} ILIKE ${pattern}
          OR ${intelEntities.summary} ILIKE ${pattern}
          OR ${intelEntities.properties}::text ILIKE ${pattern}
        )`,
      )
      .orderBy(sql`${intelEntities.updatedAt} DESC`)
      .limit(20),
  ]);

  return json({ notes, entities });
};
```

- [ ] **Step 2: Create search page**

Create `src/routes/jkai/intel/search/+page.svelte`:

```svelte
<script lang="ts">
  let query = $state('');
  let results = $state<{ notes: any[]; entities: any[] }>({ notes: [], entities: [] });
  let searching = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout>;

  const sourceIcon: Record<string, string> = {
    web: '🌐', whatsapp: '💬', pwa: '📱', email: '📧',
  };

  function onInput() {
    clearTimeout(debounceTimer);
    if (query.trim().length < 2) {
      results = { notes: [], entities: [] };
      return;
    }
    debounceTimer = setTimeout(search, 300);
  }

  async function search() {
    searching = true;
    try {
      const res = await fetch(`/api/jkai/intel/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        results = await res.json();
      }
    } finally {
      searching = false;
    }
  }
</script>

<div class="p-6 max-w-4xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300">&larr; Dashboard</a>
  <h1 class="text-2xl font-bold mt-2 mb-6">Search</h1>

  <input
    type="text"
    bind:value={query}
    oninput={onInput}
    placeholder="Search notes, entities, relationships..."
    class="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-sky-500 mb-6"
    autofocus
  />

  {#if searching}
    <div class="text-center py-8 text-gray-500">Searching...</div>
  {:else if query.length >= 2 && results.entities.length === 0 && results.notes.length === 0}
    <div class="text-center py-8 text-gray-500">No results found for "{query}"</div>
  {:else}
    <!-- Entities -->
    {#if results.entities.length > 0}
      <div class="mb-8">
        <h2 class="text-sm font-semibold text-emerald-400 mb-3">Entities ({results.entities.length})</h2>
        <div class="grid grid-cols-2 gap-2">
          {#each results.entities as entity}
            <a href="/jkai/intel/entities/{entity.id}" class="bg-gray-900 rounded-lg p-3 hover:bg-gray-800/80 transition">
              <div class="flex items-center gap-2 mb-1">
                <span>{entity.typeIcon}</span>
                <span class="font-medium text-sm">{entity.name}</span>
                <span class="text-xs text-gray-500">{entity.typeName}</span>
              </div>
              {#if entity.summary}
                <p class="text-xs text-gray-400 line-clamp-2">{entity.summary}</p>
              {/if}
            </a>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Notes -->
    {#if results.notes.length > 0}
      <div>
        <h2 class="text-sm font-semibold text-sky-400 mb-3">Notes ({results.notes.length})</h2>
        <div class="space-y-2">
          {#each results.notes as note}
            <a href="/jkai/intel/notes/{note.id}" class="block bg-gray-900 rounded-lg p-3 hover:bg-gray-800/80 transition">
              <div class="flex items-center gap-2 mb-1">
                <span>{sourceIcon[note.source] ?? '📝'}</span>
                <span class="font-medium text-sm">{note.title ?? 'Untitled'}</span>
              </div>
              {#if note.snippet}
                <p class="text-xs text-gray-400 line-clamp-2">{note.snippet}</p>
              {/if}
              <div class="text-xs text-gray-500 mt-1">{new Date(note.createdAt).toLocaleDateString()}</div>
            </a>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/jkai/intel/search/ src/routes/jkai/intel/search/
git commit -m "feat(intel): add search page and API endpoint"
```

---

### Task 5: Entity Summary Generation During Ingestion

**Files:**
- Modify: `src/lib/jkai/intel/graph.ts` (add summary update after entity upsert)

Currently entities are created without summaries. Add a rolling summary update that generates/updates entity summaries after new notes mention them.

- [ ] **Step 1: Add summary generation to graph.ts**

Add a function to `src/lib/jkai/intel/graph.ts` that generates an entity summary from its linked notes, and call it at the end of `persistExtraction`:

```typescript
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { intelNotes, intelNoteEntities } from '$lib/db/schema';

async function updateEntitySummaries(entityIds: string[]): Promise<void> {
  if (entityIds.length === 0) return;

  const modelCtx = await resolveDefaultModel('chat');
  const { client, model } = await getLLMClient(modelCtx);

  for (const entityId of entityIds) {
    try {
      // Get entity with its type
      const [entity] = await db
        .select({
          id: intelEntities.id,
          name: intelEntities.name,
          typeName: intelEntityTypes.name,
          properties: intelEntities.properties,
        })
        .from(intelEntities)
        .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
        .where(eq(intelEntities.id, entityId))
        .limit(1);

      if (!entity) continue;

      // Get note excerpts mentioning this entity
      const noteExcerpts = await db
        .select({
          content: sql<string>`substring(${intelNotes.processedContent} from 1 for 500)`,
          date: intelNotes.createdAt,
        })
        .from(intelNoteEntities)
        .innerJoin(intelNotes, eq(intelNoteEntities.noteId, intelNotes.id))
        .where(eq(intelNoteEntities.entityId, entityId))
        .orderBy(desc(intelNotes.createdAt))
        .limit(5);

      if (noteExcerpts.length === 0) continue;

      const excerptText = noteExcerpts
        .map((n, i) => `Note ${i + 1} (${new Date(n.date).toLocaleDateString()}):\n${n.content}`)
        .join('\n\n');

      const response = await client.chat.completions.create({
        model,
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content: 'Write a concise 2-3 sentence summary of this entity based on what is known from the notes. Focus on role, key relationships, and current concerns. Return only the summary text.',
          },
          {
            role: 'user',
            content: `Entity: ${entity.name} (${entity.typeName})\nProperties: ${JSON.stringify(entity.properties)}\n\nRelevant notes:\n${excerptText}`,
          },
        ],
      });

      const summary = response.choices[0]?.message?.content?.trim();
      if (summary) {
        await db
          .update(intelEntities)
          .set({ summary, updatedAt: new Date() })
          .where(eq(intelEntities.id, entityId));
      }
    } catch (err) {
      console.error(`[intel] Failed to update summary for entity ${entityId}:`, err);
    }
  }
}
```

Then at the end of `persistExtraction`, before the return statement, add:

```typescript
  // 6. Update summaries for affected entities (async, non-blocking)
  const entityIds = [...entityIdMap.values()];
  updateEntitySummaries(entityIds).catch((err) => {
    console.error('[intel] Summary update failed:', err);
  });
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/jkai/intel/graph.ts
git commit -m "feat(intel): add entity summary generation during ingestion"
```

---

### Task 6: Add Search Link to Dashboard

**Files:**
- Modify: `src/routes/jkai/intel/+page.svelte` (add search link/bar to dashboard header)

- [ ] **Step 1: Add search link to dashboard header**

In `src/routes/jkai/intel/+page.svelte`, modify the header div to include a search link between the title and the "+ New Note" button:

```svelte
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold">Intelligence Dashboard</h1>
    <div class="flex items-center gap-3">
      <a href="/jkai/intel/search" class="px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700 text-sm">
        Search
      </a>
      <a href="/jkai/intel/notes/new" class="px-4 py-2 bg-emerald-600 rounded-lg hover:bg-emerald-500 text-sm font-medium">
        + New Note
      </a>
    </div>
  </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/jkai/intel/+page.svelte
git commit -m "feat(intel): add search link to dashboard header"
```
