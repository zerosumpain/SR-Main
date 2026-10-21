// src/lib/trips/prompt.ts
//
// What the planner model is told on each turn of the conversation (v2): a
// system prompt that fixes its job and its output, and a context message with
// the trip as it stands — details, stays, wishes with their facts, bookings,
// the solved plan per day, what is still missing, the time now in the trip's
// zone and, from the phone, what the phone has noticed. Then the last ~30
// messages. PURE.

import { DAY_STAGES, DAY_STAGE_LABEL, type Booking, type LocalDate, type Observation, type SolvedPlan, type Stay, type TransportSegment, type TravellerProfile, type Trip, type TripMessage, type Wish } from './model';
import type { PackPlace, Proposal, Question, TripBrief } from './decisions';
import { FACT_SOURCE_LABEL } from './decisions';
import { dayBrief } from './stages';
import { AGENT_GUIDANCE } from './agent';
import { profileText } from './profile';

export const HISTORY_MESSAGES = 30;

/** The destination a trip started from an opening message has until the planner sets one. */
export const NEW_TRIP = 'New trip';

export const PLANNER_SYSTEM = `You are the trip planner on strangeramblings.com, working with the owner on one trip. You change the trip ONLY through operations ("ops"); a solver then builds the day-by-day schedule from them. You never write the schedule yourself.

ACT, PROPOSE OR ASK — decide every turn by this rule, and never answer with words alone when you could act or propose:
- Clear, small and reversible ("move Trevi to Thursday", "add the Pantheon on Tuesday morning", "make Wednesday lighter"): ACT — put the change in "ops". They see what changed, with Undo.
- Clear but large (more than 4 stops would move, or a booked or locked slot is involved): PROPOSE it — one "change" proposal carrying those ops, for them to approve. Do not also put it in "ops".
- Open ("something for Monday evening", "add some ideas", "it's raining", "what shall we do?"): PROPOSE 2 or 3 alternatives as one group, different in kind (a museum, a walk, a market; or three kinds of food) — "fill" for an empty part of a day or a meal, "swap" to replace a stop, "day" for a version of a whole day. Draw them from the RESEARCH PACK when it has candidates (give its "packPlaceId"). A reply that mentions places or changes MUST carry them as ops or proposals: never describe ideas without the cards.
- A missing or uncertain fact that changes the plan (no stay yet, who is coming, how late they eat): never stop for it. ASSUME something sensible, set it with an op marked "source": "assumed", say so in a short clause, and ask for it with ONE question card whose default answer is your assumption. Never ask in prose what a card can ask; never ask what the brief already knows.
- Nothing you can do: say so in one line and offer what you can.
At most one question card a turn. Never repeat an open proposal or an open question listed in the context.

Where facts come from: an op that sets a fact (a stay, a journey, a booking, the destination, dates or pace) carries "source": "you" (they said it), "notes" (from what you already know about them — the profile, their notes), "found" (from a lookup this turn) or "assumed" (your working guess), and may carry "sourceNote" (a short phrase, e.g. "Airbnb booking in your notes"). Never pass a guess off as a fact.

How to work:
- The brief in the context is what you know and where it came from. When something needed is missing — where and when, where they are staying, who is travelling, the pace, how they get about, what they want to do — assume and ask as above, most important first.
- As soon as they name where they are staying (a hotel, an address, even "near Campo de' Fiori"), add it with addStay for the nights of the trip (fromDate = first night, toDate = the morning they leave) — a stay is what every day starts and ends at. Without one, the days are planned from the centre (say so).
- Mark only what they call essential as "must". Offer nearby ideas as proposals, not as unexplained additions.
- Explain the plan: when the plan has warnings, dropped wishes or bookings due soon, say what and why in plain words, and offer the fix as a proposal or a quick reply ("The Borghese needs booking about 3 weeks ahead — add it to the checklist?").
- Re-develop on request ("swap the Vatican to the morning"): change the wishes (priority, day, part of day, lock, skip) and let the solver re-plan. Bookings the person has made are hard slots; do not move them unless asked.
- "Make <day> lighter", "a rest day", "an easy morning": set that day's load with setTrip {"dayLoads": {"<date>": "light"}} (it merges with the other days; "full" lets a day run long, "normal" resets it). Do not delete wishes to lighten a day unless asked; nice-to-haves move or drop on their own.
- Think about each day in its four stages — breakfast & morning, lunch, afternoon, dinner & evening — and talk in them ("for Wednesday lunch…", "Thursday evening is free"). Every day, whatever the pace, has a planned breakfast (at the stay unless a wish replaces it), lunch and dinner (around 19:00–21:30); sightseeing ends earlier, and "Free time at <the stay>" before dinner is deliberate rest, not a gap to fill unless they ask.
- A meal that IS an activity ("breakfast at a café in Monti", "a long lunch in Trastevere on Thursday", "dinner at Roscioli"): add ONE wish with "replacesMeal": "breakfast", "lunch" or "dinner", its "fixedDate", and a duration; the automatic meal stop that day is then dropped. Do not also add a separate meal.
- Use what you already know about them (the profile below) without being asked, and say when you did ("you prefer walking, so…"). When they state a LASTING preference ("we never do early starts", "my partner is vegetarian"), save it with a "remember" op and say in the reply that you will remember it; correct the profile with "updateProfile" when they tell you something in it is wrong. Never remember one-off trip details.
- Getting there and back: when they mention a flight, train or similar, record it with "addTransport" so the arrival and departure days are framed by it. Times they give are "stated"; times you found are "researched".
- Never book anything and never claim to have booked. Never invent a booking link, phone number or price: only use links already in the trip (researched facts, the trip guide) or ones the person gave you. If you do not know, say so and offer to research (op "research").
- Places are looked up on OpenStreetMap from your placeQuery: give a precise query ("Pantheon, Rome", "Via dei Cappellari 10, Rome"), never coordinates. A research-pack place needs no placeQuery: give its "packPlaceId".
- British English. Short, warm and direct: a few sentences, no lists longer than five lines, no headings, no emoji. Times as 24-hour (14:30), dates as "Tue 27 Oct".

Answer ONLY with one JSON object:
{"reply": string, "ops": Op[], "quickReplies": string[], "proposals": Proposal[], "questions": Question[]}
- "reply": what you say to the person (it is shown whether or not every op succeeds). Say what you did, what you assumed, and point to the cards; do not list the cards' contents again.
- "proposals" (or []): each {"kind": "fill"|"swap"|"day"|"change", "title" (the place, or the change in a few words), "why" (one sentence: what it is and why it suits them), "group" (the same short word for alternatives to each other, e.g. "mon-dinner"), "scope": {"date": "YYYY-MM-DD", "stage": "morning"|"lunch"|"afternoon"|"evening", "wishId"? (the stop a swap replaces)}, "packPlaceId"? (the research-pack id it is), "ops": Op[] (what accepting it does — a fill: one addWish with "fixedDate" and the part of the day, "replacesMeal" for a meal; a swap: removeWish of the stop, then addWish), "indoor"?: true|false, "kidFriendly"?: true|false, "costText"? (only when known: "Free", "About €15 each")}
- "questions" (or [], at most one): {"key" (short and stable, e.g. "eat-late"), "prompt" (one line), "why" (what it changes, e.g. "Changes Wednesday afternoon"), "answers": [{"label" (at most 28 characters), "ops": Op[] (what choosing it does; [] for the answer you already assumed)}] (2 to 4), "defaultIndex" (the answer you assumed), "ifSkipped" (what you will keep assuming)}
- "quickReplies": up to 4 short things the person might say next, written in their voice ("Make Thursday lighter", "Yes, add it").
- Op is one of (ids are the ones shown in the trip context; dates YYYY-MM-DD; times are minutes after midnight, local). Any op may also carry "source" and "sourceNote":
  {"op":"setTrip","fields":{"title"?,"destination"?,"timeZone"? (IANA, e.g. "Europe/Rome"),"startDate"?,"endDate"?,"pace"? ("relaxed"|"normal"|"packed"),"modes"? (subset of ["walk","cycle","drive","transit","taxi"]),"notes"?,"dayLoads"? ({"YYYY-MM-DD": "light"|"normal"|"full"}, merged)}}
  {"op":"addStay","name","placeQuery","fromDate" (first night),"toDate" (morning of departure),"checkInMin","checkOutMin"}
  {"op":"updateStay","id","fields":{"name"?,"fromDate"?,"toDate"?,"checkInMin"?,"checkOutMin"?,"placeQuery"?}}
  {"op":"removeStay","id"}
  {"op":"addWish","wish":{"title","placeQuery","priority" ("must"|"nice"),"durationMin","partOfDay" ("morning"|"afternoon"|"evening"|"any"),"fixedDate","fixedStartMin","note","replacesMeal" ("breakfast"|"lunch"|"dinner"|null)}}
  {"op":"updateWish","id","fields":{"title"?,"placeQuery"?,"priority"?,"durationMin"?,"partOfDay"?,"fixedDate"? (null = any day),"fixedStartMin"?,"note"?,"locked"?,"skipped"?,"replacesMeal"? ("breakfast"|"lunch"|"dinner"|null),"suggested"? (only false: accept a suggestion)}}
  {"op":"removeWish","id"}
  {"op":"addBooking","booking":{"wishId","title","date","startMin","endMin","reference","url","documentId":null,"status" ("to-book"|"booked"|"cancelled")}}
  {"op":"updateBooking","id","fields":{"status"?,"reference"?,"date"?,"startMin"?,"endMin"?,"url"?}}
  {"op":"research","wishIds":[...],"depth":"brief"|"deep"}
  {"op":"addTransport","segment":{"kind" ("flight"|"train"|"coach"|"ferry"|"car"),"direction" ("outbound"|"return"|"internal"),"carrier","number","from":{"name","code" (IATA/station code or null),"timeZone"},"to":{"name","code","timeZone"},"departDate","departMin","arriveDate","arriveMin" (each LOCAL to its own end),"confidence" ("stated"|"researched"|"estimated"),"bookingRef","sources":[{"url","title"}] (only URLs you saw this turn)}}
  {"op":"updateTransport","id","fields":{...any of the segment's fields}}
  {"op":"removeTransport","id"}
  {"op":"remember","text": the lasting preference in one sentence,"category" ("preferences"|"people"|"health"|"places")}
  {"op":"updateProfile","profile":{"travellers"?:[{"name","relation","notes":[]}],"preferences"?:[{"text"}],"constraints"?:[{"text"}],"history"?:[string]}} (arrays given REPLACE the profile's)
  {"op":"suggestNearby","near": a place name or null,"theme": e.g. "food" or null}
- Use [] for ops when nothing should change (a proposal to approve, a question, an explanation).`;

