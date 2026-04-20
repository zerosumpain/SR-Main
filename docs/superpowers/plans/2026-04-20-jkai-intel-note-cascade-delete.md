# jkai intel — cascading note deletion: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a note is deleted, also delete the intelligence that came only from that note: relationships sourced from the note and entities that have no other backing notes.

**Architecture:** A new `deleteNoteCascade(noteId)` helper in `src/lib/jkai/intel/ingest.ts` wraps the whole operation in a single `db.transaction`. It collects orphan entity IDs first, deletes relationships sourced from the note, deletes the note (existing FK rules cascade the join/timeline/alert rows), then deletes the orphan entities (whose cascading FKs on `intel_relationships` clean up any remaining relationships those entities were in). The existing `DELETE /api/jkai/intel/notes/[id]` endpoint calls the helper and returns counts. The note detail page gains a delete button that confirms and redirects.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), Drizzle ORM (Postgres), Vitest.

**Spec:** `docs/superpowers/specs/2026-04-20-jkai-intel-note-cascade-delete-design.md`

---

## File Structure

| File | Role |
|------|------|
| `src/lib/jkai/intel/ingest.ts` (modify) | Add exported `deleteNoteCascade(noteId)` helper next to `createNote` / `processNote`. |
| `src/routes/api/jkai/intel/notes/[id]/+server.ts` (modify) | Replace inline `db.delete(...)` in the `DELETE` handler with a call to `deleteNoteCascade` and return counts. |
| `src/routes/jkai/intel/notes/[id]/+page.svelte` (modify) | Add delete button with `confirm()`, fetch, inline error, redirect. |
| `tests/lib/jkai/intel/cascade-delete.test.ts` (create) | Vitest unit test mocking `$lib/db` to verify the query sequence. |

---

## Task 1: Cascade helper — failing test

**Files:**
- Create: `tests/lib/jkai/intel/cascade-delete.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/jkai/intel/cascade-delete.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Call = { op: string; table: string };
const calls: Call[] = [];

// Fake tx:
// - The 1st select().from().where(...) returns `candidates` — entities
//   linked to this note.
// - The 2nd select().from().where(...) returns `linkedElsewhere` — same
//   entities linked to *other* notes. Anything in `candidates` but NOT in
//   `linkedElsewhere` is an orphan.
// - delete().where(...) records the table touched and returns `{ rowCount: 1 }`.
function makeTx(candidates: string[], linkedElsewhere: string[]) {
  const selectResults = [
    candidates.map((id) => ({ entityId: id })),
    linkedElsewhere.map((id) => ({ entityId: id })),
  ];
  let selectIndex = 0;
  return {
    select: () => ({
      from: (_table: unknown) => ({
        where: async (_cond: unknown) => selectResults[selectIndex++] ?? [],
      }),
    }),
    delete: (table: { _name?: string }) => ({
      where: async (_cond: unknown) => {
        calls.push({ op: 'delete', table: table._name ?? 'unknown' });
        return { rowCount: 1 };
      },
    }),
  };
}

vi.mock('$lib/db/schema', () => ({
  intelNotes: { _name: 'intel_notes' },
  intelEntities: { _name: 'intel_entities' },
  intelRelationships: { _name: 'intel_relationships' },
  intelNoteEntities: { _name: 'intel_note_entities' },
}));

// Default mock: 2 candidates, 0 linked elsewhere → both are orphans.
vi.mock('$lib/db', () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeTx(['orphan-1', 'orphan-2'], [])),
  },
}));

beforeEach(() => {
  calls.length = 0;
  vi.resetModules();
});

describe('deleteNoteCascade', () => {
  it('deletes relationships, then the note, then orphan entities — in that order', async () => {
    vi.doMock('$lib/db', () => ({
      db: {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
          cb(makeTx(['orphan-1', 'orphan-2'], [])),
      },
    }));
    const { deleteNoteCascade } = await import('$lib/jkai/intel/ingest');
    const result = await deleteNoteCascade('note-abc');

    expect(calls.map((c) => c.table)).toEqual([
      'intel_relationships',
      'intel_notes',
      'intel_entities',
    ]);
    expect(result).toEqual({
      deleted: true,
      removedRelationships: 1,
      removedEntities: 2,
    });
  });

  it('reports zero orphans when every candidate is linked to another note', async () => {
    vi.doMock('$lib/db', () => ({
      db: {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
          cb(makeTx(['shared-1', 'shared-2'], ['shared-1', 'shared-2'])),
      },
    }));
    const { deleteNoteCascade } = await import('$lib/jkai/intel/ingest');
    const result = await deleteNoteCascade('note-xyz');
    expect(result.removedEntities).toBe(0);
    // Only relationships + note got deleted; no orphan-entity delete was issued.
    expect(calls.map((c) => c.table)).toEqual(['intel_relationships', 'intel_notes']);
  });

  it('reports zero orphans when the note had no entities at all', async () => {
    vi.doMock('$lib/db', () => ({
      db: {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
          cb(makeTx([], [])),
      },
    }));
    const { deleteNoteCascade } = await import('$lib/jkai/intel/ingest');
    const result = await deleteNoteCascade('note-empty');
    expect(result.removedEntities).toBe(0);
    expect(calls.map((c) => c.table)).toEqual(['intel_relationships', 'intel_notes']);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd ~/strange_rambling_svelte
npx vitest run tests/lib/jkai/intel/cascade-delete.test.ts
```

