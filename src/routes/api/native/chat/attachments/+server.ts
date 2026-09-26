import { isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import {
  MEMBER_DAILY_UPLOADS,
  MEMBER_UPLOAD_KINDS,
  requireConversation,
  reserveUsage,
} from '$lib/jkai/chat-access.server';
import { storeChatUpload } from '$lib/jkai/media/upload';
import { recordPreanalysis } from '$lib/jkai/media/preanalyse';

/** Longest on-device transcript kept: a few minutes of speech, well inside a URL. */
const MAX_TRANSCRIPT_CHARS = 6000;

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
 *
 * A MEMBER uploads under the web's member rule: into a named thread of their
 * OWN (404 for one they cannot see, 403 for one they may only read), a kind to
 * read rather than run (`MEMBER_UPLOAD_KINDS`), stamped with their principal,
 * and metered against the same daily ledger as their browser.
 *
 * `transcript` (query) is a voice note already transcribed ON THE PHONE. It is
 * stored as the audio's pre-analysis, so the turn reads it instead of calling
 * a transcription model: the phone sends the words as the message, and the
 * audio rides along for playback and /drive. Ignored for anything not audio.
 */
export const POST: RequestHandler = withNativeAccess('jkai.chat', async (event, _identity, role) => {
  const { request, url } = event;
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
    let row;
    if (role === 'member') {
      if (!conversationId) return json({ error: 'Upload into a conversation.' }, { status: 400 });
      const { access } = await requireConversation(event, conversationId, 'post');
      await reserveUsage(access, 'upload', MEMBER_DAILY_UPLOADS, `That is ${MEMBER_DAILY_UPLOADS} files today — the limit.`);
      row = await storeChatUpload(file, conversationId, 'web', access.own, MEMBER_UPLOAD_KINDS);
    } else {
      row = await storeChatUpload(file, conversationId, 'web');
    }
    const transcript = (url.searchParams.get('transcript') ?? '').trim().slice(0, MAX_TRANSCRIPT_CHARS);
    if (transcript && row.kind === 'audio') {
      // Pointed at the message rather than repeated: the phone sends these
      // same words as the turn's text, and the model need read them once.
      await recordPreanalysis(
        row.id,
        `Transcribed on the iPhone; the words are this turn's message:\n${transcript}`,
      );
    }
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
