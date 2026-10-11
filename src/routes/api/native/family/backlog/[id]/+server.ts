import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller } from '$lib/family/access.server';
import { familyId } from '$lib/family/roster.server';
import { isAction, NOT_FAMILY, toWire, transition } from '$lib/family/backlog';
import { applyTransition, getItem } from '$lib/family/backlog.server';

/**
 * PATCH /api/native/family/backlog/[id] — `{ action }`: done (watched, read,
 * done) · dismiss (not for us) · reopen (back on the list) · delete (soft;
 * whoever shared it, or a parent).
 *
 * Unknown id 404, not allowed 403, wrong state 409 — including a row someone
 * else moved between our read and our write. View-as never gets here: the
 * native gate refuses anything but a read while viewing as someone.
 */
export const PATCH: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Body must be JSON' }, { status: 400 });
  if (!isAction(body.action)) return json({ error: 'Unknown action.' }, { status: 400 });

  const before = await getItem(event.params.id);
  if (!before) return json({ error: 'No such item.' }, { status: 404 });
  const now = new Date();
  const allowed = transition(before, body.action, caller, now);
  if (!allowed.ok) return json({ error: allowed.error }, { status: allowed.status });

  const after = await applyTransition(before.id, allowed.value, now);
  if (!after) return json({ error: 'That changed meanwhile. Pull to refresh.' }, { status: 409 });
  if (after.status === 'deleted') return { deleted: after.id };
  return { item: toWire(after, familyId) };
});
