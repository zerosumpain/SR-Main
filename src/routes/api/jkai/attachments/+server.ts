import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { storeChatUpload } from '$lib/jkai/media/upload';
import { chatAccess, requireConversation } from '$lib/jkai/chat-access.server';

const ALLOWED_SOURCES = new Set(['web', 'generated']);

export const POST: RequestHandler = async (event) => {
  const { request } = event;
  const access = await chatAccess(event);
  const form = await request.formData();
  const conversationId = form.get('conversationId') as string | null;
  const sourceField = (form.get('source') as string | null) || 'web';
  // An agent uploads produced screenshots / image-gen output with
  // `source=generated` so the chat UI can label them and rate-limits in
  // `$lib/jkai/media/rate-limits` keep tracking them. Anything else falls back
  // to `web` (the original user-upload semantics).
  const source: 'web' | 'generated' = ALLOWED_SOURCES.has(sourceField)
    ? (sourceField as 'web' | 'generated')
    : 'web';

  // A member uploads into their OWN thread only (404 for one they cannot read,
  // 403 for one they can but may not post in), and the row is stamped theirs.
  // The owner's path is unchanged: an upload may name a thread before it lands.
  if (access.level !== 'owner' && conversationId) await requireConversation(event, conversationId, 'post');

  return json(await storeChatUpload(form.get('file'), conversationId, source, access.own));
};
