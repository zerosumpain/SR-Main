// The one-tap replies attached to a push notification.
//
// Separate from /api/daydream/thoughts because the caller is different: that
// one serves the ledger page, this one serves a notification action where the
// whole interaction is a single tap and the response is a redirect back to the
// page rather than JSON for a script.
//
// Owner-gated like its sibling — a push notification is only ever delivered to
// a subscription the owner created, and the tap carries their session.

import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordFeedback } from '$lib/daydream/thought-store';
import { errMsg } from '$lib/daydream/types';

const VERDICTS = new Set(['useful', 'not_useful', 'never_kind']);

/**
 * GET so a notification action can be a plain link.
 *
 * Ordinarily a state change behind GET would be wrong. It is accepted here for
 * one reason: a service-worker notification action cannot POST a body without
 * shipping script into the worker, and the alternative — a page that asks you
 * to tap again — defeats the point of a one-tap reply. The risk that rule
 * normally guards against is a prefetcher or crawler firing it, and neither
 * reaches an owner-gated route.
 */
export const GET: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id') ?? '';
  const verdict = url.searchParams.get('verdict') ?? '';

  if (!id || !VERDICTS.has(verdict)) {
    throw redirect(303, '/jkai/daydreams');
  }

  try {
    await recordFeedback(id, verdict as 'useful' | 'not_useful' | 'never_kind');
  } catch (err) {
    console.error('[daydream] one-tap feedback failed:', errMsg(err));
  }

  // Always land on the ledger, whether or not the write succeeded — a tap that
  // silently does nothing and shows nothing is worse than one that shows the
  // current state and lets the owner see it did not take.
  throw redirect(303, '/jkai/daydreams');
};

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'body must be JSON' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  const verdict = typeof body.verdict === 'string' ? body.verdict : '';
  if (!id) return json({ error: 'id is required' }, { status: 400 });
  if (!VERDICTS.has(verdict)) {
    return json({ error: 'verdict must be useful, not_useful or never_kind' }, { status: 400 });
  }

  try {
    const res = await recordFeedback(id, verdict as 'useful' | 'not_useful' | 'never_kind');
    return json({ ok: true, ...res });
  } catch (err) {
    return json({ error: errMsg(err) }, { status: 400 });
  }
};
