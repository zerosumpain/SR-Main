// The rambler's coarse day flags, re-read by a landing page left open so a
// flag that flips mid-visit (10,000 steps) can make him celebrate. Public:
// the same bands the landing page already carries, never totals or times.
import { json } from '@sveltejs/kit';
import { ramblerDay } from '$lib/landing/ramblers/day.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  return json(await ramblerDay(), { headers: { 'cache-control': 'public, max-age=300' } });
};
