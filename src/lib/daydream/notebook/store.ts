// src/lib/daydream/notebook/store.ts
//
// Reading and writing the notebook.
//
// The one rule the whole module exists to hold: **`body` is John's, and nothing
// but an owner edit ever writes to it.** The model's contribution goes to
// `supporting`, which is a separate column, separately stamped and separately
// clearable. `appendSupporting` is therefore the only write the review path can
// reach, and it cannot touch the body even by accident.

import { and, asc, desc, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '$lib/db';
import { daydreamNotebook, daydreamNotebookActions, daydreamNotebookAudio } from '$lib/db/schema';

/** Long enough for a blog draft, short enough that one note is one idea. */
export const MAX_BODY = 40_000;
export const MAX_TITLE = 200;
export const MAX_FOLDER = 80;

export interface NoteRow {
  id: string;
  title: string;
  body: string;
  folder: string;
  tags: string[];
  status: string;
  pinned: boolean;
  supporting: string | null;
  supportingAt: string | null;
  reviewedAt: string | null;
  reviewCount: number;
  intelNoteId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteActionRow {
  id: string;
  noteId: string;
  kind: string;
  title: string;
  status: string;
  error: string | null;
  result: string | null;
  refKind: string | null;
  refId: string | null;
  plannedAt: string;
  executedAt: string | null;
}

/**
 * The text the review reads, hashed.
 *
 * Title AND body, because renaming a note changes what it is about. An
 * unchanged note is not re-reviewed — the cap is small and re-reading yesterday
 * spends it on nothing.
 */
export function noteHash(title: string, body: string): string {
  return createHash('sha256').update(`${title}\n\n${body}`).digest('hex').slice(0, 32);
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toRow(r: typeof daydreamNotebook.$inferSelect): NoteRow {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    folder: r.folder,
    tags: (r.tags ?? []) as string[],
    status: r.status,
    pinned: r.pinned,
    supporting: r.supporting,
    supportingAt: iso(r.supportingAt),
    reviewedAt: iso(r.reviewedAt),
    reviewCount: r.reviewCount,
    intelNoteId: r.intelNoteId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Every note, newest first, pinned to the top. Archived only on request. */
export async function listNotes(opts: { includeArchived?: boolean } = {}): Promise<NoteRow[]> {
  const rows = await db
    .select()
    .from(daydreamNotebook)
    .where(opts.includeArchived ? sql`true` : eq(daydreamNotebook.status, 'active'))
    .orderBy(desc(daydreamNotebook.pinned), desc(daydreamNotebook.updatedAt))
    .limit(500);
  return rows.map(toRow);
}

export async function getNote(id: string): Promise<NoteRow | null> {
  const [r] = await db.select().from(daydreamNotebook).where(eq(daydreamNotebook.id, id)).limit(1);
  return r ? toRow(r) : null;
}

/** The folders in use. No table, no management screen — see the schema note. */
export async function listFolders(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ folder: daydreamNotebook.folder })
    .from(daydreamNotebook)
    .where(and(ne(daydreamNotebook.folder, ''), eq(daydreamNotebook.status, 'active')))
    .orderBy(asc(daydreamNotebook.folder));
  return rows.map((r) => r.folder);
}

export interface SaveInput {
  id?: string;
  title?: string;
  body?: string;
  folder?: string;
  tags?: string[];
  pinned?: boolean;
  status?: string;
}

/**
 * Create or update a note.
 *
 * An empty title is allowed and normal — you open a box and start typing, and
 * demanding a title first is exactly the friction that stops a note being made.
 * The list falls back to the first line of the body.
 */
export async function saveNote(input: SaveInput): Promise<NoteRow> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title.slice(0, MAX_TITLE);
  if (input.body !== undefined) patch.body = input.body.slice(0, MAX_BODY);
  if (input.folder !== undefined) patch.folder = input.folder.trim().slice(0, MAX_FOLDER);
  if (input.tags !== undefined) {
    patch.tags = input.tags.map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12);
  }
  if (input.pinned !== undefined) patch.pinned = input.pinned;
  if (input.status !== undefined) patch.status = input.status === 'archived' ? 'archived' : 'active';

  if (input.id) {
    const [r] = await db
      .update(daydreamNotebook)
      .set(patch)
      .where(eq(daydreamNotebook.id, input.id))
      .returning();
    if (!r) throw new Error(`no such note: ${input.id}`);
    return toRow(r);
  }
  const [r] = await db.insert(daydreamNotebook).values(patch as never).returning();
  return toRow(r);
}

