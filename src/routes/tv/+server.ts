import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** /tv — the short address for the TV's games screen. */
export const GET: RequestHandler = () => redirect(302, '/games/tv');
