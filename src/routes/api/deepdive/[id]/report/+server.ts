import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireResearchSession } from '$lib/deepdive/session-access.server';

/**
 * GET /api/deepdive/[id]/report
 * Returns the persisted ResearchReport jsonb for the report-preview node.
 * { report } when present, { report: null } when not yet generated.
 */
export const GET: RequestHandler = async (event) => {
  const { params } = event;
  const { session } = await requireResearchSession(event, params.id, 'read');

  return json({ report: session.report ?? null });
};
