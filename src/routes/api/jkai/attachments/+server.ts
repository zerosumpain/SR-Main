import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { storeChatUpload } from '$lib/jkai/media/upload';

const ALLOWED_SOURCES = new Set(['web', 'generated']);

export const POST: RequestHandler = async ({ request }) => {
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

  return json(await storeChatUpload(form.get('file'), conversationId, source));
};
