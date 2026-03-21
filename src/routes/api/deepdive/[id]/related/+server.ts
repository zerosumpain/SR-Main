import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findRelatedSessions } from '$lib/deepdive/cross-session';

export const GET: RequestHandler = async ({ params }) => {
  const results = await findRelatedSessions(params.id);
  return json(results);
};