Expected: FAIL — `deleteNoteCascade` is not exported from `ingest.ts`.

---

## Task 2: Cascade helper — implementation

**Files:**
- Modify: `src/lib/jkai/intel/ingest.ts`

- [ ] **Step 1: Extend the imports at the top of `ingest.ts`**

The current imports are:

```ts
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { extractFromNote } from './extract';
import { persistExtraction } from './graph';
import { ocrHandwriting, transcribeAudio, parseEmail } from './preprocess';
import { embedNote } from './embed';
import { recallAndAlert } from './recall';
import { pushHighAlerts } from './notify';
import type { JkaiAttachment } from '$lib/db/schema';
```

Change them to:

```ts
import { db } from '$lib/db';
import {
  intelNotes,
  intelEntities,
  intelRelationships,
  intelNoteEntities,
} from '$lib/db/schema';
import { eq, ne, and, inArray } from 'drizzle-orm';
import { extractFromNote } from './extract';
import { persistExtraction } from './graph';
import { ocrHandwriting, transcribeAudio, parseEmail } from './preprocess';
import { embedNote } from './embed';
import { recallAndAlert } from './recall';
import { pushHighAlerts } from './notify';
import type { JkaiAttachment } from '$lib/db/schema';
```

New pieces: `intelEntities`, `intelRelationships`, `intelNoteEntities`, `ne`, `and`, `inArray`.

- [ ] **Step 2: Append the `deleteNoteCascade` helper at the end of `ingest.ts`**

