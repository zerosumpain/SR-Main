import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller, NOT_FAMILY } from '$lib/family/access.server';
import { familyId, familyPersonFor, familyRoster } from '$lib/family/roster.server';
import { listsFor, toWire, validateFields } from '$lib/family/tasks';
import { createTask, loadTasks, notifyTaskChange } from '$lib/family/tasks.server';

/**
 * GET /api/native/family/tasks — the family task list as one person sees it.
 *
 * `open` is everyone's (open, and done awaiting a parent). `completed` and
 * `owed` are the caller's own for a member and everyone's for a parent. People
 * are ids; the phone names them from `people`, so no email leaves the server.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const me = await familyPersonFor(caller.email, caller.parent);
  const roster = await familyRoster();
  const people = roster.map((p) => ({ id: p.id, name: p.name }));
  if (!roster.some((p) => p.email === me.email)) people.push({ id: me.id, name: me.name });
  const lists = listsFor(await loadTasks(), caller, new Date());
  const wire = (t: Parameters<typeof toWire>[0]) => toWire(t, familyId);
  return {
    me: { id: me.id, parent: caller.parent },
    people,
    open: lists.open.map(wire),
    completed: lists.completed.map(wire),
    owed: { totalPence: lists.owed.totalPence, items: lists.owed.items.map(wire) },
  };
});

/** POST /api/native/family/tasks — `{ title, notes?, deadline?, assigneeId?, reward? }`. Anyone in the family. */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Body must be JSON' }, { status: 400 });
  const roster = new Map((await familyRoster()).map((p) => [p.id, p.email]));
  const fields = validateFields(body, (id) => roster.get(id) ?? null, 'create');
  if (!fields.ok) return json({ error: fields.error }, { status: fields.status });
  const task = await createTask({ ...fields.value, title: fields.value.title! }, caller.email);
  void notifyTaskChange('assigned', task, caller.email);
  return json({ task: toWire(task, familyId) }, { status: 201 });
});
