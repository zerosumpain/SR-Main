import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { listRoutes, setRoute } from '$lib/server/notify';
import { isKnownCategory } from '$lib/server/notify/categories';

/**
 * GET /api/native/notifications/routes — where each category goes today.
 * PUT — change one.
 *
 * The phone is an owner-authenticated device, so this is not an admin surface
 * behind a second gate: it is the owner's own preferences read and written by
 * the owner's own phone. Minting a credential still is not — that stays on
 * `/api/admin/native-devices`, because an endpoint that issues credentials must
 * not sit behind the exemption those credentials open.
 */
export const GET: RequestHandler = withDevice(async () => ({ categories: await listRoutes() }));

export const PUT: RequestHandler = withDevice(async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const payload = (body ?? {}) as {
    category?: unknown;
    whatsapp?: unknown;
    native?: unknown;
    minIntervalSeconds?: unknown;
  };

  if (typeof payload.category !== 'string' || !isKnownCategory(payload.category)) {
    return json({ error: 'Unknown notification category.' }, { status: 400 });
  }

  // A floor is clamped rather than rejected. The app offers a fixed set of
  // choices, so anything outside them is a version skew, and silently holding
  // the nearest legal value beats 400ing a settings toggle.
  const raw = Number(payload.minIntervalSeconds);
  const minIntervalSeconds = Number.isFinite(raw)
    ? Math.min(Math.max(Math.floor(raw), 0), 24 * 60 * 60)
    : undefined;

  await setRoute(payload.category, {
    whatsapp: typeof payload.whatsapp === 'boolean' ? payload.whatsapp : undefined,
    native: typeof payload.native === 'boolean' ? payload.native : undefined,
    minIntervalSeconds,
  });

  return { categories: await listRoutes() };
});