Append (do not overwrite anything that's already there):

```ts
export interface CascadeDeleteResult {
  deleted: true;
  removedRelationships: number;
  removedEntities: number;
}

/**
 * Delete a note and every piece of intelligence that was sourced only from it.
 *
 * - Relationships with source_note_id = noteId are deleted.
 * - Entities whose only intel_note_entities link was this note are deleted.
 * - Entities referenced by other notes survive; seed/manual entities with no
 *   note links are unaffected.
 *
 * Runs inside a single transaction. Returns counts for logging / UI use.
 */
export async function deleteNoteCascade(noteId: string): Promise<CascadeDeleteResult> {
  return await db.transaction(async (tx) => {
    // A. Find entities linked to this note.
    const linkedHere = await tx
      .select({ entityId: intelNoteEntities.entityId })
      .from(intelNoteEntities)
      .where(eq(intelNoteEntities.noteId, noteId));
    const candidateIds = [...new Set(linkedHere.map((r) => r.entityId))];

    // B. Of those, find which are linked to a DIFFERENT note. Anything not
    // in that set is orphaned by this deletion.
    let orphanIds: string[] = candidateIds;
    if (candidateIds.length > 0) {
      const linkedElsewhere = await tx
        .select({ entityId: intelNoteEntities.entityId })
        .from(intelNoteEntities)
        .where(
          and(
            inArray(intelNoteEntities.entityId, candidateIds),
            ne(intelNoteEntities.noteId, noteId),
          ),
        );
      const elsewhereSet = new Set(linkedElsewhere.map((r) => r.entityId));
      orphanIds = candidateIds.filter((id) => !elsewhereSet.has(id));
    }

    // C. Delete relationships sourced from this note. Must happen BEFORE the
    // note delete — otherwise the FK rule sets source_note_id = null first
    // and we lose the link that tells us which relationships to remove.
    const relResult = await tx
      .delete(intelRelationships)
      .where(eq(intelRelationships.sourceNoteId, noteId));

    // D. Delete the note. FK cascades handle:
    //    - intel_note_entities rows for this note
    //    - intel_timeline_events rows for this note
    //    - intel_alerts rows for this note
    await tx.delete(intelNotes).where(eq(intelNotes.id, noteId));

    // E. Delete orphan entities. FK cascades on intel_relationships
    // (source_entity_id / target_entity_id) remove any surviving
    // relationships that those entities were part of.
    if (orphanIds.length > 0) {
      await tx.delete(intelEntities).where(inArray(intelEntities.id, orphanIds));
    }

    const rowCount = (relResult as { rowCount?: number | null }).rowCount;
    return {
      deleted: true,
      removedRelationships: typeof rowCount === 'number' ? rowCount : 0,
      removedEntities: orphanIds.length,
    };
  });
}
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd ~/strange_rambling_svelte
npx vitest run tests/lib/jkai/intel/cascade-delete.test.ts
```

Expected: PASS, both cases.

If the first case reports `removedRelationships: 0` instead of `1`, the fake tx's `delete(...).where(...)` isn't returning the `{ rowCount: 1 }` shape the helper expects — check Task 1 Step 1's `makeTx` and confirm it was pasted exactly.

- [ ] **Step 4: Typecheck**

```bash
cd ~/strange_rambling_svelte
npm run check
```

Expected: no new errors attributable to these changes. Pre-existing warnings/errors unrelated to this file are acceptable but note them.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/jkai/intel/ingest.ts tests/lib/jkai/intel/cascade-delete.test.ts
git commit -m "feat(intel): add deleteNoteCascade helper with unit tests"
```

---

## Task 3: Wire the DELETE endpoint to the cascade

**Files:**
- Modify: `src/routes/api/jkai/intel/notes/[id]/+server.ts`

- [ ] **Step 1: Replace the DELETE handler**

Current file ends with:

```ts
export const DELETE: RequestHandler = async ({ params }) => {
  await db.delete(intelNotes).where(eq(intelNotes.id, params.id));
  return json({ deleted: true });
};
```

Change the imports and the handler so the file reads:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getNoteDetail } from '$lib/jkai/intel/queries';
import { processNote, deleteNoteCascade } from '$lib/jkai/intel/ingest';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const detail = await getNoteDetail(params.id);
  if (!detail) return json({ error: 'Not found' }, { status: 404 });
  return json(detail);
};

export const POST: RequestHandler = async ({ params }) => {
  const [note] = await db
    .select({ id: intelNotes.id, status: intelNotes.status })
    .from(intelNotes)
    .where(eq(intelNotes.id, params.id))
    .limit(1);

  if (!note) return json({ error: 'Not found' }, { status: 404 });

  processNote(params.id).catch((err) => {
    console.error(`[intel] Retry processing failed for note ${params.id}:`, err);
  });

  return json({ id: params.id, status: 'processing' });
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    const result = await deleteNoteCascade(params.id);
    return json(result);
  } catch (err) {
    console.error(`[intel] Cascade delete failed for note ${params.id}:`, err);
    return json({ error: 'Delete failed' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck**

```bash
cd ~/strange_rambling_svelte
npm run check
```

Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/jkai/intel/notes/[id]/+server.ts
git commit -m "feat(intel): cascade note delete through the API endpoint"
```

---

## Task 4: Delete button in the note detail UI

**Files:**
- Modify: `src/routes/jkai/intel/notes/[id]/+page.svelte`

- [ ] **Step 1: Add state, import `goto`, add the handler**

At the top of the `<script lang="ts">` block (after the existing `import PageHeader ...`), add:

```ts
  import { goto } from '$app/navigation';
```

Add new `$state` declarations after the existing `retrying` line:

```ts
  let deleting = $state(false);
  let deleteError = $state<string | null>(null);
```

Add the delete handler after the existing `retryProcessing` function:

```ts
  async function deleteNote() {
    const ok = confirm(
      'Delete this note? Any entities and relationships that came only from this note will also be removed.',
    );
    if (!ok) return;

    deleting = true;
    deleteError = null;
    try {
      const res = await fetch(`/api/jkai/intel/notes/${data.note.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      await goto('/jkai/intel/notes');
    } catch (err) {
      deleteError = err instanceof Error ? err.message : 'Delete failed';
      deleting = false;
    }
  }
