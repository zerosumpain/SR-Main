import { json, type RequestHandler } from '@sveltejs/kit';
import { startInteractiveSession, listInteractiveSessions } from '$lib/workflows/scraper/interactive';

export const GET: RequestHandler = async () => {
  return json(listInteractiveSessions());
};

export const POST: RequestHandler = async ({ request }) => {
  const { profile, url } = await request.json();
  if (!profile || !url) return json({ error: 'profile and url required' }, { status: 400 });
  try {
    const result = await startInteractiveSession(profile, url);
    return json(result);
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, { status: 500 });
  }
};
