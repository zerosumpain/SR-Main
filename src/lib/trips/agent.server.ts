// src/lib/trips/agent.server.ts
//
// The planner's agentic turn (v3): one run of `$lib/llm/tool-loop` on the
// `trips-planner` workload with the toolset in ./agent, inside the budget
// (≤6 tool calls, ≤4 web searches). Every search goes through the shared
// Tavily client and its ledger. What it looked up comes back as
// `ResearchStep`s for the person, and every URL it saw joins the turn's known
// links (so a link it found may be stored; one it invented may not).
//
// `flight_lookup` asks AeroDataBox when its key is registered in the secret
// registry (handle `aerodatabox`) and is DORMANT otherwise: it falls back to a
// web search the model reads, and times found that way are 'researched'.

import type OpenAI from 'openai';
import { getLLMClient } from '$lib/llm/client';
import { runToolLoop, type ToolLoopCall } from '$lib/llm/tool-loop';
import { getWorkload } from '$lib/models/workloads';
import { resolveWorkloadModel } from '$lib/server/models/workload-settings';
import { BUDGET, newBudget, PLANNER_TOOLS, readAeroDataBox, researchStep, spend, type BudgetLimits } from './agent';
import { localDateIn, localToIso, timetableDate } from './routing';
import type { LatLng, ResearchStep, Stay, TravelMode, Wish } from './model';
import { estimateLeg, windowsOn } from '$lib/trips/solver';
import { withinReach } from './research';
import { findPlace, findPlaceLoosely } from './research.server';
import type { TripRecord } from './store.server';
import { PLANNER_TURN_MS } from './limits';

const USER_AGENT = 'StrangeRamblingsTrips/1.0 (+https://strangeramblings.com)';
export const AERODATABOX_HANDLE = 'aerodatabox';
const AERODATABOX_HOST = 'aerodatabox.p.rapidapi.com';

export interface AgentContext {
  trip: TripRecord;
  stays: Stay[];
  wishes: Wish[];
}

export interface AgentResult {
  /** The model's final text (the JSON answer). */
  reply: string;
  research: ResearchStep[];
  /** URLs the research saw — may be stored when cited. */
  seenUrls: string[];
  toolCalls: number;
}

