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
export const POST: RequestHandler = withDevice(async ({ request, url }) => {
  // The file IS the body, not a multipart form, and that is not a style
  // choice. SvelteKit refuses any form-encoded POST whose `Origin` header does
  // not match the site ("Cross-site POST form submissions are forbidden", 403)
  // before a handler runs. A browser always sends one; a phone sends none. So
  // the first cut of this route, multipart like the web one, 403'd every upload
  // from the app, and its unit tests, which call the handler directly, could
  // not see the layer that refused it. A raw body is not a form, so the check
  // does not apply, and the bearer token is what makes a cross-site forgery
  // impossible here anyway.
  const buf = await request.arrayBuffer().catch(() => null);
  if (!buf || buf.byteLength === 0) return json({ error: 'The upload was empty.' }, { status: 400 });
  const filename = url.searchParams.get('filename') || 'upload';
  const conversationId = url.searchParams.get('conversationId');
  const file = new File([buf], filename, {
    type: request.headers.get('content-type') ?? 'application/octet-stream',
  });

  try {
    const row = await storeChatUpload(file, conversationId, 'web');
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
