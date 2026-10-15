// src/lib/trips/ideas.server.ts
//
// "Ask for an idea" for an open slot: compute the gap from the current plan,
// run ONE focused agentic planner turn (the same tool loop, budget and
// `trips-planner` workload as the conversation, with its own prompt), place
// each idea on OpenStreetMap, and verify it with the solver before it is
// shown (./ideas `verifyIdea`). Nothing is saved: adding an idea goes through
// the normal wishes route. The ask and what came back are logged in the
// conversation as an `event` message, so the planner keeps the context.
//
// v6: the turn has a smaller budget (≤4 lookups, ≤2 searches) and a deadline,
// an unreadable answer gets one JSON repair, and when nothing from the
// planner fits, places around the gap from OpenStreetMap are verified the
// same way (`source: 'nearby'`). Every outcome is logged, failures included.

import { solveTrip } from '$lib/trips/solver';
import { IDEAS_BUDGET } from './agent';
import { agentTurn } from './agent.server';
import { dayLabel } from './changes';
import { logEdit } from './converse.server';
import { computeGap, ideaDraft, IDEAS_SYSTEM, ideasPrompt, readIdeas, verifyIdea, type Gap, type IdeaDraft, type Verdict } from './ideas';
import { jsonCall } from './llm.server';
import { DAY_STAGE_LABEL, type DayStage, type ResearchStep, type Stay, type Wish, type WishDraft } from './model';
import { dietaryHints, elementsFromNominatim, gapCentre, nearbyCandidates, nearbyIdeasQuery, nearbyRadiusM, nominatimTerms, viewboxAround, type NearbyCandidate } from './nearby-ideas';
import { solverInput } from './plan.server';
import { profileText, travellersOnly } from './profile';
import { parseLooseJson } from './research';
import { findPlaceLoosely, nominatimAround, overpass } from './research.server';
import { latestPlan, listTransport, type TripRecord } from './store.server';

export interface Idea {
  title: string;
  why: string;
  /** The planner's own estimate of the fit. */
  fit: string;
  /** What to add: the wish, with its place resolved on OpenStreetMap. */
  wish: WishDraft & { place: Wish['place'] };
  verdict: Verdict;
  /** v6: from the planner, or from the OpenStreetMap fallback around the gap. */
  source: 'planner' | 'nearby';
}

export interface IdeasDeps {
  agent?: typeof agentTurn;
  place?: typeof findPlaceLoosely;
  asOwner?: boolean;
  author?: { email: string; id: string | null };
  /** v6 test seams: the JSON repair call, the Overpass call, the planner deadline. */
  repair?: (reply: string) => Promise<unknown>;
  overpass?: (query: string) => Promise<unknown>;
  nominatim?: (term: string, viewbox: string) => Promise<unknown[]>;
  plannerMs?: number;
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
  deps: IdeasDeps = {},
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

  const planned = await plannerDrafts(trip, state, prompt, deps);
  const research = planned.research;
  let note = planned.note;
  const baseline = solveTrip(input);
  const ideas: Idea[] = [];
  const rejected: IdeasResult['rejected'] = [];
  const asWish = (id: string, title: string, durationMin: number, place: Wish['place'], partOfDay: Wish['partOfDay']): Wish => ({
    id,
    title,
    place,
    priority: 'nice',
    durationSec: durationMin * 60,
    partOfDay,
    fixedDate: gap.date,
    fixedStartMin: null,
    locked: false,
    suggested: false,
    skipped: false,
    facts: null,
    note: null,
    sortHint: 0,
    replacesMeal: gap.meal,
  });

  for (const [i, d] of planned.drafts.entries()) {
    const found = await (deps.place ?? findPlaceLoosely)(d.placeQuery, trip.destination, gap.before.location ?? gap.after.location).catch(() => null);
    if (!found) {
      rejected.push({ title: d.title, reason: `“${d.placeQuery}” was not found on the map.` });
      continue;
    }
    const draft = ideaDraft(d, gap);
    const place = { name: found.name, location: found.location, osmId: found.osmId, address: found.address };
    const verdict = verifyIdea(input, asWish(`idea:${i}`, d.title, d.durationMin, place, draft.partOfDay), gap, baseline);
    if (verdict.fits || verdict.pushesOut.length) ideas.push({ title: d.title, why: d.why, fit: d.fit, wish: { ...draft, place }, verdict, source: 'planner' });
    else rejected.push({ title: d.title, reason: verdict.reason ?? 'It does not fit.' });
  }

