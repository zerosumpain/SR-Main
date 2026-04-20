# jkai intel — cascading note deletion

**Date:** 2026-04-20

## Problem

Deleting an intel note currently leaves behind intelligence extracted from that note:

- `intel_relationships.source_note_id` is set to null by the FK, so the relationship survives as an orphaned claim with no traceable source.
- `intel_entities.first_seen_in` is set to null; if the deleted note was the entity's *only* link via `intel_note_entities`, the entity persists with no notes referencing it.

The user wants a true cascade: deleting a note removes everything the note contributed, while preserving anything still supported by other notes.

## Goals

1. Deleting a note removes relationships sourced from that note.
2. Deleting a note removes any entity whose only backing `intel_note_entities` link was that note.
3. Entities referenced by other notes survive.
4. Manually-created or seed entities with no note links are not deleted.
5. Provide a delete button in the note detail UI so the cascade is reachable.

## Non-goals

- Regenerating surviving entities' summaries post-delete. Summaries may be mildly stale; they refresh naturally when new notes mention the entity.
- Recomputing `first_seen_in` to the oldest remaining note. The FK null is acceptable.
- Per-row delete on the notes list page. Single entry point reduces accidental deletions.
- A toast/notification system on the detail page. Redirect to the notes list is sufficient feedback.

## Design

### Existing FK behaviour (unchanged)

On `DELETE FROM intel_notes WHERE id = $id`:

- `intel_note_entities` rows for this note → cascade deleted
- `intel_timeline_events` rows for this note → cascade deleted
- `intel_alerts` rows for this note → cascade deleted
- `intel_entities.first_seen_in` → set null (entity survives)
- `intel_relationships.source_note_id` → set null (relationship survives)

### Server cascade

Endpoint: `DELETE /api/jkai/intel/notes/[id]` (same path; expanded behaviour). All steps inside a single DB transaction.

1. **Collect orphan-entity IDs** — entities linked only to this note:
   ```sql
   SELECT DISTINCT entity_id FROM intel_note_entities
   WHERE note_id = $id
     AND entity_id NOT IN (
       SELECT entity_id FROM intel_note_entities WHERE note_id <> $id
     )
   ```
2. **Delete relationships sourced from this note** —
   `DELETE FROM intel_relationships WHERE source_note_id = $id`.
   Done *before* the note delete, otherwise the FK nulls `source_note_id` first and we lose the reference.
3. **Delete the note** — `DELETE FROM intel_notes WHERE id = $id`.
   Cascades `intel_note_entities`, `intel_timeline_events`, `intel_alerts`.
4. **Delete the orphan entities** — `DELETE FROM intel_entities WHERE id IN (...)`.
   Cascades any remaining relationships in which those entities participated (covers the case where another note's relationship still pointed at a now-orphaned entity).

### Response shape

Extended from `{ deleted: true }`:

```json
{
  "deleted": true,
  "removedRelationships": 3,
  "removedEntities": 2
}
```

Returning counts is cheap and useful for logs / future UI affordances. The UI ignores them in this iteration.

### Edge cases

| Case | Outcome |
|------|---------|
| Entity linked to this note and another note | Survives (not orphaned) |
| Entity only linked to this note | Deleted |
| Relationship sourced from this note, both endpoints survive | Deleted in step 2 |
| Relationship between an orphaned entity and a surviving one | Deleted via step 4 (FK cascade on `source_entity_id`/`target_entity_id`) |
| Manually created / seed entity with zero note links | Unaffected — never appears in the orphan query |
| Note already deleted (race / double-click) | `DELETE` is idempotent; returns `{ deleted: true, removedRelationships: 0, removedEntities: 0 }` |

### UI

**File:** `src/routes/jkai/intel/notes/[id]/+page.svelte`

- Add a **Delete** button to the header row, positioned after the status badge.
- Subdued destructive styling: transparent background, red border/text on hover, not a solid red fill.
- Click → native `confirm()`:
  > *"Delete this note? Any entities and relationships that came only from this note will also be removed."*
- On confirm:
  - Disable the button, show "Deleting…"
  - `fetch(\`/api/jkai/intel/notes/${id}\`, { method: 'DELETE' })`
  - Success → `goto('/jkai/intel/notes')`
  - Failure → re-enable the button and render an inline error message under the header

No changes to the notes list page.

### Testing

Integration test in `tests/lib/jkai/intel/` (or a new `tests/routes/api/jkai/intel/` if the project convention puts API tests there). Scenario:

1. Seed two notes: note A mentions entity X and entity Y; note B mentions entity X and entity Z.
2. Seed relationships: X–Y sourced from note A; X–Z sourced from note B.
3. `DELETE` note A.
4. Assert:
   - Entity X survives (still linked to note B).
   - Entity Y is deleted (only linked to note A).
   - Entity Z survives (only linked to note B, which was not deleted).
   - Relationship X–Y is gone.
   - Relationship X–Z survives.
   - Response body reports `removedEntities: 1`, `removedRelationships: 1`.

## Files touched

- `src/routes/api/jkai/intel/notes/[id]/+server.ts` — rewrite the `DELETE` handler with the transaction.
- `src/routes/jkai/intel/notes/[id]/+page.svelte` — add delete button, confirm, fetch, redirect.
- `tests/lib/jkai/intel/cascade-delete.test.ts` (new) — integration test.

## Open questions

None.
