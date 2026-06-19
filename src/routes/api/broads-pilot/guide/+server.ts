// POST /api/broads-pilot/guide — LLM-guided day planner. The skipper's
// objectives come in; the server computes which moorings are REACHABLE for their
// boat (engine), builds a POI catalogue, fetches current weather, then asks the
// LLM to pick & explain stops from that grounded set. The server then computes
// the real legs (distance/time/fuel/restrictions) + compliance callouts, so
// nothing in the returned plan is hallucinated.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { jsonCompletion } from '$lib/deepdive/ai';
import { route as computeRoute, reachable as computeReachable } from '../../../projects/broads-pilot/lib/router';
import { bridgeVerdict } from '../../../projects/broads-pilot/lib/passability';
import { routeFuel } from '../../../projects/broads-pilot/lib/fuel';
import { daylightHours } from '../../../projects/broads-pilot/lib/daylight';
import { haversine } from '../../../projects/broads-pilot/lib/geo';
import { breydonAdvice } from '../../../projects/broads-pilot/lib/tide';
import type { WaterGraph, Restrictions, Mooring, Poi, Boat, MooringPois } from '../../../projects/broads-pilot/lib/types';

// ---- server-side dataset load (read the bundled JSON directly) ----
// In dev the files live under static/; in the built adapter-node server they're
// copied to build/client/. Resolve whichever exists.
const BASES = ['static/broads-pilot', 'build/client/broads-pilot', 'client/broads-pilot'];
function dsFile(name: string): string {
  for (const base of BASES) {
    const p = resolve(base, `${name}.json`);
    if (existsSync(p)) return p;
  }
  return resolve('static/broads-pilot', `${name}.json`);
}
function ds<T>(name: string): T {
  return JSON.parse(readFileSync(dsFile(name), 'utf8')) as T;
}
let cache: { graph: WaterGraph; restrictions: Restrictions; moorings: Mooring[]; pois: Poi[]; mooringPois: MooringPois; fleet: Boat[] } | null = null;
function datasets() {
  if (!cache) cache = {
    graph: ds('graph'), restrictions: ds('restrictions'), moorings: ds('moorings'),
    pois: ds('pois'), mooringPois: ds('mooring_pois'), fleet: ds('fleet'),
  };
  return cache;
}

const ACTIVITY_KINDS: Record<string, string[]> = {
  dog_walk: ['walk'], walk: ['walk'], pub: ['pub'], food: ['pub'], lunch: ['pub'],
  swim: ['swim'], swimming: ['swim'], supermarket: ['shop'], shop: ['shop'], shopping: ['shop'],
  fishing: ['fishing'], fish: ['fishing'], wildlife: ['attraction'], nature: ['attraction'],
  sights: ['attraction'], sightseeing: ['attraction'], relax: [], scenic: [],
};
const TIER_LABEL: Record<string, string> = {
  ba_free: 'Free 24h mooring', ba_staffed: 'Staffed mooring', yacht_station: 'Yacht station',
  pub: 'Pub mooring', private: 'Private mooring', marina: 'Marina', hire_yard: 'Hire base',
};
const WMO: Record<number, string> = {
  0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'rime fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers', 81: 'rain showers', 82: 'violent showers',
  95: 'thunderstorm', 96: 'thunderstorm w/ hail', 99: 'severe thunderstorm',
};
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => DIRS[Math.round(deg / 45) % 8];

