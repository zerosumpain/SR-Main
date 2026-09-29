import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller, NOT_FAMILY } from '$lib/family/access.server';
import { familyId, familyRoster } from '$lib/family/roster.server';
import { isAction, toWire, transition, validateFields } from '$lib/family/tasks';
import { applyTransition, getTask, notifyTaskChange } from '$lib/family/tasks.server';

/**
 * PATCH /api/native/family/tasks/[id] — `{ action, ... }`:
 * done · undo · confirm · send_back `{ note }` · paid · edit `{ title?, notes?,
 * deadline?, assigneeId?, reward? }` · delete (soft).
 *
 * Who may do what, and from which state, is `transition` in $lib/family/tasks.
 * Unknown id 404, not allowed 403, wrong state 409 — including a row another
 * parent moved between our read and our write. View-as never gets here: the
 * native gate refuses anything but a read while viewing as someone.
 */
export const PATCH: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Body must be JSON' }, { status: 400 });
  if (!isAction(body.action)) return json({ error: 'Unknown action.' }, { status: 400 });
  const action = body.action;

  const before = await getTask(event.params.id);
  if (!before) return json({ error: 'No such task.' }, { status: 404 });

  if (body.expectedUpdatedAt !== undefined && (typeof body.expectedUpdatedAt !== 'string' || body.expectedUpdatedAt !== before.updatedAt.toISOString())) {
    return json({ error: 'That task changed meanwhile. Refresh before trying again.', task: toWire(before, familyId) }, { status: 409 });
  }
  const now = new Date();
  const allowed = transition(before, action, caller, now, { note: body.note });
  if (!allowed.ok) return json({ error: allowed.error }, { status: allowed.status });

  let step = allowed.value;
  if (action === 'edit') {
    const { action: _drop, expectedUpdatedAt: _version, ...rest } = body;
    const roster = new Map((await familyRoster()).map((p) => [p.id, p.email]));
    const fields = validateFields(rest, (id) => roster.get(id) ?? null, 'edit');
    if (!fields.ok) return json({ error: fields.error }, { status: fields.status });
    step = { ...step, patch: { ...fields.value } };
  }

  const after = await applyTransition(before.id, step, now, before.updatedAt);
  if (!after) return json({ error: 'That task changed meanwhile. Pull to refresh.' }, { status: 409 });

  if (action === 'done') void notifyTaskChange('done', after, caller.email);
  if (action === 'confirm') void notifyTaskChange('confirmed', after, caller.email, { doerEmail: before.doneByEmail });
  if (action === 'send_back') void notifyTaskChange('sent_back', after, caller.email, { doerEmail: before.doneByEmail });
  if (action === 'edit' && after.assigneeEmail && after.assigneeEmail !== before.assigneeEmail) {
    void notifyTaskChange('assigned', after, caller.email);
  }
  return { task: toWire(after, familyId) };
});
