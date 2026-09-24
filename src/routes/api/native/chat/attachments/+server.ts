import { isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { storeChatUpload } from '$lib/jkai/media/upload';

/**
 * POST /api/native/chat/attachments — a photo or a document from the phone.
 *
 * The same upload as `/api/jkai/attachments`, through the same checks, and the
 * row it returns is what the phone then names in `attachmentIds` on the chat
 * turn. A separate FILE only because identity arrives as a device token, and
 * the web route sits behind the session gate a phone never passes.
 *
 * Two differences, both deliberate:
 * - `source` is always `web`. `generated` is the agent's label for its own
 *   output; a phone claiming it would be a user upload wearing the wrong badge.
 * - A refusal comes back as `{ error }` with its status. `withDevice` would
 *   flatten a thrown 413 into "Something went wrong", and "too large" is the
 *   one thing the phone can actually act on.
 */
export const POST: RequestHandler = withDevice(async ({ request }) => {
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: 'Send the file as multipart form data.' }, { status: 400 });
  const conversationId = form.get('conversationId');

  try {
    const row = await storeChatUpload(
      form.get('file'),
      typeof conversationId === 'string' ? conversationId : null,
      'web',
    );
    // The transcript's attachment shape, not the table's: the phone decodes
    // this with the same type as an attachment on a loaded message.
    return json({
      id: row.id,
      filename: row.originalName,
      kind: row.kind,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
    }, { status: 201 });
  } catch (err) {
    if (isHttpError(err)) return json({ error: err.body.message }, { status: err.status });
    throw err;
  }
});
