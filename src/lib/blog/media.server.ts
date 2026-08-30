/**
 * The blog media library — the record of what has been uploaded against a post.
 *
 * WHY A TABLE AND NOT A DIRECTORY LISTING
 *
 * `$lib/blog/image-store` has TWO interchangeable backends behind one
 * interface: the filesystem under BLOG_IMAGE_ROOT, and Azure Blob whenever
 * AZURE_STORAGE_CONNECTION_STRING is set. NEITHER exposes a list primitive —
 * `saveBlogImage` / `readBlogImage` are the whole surface — so a gallery built
 * on `readdir` is really a gallery built on one of the two backends. It would
 * work on homeserv (fs) and come back empty in production (Azure).
 *
 * Worse than empty: the fs root is a SHARED namespace. The decks feature writes
 * video and image blocks into a reserved 'deck-media' bucket through the same
 * `saveBlogImage`, so a readdir-based listing is one wrong postId away from
 * showing another feature's assets inside the blog editor.
 *
 * A table answers both backends identically, and it is the only place alt text
 * and pixel dimensions can live at all — neither survives in a blob name, and
 * re-deriving them would mean downloading every asset on every panel open.
 *
 * The rows are a MIRROR of the store, not its index: nothing here deletes
 * bytes, and a missing row never makes an image stop serving. That asymmetry is
 * deliberate and is repeated at the delete site.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { blogMedia } from '$lib/db/schema';

/**
 * One library entry, shaped for the wire.
 *
 * `createdAt` is a string, not a Date: this type is consumed by the media panel
 * through `JSON.parse`, where a Date is already an ISO string. Typing it as a
 * Date would be a lie on the client half and would put a `new Date(...)` in
 * every consumer.
 */
// Declared in ./media so the picker component can import it without reaching
// into a *.server module. Re-exported for the callers already importing it here.
import { MAX_ALT_LENGTH, type MediaItem } from './media';
export type { MediaItem } from './media';

export { MAX_ALT_LENGTH } from './media';

/**
 * Record an upload. Idempotent on (postId, filename).
 *
 * The unique index `blog_media_post_filename_idx` makes a re-upload of the same
 * name a 23505, and the upload route calls this AFTER the bytes are already in
 * the store — so a plain INSERT would turn "you replaced an image" into a
 * failed upload with the replacement sitting on disk. ON CONFLICT DO UPDATE
 * makes the second write a replacement, which is what it is.
 */
export async function recordUpload(input: {
  postId: number;
  filename: string;
  url: string;
  mimeType: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
}): Promise<void> {
  await db
    .insert(blogMedia)
    .values({
      postId: input.postId,
      filename: input.filename,
      url: input.url,
      mimeType: input.mimeType,
      bytes: input.bytes,
      width: input.width ?? null,
      height: input.height ?? null,
    })
    .onConflictDoUpdate({
      target: [blogMedia.postId, blogMedia.filename],
      set: {
        url: sql`excluded.url`,
        mimeType: sql`excluded.mime_type`,
        bytes: sql`excluded.bytes`,
        // COALESCE, not `excluded.*`: the upload route does not decode images,
        // so it supplies NULL dimensions on every call. A straight
        // `excluded.width` would wipe dimensions a later backfill had measured,
        // every time the same filename was re-uploaded.
        width: sql`coalesce(excluded.width, ${blogMedia.width})`,
        height: sql`coalesce(excluded.height, ${blogMedia.height})`,
        // altText is deliberately absent. Replacing the bytes behind a filename
        // does not replace the author's description of them, and re-typing alt
        // text is exactly the friction that keeps coverage low.
      },
    });
}

/** Newest first — the thing you just uploaded is the thing you want to insert. */
export async function listMedia(postId: number): Promise<MediaItem[]> {
  const rows = await db
    .select()
    .from(blogMedia)
    .where(eq(blogMedia.postId, postId))
    .orderBy(desc(blogMedia.createdAt), desc(blogMedia.id));

  return rows.map((r) => ({
    id: r.id,
    postId: r.postId,
    filename: r.filename,
    url: r.url,
    mimeType: r.mimeType,
    bytes: r.bytes,
    width: r.width,
    height: r.height,
    altText: r.altText,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Set (or clear) the alt text for one asset.
 *
 * An empty or whitespace-only value stores NULL rather than ''. Coverage is
 * counted elsewhere as a publish-gate check, and a column that can be absent in
 * two different ways is a column that gets counted wrong in one of them.
 */
export async function setMediaAlt(postId: number, filename: string, altText: string): Promise<void> {
  const trimmed = altText.trim().slice(0, MAX_ALT_LENGTH);
  await db
    .update(blogMedia)
    .set({ altText: trimmed.length > 0 ? trimmed : null })
    .where(and(eq(blogMedia.postId, postId), eq(blogMedia.filename, filename)));
}

/**
 * Forget an asset. The BYTES ARE LEFT ALONE — see the delete handler in
 * routes/api/admin/blog/media for why that is the whole point.
 */
export async function deleteMediaRecord(postId: number, filename: string): Promise<void> {
  await db
    .delete(blogMedia)
    .where(and(eq(blogMedia.postId, postId), eq(blogMedia.filename, filename)));
}
