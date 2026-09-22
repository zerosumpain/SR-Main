import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { clampLimit, withDevice } from '$lib/server/native-handler';
import { markAllRead, markCollected, pendingForDevice, recentEvents } from '$lib/server/notify';

/**
 * GET /api/native/notifications — what the phone has not raised yet, and the inbox.
 *
 * Two lists in one answer, because they are read together and a background
 * refresh gets seconds of runtime, not round trips:
 *
 *   `pending` — routed to this phone and not yet collected. The app posts one
 *               local notification per entry and then acknowledges them.
 *   `recent`  — the ledger, for the inbox screen. Includes things that went to
 *               WhatsApp instead, because "what did the site tell me today" is
 *               a question about the day, not about a channel.
 *
 * There is no push certificate in this app's provisioning profile, so nothing
 * here can wake the phone. iOS decides when a background refresh runs; the app
 * asks for one, takes what is waiting, and raises it locally. That is why
 * `pending` is a QUEUE and not a since-cursor: a refresh that never happened
 * must not lose what it would have carried.
 */
export const GET: RequestHandler = withDevice(async ({ url }) => {
  const [pending, recent] = await Promise.all([
    pendingForDevice(clampLimit(url.searchParams.get('limit'), 20, 100)),
    recentEvents(clampLimit(url.searchParams.get('inbox'), 50, 200)),
  ]);
  return {
    pending: pending.map(wire),
    recent: recent.map(wire),
    unread: recent.filter((row) => !row.readAt).length,
  };
});

/**
 * POST /api/native/notifications — acknowledge, or mark the inbox read.
 *
 * `{ collected: [id, …] }` is the phone saying it has posted those as local
 * notifications and they must not be posted again. `{ readAll: true }` is the
 * person having looked at the inbox.
 *
 * Acknowledging is deliberately a separate call from fetching rather than a
 * side effect of it. A refresh that is killed by iOS mid-flight — which is
 * ordinary, the budget is a few seconds — would otherwise consume the queue
 * without ever having raised it.
 */
export const POST: RequestHandler = withDevice(async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const payload = (body ?? {}) as { collected?: unknown; readAll?: unknown };

  let collected = 0;
  if (Array.isArray(payload.collected)) {
    collected = await markCollected(payload.collected.filter((id): id is string => typeof id === 'string'));
  }
  if (payload.readAll === true) await markAllRead();

  return { ok: true, collected };
});

type Row = Awaited<ReturnType<typeof recentEvents>>[number] | Awaited<ReturnType<typeof pendingForDevice>>[number];

/** Dates go out as ISO 8601; the app decodes nothing else. */
function wire(row: Row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    url: row.url,
    severity: row.severity,
    data: row.data ?? null,
    createdAt: row.createdAt.toISOString(),
    read: 'readAt' in row ? Boolean(row.readAt) : false,
  };
}
