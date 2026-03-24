import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Old login endpoint — no longer used. Auth is now handled by Auth.js.
export const POST: RequestHandler = async () => {
  return json({ error: 'This login endpoint is deprecated. Use /auth/signin instead.' }, { status: 410 });
};
