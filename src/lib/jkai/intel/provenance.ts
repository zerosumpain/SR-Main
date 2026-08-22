// Where an entity came from, and what has updated it since.
//
// Three surfaces answer that question — the hover card, the entity
// drillthrough and the entities index — and they have to answer it the same
// way, so the two rules that are easy to get subtly wrong live here rather
// than being re-derived per call site.

import { sql, type SQL } from 'drizzle-orm';

/**
 * URLs that name a section rather than an item. Following one lands you in a
 * browser with no idea which document was meant.
 */
const ROOT_ONLY_URLS = new Set(['/drive', '/jkai', '/', '/deepdive']);

/**
 * Where a note came from, as something clickable.
 *
 * Measured coverage of `intel_notes.metadata` on 2026-08-05, and the cases are
 * genuinely different — a `sourceUrl` is not by itself a usable link:
 *
 *   email    (1,038)  a real Gmail permalink to the thread. Use it.
 *   research (17)     `/deepdive/<id>`. Use it.
 *   file     (38)     the bare string `/drive` — the ROOT, with no file id, and
 *                     `/drive` has no deep-link parameter. Following it lands
 *                     you in a file browser with no idea which document was
 *                     meant, so the note's own page, which quotes the extracted
 *                     content, is more use.
 *   chat     (192)    `refId` only, and there is no route that opens a thread by
 *                     id. Same fallback.
 *   web      (2)      neither. Same fallback.
 *
 * The rule is therefore "link out only where the URL identifies the actual
 * item". A plausible-looking link that lands somewhere useless is worse than an
 * honest one to the note.
 */
export function sourceHref(noteId: string, metadata: unknown): string {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const url = meta.sourceUrl == null ? '' : String(meta.sourceUrl).trim();
  if (url && !ROOT_ONLY_URLS.has(url.replace(/\/+$/, '') || '/')) return url;
  return `/jkai/intel/notes/${noteId}`;
}

/**
 * True when `sourceHref` reached the item itself rather than falling back to
 * the extracted note. Surfaces say which they are giving you: "the email" and
 * "what we extracted from the email" are different promises.
 */
export function linksToItem(href: string): boolean {
  return !href.startsWith('/jkai/intel/notes/');
}

/**
 * When a note's contents were OBSERVED, given its `observed_at` and `id` columns.
 *
 * `created_at` is the ingest clock and is useless for ordering provenance:
 * every email note lands on the day its sweep ran, so on 2026-08-05 all 1,038
 * of them shared a single day while the mail they describe spanned twelve
 * weeks. Anything ordering or dating evidence has to read this instead, or an
 * eleven-week-old thread outranks last week's because March happened to be
 * swept later.
 *
 * Two sources, in order, because neither covers everything:
 *   1. `observed_at` on the note — set by the ingest that knows the real time.
 *   2. the newest `last_seen_at` across the edges the note produced — written
 *      from that same value (graph.ts passes one `observedAt` to both), so this
 *      is a fallback for notes ingested before the column existed, not a second
 *      disagreeing definition.
 * Null where a note has neither; callers COALESCE to `created_at` and say so.
 */
export function observedAtSql(observedAt: SQL | unknown, noteId: SQL | unknown): SQL<Date | null> {
  return sql<Date | null>`COALESCE(
    ${observedAt},
    (SELECT MAX(r.last_seen_at) FROM intel_relationships r
      WHERE r.source_note_id = ${noteId} AND r.suppressed IS NOT TRUE)
  )`;
}
