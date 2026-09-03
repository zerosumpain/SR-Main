// POST /api/policy-engine/ingest — refresh the live-data observation layer for The
// Whitehall Model. Driven by the jkai cron workflows (one per cadence group). Auth: if
// POLICY_INGEST_SECRET is set, a matching Bearer token is required (mirrors the scraper route).
//
// Body: { group?: 'ees'|'neet'|'context'|'annual', force?: boolean, includeManual?: boolean }
// GET returns the current tracked indicators (read-only) for debugging / the admin view.

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runIngest, loadTrackedIndicators } from '$lib/policy-engine/tracking/ingest.server';
import type { TrackGroup } from '$lib/policy-engine/tracking/types';
import type { RequestHandler } from './$types';
import { assertBearerSecret, readLimitedJson } from '$lib/server/service-auth';
import { assertPublicRequestBudget } from '$lib/server/public-request-guard';

const GROUPS: TrackGroup[] = ['ees', 'neet', 'context', 'annual'];

export const POST: RequestHandler = async (event) => {
  const { request } = event;
  assertPublicRequestBudget(event, {
    scope: 'policy-ingest', perClient: { capacity: 8, refillPerSecond: 8 / 60 },
    global: { capacity: 30, refillPerSecond: 30 / 60 },
  });
  assertBearerSecret(request, env.POLICY_INGEST_SECRET, 'POLICY_INGEST_SECRET');
  const body = await readLimitedJson<{ group?: string; force?: boolean; includeManual?: boolean }>(request, 8_192);
  const group = body.group && GROUPS.includes(body.group as TrackGroup) ? (body.group as TrackGroup) : undefined;
  const summary = await runIngest({ group, force: !!body.force, includeManual: !!body.includeManual });
  return json(summary);
};

export const GET: RequestHandler = async () => {
  const indicators = await loadTrackedIndicators();
  return json({ indicators });
};
