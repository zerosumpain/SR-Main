import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { jkaiAttachments, workflowFiles } from '$lib/db/schema';
import { jkaiDriveFolder, mirrorJkaiAttachmentToDrive } from '$lib/file-index/jkai-mirror';
import { isPlaceholderTitle } from '$lib/jkai/thread-title';
import { isMemberThread } from '$lib/jkai/owner-threads';

/**
 * The link between a chat attachment and its copy in /drive.
 *
 * Every upload is mirrored into /drive by `$lib/file-index/jkai-mirror`, but
 * the two stores only ever shared a filename: nothing could move a thread's
 * files once it was titled, and the model could not be told where the original
 * of the photo it is looking at lives. This records the link on the
 * attachment (`metadata.driveFileId` / `drivePath`) and keeps it true.
 *
 * Kept out of `jkai-mirror.ts` on purpose: that file is duplicated in SR-Drive
 * and hash-guarded (`tests/scripts/shared-with-extracted.test.ts`), and none of
 * this is Drive's business. It is the chat's record of where its files went.
 */

const JKAI_FOLDER = 'jkai/';

/** Mirror one upload into /drive, then stamp the attachment with where it went. */
export async function mirrorAndLink(
  opts: Parameters<typeof mirrorJkaiAttachmentToDrive>[0] & { attachmentId: string },
): Promise<string | null> {
  const { attachmentId, ...mirror } = opts;
  // /drive is the owner's: a member's file (or one in a member's thread) is
  // never mirrored into it. The upload path already skips this for members;
  // this is the belt to that brace.
  try {
    const [att] = await db
      .select({ principalId: jkaiAttachments.principalId })
      .from(jkaiAttachments)
      .where(eq(jkaiAttachments.id, attachmentId))
      .limit(1);
    if (att && att.principalId !== 'owner') return null;
    if (await isMemberThread(mirror.conversationId)) return null;
  } catch (err) {
    console.warn(`[drive-link] owner check failed for ${attachmentId}: ${(err as Error).message}`);
    return null;
  }
  const fileId = await mirrorJkaiAttachmentToDrive(mirror);
  if (!fileId) return null;
  try {
    const [file] = await db
      .select({ name: workflowFiles.name })
      .from(workflowFiles)
      .where(and(eq(workflowFiles.principalId, 'owner'), eq(workflowFiles.id, fileId)))
      .limit(1);
    if (file) await stampDriveLink(attachmentId, fileId, file.name);
  } catch (err) {
    // The copy is in /drive either way; only the link is missing.
    console.warn(`[drive-link] could not link ${attachmentId} to ${fileId}: ${(err as Error).message}`);
  }
  return fileId;
}

/**
 * Merged into `metadata` in SQL, because pre-analysis caches its description in
 * the same column (`$lib/jkai/media/preanalyse`) and either write can land first.
 */
async function stampDriveLink(attachmentId: string, driveFileId: string, drivePath: string): Promise<void> {
  const patch = JSON.stringify({ driveFileId, drivePath });
  await db
    .update(jkaiAttachments)
    .set({ metadata: sql`coalesce(${jkaiAttachments.metadata}, '{}'::jsonb) || ${patch}::jsonb` })
    .where(eq(jkaiAttachments.id, attachmentId));
}

/**
 * A folder a chat file lands in before its thread has a name: the month
 * (`jkai/2026-09/`), the bare `jkai/` of older mirrors, or "New thread".
 */
export function isFallbackPath(path: string): boolean {
  if (!path.startsWith(JKAI_FOLDER)) return false;
  const rest = path.slice(JKAI_FOLDER.length);
  const slash = rest.indexOf('/');
  if (slash === -1) return true;
  const folder = rest.slice(0, slash);
  return /^\d{4}-\d{2}$/.test(folder) || isPlaceholderTitle(folder);
}

function splitExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return { stem: name.slice(0, dot), ext: name.slice(dot) };
  return { stem: name, ext: '' };
}

/**
 * Move a thread's files into `jkai/<title>/` once the thread has a title.
 *
 * A file is uploaded before the message it belongs to is sent, and the title is
 * written from that first message, so the first files in every thread were
 * filed under the month and stayed there. Called when a title is written. Only
 * files still in a fallback folder move: one the owner has already filed
 * somewhere else in /drive stays put.
 *
 * Best-effort, like the mirror: a file that cannot move stays where it was.
 */
export async function refileConversationFiles(conversationId: string): Promise<number> {
  let folder: string;
  let atts: Array<{ id: string; metadata: unknown }>;
  try {
    // Only the owner's threads have files in /drive to move.
    if (await isMemberThread(conversationId)) return 0;
    folder = await jkaiDriveFolder(conversationId);
    // Still untitled (or titled like a month): nowhere better to put them.
    if (isFallbackPath(`${folder}x`)) return 0;
    atts = await db
      .select({ id: jkaiAttachments.id, metadata: jkaiAttachments.metadata })
      .from(jkaiAttachments)
      .where(and(eq(jkaiAttachments.conversationId, conversationId), isNotNull(jkaiAttachments.metadata)));
  } catch (err) {
    console.warn(`[drive-link] refile lookup failed for ${conversationId}: ${(err as Error).message}`);
    return 0;
  }

  const byFile = new Map<string, string>();
  for (const a of atts) {
    const id = (a.metadata as { driveFileId?: unknown } | null)?.driveFileId;
    if (typeof id === 'string') byFile.set(id, a.id);
  }
  if (byFile.size === 0) return 0;

  const files = await db
    .select({ id: workflowFiles.id, name: workflowFiles.name })
    .from(workflowFiles)
    // Owner files only: a member's live under members/<id>/ (see
    // $lib/drive/namespace) and are never an owner thread's to refile.
    .where(and(eq(workflowFiles.principalId, 'owner'), inArray(workflowFiles.id, [...byFile.keys()])))
    .catch(() => [] as Array<{ id: string; name: string }>);

  let moved = 0;
  for (const f of files) {
    if (!isFallbackPath(f.name)) continue;
    const base = f.name.slice(f.name.lastIndexOf('/') + 1);
    try {
      let name = `${folder}${base}`.slice(0, 200);
      // Every principal's names: the unique index on `name` is global. (A
      // jkai/ name can never be a member's, which live under members/.)
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
      // `updated_at` is left alone, as /drive's own move does: a move is not an
      // edit, and "last added" sorts on it.
      await db
        .update(workflowFiles)
        .set({ name })
        .where(and(eq(workflowFiles.principalId, 'owner'), eq(workflowFiles.id, f.id)));
      await stampDriveLink(byFile.get(f.id)!, f.id, name);
      moved++;
    } catch (err) {
      // One file losing a race for its name must not strand the rest.
      console.warn(`[drive-link] could not refile ${f.id}: ${(err as Error).message}`);
    }
  }
  return moved;
}