/**
 * v8: the one correction a turn gets when its reply promised ideas or
 * changes and carried none (Darlington's "I've added a few ideas" with
 * nothing added — ./decisions `emptyPromise`).
 */
export const EMPTY_PROMISE_CORRECTION =
  'Your reply talks about adding, suggesting or planning places, but it carries no ops and no proposals, so the person would see nothing to use. Answer again with the same JSON object: put each change you described in "ops" (if they asked for it plainly) or each idea in "proposals" (2 or 3 alternatives in one group, from the research pack when it has candidates). If there is truly nothing you can do, say so in one line with "ops": [] and "proposals": [].';

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;

function day(date: LocalDate): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** What the planner still needs to ask for. */
export function missingInfo(trip: Trip, stays: Stay[], wishes: Wish[]): string[] {
  const out: string[] = [];
  if (!trip.destination || trip.destination === NEW_TRIP) out.push('destination, and the first and last day (the dates shown are placeholders)');
  if (trip.notes === null && trip.status === 'draft') out.push('who is travelling (not recorded yet)');
  if (!stays.length) out.push('where they are staying');
  else {
    const covered = new Set<string>();
    for (const s of stays) for (let d = s.fromDate; d < s.toDate; d = addDays(d, 1)) covered.add(d);
    const gaps: string[] = [];
    for (let d = trip.startDate; d < trip.endDate; d = addDays(d, 1)) if (!covered.has(d)) gaps.push(day(d));
    if (gaps.length) out.push(`a stay for the night(s) of ${gaps.join(', ')}`);
  }
  if (!wishes.filter((w) => !w.suggested).length) out.push('what they want to do');
  if (wishes.some((w) => !w.suggested && !w.skipped && !w.place)) out.push('a findable place for: ' + wishes.filter((w) => !w.suggested && !w.skipped && !w.place).map((w) => w.title).join(', '));
  return out;
}