```

- [ ] **Step 2: Add the button and error display**

Find the header row:

```svelte
  <div class="flex items-start justify-between mb-4">
    <h2 class="text-xl font-bold">{data.note.title ?? 'Untitled Note'}</h2>
    <div class="flex items-center gap-2">
      {#if noteStatus === 'failed' || noteStatus === 'pending'}
        <button
          onclick={retryProcessing}
          disabled={retrying}
          class="px-3 py-1 rounded text-xs border transition-colors hover:opacity-80"
          style="background: var(--accent); color: white; border-color: var(--accent);"
        >{retrying ? 'Retrying...' : 'Retry'}</button>
      {/if}
      <span class="px-2 py-1 rounded text-xs border" style="{badge.bg} {badge.text} border-color: var(--card-border);">{noteStatus}</span>
    </div>
  </div>
```

Add the delete button inside the inner `<div class="flex items-center gap-2">` so it sits at the end (after the status badge). The full replacement block:

```svelte
  <div class="flex items-start justify-between mb-4">
    <h2 class="text-xl font-bold">{data.note.title ?? 'Untitled Note'}</h2>
    <div class="flex items-center gap-2">
      {#if noteStatus === 'failed' || noteStatus === 'pending'}
        <button
          onclick={retryProcessing}
          disabled={retrying}
          class="px-3 py-1 rounded text-xs border transition-colors hover:opacity-80"
          style="background: var(--accent); color: white; border-color: var(--accent);"
        >{retrying ? 'Retrying...' : 'Retry'}</button>
      {/if}
      <span class="px-2 py-1 rounded text-xs border" style="{badge.bg} {badge.text} border-color: var(--card-border);">{noteStatus}</span>
      <button
        onclick={deleteNote}
        disabled={deleting}
        class="px-3 py-1 rounded text-xs border transition-colors hover:bg-red-50 hover:text-red-600 hover:border-red-300"
        style="background: transparent; color: var(--text-secondary); border-color: var(--card-border);"
        aria-label="Delete note"
      >{deleting ? 'Deleting...' : 'Delete'}</button>
    </div>
  </div>
  {#if deleteError}
    <div class="mb-4 text-sm" style="color: #dc2626;">{deleteError}</div>
  {/if}
```

- [ ] **Step 3: Typecheck**

```bash
cd ~/strange_rambling_svelte
npm run check
```

Expected: no new errors from this file.

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/jkai/intel/notes/[id]/+page.svelte
git commit -m "feat(intel): add delete button to note detail page"
```

---

## Task 5: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
cd ~/strange_rambling_svelte
npm run dev
```

Server should come up on `http://homeserv:5173` (or whatever port vite picks — check console output).

- [ ] **Step 2: Create a disposable test note**

From the browser, visit `/jkai/intel/notes/new`, paste content mentioning a few names/places, submit, and wait for status to become `processed`. Note the note's id from the URL.

- [ ] **Step 3: Record baseline entity / relationship counts**

In a separate terminal, open pgweb (`http://homeserv:8085/pgweb/`) or run psql directly:

```sql
SELECT count(*) FROM intel_entities;
SELECT count(*) FROM intel_relationships;
SELECT count(*) FROM intel_note_entities WHERE note_id = '<note-id>';
```

Record the numbers.

- [ ] **Step 4: Delete the note via the UI**

Open the note's detail page. Click **Delete**. Confirm the native dialog. Expect to land back on `/jkai/intel/notes` without the deleted note listed.

- [ ] **Step 5: Verify cascade in the database**

```sql
SELECT count(*) FROM intel_entities;        -- should drop by the # of entities unique to the deleted note
SELECT count(*) FROM intel_relationships;   -- should drop by the # of relationships sourced from the deleted note
SELECT * FROM intel_notes WHERE id = '<note-id>';  -- should be empty
SELECT * FROM intel_note_entities WHERE note_id = '<note-id>';  -- should be empty
SELECT * FROM intel_timeline_events WHERE note_id = '<note-id>';  -- should be empty
SELECT * FROM intel_alerts WHERE note_id = '<note-id>';  -- should be empty
```

Entities mentioned in the deleted note AND in other notes must still exist.

- [ ] **Step 6: Check server logs**

The endpoint shouldn't have logged `[intel] Cascade delete failed ...`. If it did, investigate before claiming completion.

---

## Self-review notes (incorporated)

- **Spec coverage:** Every goal in the spec maps to a task — cascade (Task 2), endpoint wiring (Task 3), UI (Task 4), test (Task 1), manual verification (Task 5). Non-goals are not included.
- **Types / names:** `deleteNoteCascade`, `CascadeDeleteResult`, `removedRelationships`, `removedEntities` consistent across tasks.
- **Transaction-safety:** Steps C (relationships) → D (note) → E (orphan entities) are ordered deliberately inside the transaction; the plan calls out why.
- **Drift risk:** The `rowCount` field on a Drizzle/node-postgres delete result is the count of rows affected; if the runtime's pg driver returns `undefined` here, `removedRelationships` falls back to 0. Acceptable for the v1 response shape — logs still carry the real story.
