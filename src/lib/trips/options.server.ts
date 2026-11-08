// src/lib/trips/options.server.ts
//
// Placing and checking the planner's options (./options): each on
// OpenStreetMap near its part of the day (a namesake far from the day and
// every stay is not the place), then dry-run with the solver as an idea is.
// One that cannot be placed, or does not fit and pushes nothing out, is left
// out — the reply still stands.

import { solveTrip } from '$lib/trips/solver';
import { computeGap, ideaDraft, verifyIdea } from './ideas';
import type { Wish } from './model';
import { optionFit, type OptionDraft, type PlanOption } from './options';
import { solverInput } from './plan.server';
import { emptyFacts, withinReach } from './research';
import { findPlaceLoosely } from './research.server';
import { latestPlan, type TripRecord } from './store.server';

export async function checkOptions(
  trip: TripRecord,
  drafts: OptionDraft[],
  deps: { place?: typeof findPlaceLoosely } = {},
): Promise<PlanOption[]> {
  if (!drafts.length) return [];
  const latest = await latestPlan(trip.id);
  if (!latest) return [];
  const { input, state } = await solverInput(trip, latest, { reuseMatrix: true });
  const baseline = solveTrip(input);
  const out: PlanOption[] = [];
  for (const [i, d] of drafts.entries()) {
    const gap = computeGap(latest.plan, d.date, d.stage);
    if (!gap) continue;
    const near = gap.before.location ?? gap.after.location ?? state.stays[0]?.location ?? null;
    const hit = await (deps.place ?? findPlaceLoosely)(d.placeQuery, trip.destination, near).catch(() => null);
    const found = hit && withinReach(hit.location, [gap.before.location, gap.after.location, ...state.stays.map((s) => s.location)]) ? hit : null;
    if (!found) continue;
    const place = { name: found.name, location: found.location, osmId: found.osmId, address: found.address };
    const draft = { ...ideaDraft({ title: d.title, placeQuery: d.placeQuery, durationMin: d.durationMin, why: d.why, fit: '' }, gap), place };
    const wish: Wish = {
      id: `option:${i}`, title: d.title, place, priority: 'nice', durationSec: d.durationMin * 60, partOfDay: draft.partOfDay,
      fixedDate: gap.date, fixedStartMin: null, locked: false, suggested: false, skipped: false,
      facts: found.openingHoursText ? { ...emptyFacts('brief', null), openingHoursText: found.openingHoursText } : null,
      note: null, sortHint: 0, replacesMeal: gap.meal,
    };
    const verdict = verifyIdea(input, wish, gap, baseline);
    if (!verdict.fits && !verdict.pushesOut.length) continue;
    out.push({
      id: `${d.date}:${d.stage}:${i}`, date: d.date, stage: d.stage, title: d.title, why: d.why, fit: optionFit(verdict),
      indoor: d.indoor, kidFriendly: d.kidFriendly, costText: d.costText, wish: draft, verdict,
    });
  }
  // What fits as it stands first; what costs the day something after.
  return out.sort((a, b) => Number(b.verdict.fits) - Number(a.verdict.fits));
}
