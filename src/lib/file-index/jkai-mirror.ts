// Mirror a file the user added in the /jkai chat (attachment button or drag-drop)
// into the /drive file store under a `jkai/` folder, then embed it into the
// global @files index. This keeps jkai chat uploads discoverable in /drive and
// searchable via @files — even though jkai attachments live in a separate media
// store (jkaiAttachments) from Drive files (workflow_files).
//
// Best-effort: any failure here must NOT break the chat attachment upload, so
// the caller ignores the return value on error.

import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { workflowFiles, conversations, jkaiAttachments } from '$lib/db/schema';
import { isPlaceholderTitle } from '$lib/jkai/thread-title';
import { newDiskPath, saveBuffer } from '$lib/file-store/storage';
import { reindexFileInBackground } from './store';

const JKAI_FOLDER = 'jkai/';

/** Best-effort extension from a MIME type, for naming attachments that lack a filename. */
function extFromMime(mime: string): string {
  const m = (mime || '').toLowerCase();
  const map: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
    'image/heic': '.heic', 'image/heif': '.heif',
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
    'audio/ogg': '.ogg', 'audio/webm': '.weba', 'audio/mp4': '.m4a', 'audio/aac': '.aac',
    'audio/flac': '.flac',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'application/pdf': '.pdf', 'application/json': '.json',
    'text/plain': '.txt', 'text/markdown': '.md', 'text/csv': '.csv',
  };
  return map[m] || '';
}

function sanitizeBase(name: string): string {
  // Strip any path separators (Drive uses `name` as a virtual path; the folder is
  // prepended explicitly) and control chars.
  return name.replace(/[\/\\\0]/g, '_').replace(/^\.+/, '').trim().slice(0, 160);
}

function splitExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return { stem: name.slice(0, dot), ext: name.slice(dot) };
  return { stem: name, ext: '' };
}

/** A conversation title reduced to one safe Drive folder segment. Drive folders
 *  are virtual — derived from `/` in `workflow_files.name` — so a title
 *  containing a slash would silently invent a nesting level. */
function folderSegment(title: string): string {
  return title
    .replace(/[\/\\\0]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60)
    .trim();
}

/**
 * Which folder a chat upload belongs in: `jkai/<chat title>/`, falling back to
 * `jkai/<YYYY-MM>/` when the conversation has no title yet.
 *
 * The fallback matters — a title is generated from the first exchange, so a file
 * dropped into a brand-new chat arrives before there is anything to name the
 * folder after. Dating those keeps them findable instead of piling up in an
 * "untitled" bucket.
 */
export async function jkaiDriveFolder(conversationId: string | null | undefined): Promise<string> {
  if (conversationId) {
    try {
      const [conv] = await db
        .select({ title: conversations.title })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);
      // "New thread" is what the iPhone app names every thread it opens. As a
      // folder it put every photo from the app in one pile.
      const seg = isPlaceholderTitle(conv?.title) ? '' : folderSegment(conv?.title ?? '');
      if (seg) return `${JKAI_FOLDER}${seg}/`;
    } catch (err) {
      // A lookup failure must not cost the mirror — fall through to the date.
      console.warn(`[file-index] jkai folder lookup failed: ${(err as Error).message}`);
    }
  }
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${JKAI_FOLDER}${month}/`;
}

/**
 * Copy an in-memory attachment into /drive under jkai/<name> and queue embedding.
 * Returns the new Drive file id, or null on any failure (non-fatal).
 */
export async function mirrorJkaiAttachmentToDrive(opts: {
  buf: Buffer;
  originalName: string | null | undefined;
  mimeType: string;
  /** Groups the file under that chat's folder in /drive. */
  conversationId?: string | null;
  /** How the file got into the chat. `generated` files (agent screenshots,
   *  write_document output) are mirrored too, so /drive holds everything the
   *  conversation touched rather than only the half the user typed. */
  source?: 'web' | 'generated';
  uploadedBy?: string | null;
  /** The chat's own row for this file, stamped with where the copy went. */
  attachmentId?: string | null;
}): Promise<string | null> {
  try {
    const folder = await jkaiDriveFolder(opts.conversationId);
    const raw = opts.originalName ? sanitizeBase(opts.originalName) : '';
    const base = raw || `attachment-${randomUUID().slice(0, 8)}${extFromMime(opts.mimeType)}`;

    let name = `${folder}${base}`.slice(0, 200);
    const [clash] = await db
      .select({ id: workflowFiles.id })
      .from(workflowFiles)
      .where(eq(workflowFiles.name, name))
      .limit(1);
    if (clash) {
      const { stem, ext } = splitExt(base);
      name = `${folder}${stem}-${randomUUID().slice(0, 8)}${ext}`.slice(0, 200);
    }

    const diskPath = newDiskPath(name);
    await saveBuffer(diskPath, opts.buf);

    const [row] = await db
      .insert(workflowFiles)
      .values({
        name,
        description: opts.source === 'generated' ? 'Produced by jkai chat' : 'Added from jkai chat',
        mimeType: opts.mimeType || 'application/octet-stream',
        sizeBytes: opts.buf.byteLength,
        diskPath,
        permissions: { read: true, write: false, append: false, delete: true },
        uploadedBy: opts.uploadedBy ?? null,
      })
      .returning({ id: workflowFiles.id });

    if (row) reindexFileInBackground(row.id);
    if (row && opts.attachmentId) await stampDriveLink(opts.attachmentId, row.id, name);
    return row?.id ?? null;
  } catch (err) {
    console.warn(`[file-index] jkai attachment mirror failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Record on the chat's attachment row which /drive file is its copy.
 *
 * Without it the two stores only shared a filename: nothing could move a
 * thread's files when it got a title, and the model could not be told where
 * the original of the photo it is looking at lives. Merged into `metadata` in
 * SQL, because pre-analysis writes the same column (`$lib/jkai/media/preanalyse`).
 */
