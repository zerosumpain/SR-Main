// POST /api/releases/summarise — run the LLM pass over un-summarised releases.
//
// Summarisation deliberately does NOT happen in CI or in the homeserv backfill
// script: the OpenRouter keys and the model settings live on the VPS with the
// site. Both callers therefore drive this endpoint instead.
//
//   { id: 42, force: true }      → re-summarise one release (admin "Regenerate")
//   { limit: 5 }                 → summarise the oldest N pending releases
//   { limit: 5, retryFailed: 1 } → also retry the ones whose last pass failed
//
// Auth: a valid `Authorization: Bearer RELEASE_LOG_SECRET` (used by the backfill
// script, which has no session) OR an owner session/LAN bypass. Unlike the
// ingest route this never falls open when the secret is unset — it spends money
// on LLM calls, so an unauthenticated caller must not be able to trigger it.
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { countPending, summarisePending, summariseRelease } from '$lib/releases/summarise';
import { isOwnerRequest } from '$lib/server/owner';
import type { RequestEvent, RequestHandler } from './$types';

const MAX_BATCH = 25;

async function authorize(event: RequestEvent): Promise<boolean> {
  const secret = env.RELEASE_LOG_SECRET;
  if (secret && (event.request.headers.get('authorization') ?? '') === `Bearer ${secret}`) return true;
  return isOwnerRequest(event);
}

export const POST: RequestHandler = async (event) => {
  if (!(await authorize(event))) throw error(401, 'unauthorized');

  const body = (await event.request.json().catch(() => ({}))) as {
    id?: number;
    limit?: number;
    force?: boolean;
    retryFailed?: boolean;
  };

  if (body.id) {
    const result = await summariseRelease(Number(body.id), { force: body.force !== false });
    return json({ ok: result !== 'failed', id: Number(body.id), result, remaining: await countPending() });
  }

  const limit = Math.min(MAX_BATCH, Math.max(1, Number(body.limit) || 5));
  const result = await summarisePending(limit, { includeFailed: Boolean(body.retryFailed) });
  return json({
    ok: true,
    processed: result.processed,
    summarised: result.ok,
    failed: result.failed,
    remaining: result.remaining,
  });
};

export const GET: RequestHandler = async () => {
  return json({ pending: await countPending(), pendingOrFailed: await countPending(true) });
};
