import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearHistory } from '$lib/blog/assistant/messages';

export const POST: RequestHandler = async ({ params }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) throw error(400, 'invalid id');
  await clearHistory(postId);
  return json({ ok: true });
};