  // v6: nothing from the planner that fits → places around the gap from
  // OpenStreetMap, each verified by the solver like any other idea.
  let nearbyNote: string | null = null;
  if (!ideas.some((x) => x.verdict.fits)) {
    const near = await nearbyIdeas(trip, gap, state.wishes, deps);
    nearbyNote = near.note;
    const turnedDown: IdeasResult['rejected'] = [];
    for (const [i, c] of near.candidates.entries()) {
      if (ideas.filter((x) => x.verdict.fits).length >= 3 || i >= NEARBY_VERIFY_MAX) break;
      const draft = ideaDraft({ title: c.title, placeQuery: c.title, durationMin: c.durationMin, why: c.why, fit: c.fit }, gap);
      const verdict = verifyIdea(input, asWish(`nearby:${i}`, c.title, c.durationMin, c.place, draft.partOfDay), gap, baseline);
      if (verdict.fits) ideas.push({ title: c.title, why: c.why, fit: c.fit, wish: { ...draft, placeQuery: `${c.title}, ${trip.destination}`, place: c.place }, verdict, source: 'nearby' });
      else turnedDown.push({ title: c.title, reason: verdict.reason ?? 'It does not fit.' });
    }
    // Planner ideas that only fit by pushing something out come after the ones that fit.
    ideas.sort((a, b) => Number(b.verdict.fits) - Number(a.verdict.fits));
    if (!ideas.length) rejected.push(...turnedDown.slice(0, 3));
  }

  const fitting = ideas.filter((x) => x.verdict.fits);
  if (fitting.some((x) => x.source === 'nearby') && !fitting.some((x) => x.source === 'planner')) {
    note = planned.failure
      ? `The planner ${FAILURE_WORDS[planned.failure]}, so these are places near the way from ${gap.before.title} to ${gap.after.title}, checked against your day.`
      : `These are places near the way from ${gap.before.title} to ${gap.after.title}, checked against your day.`;
  } else if (!ideas.length) {
    note = planned.failure
      ? `The planner ${FAILURE_WORDS[planned.failure]} and nothing nearby fits ${gap.freeMin} minutes between ${gap.before.title} and ${gap.after.title}${nearbyNote ? ` (${nearbyNote})` : ''} — try again shortly.`
      : (note ?? `Nothing fits ${gap.freeMin} minutes between ${gap.before.title} and ${gap.after.title} with the travel there and back — want me to shorten something?`);
  }

  // Every outcome is logged, failures included, so they are visible.
  const parts = [`Asked for ideas for ${slot}.`];
  if (planned.failure) parts.push(`Planner error: ${planned.failure}.`);
  parts.push(fitting.length ? `Found: ${fitting.map((x) => (x.source === 'nearby' ? `${x.title} (nearby)` : x.title)).join(', ')}.` : 'Nothing fitted.');
  if (rejected.length) parts.push(`Turned down: ${rejected.map((r) => `${r.title} (${r.reason})`).join('; ')}.`);
  if (!fitting.length && nearbyNote) parts.push(`Nearby search: ${nearbyNote}.`);
  await logEdit(
    trip.id,
    parts.join(' '),
    [],
    null,
    surface,
    // The asker's own thread (v5): the reasons may echo their profile.
    deps.author ?? { email: trip.ownerEmail, id: null },
  );
  return { gap, ideas, rejected, note, research };
}

// ── The planner's turn (v6: smaller budget, a deadline, one JSON repair) ────

/** The ideas turn must leave room for the fallback inside the job cap
 * (and the phone's 180 s wait). */
export const IDEAS_PLANNER_MS = 75_000;
/** At most this many nearby candidates are dry-run with the solver. */
const NEARBY_VERIFY_MAX = 8;

export type PlannerFailure = 'timeout' | 'unreachable' | 'unreadable' | 'error';

const FAILURE_WORDS: Record<PlannerFailure, string> = {
  timeout: 'took too long',
  unreachable: 'is not reachable just now',
  unreadable: 'gave an answer that could not be read',
  error: 'ran into an error',
};