async function stampDriveLink(attachmentId: string, driveFileId: string, drivePath: string): Promise<void> {
  const patch = JSON.stringify({ driveFileId, drivePath });
  await db
    .update(jkaiAttachments)
    .set({ metadata: sql`coalesce(${jkaiAttachments.metadata}, '{}'::jsonb) || ${patch}::jsonb` })
    .where(eq(jkaiAttachments.id, attachmentId));
}

/** A folder a file lands in before its thread has a name. */
function isFallbackFolder(path: string): boolean {
  const rest = path.slice(JKAI_FOLDER.length);
  const folder = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : '';
  return path.startsWith(JKAI_FOLDER) && (folder === '' || /^\d{4}-\d{2}$/.test(folder) || isPlaceholderTitle(folder));
}

/**
 * Move a thread's files into `jkai/<title>/` once the thread has a title.
 *
 * A file is uploaded before the message it belongs to is sent, and the title
 * is written from that first message, so the first files in every thread were
 * filed under the month (or, from the phone, under "New thread") and stayed
 * there. Called when a title is written. Only files still in a fallback folder
 * move: one the owner has already filed somewhere else in /drive stays put.
 *
 * Best-effort, like the mirror: a failure leaves the file where it was.
 */
export async function refileConversationFiles(conversationId: string): Promise<number> {
  try {
    const folder = await jkaiDriveFolder(conversationId);
    if (isFallbackFolder(folder)) return 0;

    const atts = await db
      .select({ id: jkaiAttachments.id, metadata: jkaiAttachments.metadata })
      .from(jkaiAttachments)
      .where(and(eq(jkaiAttachments.conversationId, conversationId), isNotNull(jkaiAttachments.metadata)));
    const byFile = new Map<string, string>();
    for (const a of atts) {
      const id = (a.metadata as { driveFileId?: unknown } | null)?.driveFileId;
      if (typeof id === 'string') byFile.set(id, a.id);
    }
    if (byFile.size === 0) return 0;

    const files = await db
      .select({ id: workflowFiles.id, name: workflowFiles.name })
      .from(workflowFiles)
      .where(inArray(workflowFiles.id, [...byFile.keys()]));

    let moved = 0;
    for (const f of files) {
      if (!isFallbackFolder(f.name)) continue;
      const base = f.name.slice(f.name.lastIndexOf('/') + 1);
      let name = `${folder}${base}`.slice(0, 200);
      const [clash] = await db
        .select({ id: workflowFiles.id })
        .from(workflowFiles)
        .where(eq(workflowFiles.name, name))
        .limit(1);
      if (clash) {
        const { stem, ext } = splitExt(base);
        name = `${folder}${stem}-${randomUUID().slice(0, 8)}${ext}`.slice(0, 200);
      }
      // `name` is only the /drive path; the bytes stay where `diskPath` says.
      // `updated_at` is left alone, as /drive's own move does: a move is not
      // an edit, and "last added" sorts on it.
      await db.update(workflowFiles).set({ name }).where(eq(workflowFiles.id, f.id));
      await stampDriveLink(byFile.get(f.id)!, f.id, name);
      moved++;
    }
    return moved;
  } catch (err) {
    console.warn(`[file-index] jkai refile failed for ${conversationId}: ${(err as Error).message}`);
    return 0;
  }
}