function addDays(date: LocalDate, n: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

function wishLine(w: Wish): string {
  const bits = [`${w.priority}`];
  if (w.suggested) bits.push('SUGGESTION (not planned until accepted)');
  if (w.skipped) bits.push('skipped');
  if (w.locked) bits.push('locked');
  if (w.partOfDay !== 'any') bits.push(w.partOfDay);
  if (w.replacesMeal) bits.push(`is that day's ${w.replacesMeal}`);
  if (w.fixedDate) bits.push(`on ${day(w.fixedDate)}${w.fixedStartMin !== null ? ` at ${hhmm(w.fixedStartMin)}` : ''}`);
  if (w.durationSec) bits.push(`${Math.round(w.durationSec / 60)} min`);
  bits.push(w.place ? `at ${w.place.name}` : 'NO PLACE YET');
  const f = w.facts;
  if (f) {
    if (f.bookingRequired) bits.push(`booking required${f.bookAheadDays !== null ? `, ~${f.bookAheadDays} days ahead` : ''}`);
    if (f.openingHoursText) bits.push(`hours ${f.openingHoursText}`);
    if (f.bookingUrl) bits.push(`official tickets ${f.bookingUrl}`);
    if (f.unknown.length) bits.push(`unknown: ${f.unknown.join(', ')}`);
  } else bits.push('not researched');
  return `- [${w.id}] ${w.title} — ${bits.join('; ')}`;
}

/** The solved plan in a few lines per day. */
export function planSummary(plan: SolvedPlan | null, wishes: Wish[]): string {
  if (!plan) return 'No plan yet.';
  const title = new Map(wishes.map((w) => [w.id, w.title]));
  const lines: string[] = [];
  for (const d of plan.days) {
    const brief = dayBrief(d);
    lines.push(`${day(d.date)} by stage: ${DAY_STAGES.map((st) => `${DAY_STAGE_LABEL[st]}: ${brief[st].join(', ') || 'free'}`).join(' | ')}`);
    const stops = d.stops
      .filter((s) => s.kind !== 'stay')
      .map((s) => {
        const leg = d.legs.find((l) => l.toStopId === s.id);
        return `${hhmm(s.arriveMin)}–${hhmm(s.departMin)} ${s.title}${leg ? ` (${leg.mode} ${Math.round(leg.durationSec / 60)} min)` : ''}${s.warnings.length ? ` [${s.warnings.join('; ')}]` : ''}`;
      });
    lines.push(`${day(d.date)}: ${stops.length ? stops.join(' → ') : 'free'}${d.warnings.length ? ` | warnings: ${d.warnings.join('; ')}` : ''}`);
  }
  if (plan.dropped.length) lines.push(`Not planned: ${plan.dropped.map((x) => `${title.get(x.wishId) ?? x.wishId} (${x.reason})`).join('; ')}`);
  if (plan.warnings.length) lines.push(`Trip warnings: ${plan.warnings.join('; ')}`);
  return lines.join('\n');
}

export interface PlannerContext {
  trip: Trip;
  stays: Stay[];
  wishes: Wish[];
  bookings: Booking[];
  plan: SolvedPlan | null;
  planVersion: number | null;
  messages: TripMessage[];
  /** "Wed 14 Oct, 09:12" in the trip's zone. */
  nowText: string;
  surface: 'site' | 'phone';
  observation: Observation | null;
  position: { lat: number; lng: number } | null;
  /** v3 */
  transport?: TransportSegment[];
  profile?: TravellerProfile | null;
  /** v5: the person talking cannot change this trip — advice only, no ops. */
  adviceOnly?: boolean;
  callerName?: string | null;
  /** v8: what the planner knows and where each fact came from (the caller's view: no memory text for anyone but the owner). */
  brief?: TripBrief | null;
  /** v8: research-pack candidates the planner may propose by id (≤ PACK_IN_PROMPT). */
  pack?: PackPlace[];
  /** v8: proposals and questions already open, so the planner does not repeat them. */
  openProposals?: Proposal[];
  openQuestions?: Question[];
}

/** At most this many research-pack places go into one planner turn. */
export const PACK_IN_PROMPT = 40;

/** The brief, one line per fact, assumptions flagged so the planner says so and corrects them when told. */
export function briefText(brief: TripBrief): string[] {
  return brief.items.map((i) => {
    const origin = i.origin === 'assumed' ? 'ASSUMED by you' : FACT_SOURCE_LABEL[i.origin].toLowerCase();
    return `- ${i.label}${i.detail ? ` — ${i.detail}` : ''} (${origin}${i.note && i.origin !== 'assumed' ? `: ${i.note}` : ''})`;
  });
}

function packLine(p: PackPlace): string {
  const bits = [p.kind, p.neighbourhood, p.indoor === true ? 'indoor' : p.indoor === false ? 'outdoor' : null, p.kidFriendly ? 'good for children' : null, p.lessVisited ? 'less visited' : null, p.costText, p.durationMin ? `~${p.durationMin} min` : null, p.bookingRequired ? `book${p.bookAheadDays ? ` ~${p.bookAheadDays} days ahead` : ' ahead'}` : null].filter(Boolean);
  return `- [${p.id}] ${p.name} (${bits.join('; ')})${p.why ? ` — ${p.why}` : ''}`;
}

/** The trip as it stands, as one user-role context message. */
export function contextText(c: PlannerContext): string {
  const t = c.trip;
  const lines = [
    `TRIP (as it stands; the person is talking to you on the ${c.surface === 'phone' ? 'phone, possibly while out' : 'website'})`,
    `Now in the trip's zone: ${c.nowText}`,
    ...(c.callerName ? [`Talking to: ${c.callerName}`] : []),
    ...(c.adviceOnly
      ? ['THIS PERSON CANNOT CHANGE THE TRIP: give advice only and return "ops": []. If they want something added, tell them to use "Make a suggestion" on that slot so a parent can approve it.']
      : []),
    `Destination: ${t.destination} | ${day(t.startDate)} to ${day(t.endDate)} (${t.startDate} → ${t.endDate}) | zone ${t.timeZone} | pace ${t.pace} | getting about: ${t.modes.join(', ')}${t.notes ? ` | notes: ${t.notes}` : ''}`,
    `Day loads: ${Object.keys(t.dayLoads ?? {}).length ? Object.entries(t.dayLoads ?? {}).map(([d, l]) => `${day(d)} ${l}`).join(', ') : 'all normal'}`,
    '',
    profileText(c.profile ?? null),
    '',
    'GETTING THERE AND BACK:',
    ...((c.transport ?? []).length
      ? (c.transport ?? []).map(
          (t) =>
            `- [${t.id}] ${t.direction} ${t.kind}${t.number ? ` ${t.number}` : ''}: ${t.from.name}${t.from.code ? ` (${t.from.code})` : ''} ${day(t.departDate)} ${hhmm(t.departMin)} → ${t.to.name}${t.to.code ? ` (${t.to.code})` : ''} ${day(t.arriveDate)} ${hhmm(t.arriveMin)} (${t.confidence}${t.delayMin ? `, ${t.delayMin} min late` : ''})`,
        )
      : ['- none recorded']),
    '',
    'STAYS:',
    ...(c.stays.length ? c.stays.map((s) => `- [${s.id}] ${s.name}${s.address ? ` (${s.address.split(',').slice(0, 3).join(',')})` : ''}: nights ${day(s.fromDate)} → leaves ${day(s.toDate)}`) : ['- none yet']),
    '',
    'WISHES:',
    ...(c.wishes.length ? c.wishes.map(wishLine) : ['- none yet']),
    '',
    'BOOKINGS:',
    ...(c.bookings.length
      ? c.bookings.map((b) => `- [${b.id}] ${b.title}: ${b.status}${b.date ? ` ${day(b.date)}` : ''}${b.startMin !== null ? ` ${hhmm(b.startMin)}` : ''}${b.reference ? ` ref ${b.reference}` : ''}${b.url ? ` ${b.url}` : ''}`)
      : ['- none']),
    '',
    `PLAN${c.planVersion ? ` (version ${c.planVersion})` : ''}:`,
    planSummary(c.plan, c.wishes),
  ];
  const missing = missingInfo(c.trip, c.stays, c.wishes);
  if (missing.length) lines.push('', `STILL MISSING: ${missing.join('; ')}`);
  if (c.brief) lines.push('', 'THE BRIEF (what you know and where it came from; what you ASSUMED is your own guess — say so, and correct it when told):', ...briefText(c.brief));
  if (c.pack?.length) {
    lines.push('', 'RESEARCH PACK (places already researched for this trip, not yet planned — propose from these first, giving the id as "packPlaceId"):', ...c.pack.slice(0, PACK_IN_PROMPT).map(packLine));
  } else if (c.pack) lines.push('', 'RESEARCH PACK: not ready yet — propose real, named places with a precise placeQuery.');
  if (c.openProposals?.length) {
    lines.push(
      '',
      'OPEN PROPOSALS (already offered and waiting for them — do not offer these again):',
      ...c.openProposals.slice(0, 12).map((p) => `- ${p.title} (${p.kind}${p.scope.date ? `, ${day(p.scope.date)}` : ''}${p.scope.stage ? ` ${p.scope.stage}` : ''})`),
    );
  }
  if (c.openQuestions?.length) {
    lines.push(
      '',
      'OPEN QUESTIONS (already asked — do not ask again):',
      ...c.openQuestions.slice(0, 6).map((q) => `- [${q.key}] ${q.prompt} (assumed meanwhile: ${q.answers.find((a) => a.id === q.defaultAnswerId)?.label ?? 'the default'})`),
    );
  }
  if (c.observation) {
    const o = c.observation;
    lines.push(
      '',
      `THE PHONE NOTICED: ${o.kind} since ${hhmm(o.sinceMin)}, ${o.motion}${o.place ? `, at ${o.place.name ?? 'an unnamed place'}` : ''}${o.stopId ? `, stop ${o.stopId}` : ''}.`,
    );
  }
  if (c.position) lines.push(`Phone position: ${c.position.lat.toFixed(5)}, ${c.position.lng.toFixed(5)}`);
  return lines.join('\n');
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** The messages for one planner call: system, the trip context, the recent conversation, the new text. */
export function plannerMessages(c: PlannerContext, text: string, opts: { agentic?: boolean } = {}): ChatMessage[] {
  const history: ChatMessage[] = c.messages.slice(-HISTORY_MESSAGES).map((m) =>
    m.role === 'assistant'
      ? { role: 'assistant', content: m.text }
      : { role: 'user', content: m.role === 'event' ? `[changed directly on the ${m.surface === 'phone' ? 'phone' : 'page'}] ${m.text}` : m.text },
  );
  return [
    { role: 'system', content: opts.agentic ? `${PLANNER_SYSTEM}\n\n${AGENT_GUIDANCE}` : PLANNER_SYSTEM },
    { role: 'user', content: contextText(c) },
    { role: 'assistant', content: '{"reply":"Understood — I have the trip in front of me.","ops":[],"quickReplies":[]}' },
    ...history,
    { role: 'user', content: text },
  ];
}

export const NARRATIVE_SYSTEM = `You are the trip planner on strangeramblings.com. The phone has noticed the person may be off their plan. In two or three short sentences of British English (no emoji, no lists), say plainly what seems to be happening and what you would do, choosing among the options given. If somewhere nearby would suit them right now, you may suggest it as ONE quick reply they could send ("Find me lunch near here"). Never invent links, prices or opening times.
Answer ONLY with JSON: {"narrative": string, "quickReplies": string[]} (at most 3 quick replies).`;
