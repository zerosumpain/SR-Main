// src/lib/trips/api.server.ts
//
// The shared opening of every /api/trips handler: the owner (D2) and their
// trip, or the site's refusal; then, after an edit to the constraints, a
// re-plan so the page always shows a plan for the constraints it holds.

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireTripOwner } from './access.server';
import { logEdit } from './converse.server';
import { noteProvenance } from './decisions.store.server';
import type { TripOp } from './model';
import { describeOp } from './ops';
import { replan } from './plan.server';
import { createdFromExtra, pairDirect, provenanceFor } from './provenance';
import { getTrip, loadState, type TripRecord } from './store.server';

export async function ownerTrip(event: RequestEvent): Promise<{ owner: string; trip: TripRecord }> {
  const owner = await requireTripOwner(event);
  const trip = await getTrip(owner, event.params.id ?? '');
  if (!trip) error(404, 'No such trip.');
  return { owner, trip };
}

export async function readJson(event: RequestEvent): Promise<unknown> {
  return event.request.json().catch(() => null);
}

/**
 * Re-plan after a direct edit and answer with the version the page should now
 * show. The edit is logged in the conversation as an `event` message with its
 * ops, so the planner sees it on its next turn. v8: every fact it touched is
 * now the person's own ('you' in the brief), whatever it was before.
 */
export async function replanned(trip: TripRecord, extra: Record<string, unknown> = {}, status = 200, ops: TripOp[] = []): Promise<Response> {
  if (ops.length) {
    await noteProvenance(trip.id, provenanceFor(pairDirect(ops, createdFromExtra(extra)), 'you')).catch((err) =>
      console.warn('[trips] could not record where the edit came from:', (err as Error)?.message),
    );
  }
  const log = async (version: number | null) => {
    if (!ops.length) return;
    const titles = Object.fromEntries((await loadState(trip.id)).wishes.map((w) => [w.id, w.title]));
    await logEdit(trip.id, ops.map((o) => describeOp(o, titles)).join(' '), ops, version);
  };
  try {
    const { plan, created } = await replan(trip, 'site');
    await log(created ? plan.version : null);
    return json({ ...extra, planVersion: plan.version, replanned: created }, { status });
  } catch (err) {
    // The edit is saved; a failed solve must not read as a failed edit.
    console.error('[trips] re-plan failed:', err);
    await log(null);
    return json({ ...extra, planVersion: null, replanned: false, warning: 'Saved, but the plan could not be rebuilt just now.' }, { status });
  }
}