async function getWeather(lat: number, lng: number) {
  try {
    const p = new URLSearchParams({ latitude: String(lat), longitude: String(lng), current: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation,is_day', wind_speed_unit: 'mph' });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const c = (await res.json()).current;
    return {
      tempC: Math.round(c.temperature_2m), windMph: Math.round(c.wind_speed_10m), windDir: compass(c.wind_direction_10m),
      precip: c.precipitation as number, isDay: c.is_day === 1, description: WMO[c.weather_code] ?? 'changeable',
    };
  } catch { return null; }
}

export const POST: RequestHandler = async ({ request }) => {
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, { status: 400 }); }
  const { boat: boatSlug, originNode, objectives, followUp, previousPlan } = body ?? {};
  const d = datasets();
  const boat = d.fleet.find((b) => b.slug === boatSlug) ?? d.fleet.find((b) => b.class === 'generic') ?? d.fleet[0];
  if (!boat) return json({ error: 'No boat' }, { status: 400 });
  const origin = d.graph.nodes.find((n) => n.id === originNode) ?? d.graph.nodes.find((n) => n.id === 'staithe-stalham') ?? d.graph.nodes[0];

  const activities: string[] = Array.isArray(objectives?.activities) ? objectives.activities : [];
  const freeText: string = (objectives?.freeText ?? followUp ?? '').toString().slice(0, 300);
  const durationHours: number | null = objectives?.durationHours ?? null;
  const days: number = Math.max(1, Math.min(10, objectives?.days ?? 1));
  const multiDay = days > 1;
  const nights = Math.max(1, days - 1);
  const perDayHours = multiDay ? (durationHours ?? 4) : (durationHours ?? 6);

  // objective POI kinds
  const objKinds = new Set<string>();
  for (const a of activities) for (const k of ACTIVITY_KINDS[a] ?? []) objKinds.add(k);
  const ft = freeText.toLowerCase();
  for (const [word, kinds] of Object.entries(ACTIVITY_KINDS)) if (ft.includes(word)) kinds.forEach((k) => objKinds.add(k));

  // reachability for this boat. Multi-day reaches the whole network (sequenced
  // over days); single-day caps at the day's budget.
  const budgetS = multiDay ? 12 * 3600 : (durationHours ? durationHours * 3600 * 1.25 : daylightHours(new Date(), 52.62, 1.5) * 3600);
  const reach = computeReachable(d.graph, d.restrictions, boat, origin.id, budgetS);

  // candidate moorings (reachable), nearest first, with relevant nearby POIs
  const poiById = new Map(d.pois.map((p) => [p.id, p]));
  const candidates = d.moorings
    .filter((m) => m.node_id && reach.has(m.node_id) && m.node_id !== origin.id)
    .map((m) => ({ m, r: reach.get(m.node_id!)! }))
    .sort((a, b) => a.r.time_s - b.r.time_s)
    .slice(0, multiDay ? 30 : 18)
    .map(({ m, r }) => {
      const near = (d.mooringPois[m.id] ?? [])
        .map((x) => ({ poi: poiById.get(x.poi_id)!, dist_m: x.dist_m }))
        .filter((x) => x.poi)
        .sort((a, b) => {
          const am = objKinds.size === 0 || objKinds.has(a.poi.kind) ? 0 : 1;
          const bm = objKinds.size === 0 || objKinds.has(b.poi.kind) ? 0 : 1;
          return am - bm || a.dist_m - b.dist_m;
        })
        .slice(0, 6);
      return { m, time_s: r.time_s, dist_m: r.dist_m, near };
    });

  const weather = await getWeather(origin.lat, origin.lng);

  // ---- build the LLM prompt ----
  const catalog = candidates.map(({ m, time_s, dist_m, near }) => {
    const facils = Object.entries(m.facilities).filter(([, v]) => v).map(([k]) => k).join(', ') || 'bankside only';
    const charge = m.rate.unit === 'free' || (m.rate.amount === 0 && m.rate.unit !== 'metre_night') ? 'free' : `£${m.rate.amount}/${m.rate.unit.replace('_', ' ')}`;
    const pts = near.map((x) => {
      const lenTag = x.poi.kind === 'walk' && x.poi.length_mi ? `, ${x.poi.length_mi}mi` : '';
      return `    - ${x.poi.id} | ${x.poi.name} (${x.poi.kind}${lenTag}${x.poi.dog_friendly ? ', dog-ok' : ''}${x.poi.food ? ', food' : ''}) ~${x.dist_m}m: ${x.poi.description.slice(0, 100)}`;
    }).join('\n');
    return `* ${m.id} | ${m.name} [${TIER_LABEL[m.tier]}, ${charge}, ${facils}] — ${Math.round(time_s / 60)} min / ${(dist_m / 1609).toFixed(1)} mi from start\n${pts || '    - (no notable POIs catalogued nearby)'}`;
  }).join('\n');

  const system = `You are a friendly, expert Norfolk Broads cruising concierge planning a boating itinerary. You ONLY choose stops from the provided REACHABLE moorings (each is already confirmed passable for this boat). Match the skipper's objectives. Keep each day's cruising within the daily budget. A single-day trip ends moored at the final stop; a MULTI-DAY trip is a ROUND TRIP that returns to base on the final day. Be specific and warm but concise. For each stop explain WHY it fits their goals, and reference the specific nearby POIs (by id) that satisfy each objective. Prefer a sensible geographic progression (don't zig-zag). If they want a LONG or family walk, pick a walk of 5+ miles (walk lengths are shown like "6mi"); for a gentle stroll pick a shorter one.`;

  const user = `SKIPPER'S OBJECTIVES:
- Boat: ${boat.name} (air draft ${boat.air_draft_m} m, sleeps ${boat.sleeps})
- Start: ${origin.id === 'staithe-stalham' ? 'Stalham (Richardsons base)' : origin.id}
- Time budget: ${durationHours ? `about ${durationHours} hours cruising` : 'a full day'}${days > 1 ? ` over ${days} days` : ''}
- Wants to: ${activities.length ? activities.join(', ') : 'a nice relaxed cruise'}
- In their words: ${freeText || '(nothing extra)'}
${weather ? `- Weather now at the start: ${weather.tempC}°C, ${weather.description}, wind ${weather.windMph} mph ${weather.windDir}${weather.precip > 0 ? ', some rain' : ''}` : ''}
${previousPlan ? `\nThis REVISES a previous plan. Previous stops: ${(previousPlan.stops ?? []).map((s: any) => s.name).join(' → ')}. Apply the skipper's change: "${followUp}".` : ''}

${multiDay
  ? `PLAN A ${days}-DAY ROUND TRIP from base. Choose ONE overnight mooring per night (${nights} nights), in a sensible loop, each leg about ${perDayHours} h cruising from the previous, so you can cruise back to base on the final morning — don't wander so far you can't get back in time. Tag each stop with its night number ("day": 1..${nights}).`
  : `Choose 1-4 ordered stops for the day (you stay moored at the last one).`}

REACHABLE MOORINGS (ids in [brackets] for POIs):
${catalog}

Return JSON exactly:
{
  "summary": "2-3 sentence friendly overview of the ${multiDay ? `${days}-day trip` : 'day'} and why it suits them${weather ? ', mentioning the weather if relevant' : ''}",
  "stops": [
    { "mooringId": "<one of the mooring ids above>", ${multiDay ? `"day": <night number 1..${nights}>, ` : ''}"why": "why this stop fits their goals", "activities": [ { "poiId": "<a POI id near this mooring>", "what": "what to do there and why it matches an objective" } ] }
  ],
  "tips": ["1-3 short practical tips (tide/weather/timing/dog/charges)"]
}`;

  let llm: any;
  try {
    llm = await jsonCompletion<{ summary: string; stops: { mooringId: string; day?: number; why: string; activities: { poiId: string; what: string }[] }[]; tips: string[] }>(system, user, { temperature: 0.6, maxTokens: multiDay ? 4500 : 3500 });
  } catch (e: any) {
    return json({ error: 'The planner is busy — please try again. ' + (e?.message ?? '') }, { status: 503 });
  }

  // ---- validate + enrich with REAL legs + compliance ----
  const candById = new Map(candidates.map((c) => [c.m.id, c]));
  const rawStops: any[] = Array.isArray(llm?.stops) ? llm.stops : [];
  const valid = rawStops.map((s) => ({ s, c: candById.get(s?.mooringId) })).filter((x) => !!x.c);
  if (!valid.length) return json({ error: 'No suitable stops found within your time budget — try a longer trip or different goals.' }, { status: 200 });
  const ordered = multiDay ? [...valid].sort((a, b) => ((a.s.day ?? 1) - (b.s.day ?? 1))) : valid;
  const daylight = daylightHours(new Date(), 52.62, 1.5);
  const originLabel = origin.id === 'staithe-stalham' ? 'Stalham (base)' : 'base';

  let fromNode = origin.id;
  let totalTime = 0, totalDist = 0, totalFuel = 0, anyBreydon = false;
  const warnings: string[] = [];
  const dayOver = new Set<number>();
  const legFor = (toNode: string) => {
    const leg = computeRoute(d.graph, d.restrictions, boat, fromNode, toNode);
    if (!leg.edges.length) return { leg, out: null as any };
    const fuel = routeFuel(leg);
    totalTime += leg.time_s; totalDist += leg.distance_m; totalFuel += fuel.litres;
    if (leg.crossesBreydon) anyBreydon = true;
    fromNode = toNode;
    return { leg, out: { distance_m: leg.distance_m, time_s: leg.time_s, fuel_l: +fuel.litres.toFixed(1), fuel_cost: +fuel.cost.toFixed(2), crossesBreydon: leg.crossesBreydon, marginalBridges: leg.bridges.filter((bb) => bb.verdict === 'marginal').map((bb) => bb.bridge.name) } };
  };

  const stops: any[] = ordered.map(({ s, c }, i) => {
    const m = c!.m;
    const { leg, out } = legFor(m.node_id!);
    const day = multiDay ? Math.max(1, Math.min(nights, s.day ?? i + 1)) : 1;
    if (multiDay && out && leg.time_s > daylight * 3600) dayOver.add(day);
    const acts = (Array.isArray(s.activities) ? s.activities : [])
      .map((a: any) => { const p = poiById.get(a?.poiId); return p ? { poiId: p.id, name: p.name, kind: p.kind, dog: p.dog_friendly ?? null, dist_m: (d.mooringPois[m.id] ?? []).find((x) => x.poi_id === p.id)?.dist_m ?? null, length_mi: p.length_mi ?? null, what: String(a.what ?? '').slice(0, 240), opening_hours: p.opening_hours ?? null } : null; })
      .filter(Boolean);
    const facilities = Object.entries(m.facilities).filter(([, v]) => v).map(([k]) => k);
    return {
      mooringId: m.id, name: m.name, lat: m.lat, lng: m.lng, nodeId: m.node_id, day, isReturn: false,
      tier: TIER_LABEL[m.tier], why: String(s.why ?? '').slice(0, 320), activities: acts, leg: out,
      mooring: {
        charge: m.rate.unit === 'free' || (m.rate.amount === 0 && m.rate.unit !== 'metre_night') ? 'Free (24h)' : `£${m.rate.amount}/${m.rate.unit.replace('_', ' ')}${m.waived_with_meal ? ' (often waived with a meal)' : ''}`,
        facilities, shorePower: m.facilities.shore_power, capacityCaveat: m.capacity_caveat, lastVerified: m.last_verified,
      },
    };
  });

  // multi-day: cruise back to base on the final day
  if (multiDay && fromNode !== origin.id) {
    const { out } = legFor(origin.id);
    stops.push({
      mooringId: '__return__', name: `Return to ${originLabel}`, lat: origin.lat, lng: origin.lng, nodeId: origin.id, day: days, isReturn: true,
      tier: 'Home base', why: 'Cruise back so the boat is at base in good time on the final morning.', activities: [], leg: out,
      mooring: { charge: '—', facilities: [], shorePower: false, capacityCaveat: false, lastVerified: '' },
    });
    if (!out) warnings.push("The return to base couldn't be routed automatically — double-check the last leg.");
  }

  // compliance warnings
  if (!multiDay && totalTime > daylight * 3600) warnings.push(`This is more than today's daylight (~${daylight.toFixed(1)} h) — split it across days and moor overnight.`);
  if (multiDay && dayOver.size) warnings.push(`Day ${[...dayOver].sort((a, b) => a - b).join(', ')} has more cruising than fits a day's daylight (~${daylight.toFixed(1)} h) — ease the route or add a night.`);
  if (durationHours && !multiDay && totalTime > durationHours * 3600 * 1.15) warnings.push(`Total cruising is ~${(totalTime / 3600).toFixed(1)} h, a bit over your ${durationHours} h budget.`);
  if (anyBreydon) warnings.push(breydonAdvice());
  if (weather && weather.windMph >= 16) warnings.push(`It's breezy (${weather.windMph} mph ${weather.windDir}) — open water like Breydon, Hickling and Barton Broad will be choppy; sheltered rivers are more comfortable.`);
  if (weather && weather.precip > 0.2) warnings.push('Rain about — pack waterproofs and plan an indoor pub or two.');

  return json({
    plan: {
      summary: String(llm.summary ?? '').slice(0, 600),
      tips: (Array.isArray(llm.tips) ? llm.tips : []).slice(0, 4).map((t: any) => String(t).slice(0, 200)),
      weather,
      stops, days,
      totals: { distance_m: Math.round(totalDist), time_s: Math.round(totalTime), fuel_l: +totalFuel.toFixed(1) },
      warnings,
      boat: { name: boat.name, air_draft_m: boat.air_draft_m },
    },
  });
};
