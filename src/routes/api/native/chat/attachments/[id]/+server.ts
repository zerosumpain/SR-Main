import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { readBuffer } from '$lib/jkai/media/storage';
import { withDevice } from '$lib/server/native-handler';

/**
 * GET /api/native/chat/attachments/:id — the bytes, so the phone can draw a
 * photo in the transcript instead of a paperclip and a filename.
 *
 * Read-only on purpose. The web route also DELETEs; nothing on the phone needs
 * to, and a destructive verb is not added to a token lane for symmetry.
 */
export const GET: RequestHandler = withDevice(async ({ params }) => {
  const [row] = await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.id, params.id)).limit(1);
  if (!row) return json({ error: 'No such attachment.' }, { status: 404 });
  let buf: Buffer;
  try {
    buf = await readBuffer(row.diskPath);
  } catch {
    return json({ error: 'That file is no longer on the server.' }, { status: 410 });
  }
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': row.mimeType,
      'Content-Length': String(row.sizeBytes),
      'Cache-Control': 'private, max-age=3600',
    },
  });
});
