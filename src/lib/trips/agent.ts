// src/lib/trips/agent.ts
//
// The planner's own research (v3), the pure half: the tools it is offered,
// the per-turn budget (at most 6 tool calls, at most 4 web searches — D4 as
// relaxed for v3), how a tool call becomes a `ResearchStep` the person sees
// under the reply, and how a flight-status answer becomes times. The tool
// bodies are in ./agent.server.

import type { ResearchStep } from './model';

export const BUDGET = { calls: 6, searches: 4 } as const;

/** v6: the "Make a suggestion" turn is smaller, so it answers in time. */
export const IDEAS_BUDGET = { calls: 4, searches: 2 } as const;

export interface BudgetLimits {
  calls: number;
  searches: number;
}

/** Tools that spend a web search from the budget. */
const SEARCHING = new Set(['web_search', 'flight_lookup']);

export interface Budget {
  calls: number;
  searches: number;
}

export function newBudget(): Budget {
  return { calls: 0, searches: 0 };
}

/**
 * May this call run? Counts it when it may. A refused call is answered with
 * the reason, so the model learns to stop and answer instead.
 */
export function spend(budget: Budget, tool: string, limits: BudgetLimits = BUDGET): { ok: true } | { ok: false; reason: string } {
  if (budget.calls >= limits.calls) return { ok: false, reason: `Research budget used (${limits.calls} lookups this turn). Answer now with what you have.` };
  if (SEARCHING.has(tool) && budget.searches >= limits.searches) {
    return { ok: false, reason: `Web search budget used (${limits.searches} searches this turn). Use what you have, or a non-search tool.` };
  }
  budget.calls++;
  if (SEARCHING.has(tool)) budget.searches++;
  return { ok: true };
}

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