/**
 * Delete a note, and report the audio files it orphaned.
 *
 * The FK cascade removes the recording ROWS; the bytes behind them live in the
 * media store and have to be unlinked by the caller. They are returned rather
 * than deleted here so this module keeps its `$lib/db`-only dependency —
 * `$lib/jkai/media/storage` is the route's business, not the store's.
 */
export async function deleteNote(id: string): Promise<{ orphanedDiskPaths: string[] }> {
  const rows = await db
    .select({ diskPath: daydreamNotebookAudio.diskPath })
    .from(daydreamNotebookAudio)
    .where(eq(daydreamNotebookAudio.noteId, id));
  // Actions cascade — the FK says so, and a note's action list has no meaning
  // without the note. So do recordings.
  await db.delete(daydreamNotebook).where(eq(daydreamNotebook.id, id));
  return { orphanedDiskPaths: rows.map((r) => r.diskPath) };
}

export interface RecordingRow {
  id: string;
  noteId: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  transcript: string | null;
  language: string | null;
  engine: string | null;
  createdAt: string;
}

/** Never includes `diskPath` — the browser addresses a recording by id, and the
 *  storage key is not something a page has any use for. */
function toRecording(r: typeof daydreamNotebookAudio.$inferSelect): RecordingRow {
  return {
    id: r.id,
    noteId: r.noteId,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    durationSec: r.durationSec ?? null,
    transcript: r.transcript ?? null,
    language: r.language ?? null,
    engine: r.engine ?? null,
    createdAt: (r.createdAt as Date).toISOString(),
  };
}

export async function listRecordings(noteId: string): Promise<RecordingRow[]> {
  const rows = await db
    .select()
    .from(daydreamNotebookAudio)
    .where(eq(daydreamNotebookAudio.noteId, noteId))
    .orderBy(asc(daydreamNotebookAudio.createdAt));
  return rows.map(toRecording);
}

export async function addRecording(input: {
  noteId: string;
  mimeType: string;
  sizeBytes: number;
  diskPath: string;
  durationSec?: number | null;
  transcript?: string | null;
  language?: string | null;
  engine?: string | null;
}): Promise<RecordingRow> {
  const [row] = await db
    .insert(daydreamNotebookAudio)
    .values({
      noteId: input.noteId,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      diskPath: input.diskPath,
      durationSec: input.durationSec ?? null,
      transcript: input.transcript ?? null,
      language: input.language ?? null,
      engine: input.engine ?? null,
    })
    .returning();
  return toRecording(row);
}

/** The row plus its storage key — for the two callers that must reach the
 *  bytes: serving playback, and deleting one. */
export async function getRecordingWithPath(
  id: string,
): Promise<{ recording: RecordingRow; diskPath: string } | null> {
  const [row] = await db
    .select()
    .from(daydreamNotebookAudio)
    .where(eq(daydreamNotebookAudio.id, id))
    .limit(1);
  return row ? { recording: toRecording(row), diskPath: row.diskPath } : null;
}

export async function deleteRecording(id: string): Promise<void> {
  await db.delete(daydreamNotebookAudio).where(eq(daydreamNotebookAudio.id, id));
}

/**
 * Append a transcript to the note's BODY.
 *
 * This is the one write outside `saveNote` that touches `body`, and it does not
 * break the module's rule: a transcript is the owner's own words, arriving
 * through a microphone instead of a keyboard. That is why it bumps `updatedAt`
 * — unlike `appendSupporting`, this IS an owner edit, and the review should see
 * a changed note afterwards.
 *
 * Nothing the model produced ever reaches here; `supporting` is still the only
 * door the review path has.
 */
