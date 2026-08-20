// Mirror a file the user added in the /jkai chat (attachment button or drag-drop)
// into the /drive file store under a `jkai/` folder, then embed it into the
// global @files index. This keeps jkai chat uploads discoverable in /drive and
// searchable via @files — even though jkai attachments live in a separate media
// store (jkaiAttachments) from Drive files (workflow_files).
//
// Best-effort: any failure here must NOT break the chat attachment upload, so
// the caller ignores the return value on error.

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { workflowFiles, conversations } from '$lib/db/schema';
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
      const seg = folderSegment(conv?.title ?? '');
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
    return row?.id ?? null;
  } catch (err) {
    console.warn(`[file-index] jkai attachment mirror failed: ${(err as Error).message}`);
    return null;
  }
}
