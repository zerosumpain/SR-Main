// src/lib/trips/undo.server.ts
//
// v8: Undo, and restoring any earlier version. The plan keeps every version,
// but before v8 the wishes and stays behind them were edited in place, so
// nothing could be put back. Now every version stores the facts it was
// solved from; undo writes that snapshot back (./undo, in one transaction)
// and re-solves — appending a NEW version led by "Undone: …", never
// rewriting history — so an undo can itself be undone.

import { latestPlan, listTransport, loadState, getTripById, tripOnly, type TripRecord } from './store.server';
import { constraintsOf, listPackPlaces, planConstraints, updatePackPlace } from './decisions.store.server';
import type { PackPlace } from './decisions';
import { planDiff } from './dryrun';
import { logEdit } from './converse.server';
import { replan } from './plan.server';
import { refreshQuestions } from './questions.server';
import { isEmptyRestore, restoreActions, undoLine } from './undo';
import { restoreConstraints } from './undo.store.server';

export interface UndoCaller {
  name: string | null;
  surface: 'site' | 'phone';
}

/**
 * Put the trip back as it was at `toVersion` (default: the version before
 * the latest). 409 when there is nothing to go back to, or that version was
 * made before snapshots were kept.
 *
 * `expectedLatest`, when given, is the version the caller last saw. If the
 * plan has moved on since (a family member's edit, or this same undo already
 * applied), the undo is refused with 409 rather than silently wiping the
 * newer change: restoring a snapshot replaces everything after it.
 */
export async function undoTo(
  trip: TripRecord,
  toVersion: number | null | undefined,
  caller: UndoCaller,
  opts: { expectedLatest?: number } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const latest = await latestPlan(trip.id);
  if (!latest) return { status: 409, body: { error: 'There is nothing to undo yet.' } };
  if (opts.expectedLatest !== undefined && latest.version !== opts.expectedLatest) {
    return {
      status: 409,
      body: {
        error:
          `The plan has changed since version ${opts.expectedLatest}: it is now at version ${latest.version}, ` +
          `so I haven't undone anything — that would also throw away the newer change. Look at the latest plan and ask again.`,
        latestVersion: latest.version,
      },
    };
  }
  const target = toVersion ?? latest.version - 1;
  if (!Number.isInteger(target) || target < 1 || target > latest.version) return { status: 400, body: { error: 'There is no such version.' } };
  if (target === latest.version) return { status: 409, body: { error: 'That is the plan as it stands.' } };
  const snapshot = await planConstraints(trip.id, target);
  if (!snapshot) return { status: 409, body: { error: `Version ${target} was made before undo was possible, so it cannot be restored.` } };

  const [state, transport] = await Promise.all([loadState(trip.id), listTransport(trip.id)]);
  const current = constraintsOf(tripOnly(trip), state, transport);
  const actions = restoreActions(current, snapshot);
  const lead = undoLine(target, actions, current);
  if (!isEmptyRestore(actions)) await restoreConstraints(trip.id, actions);

  // The research pack follows its wishes: a wish undo took off frees its
  // place; a wish undo put back is planned again.
  await relinkPack(trip.id, actions.wishes.remove, actions.wishes.insert).catch((err) => console.warn('[trips/undo] pack not relinked:', (err as Error)?.message));

  const fresh = (await getTripById(trip.id)) ?? trip;
  const solved = await replan(fresh, caller.surface === 'phone' ? 'phone' : 'undo', { keepRunningDay: caller.surface !== 'phone', lead: [lead] });
  if (!solved.created) return { status: 409, body: { error: `The plan already matches version ${target}.` } };
  const titles = Object.fromEntries((await loadState(trip.id)).wishes.map((w) => [w.id, w.title]));
  const diff = planDiff(latest.plan, solved.plan.plan, titles);
  await logEdit(trip.id, caller.name ? `${caller.name}: ${lead}` : lead, [], solved.plan.version, caller.surface);
  void Promise.resolve()
    .then(() => refreshQuestions(fresh, { reason: 'undo' }))
    .catch(() => {});
  return { status: 200, body: { planVersion: solved.plan.version, changes: solved.plan.changes, diff } };
}

async function relinkPack(tripId: string, removed: string[], inserted: Array<{ id: string; title: string; place: { osmId: string | null } | null }>): Promise<void> {
  if (!removed.length && !inserted.length) return;
  const pack = await listPackPlaces(tripId);
  const gone = new Set(removed);
  for (const p of pack.filter((p) => p.status === 'planned' && p.wishId && gone.has(p.wishId))) await updatePackPlace(tripId, p.id, { status: 'candidate', wishId: null });
  for (const w of inserted) {
    const match: PackPlace | undefined = pack.find(
      (p) => p.status === 'candidate' && ((w.place?.osmId && p.place.osmId === w.place.osmId) || p.name.trim().toLowerCase() === w.title.trim().toLowerCase()),
    );
    if (match) await updatePackPlace(tripId, match.id, { status: 'planned', wishId: w.id });
  }
}