export function failureKind(err: unknown): PlannerFailure {
  const m = `${(err as Error)?.name ?? ''} ${(err as Error)?.message ?? ''}`.toLowerCase();
  if (/timeout|timed out|abort/.test(m)) return 'timeout';
  if (/no key|api key|not registered|unreachable|econnrefused|fetch failed|401|403|429|5\d\d/.test(m)) return 'unreachable';
  return 'error';
}

const REPAIR_SYSTEM = 'Rewrite the text you are given as ONE JSON object of the form {"ideas":[{"title","placeQuery","durationMin","why","fit"}],"note": string|null}. Keep only what it says; invent nothing. JSON only.';

async function repairIdeas(reply: string): Promise<unknown> {
  return jsonCall('trips-reader', [
    { role: 'system', content: REPAIR_SYSTEM },
    { role: 'user', content: reply.slice(0, 6000) },
  ], { maxTokens: 1500, timeoutMs: 20_000 });
}

const readable = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);

async function plannerDrafts(
  trip: TripRecord,
  state: { stays: Stay[]; wishes: Wish[] },
  prompt: string,
  deps: IdeasDeps,
): Promise<{ drafts: IdeaDraft[]; note: string | null; research: ResearchStep[]; failure: PlannerFailure | null }> {
  let research: ResearchStep[] = [];
  let reply: string;
  try {
    const deadline = deps.plannerMs ?? IDEAS_PLANNER_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const turn = await Promise.race([
      (deps.agent ?? agentTurn)(
        [
          { role: 'system', content: IDEAS_SYSTEM },
          { role: 'user', content: prompt },
        ],
        { trip, stays: state.stays, wishes: state.wishes },
        { finalPrompt: 'Answer now with the JSON object only ({"ideas": [...], "note": ...}) — no more lookups.', budget: IDEAS_BUDGET, timeoutMs: 45_000 },
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('ideas planner timed out')), deadline);
      }),
    ]).finally(() => clearTimeout(timer));
    research = turn.research;
    reply = turn.reply;
  } catch (err) {
    const failure = failureKind(err);
    console.warn(`[trips/ideas] planner ${failure}:`, (err as Error)?.message);
    return { drafts: [], note: null, research, failure };
  }
  let raw = parseLooseJson(reply);
  if (!readable(raw)) {
    console.warn(`[trips/ideas] unreadable planner answer (${reply.length} chars); one repair`);
    raw = await (deps.repair ?? repairIdeas)(reply).catch((err) => {
      console.warn('[trips/ideas] repair failed:', (err as Error)?.message);
      return null;
    });
    if (!readable(raw)) return { drafts: [], note: null, research, failure: 'unreadable' };
  }
  const { ideas: drafts, note } = readIdeas(raw);
  return { drafts, note, research, failure: null };
}

// ── The deterministic fallback (v6) ─────────────────────────────────────────

async function nearbyIdeas(
  trip: TripRecord,
  gap: Gap,
  wishes: Wish[],
  deps: IdeasDeps,
): Promise<{ candidates: NearbyCandidate[]; note: string | null }> {
  const centre = gapCentre(gap);
  if (!centre) return { candidates: [], note: 'the slot has no position to search around' };
  const radius = nearbyRadiusM(gap);
  const query = nearbyIdeasQuery(gap, centre, radius);
  let answer = await Promise.resolve()
    .then(() => (deps.overpass ? deps.overpass(query) : overpass(query, { attempts: 1, timeoutMs: 12_000 })))
    .catch((err) => {
      console.warn('[trips/ideas] Overpass failed:', (err as Error)?.message);
      return null;
    });
  if (!answer) {
    // The public Overpass is often busy (504): Nominatim's bounded search, a few paced terms.
    console.warn('[trips/ideas] Overpass unavailable; trying Nominatim');
    const box = viewboxAround(centre, radius);
    const rows: unknown[] = [];
    for (const term of nominatimTerms(gap)) {
      rows.push(...(await Promise.resolve().then(() => (deps.nominatim ?? nominatimAround)(term, box)).catch(() => [])));
    }
    answer = rows.length ? { elements: elementsFromNominatim(rows) } : null;
  }
  if (!answer) {
    console.warn('[trips/ideas] nearby search unavailable');
    return { candidates: [], note: 'OpenStreetMap did not answer' };
  }
  const candidates = nearbyCandidates(answer, gap, wishes, dietaryHints(trip.profile));
  return { candidates, note: candidates.length ? null : 'no places found nearby' };
}