/** The toolset, in the chat-completions shape every caller of the tool loop uses. */
export const PLANNER_TOOLS = [
  fn('web_search', 'Search the web once. Use when a fact matters to the plan and is not in the trip: a schedule, whether something needs booking, a closure.', { query: { type: 'string' } }, ['query']),
  fn('read_page', 'Read one public web page (text only, first few thousand characters) — e.g. an official site found by web_search.', { url: { type: 'string' } }, ['url']),
  fn('find_place', 'Find a place on OpenStreetMap: name, address, position, opening_hours and website tags.', { query: { type: 'string' } }, ['query']),
  fn('opening_hours', 'Opening hours of a place on a given date (from its researched facts or OpenStreetMap).', { place: { type: 'string', description: 'A wish id from the trip, or a place name.' }, date: { type: 'string', description: 'YYYY-MM-DD' } }, ['place', 'date']),
  fn('travel_time', 'How long to get from one place to another by a mode (walk, transit, taxi, drive, cycle). Places are names, a wish id, or "stay".', { from: { type: 'string' }, to: { type: 'string' }, mode: { type: 'string', enum: ['walk', 'transit', 'taxi', 'drive', 'cycle'] }, date: { type: 'string' }, departMin: { type: 'number', description: 'Local minutes after midnight' } }, ['from', 'to', 'mode']),
  fn('flight_lookup', 'Scheduled times, airports and terminal for a flight by number and date (from a flight-status service when one is configured, else a web search you then read).', { number: { type: 'string', description: 'e.g. LS1235' }, from: { type: 'string', description: 'Departure airport or city' }, to: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD, local departure date' } }, ['date']),
  fn('recall', 'Search the owner’s own memory and notes for something relevant to the trip (preferences, past trips, people).', { query: { type: 'string' } }, ['query']),
];

export const AGENT_GUIDANCE = `You may research on your own with tools before answering — at most ${BUDGET.calls} lookups and ${BUDGET.searches} web searches per turn:
- Look things up when a fact matters to the plan and you do not have it: when a flight lands, opening hours on the day, whether a place takes bookings, how long a transfer takes. Do not research for its own sake.
- Reason about the gaps: e.g. a flight landing at 11:05 → about 40 min to get out of the airport → the transfer to the stay → hotel check-in at 15:00 → is there time to drop bags and see something, and is it lunchtime? Propose what fits, and say the times you are assuming and where they came from.
- When they mention a flight or train without its full times or number, call flight_lookup FIRST (with the number if given, else from, to and date) before asking them. Try before you ask.
- Times you found online are 'researched', not certain: say so, and record the journey with addTransport (confidence "researched", its sources) so the plan is framed by it. If a lookup finds nothing, you may still record it with an arrival estimated from the usual journey time (e.g. Newcastle → Rome is about 2h45 in the air, plus one hour of time difference), confidence "researched" and no sources — and say plainly in the reply that the arrival is your estimate and ask them to confirm the flight number. A rough frame now beats an unframed first day.
- When you have what you need, answer with the JSON object only (reply, ops, quickReplies) — no tool call in the final answer.`;

/** Turn one tool call and its outcome into the line shown under the reply. */
export function researchStep(tool: string, args: Record<string, unknown>, outcome: { summary?: string; sources?: Array<{ url: string; title: string | null }>; error?: string }): ResearchStep {
  const q = (k: string) => (typeof args[k] === 'string' ? String(args[k]).slice(0, 80) : '');
  const what: Record<string, string> = {
    web_search: `Searched “${q('query')}”`,
    read_page: `Read ${q('url').replace(/^https?:\/\//, '').slice(0, 60)}`,
    find_place: `Looked up ${q('query')} on OpenStreetMap`,
    opening_hours: `Checked opening hours of ${q('place')} on ${q('date')}`,
    travel_time: `Timed ${q('from')} → ${q('to')} (${q('mode')})`,
    flight_lookup: `Looked up flight ${[q('number'), q('from') && q('to') ? `${q('from')} → ${q('to')}` : ''].filter(Boolean).join(' ')} on ${q('date')}`,
    recall: `Checked what I know about “${q('query')}”`,
  };
  const head = what[tool] ?? `Used ${tool}`;
  return {
    tool,
    summary: outcome.error ? `${head} — ${outcome.error}` : outcome.summary ? `${head}: ${outcome.summary}` : head,
    sources: (outcome.sources ?? []).slice(0, 5),
  };
}

export interface FlightTimes {
  number: string;
  carrier: string | null;
  from: { name: string; code: string | null; timeZone: string | null; terminal: string | null };
  to: { name: string; code: string | null; timeZone: string | null; terminal: string | null };
  departDate: string;
  departMin: number;
  arriveDate: string;
  arriveMin: number;
  status: string | null;
}

/** "2026-10-27 07:35+00:00" (AeroDataBox local time) → date and minutes. */
function localStamp(v: unknown): { date: string; min: number } | null {
  const m = typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(v) : null;
  return m ? { date: m[1], min: Number(m[2]) * 60 + Number(m[3]) } : null;
}

/** An AeroDataBox `/flights/number/{n}/{date}` answer → the first flight's times, or null. */
export function readAeroDataBox(raw: unknown, number: string): FlightTimes | null {
  const f = Array.isArray(raw) ? (raw[0] as Record<string, any> | undefined) : null;
  if (!f) return null;
  const dep = f.departure ?? {};
  const arr = f.arrival ?? {};
  const d = localStamp(dep.scheduledTime?.local ?? dep.scheduledTimeLocal);
  const a = localStamp(arr.scheduledTime?.local ?? arr.scheduledTimeLocal);
  if (!d || !a) return null;
  const end = (x: Record<string, any>) => ({
    name: String(x.airport?.name ?? x.airport?.municipalityName ?? 'airport'),
    code: typeof x.airport?.iata === 'string' ? x.airport.iata : null,
    timeZone: typeof x.airport?.timeZone === 'string' ? x.airport.timeZone : null,
    terminal: typeof x.terminal === 'string' ? x.terminal : null,
  });
  return {
    number: String(f.number ?? number).replace(/\s+/g, ''),
    carrier: typeof f.airline?.name === 'string' ? f.airline.name : null,
    from: end(dep),
    to: end(arr),
    departDate: d.date,
    departMin: d.min,
    arriveDate: a.date,
    arriveMin: a.min,
    status: typeof f.status === 'string' ? f.status : null,
  };
}