/** Tool bodies, swappable in tests. Each returns the text the model reads and the step the person sees. */
export interface AgentTools {
  run(call: ToolLoopCall, ctx: AgentContext): Promise<{ content: string; summary?: string; sources?: Array<{ url: string; title: string | null }>; error?: string }>;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

async function webSearch(query: string, purpose: string) {
  const { search } = await import('$lib/deepdive/tavily');
  const found = await search(query, { purpose, maxResults: 5, searchDepth: 'basic' });
  return (found.results ?? []).map((r) => ({ title: r.title, url: r.url, content: clip(r.content ?? '', 600) }));
}

/** Coordinates written into a place argument ("41.89020, 12.49220 (Lunch)"). */
export function coordsIn(text: string): LatLng | null {
  const m = /(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

const stayPoints = (ctx: AgentContext): LatLng[] => ctx.stays.map((x) => x.location);

/** Where a tool argument names a place: coordinates, "stay", a wish id, or a name to look up near the trip. */
async function locate(name: string, ctx: AgentContext): Promise<{ name: string; location: LatLng } | null> {
  const n = name.trim();
  const at = coordsIn(n);
  if (at) return { name: n.replace(/^[-\d.,\s]+/, '').replace(/[()]/g, '').trim() || 'there', location: at };
  if (/^stay$/i.test(n) && ctx.stays[0]) return { name: ctx.stays[0].name, location: ctx.stays[0].location };
  const w = ctx.wishes.find((x) => x.id === n || x.title.toLowerCase() === n.toLowerCase());
  if (w?.place) return { name: w.place.name, location: w.place.location };
  const near = ctx.stays[0]?.location ?? null;
  const p = await findPlaceLoosely(n, ctx.trip.destination, near);
  // A namesake on another continent is not the place: refuse anything beyond PLACE_REACH_M (300 km) of every stay.
  if (p && !withinReach(p.location, stayPoints(ctx))) return null;
  return p ? { name: p.name, location: p.location } : null;
}

async function aeroDataBox(number: string, date: string): Promise<unknown | null> {
  const url = `https://${AERODATABOX_HOST}/flights/number/${encodeURIComponent(number)}/${date}?withAircraftImage=false&withLocation=false`;
  let headers: Record<string, string> | null = null;
  try {
    const { resolveSecretForUrl } = await import('$lib/secrets/registry');
    headers = (await resolveSecretForUrl(AERODATABOX_HANDLE, url, 'GET')).headers ?? null;
  } catch {
    headers = null; // dormant until the owner registers a key
  }
  if (!headers) return null;
  const res = await fetch(url, { headers: { ...headers, 'X-RapidAPI-Host': AERODATABOX_HOST, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  return res.ok ? res.json() : null;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** The real tools. */
export const LIVE_TOOLS: AgentTools = {
  async run(call, ctx) {
    const a = call.args;
    const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '');
    switch (call.name) {
      case 'web_search': {
        const results = await webSearch(s('query'), 'trips.agent');
        return { content: JSON.stringify(results), summary: `${results.length} results`, sources: results.slice(0, 3).map((r) => ({ url: r.url, title: r.title })) };
      }
      case 'read_page': {
        const { guardedPublicFetch } = await import('$lib/server/safe-fetch');
        const res = await guardedPublicFetch(s('url'), { timeoutMs: 8_000, maxBytes: 400_000, readBody: (st, h) => st < 400 && /text\/html|text\/plain/.test(h.get('content-type') ?? '') });
        if (!res.ok || !res.body.byteLength) return { content: 'Could not read that page.', error: 'could not read it' };
        const text = new TextDecoder()
          .decode(res.body)
          .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return { content: clip(text, 4000), sources: [{ url: res.finalUrl, title: null }] };
      }
      case 'find_place': {
        const found = await findPlaceLoosely(s('query'), ctx.trip.destination, ctx.stays[0]?.location ?? null);
        const p = found && withinReach(found.location, stayPoints(ctx)) ? found : null;
        if (!p) return { content: 'Not found on OpenStreetMap.', error: 'not found' };
        return { content: JSON.stringify(p), summary: p.name, sources: p.website ? [{ url: p.website, title: p.name }] : [] };
      }
      case 'opening_hours': {
        const date = s('date');
        const w = ctx.wishes.find((x) => x.id === s('place') || x.title.toLowerCase() === s('place').toLowerCase());
        let facts = w?.facts ?? null;
        let text = facts?.openingHoursText ?? null;
        if (!text) {
          const p = await findPlace(`${s('place')}, ${ctx.trip.destination}`, ctx.stays[0]?.location ?? null);
          // A far namesake's hours are not this place's.
          text = p && withinReach(p.location, stayPoints(ctx)) ? p.openingHoursText : null;
          if (text) facts = { ...(facts ?? ({} as NonNullable<Wish['facts']>)), openingHoursText: text, hours: null, closedDates: [] };
        }
        if (!text) return { content: 'Opening hours unknown.', error: 'unknown' };
        const windows = windowsOn(facts, date);
        const day = windows === null ? 'unknown that day' : windows.length ? windows.map((x) => `${hhmm(x.openMin)}–${hhmm(x.closeMin)}`).join(', ') : 'closed';
        return { content: JSON.stringify({ openingHours: text, onDate: day }), summary: day };
      }
      case 'travel_time': {
        const [from, to] = await Promise.all([locate(s('from'), ctx), locate(s('to'), ctx)]);
        if (!from || !to) return { content: 'Could not place one end on the map.', error: 'could not place it' };
        const mode = (['walk', 'transit', 'taxi', 'drive', 'cycle'].includes(s('mode')) ? s('mode') : 'walk') as TravelMode;
        if (mode === 'transit') {
          const date = s('date') || ctx.trip.startDate;
          const when = localToIso(timetableDate(date, localDateIn(ctx.trip.timeZone, new Date())), Number(a.departMin) || 600, ctx.trip.timeZone);
          const url = new URL('https://api.transitous.org/api/v1/plan');
          url.searchParams.set('fromPlace', `${from.location.lat},${from.location.lng}`);
          url.searchParams.set('toPlace', `${to.location.lat},${to.location.lng}`);
          url.searchParams.set('time', when);
          url.searchParams.set('numItineraries', '2');
          const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12_000) }).catch(() => null);
          const data = res?.ok ? ((await res.json()) as { itineraries?: Array<{ duration?: number; legs?: Array<{ mode?: string; routeShortName?: string; from?: { name?: string } }> }> }) : null;
          const it = data?.itineraries?.[0];
          if (it?.duration) {
            const rides = (it.legs ?? []).filter((l) => l.mode && l.mode !== 'WALK').map((l) => `${l.mode} ${l.routeShortName ?? ''} from ${l.from?.name ?? '?'}`.trim());
            const min = Math.round(it.duration / 60);
            return { content: JSON.stringify({ minutes: min, rides, source: 'Transitous timetable' }), summary: `about ${min} min by public transport`, sources: [{ url: 'https://transitous.org/sources/', title: 'Transitous' }] };
          }
        }
        const leg = estimateLeg(from.location, to.location, mode === 'taxi' ? 'drive' : mode);
        const min = Math.round(leg.seconds / 60) + (mode === 'taxi' ? 8 : 0);
        return { content: JSON.stringify({ minutes: min, km: Math.round(leg.metres / 100) / 10, estimated: true }), summary: `about ${min} min (estimated from distance)` };
      }
      case 'flight_lookup': {
        const number = s('number').replace(/\s+/g, '').toUpperCase();
        const date = s('date');
        if (number) {
          const raw = await aeroDataBox(number, date).catch(() => null);
          const f = raw ? readAeroDataBox(raw, number) : null;
          if (f) {
            return {
              content: JSON.stringify({ ...f, confidence: 'researched', source: 'AeroDataBox' }),
              summary: `${f.number} ${f.from.code ?? f.from.name} ${hhmm(f.departMin)} → ${f.to.code ?? f.to.name} ${hhmm(f.arriveMin)} (scheduled)`,
              sources: [{ url: 'https://aerodatabox.com/', title: 'AeroDataBox' }],
            };
          }
        }
        // Dormant service or no number: a web search the model reads itself.
        const q = number ? `${number} flight ${date} scheduled departure arrival time` : `flight ${s('from')} to ${s('to')} ${date} departure arrival time`;
        const results = await webSearch(q, 'trips.flight');
        return {
          content: JSON.stringify({ note: 'No flight-status service is configured; read these results. Times found here are "researched", not confirmed.', results }),
          summary: `${results.length} search results (no flight-status service)`,
          sources: results.slice(0, 3).map((r) => ({ url: r.url, title: r.title })),
        };
      }
      case 'recall': {
        const { ownerMemories } = await import('./profile.server');
        const rows = await ownerMemories([s('query')], 8);
        const hits = rows.filter((r) => s('query').split(/\s+/).some((w) => w.length > 3 && r.content.toLowerCase().includes(w.toLowerCase())) || rows.length <= 8).slice(0, 8);
        return { content: JSON.stringify(hits.map((r) => ({ category: r.category, text: r.content }))), summary: `${hits.length} things I know` };
      }
      default:
        return { content: `Unknown tool ${call.name}.`, error: 'unknown tool' };
    }
  },
};

/**
 * Run the planner with tools. `messages` are the planner's (system with the
 * agent guidance, context, history, the new text); the final answer is the
 * model's last text. Throws only when no model is reachable.
 */
export async function agentTurn(
  messages: Array<Record<string, unknown>>,
  ctx: AgentContext,
  opts: { tools?: AgentTools; client?: { client: OpenAI; model: string }; timeoutMs?: number; finalPrompt?: string; budget?: BudgetLimits } = {},
): Promise<AgentResult> {
  let llm = opts.client;
  if (!llm) {
    const def = getWorkload('trips-planner');
    if (!def) throw new Error('trips-planner workload is not registered');
    llm = await getLLMClient(await resolveWorkloadModel(def));
  }
  const tools = opts.tools ?? LIVE_TOOLS;
  const budget = newBudget();
  const research: ResearchStep[] = [];
  const seen = new Set<string>();
  const loop = await runToolLoop({
    client: llm.client,
    model: llm.model,
    messages,
    tools: PLANNER_TOOLS,
    // N lookups at most, so N+1 rounds is enough; a forced final answers.
    maxRounds: (opts.budget ?? BUDGET).calls + 1,
    forceFinal: { prompt: opts.finalPrompt ?? 'Answer now with the JSON object only (reply, ops, quickReplies) — no more lookups.' },
    temperature: 0.2,
    maxTokens: 4000,
    activity: 'trips-planner',
    timeoutMs: opts.timeoutMs ?? PLANNER_TURN_MS,
    execute: async (call) => {
      const allowed = spend(budget, call.name, opts.budget ?? BUDGET);
      if (!allowed.ok) return allowed.reason;
      try {
        const out = await tools.run(call, ctx);
        research.push(researchStep(call.name, call.args, out));
        for (const src of out.sources ?? []) seen.add(src.url);
        for (const m of out.content.matchAll(/https?:\/\/[^\s"'<>\\]+/g)) seen.add(m[0]);
        return out.content;
      } catch (err) {
        const why = (err as Error)?.message?.includes('Tavily API key') ? 'web search is not available here' : 'that lookup failed';
        research.push(researchStep(call.name, call.args, { error: why }));
        return `Lookup failed: ${why}.`;
      }
    },
  });
  return { reply: loop.reply, research, seenUrls: [...seen], toolCalls: budget.calls };
}
