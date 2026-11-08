// A capture's audio and screenshot, in the chat media store.
//
// The same store, the same sniff and the same `jkai_attachments` row as a chat
// upload (`$lib/jkai/media/upload`), so the bytes live where every other phone
// file lives and are read back the same way. Two differences, both deliberate:
// - no /drive mirror. A recording of other people is not a document to browse,
//   and deleting a capture must remove the only copy (PLAN: "audio is not
//   mirrored into /drive").
// - the caps are the capture's own (60 MB audio, 8 MB screenshot), checked
//   here, against the sniffed kind rather than the content-type the phone sent.

import { eq, inArray } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { deleteByDiskPath, readBuffer, saveBuffer } from '$lib/jkai/media/storage';
import { extensionForMime, isAllowedMime, kindFromMime } from '$lib/jkai/media/mime';
import { canonicalMime } from '$lib/jkai/media/upload';
import { MAX_AUDIO_BYTES, MAX_SCREEN_BYTES } from './types';

export type CaptureMediaKind = 'audio' | 'image';

export class CaptureMediaError extends Error {
  constructor(public status: 400 | 413 | 415, message: string) {
    super(message);
  }
}

/** `jkai_attachments.source` for capture media: never a chat upload, never `generated`. */
export const CAPTURE_MEDIA_SOURCE = 'capture';

export async function storeCaptureMedia(
  buf: Buffer,
  declaredType: string | null,
  want: CaptureMediaKind,
  /** `jkai_attachments.principal_id`: 'owner' for the owner, as every owner upload. */
  principalId: string,
  captureId: string,
): Promise<{ id: string; mimeType: string; sizeBytes: number; diskPath: string }> {
  if (buf.byteLength === 0) throw new CaptureMediaError(400, 'The upload was empty.');
  const cap = want === 'audio' ? MAX_AUDIO_BYTES : MAX_SCREEN_BYTES;
  if (buf.byteLength > cap) throw new CaptureMediaError(413, `That is larger than the ${Math.round(cap / 1024 / 1024)} MB limit.`);
  const sniffed = (await fileTypeFromBuffer(buf))?.mime;
  const mime = canonicalMime((sniffed ?? declaredType ?? 'application/octet-stream').split(';', 1)[0].trim());
  if (!isAllowedMime(mime) || kindFromMime(mime) !== want) {
    throw new CaptureMediaError(415, want === 'audio' ? 'That is not an audio file.' : 'That is not an image.');
  }
  const { diskPath, sizeBytes } = await saveBuffer(buf, extensionForMime(mime));
  try {
    const [row] = await db
      .insert(jkaiAttachments)
      .values({
        conversationId: null,
        messageId: null,
        source: CAPTURE_MEDIA_SOURCE,
        kind: want,
        mimeType: mime,
        originalName: `${captureId}-${want === 'audio' ? 'audio' : 'screen'}.${extensionForMime(mime).replace(/^\./, '')}`,
        sizeBytes,
        diskPath,
        duration: null,
        metadata: { captureId },
        principalId,
      })
      .returning({ id: jkaiAttachments.id });
    return { id: row.id, mimeType: mime, sizeBytes, diskPath };
  } catch (err) {
    await deleteByDiskPath(diskPath).catch(() => {});
    throw err;
  }
}

export async function readCaptureMedia(uploadId: string): Promise<{ buf: Buffer; mimeType: string; sizeBytes: number } | null> {
  const [row] = await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.id, uploadId)).limit(1);
  if (!row || row.source !== CAPTURE_MEDIA_SOURCE) return null;
  const buf = await readBuffer(row.diskPath);
  return { buf, mimeType: row.mimeType, sizeBytes: row.sizeBytes };
}

/**
 * Remove the rows and the bytes. Best-effort per file: a blob that is already
 * gone is not a reason to keep the row, and one that will not delete is
 * reported rather than failing the capture's deletion.
 */
export async function deleteCaptureMedia(uploadIds: Array<string | null | undefined>): Promise<{ removed: number; failed: number }> {
  const ids = uploadIds.filter((x): x is string => !!x);
  if (!ids.length) return { removed: 0, failed: 0 };
  const rows = await db
    .delete(jkaiAttachments)
    .where(inArray(jkaiAttachments.id, ids))
    .returning({ diskPath: jkaiAttachments.diskPath });
  let failed = 0;
  for (const r of rows) {
    try {
      await deleteByDiskPath(r.diskPath);
    } catch (err) {
      failed++;
      console.warn('[captures] media file not removed:', err instanceof Error ? err.message : err);
    }
  }
  return { removed: rows.length - failed, failed };
}
