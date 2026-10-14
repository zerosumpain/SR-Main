// src/lib/trips/ideas.server.ts
//
// "Ask for an idea" for an open slot: compute the gap from the current plan,
// run ONE focused agentic planner turn (the same tool loop, budget and
// `trips-planner` workload as the conversation, with its own prompt), place
// each idea on OpenStreetMap, and verify it with the solver before it is
// shown (./ideas `verifyIdea`). Nothing is saved: adding an idea goes through
// the normal wishes route. The ask and what came back are logged in the
// conversation as an `event` message, so the planner keeps the context.

import { solveTrip } from '$lib/trips/solver';
import { agentTurn } from './agent.server';
import { dayLabel } from './changes';
import { logEdit } from './converse.server';
import { computeGap, ideaDraft, IDEAS_SYSTEM, ideasPrompt, readIdeas, verifyIdea, type Gap, type IdeaDraft, type Verdict } from './ideas';
import { DAY_STAGE_LABEL, type DayStage, type ResearchStep, type Wish, type WishDraft } from './model';
import { solverInput } from './plan.server';
import { profileText, travellersOnly } from './profile';
import { parseLooseJson } from './research';
import { findPlaceLoosely } from './research.server';
import { latestPlan, listTransport, type TripRecord } from './store.server';

export interface Idea {
  title: string;
  why: string;
  /** The planner's own estimate of the fit. */
  fit: string;
  /** What to add: the wish, with its place resolved on OpenStreetMap. */
  wish: WishDraft & { place: Wish['place'] };
  verdict: Verdict;
}

export interface IdeasResult {
  gap: Gap | null;
  ideas: Idea[];
  /** Ideas the solver (or the map) turned down, with why. */
  rejected: Array<{ title: string; reason: string }>;
  note: string | null;
  research: ResearchStep[];
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;

export async function findIdeas(
  trip: TripRecord,
  ask: { date: string; stage: DayStage; afterStopId?: string | null; beforeStopId?: string | null },
  surface: 'site' | 'phone' = 'site',
  deps: { agent?: typeof agentTurn; place?: typeof findPlaceLoosely; asOwner?: boolean } = {},
): Promise<IdeasResult> {
  const latest = await latestPlan(trip.id);
  if (!latest) return { gap: null, ideas: [], rejected: [], note: 'There is no plan yet to find a gap in.', research: [] };
  const gap = computeGap(latest.plan, ask.date, ask.stage, { afterStopId: ask.afterStopId, beforeStopId: ask.beforeStopId });
  if (!gap) return { gap: null, ideas: [], rejected: [], note: 'That day is not in the plan.', research: [] };
  const day = latest.plan.days.find((d) => d.date === ask.date)!;
  const { input, state } = await solverInput(trip, latest, { reuseMatrix: true });
  const transport = await listTransport(trip.id);
  const titles = new Map(state.wishes.map((w) => [w.id, w.title]));
  const slot = `${dayLabel(gap.date)} ${DAY_STAGE_LABEL[gap.stage].toLowerCase()} (${hhmm(gap.before.min)}–${hhmm(gap.after.min)}, ${gap.freeMin} min between ${gap.before.title} and ${gap.after.title})`;

  const prompt = ideasPrompt({
    gap,
    day,
    destination: trip.destination,
    otherDays: latest.plan.days.filter((d) => d.date !== gap.date).map((d) => ({ date: d.date, titles: d.stops.filter((s) => s.kind === 'wish').map((s) => s.title) })),
    dropped: latest.plan.dropped.map((d) => titles.get(d.wishId) ?? d.wishId),
    // Only the owner's own asks see the owner's memory; anyone else gets the travellers (v5).
    profileText: profileText(deps.asOwner === false ? travellersOnly(trip.profile) : trip.profile),
    guideText: trip.guide ? [trip.guide.gettingAround, trip.guide.transitTickets].filter(Boolean).join(' ') : null,
    transportText: transport.length ? transport.map((t) => `${t.direction} ${t.kind} ${t.number ?? ''} ${t.from.name} ${t.departDate} ${hhmm(t.departMin)} → ${t.to.name} ${t.arriveDate} ${hhmm(t.arriveMin)}`).join('; ') : null,
  });

  let drafts: IdeaDraft[] = [];
  let note: string | null = null;
  let research: ResearchStep[] = [];
  try {
    const turn = await (deps.agent ?? agentTurn)(
      [
        { role: 'system', content: IDEAS_SYSTEM },
        { role: 'user', content: prompt },
      ],
      { trip, stays: state.stays, wishes: state.wishes },
      { finalPrompt: 'Answer now with the JSON object only ({"ideas": [...], "note": ...}) — no more lookups.' },
    );
    research = turn.research;
    ({ ideas: drafts, note } = readIdeas(parseLooseJson(turn.reply)));
  } catch (err) {
    console.warn('[trips/ideas] planner unavailable:', (err as Error)?.message);
    return { gap, ideas: [], rejected: [], note: 'The planner is not reachable just now — try again shortly.', research };
  }

  const baseline = solveTrip(input);
  const ideas: Idea[] = [];
  const rejected: IdeasResult['rejected'] = [];
  for (const [i, d] of drafts.entries()) {
    const found = await (deps.place ?? findPlaceLoosely)(d.placeQuery, trip.destination, gap.before.location ?? gap.after.location);
    if (!found) {
      rejected.push({ title: d.title, reason: `“${d.placeQuery}” was not found on the map.` });
      continue;
    }
    const draft = ideaDraft(d, gap);
    const place = { name: found.name, location: found.location, osmId: found.osmId, address: found.address };
    const wish: Wish = {
      id: `idea:${i}`,
      title: d.title,
      place,
      priority: 'nice',
      durationSec: d.durationMin * 60,
      partOfDay: draft.partOfDay,
      fixedDate: gap.date,
      fixedStartMin: null,
      locked: false,
      suggested: false,
      skipped: false,
      facts: null,
      note: null,
      sortHint: 0,
      replacesMeal: gap.meal,
    };
    const verdict = verifyIdea(input, wish, gap, baseline);
    if (verdict.fits || verdict.pushesOut.length) ideas.push({ title: d.title, why: d.why, fit: d.fit, wish: { ...draft, place }, verdict });
    else rejected.push({ title: d.title, reason: verdict.reason ?? 'It does not fit.' });
  }
  if (!ideas.length && !note) note = `Nothing the planner found fits ${gap.freeMin} minutes between ${gap.before.title} and ${gap.after.title} with the travel there and back — want me to shorten something?`;

  const fitting = ideas.filter((x) => x.verdict.fits).map((x) => x.title);
  await logEdit(
    trip.id,
    `Asked for ideas for ${slot}. ${fitting.length ? `Found: ${fitting.join(', ')}.` : 'Nothing fitted.'}${rejected.length ? ` Turned down: ${rejected.map((r) => `${r.title} (${r.reason})`).join('; ')}.` : ''}`,
    [],
    null,
    surface,
  );
  return { gap, ideas, rejected, note, research };
}
