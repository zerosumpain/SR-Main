import { json, type RequestHandler } from '@sveltejs/kit';
import { stopInteractiveSession } from '$lib/workflows/scraper/interactive';

export const DELETE: RequestHandler = async ({ params }) => {
  await stopInteractiveSession(params.id!);
  return json({ ok: true });
};
