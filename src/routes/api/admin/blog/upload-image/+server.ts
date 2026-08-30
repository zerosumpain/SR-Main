import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { saveBlogImage } from '$lib/blog/image-store';
import { recordUpload } from '$lib/blog/media.server';

// Two ceilings, not one. A 10MB cap is generous for a photograph and absurd for
// a clip — a 20-second screen capture clears it without trying — but raising
// the image cap to match would let a mis-picked RAW file through as "an image".
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 60 * 1024 * 1024; // 60MB
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
// mp4/webm only. The byte-serving route (/api/blog/images/[postId]/[filename])
// maps exactly these two extensions, so anything else would upload cleanly and
// then 404 on the way back out.
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

export const POST: RequestHandler = async ({ request }) => {
  const formData = await request.formData();
  const file = formData.get('file');
  const postId = formData.get('postId');

  if (!file || !(file instanceof File)) {
    return json({ error: 'No image file provided' }, { status: 400 });
  }
  const isVideo = VIDEO_TYPES.has(file.type);
  if (!IMAGE_TYPES.has(file.type) && !isVideo) {
    return json({ error: `Unsupported file type: ${file.type}` }, { status: 400 });
  }
  const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
  if (file.size > maxSize) {
    return json(
      { error: `File too large (max ${isVideo ? '60MB for video' : '10MB'})` },
      { status: 400 },
    );
  }

  const safePostId = String(postId ?? 'uncategorized').replace(/[^a-zA-Z0-9_-]/g, '_') || 'uncategorized';
  const ext = MIME_TO_EXT[file.type] ?? 'bin';
  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await saveBlogImage(safePostId, filename, buffer);

  const url = `/api/blog/images/${safePostId}/${filename}`;

  // Library bookkeeping, and it must NEVER fail the upload. The bytes are
  // already in the store and the editor is blocked on this response holding an
  // insertion point open; a 500 here would leave the author with no image and
  // an orphaned file, which is the worse of the two failures by a distance.
  //
  // Only numeric ids are recorded. `safePostId` is a sanitised STRING and is
  // legitimately 'uncategorized' while a post is still unsaved, but
  // blog_media.post_id is an integer FK onto blog_posts — so a non-numeric id
  // has no row to hang off, and a numeric id for a post that has since been
  // deleted raises a 23503. Both land in the catch rather than the response.
  if (/^\d+$/.test(safePostId)) {
    try {
      await recordUpload({
        postId: Number.parseInt(safePostId, 10),
        filename,
        url,
        mimeType: file.type,
        bytes: file.size,
      });
    } catch (err) {
      console.error('[blog upload] media library record failed for', url, err);
    }
  }

  return json({ url });
};
