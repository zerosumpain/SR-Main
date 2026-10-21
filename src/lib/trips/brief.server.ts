// src/lib/trips/brief.server.ts
//
// v8: the brief as it stands, read fresh, and direct edits to it (site and
// phone, no chat): each edit becomes ops recorded as the person's own
// ('you'), applied through the same validation as every other change,
// re-solved once and logged so the planner sees it.

import { phoneBrief } from './decisions.bundle.server';
import { buildBrief, briefPatchOps } from './brief';
import { applyDirect, logEdit } from './converse.server';
import type { BriefPatch, TripBrief } from './decisions';
import { noteProvenance, readProvenance } from './decisions.store.server';
import { describeOp } from './ops';
import { ensurePack } from './pack.server';
import { refreshQuestions } from './questions.server';
import { replan } from './plan.server';
import { missingInfo } from './prompt';
import { getTripById, latestPlan, listTransport, loadState, tripOnly, type TripRecord } from './store.server';

/** The brief now; the phone's has no memory text (./decisions.bundle.server `phoneBrief`). */
export async function briefNow(trip: TripRecord, surface: 'site' | 'phone'): Promise<TripBrief> {
  const [state, transport, provenance] = await Promise.all([loadState(trip.id), listTransport(trip.id), readProvenance(trip.id).catch(() => ({}))]);
  const brief = buildBrief({
    trip: tripOnly(trip),
    stays: state.stays,
    wishes: state.wishes,
    bookings: state.bookings,
    transport,
    profile: trip.profile,
    provenance,
    missing: missingInfo(trip, state.stays, state.wishes),
  });
  return surface === 'phone' ? phoneBrief(brief) : brief;
}

/** `PATCH brief`: `{ brief, planVersion, changes }`, or a sentence saying why not. */
export async function patchBrief(trip: TripRecord, patch: BriefPatch, caller: { name: string | null; surface: 'site' | 'phone' }): Promise<{ status: number; body: Record<string, unknown> }> {
  const [state, transport, provenance, latest] = await Promise.all([loadState(trip.id), listTransport(trip.id), readProvenance(trip.id).catch(() => ({})), latestPlan(trip.id)]);
  const r = briefPatchOps(patch, { trip: tripOnly(trip), stays: state.stays, wishes: state.wishes, transport, provenance, profile: trip.profile });
  if (!r.ok) return { status: 400, body: { error: r.error } };
  if (Object.keys(r.provenance).length) await noteProvenance(trip.id, r.provenance);

  let planVersion = latest?.version ?? null;
  let changes: string[] = [];
  let fresh = trip;
  if (r.ops.length) {
    const { result } = await applyDirect(trip, r.ops, { provenance: 'you' });
    if (!result.applied.length) return { status: 400, body: { error: result.rejected.map((x) => x.reason).join(' ') || 'That changed nothing.' } };
    fresh = (await getTripById(trip.id)) ?? trip;
    let made = false;
    if (result.changed) {
      try {
        const solved = await replan(fresh, caller.surface === 'phone' ? 'phone' : 'site', { keepRunningDay: caller.surface !== 'phone' });
        planVersion = solved.plan.version;
        made = solved.created;
        changes = solved.created ? solved.plan.changes : [];
      } catch (err) {
        console.error('[trips/brief] re-plan after an edit failed:', err);
        changes = ['Saved, but the plan could not be rebuilt just now.'];
      }
    }
    const titles = Object.fromEntries(state.wishes.map((w) => [w.id, w.title]));
    const said = result.applied.map((o) => describeOp(o, titles)).join(' ');
    await logEdit(trip.id, caller.name ? `${caller.name}: ${said}` : said, result.applied, made ? planVersion : null, caller.surface);
    // A new destination or new dates: the research pack is rebuilt for them.
    if (result.applied.some((o) => o.op === 'setTrip' && ('destination' in o.fields || 'startDate' in o.fields || 'endDate' in o.fields))) {
      void Promise.resolve()
        .then(() => ensurePack(fresh, { reason: 'changed' }))
        .catch(() => {});
    }
    // A corrected fact can settle a question (or raise one).
    if (result.changed) {
      void Promise.resolve()
        .then(() => refreshQuestions(fresh, { reason: 'brief' }))
        .catch(() => {});
    }
  }
  return { status: 200, body: { brief: await briefNow(fresh, caller.surface), planVersion, changes } };
}