export async function appendTranscriptToBody(id: string, text: string): Promise<NoteRow | null> {
  const clean = text.trim();
  if (!clean) return getNote(id);
  const [row] = await db
    .update(daydreamNotebook)
    .set({
      // Clamped to the same ceiling `saveNote` applies, so a long dictation
      // cannot walk the body past a limit every other write respects.
      body: sql`left(case
        when ${daydreamNotebook.body} is null or ${daydreamNotebook.body} = ''
        then ${clean}
        else ${daydreamNotebook.body} || E'\n\n' || ${clean}
      end, ${MAX_BODY})`,
      updatedAt: new Date(),
    })
    .where(eq(daydreamNotebook.id, id))
    .returning();
  return row ? toRow(row) : null;
}

/**
 * Append supporting information, attributed and separate.
 *
 * The ONLY write the review path can reach. It cannot touch `body`, which is
 * the point: if this whole path failed permanently, every note would still read
 * exactly as typed.
 */
export async function appendSupporting(id: string, text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  await db
    .update(daydreamNotebook)
    .set({
      supporting: sql`case
        when ${daydreamNotebook.supporting} is null or ${daydreamNotebook.supporting} = ''
        then ${clean}
        else ${daydreamNotebook.supporting} || E'\n\n' || ${clean}
      end`,
      supportingAt: new Date(),
      // Deliberately NOT updatedAt: the model adding context is not the owner
      // editing the note, and letting it bump the timestamp would reorder his
      // list under him and re-trigger the review on its own output.
    })
    .where(eq(daydreamNotebook.id, id));
}

export async function clearSupporting(id: string): Promise<void> {
  await db
    .update(daydreamNotebook)
    .set({ supporting: null, supportingAt: null })
    .where(eq(daydreamNotebook.id, id));
}

/**
 * Notes worth reviewing: active, long enough to be about something, and either
 * never reviewed or changed since the last one.
 *
 * `reviewedHash` rather than a timestamp comparison, because `updatedAt` moves
 * on a pin or a folder change — neither of which alters what the note SAYS, and
 * neither of which is worth a model call.
 *
 * The hash is compared in JS, NOT in SQL. The obvious `digest(...)` version
 * needs `pgcrypto`, and this database has only `pg_trgm`, `plpgsql` and
 * `vector` — it would have thrown at runtime on the first idle tick and nowhere
 * earlier. A notebook is hundreds of rows, so the candidate scan is cheap; the
 * `status`/`reviewedAt` index still does the narrowing.
 */
export async function notesNeedingReview(limit: number): Promise<NoteRow[]> {
  const rows = await db
    .select()
    .from(daydreamNotebook)
    .where(
      and(
        eq(daydreamNotebook.status, 'active'),
        sql`length(${daydreamNotebook.body}) >= 40`,
      ),
    )
    .orderBy(asc(daydreamNotebook.reviewedAt), asc(daydreamNotebook.createdAt))
    .limit(Math.max(limit * 20, 100));

  const stale = rows.filter(
    (r) => r.reviewedAt == null || r.reviewedHash !== noteHash(r.title, r.body),
  );
  return stale.slice(0, limit).map(toRow);
}

export async function markReviewed(id: string, title: string, body: string): Promise<void> {
  await db
    .update(daydreamNotebook)
    .set({
      reviewedAt: new Date(),
      reviewedHash: noteHash(title, body),
      reviewCount: sql`${daydreamNotebook.reviewCount} + 1`,
    })
    .where(eq(daydreamNotebook.id, id));
}

// ── Actions ────────────────────────────────────────────────────────────────

export async function listActions(noteId: string): Promise<NoteActionRow[]> {
  const rows = await db
    .select()
    .from(daydreamNotebookActions)
    .where(eq(daydreamNotebookActions.noteId, noteId))
    .orderBy(desc(daydreamNotebookActions.plannedAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    noteId: r.noteId,
    kind: r.kind,
    title: r.title,
    status: r.status,
    error: r.error,
    result: r.result,
    refKind: r.refKind,
    refId: r.refId,
    plannedAt: r.plannedAt.toISOString(),
    executedAt: iso(r.executedAt),
  }));
}

