// POST /api/policy-engine/ingest — refresh the live-data observation layer for The
// Whitehall Model. Driven by the jkai cron workflows (one per cadence group). Auth: if
// POLICY_INGEST_SECRET is set, a matching Bearer token is required (mirrors the scraper route).
//
// Body: { group?: 'ees'|'neet'|'context'|'annual', force?: boolean, includeManual?: boolean }
// GET returns the current tracked indicators (read-only) for debugging / the admin view.

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runIngest, loadTrackedIndicators } from '../../../projects/policy-engine/lib/tracking/ingest.server';
import type { TrackGroup } from '../../../projects/policy-engine/lib/tracking/types';
import type { RequestHandler } from './$types';

const GROUPS: TrackGroup[] = ['ees', 'neet', 'context', 'annual'];

function authorized(request: Request): boolean {
  const secret = env.POLICY_INGEST_SECRET;
  if (!secret) return true; // unset → open (dev convenience), same as the scraper route
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

export const POST: RequestHandler = async ({ request }) => {
  if (!authorized(request)) throw error(401, 'unauthorized');
  const body = (await request.json().catch(() => ({}))) as { group?: string; force?: boolean; includeManual?: boolean };
  const group = body.group && GROUPS.includes(body.group as TrackGroup) ? (body.group as TrackGroup) : undefined;
  const summary = await runIngest({ group, force: !!body.force, includeManual: !!body.includeManual });
  return json(summary);
};

export const GET: RequestHandler = async () => {
  const indicators = await loadTrackedIndicators();
  return json({ indicators });
};
