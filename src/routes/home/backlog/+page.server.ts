import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { webFamilyCaller } from '$lib/family/access.server';
import { viewerOf } from '$lib/server/viewer';
import { familyId, familyPersonFor, familyRoster } from '$lib/family/roster.server';
import { isAction, listsOf, toWire, transition } from '$lib/family/backlog';
import { applyTransition, getItem, loadItems, loadReactions } from '$lib/family/backlog.server';

// The family backlog for a big screen — the television, a laptop on the sofa.
//
// Open to the owner and Family Circle (`$lib/access/catalogue`); the hook lets
// only those reach it, and `webFamilyCaller` here is the second lock and the
// one that says who they are.
// The same list the phone reads (`/api/native/family/backlog`), the same
// rules, and the same "people are ids" shape, so no address reaches the
// browser. Adding stays on the phone ("Share → SR"): this page is for
// choosing what to watch, not for collecting it.

export const load: PageServerLoad = async (event) => {
  const caller = await webFamilyCaller(event);
  if (!caller) error(403, 'The backlog is for the family.');
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const me = await familyPersonFor(caller.email, caller.parent);
  const roster = await familyRoster();
  const people = roster.map((p) => ({ id: p.id, name: p.name }));
  if (!roster.some((p) => p.email === me.email)) people.push({ id: me.id, name: me.name });
  const lists = listsOf(await loadItems(), new Date());
  const reactions = await loadReactions([...lists.items, ...lists.finished].map((i) => i.id));
  const wire = (i: Parameters<typeof toWire>[0]) => toWire(i, familyId, reactions);
  return {
    me: { id: me.id, parent: caller.parent },
    /** "One level up" is /home, which needs the `home` area: only the owner's for certain. */
    owner: (await viewerOf(event)).kind === 'owner',
    people,
    items: lists.items.map(wire),
    finished: lists.finished.map(wire),
    loadedAt: new Date().toISOString(),
  };
};

/** One form action per move; each re-checks who is asking and the item's state. */
async function move(event: Parameters<Actions[string]>[0], action: 'done' | 'dismiss' | 'reopen') {
  const caller = await webFamilyCaller(event);
  if (!caller) return fail(403, { error: 'The backlog is for the family.' });
  const id = String((await event.request.formData()).get('id') ?? '');
  const before = await getItem(id);
  if (!before) return fail(404, { error: 'That has gone from the list.' });
  if (!isAction(action)) return fail(400, { error: 'Unknown action.' });
  const now = new Date();
  const allowed = transition(before, action, caller, now);
  if (!allowed.ok) return fail(allowed.status, { error: allowed.error });
  const after = await applyTransition(before.id, allowed.value, now);
  if (!after) return fail(409, { error: 'Someone got there first — the list is up to date now.' });
  return { moved: after.id };
}

export const actions: Actions = {
  done: (event) => move(event, 'done'),
  dismiss: (event) => move(event, 'dismiss'),
  reopen: (event) => move(event, 'reopen'),
};