export async function recordPlanned(
  noteId: string,
  kind: string,
  title: string,
  params: Record<string, unknown>,
): Promise<string> {
  const [r] = await db
    .insert(daydreamNotebookActions)
    .values({ noteId, kind, title, params })
    .returning({ id: daydreamNotebookActions.id });
  return r.id;
}

/** A plan the validator would not accept. Recorded rather than dropped: a
 *  vocabulary the model keeps reaching past is a thing worth being able to see. */
export async function recordRefused(
  noteId: string,
  kind: string,
  title: string,
  error: string,
): Promise<void> {
  await db.insert(daydreamNotebookActions).values({
    noteId,
    kind: kind.slice(0, 40) || 'unknown',
    title: title.slice(0, 120) || '(no title)',
    status: 'refused',
    error: error.slice(0, 300),
  });
}

export async function recordExecuted(
  actionId: string,
  outcome: { ok: boolean; result: string; refKind?: string; refId?: string },
): Promise<void> {
  await db
    .update(daydreamNotebookActions)
    .set({
      status: outcome.ok ? 'done' : 'failed',
      result: outcome.ok ? outcome.result.slice(0, 2_000) : null,
      error: outcome.ok ? null : outcome.result.slice(0, 300),
      refKind: outcome.refKind ?? null,
      refId: outcome.refId ?? null,
      executedAt: new Date(),
    })
    .where(eq(daydreamNotebookActions.id, actionId));
}

/** Recent finished actions across every note, for the pack and the page. */
export async function recentActions(limit = 20) {
  return db
    .select({
      id: daydreamNotebookActions.id,
      noteId: daydreamNotebookActions.noteId,
      kind: daydreamNotebookActions.kind,
      title: daydreamNotebookActions.title,
      result: daydreamNotebookActions.result,
      refKind: daydreamNotebookActions.refKind,
      refId: daydreamNotebookActions.refId,
      executedAt: daydreamNotebookActions.executedAt,
      noteTitle: daydreamNotebook.title,
    })
    .from(daydreamNotebookActions)
    .innerJoin(daydreamNotebook, eq(daydreamNotebook.id, daydreamNotebookActions.noteId))
    .where(eq(daydreamNotebookActions.status, 'done'))
    .orderBy(desc(daydreamNotebookActions.executedAt))
    .limit(limit);
}

/**
 * Notes not yet in the graph, or whose content has moved since they were.
 *
 * "Content" is BOTH halves. `updatedAt` covers John editing the note, and
 * `supportingAt` covers the model appending background — and the second one is
 * easy to miss, because `appendSupporting` deliberately does NOT bump
 * `updatedAt` (that would reorder his list under him and re-trigger the review
 * on its own output). Without the second clause a note woven once would never
 * be re-woven no matter how much context was added to it, and the supporting
 * block is often exactly where the third organisation gets named.
 */
export async function notesNeedingWeave(limit: number): Promise<NoteRow[]> {
  const rows = await db
    .select()
    .from(daydreamNotebook)
    .where(
      and(
        eq(daydreamNotebook.status, 'active'),
        sql`length(${daydreamNotebook.body}) >= 200`,
        or(
          isNull(daydreamNotebook.intelWovenAt),
          lt(daydreamNotebook.intelWovenAt, daydreamNotebook.updatedAt),
          sql`${daydreamNotebook.supportingAt} > ${daydreamNotebook.intelWovenAt}`,
        ),
      ),
    )
    .orderBy(asc(daydreamNotebook.intelWovenAt))
    .limit(limit);
  return rows.map(toRow);
}

export async function markWoven(id: string, intelNoteId: string): Promise<void> {
  await db
    .update(daydreamNotebook)
    .set({ intelNoteId, intelWovenAt: new Date() })
    .where(eq(daydreamNotebook.id, id));
}
