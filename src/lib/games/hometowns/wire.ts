// What one phone sees of a county (spec §10.7; WP4). The types are the
// engine's (engine/wire.ts, shared with the map page and the app); this file
// builds the frames.
//
// Three jobs:
//   - REDACTION. A viewer gets their own town whole, the snapshot (exactly
//     the server's inputs, so the phone predicts), and of every other town
//     only its public card. Another town's money, bonds, orders and contract
//     books never leave this file, and only the offers and contracts the
//     viewer is a party to are listed.
//   - DELTAS. The registry hands `toWire` the rev a phone already holds
//     (`since`). Each viewer's recent frames are remembered here as hashes,
//     per part and per top-level TownState field, keyed by the room object
//     and its `rev` (hometowns.ts bumps rev on every change in memory). A
//     frame cut against a rev still remembered carries only what changed
//     (see engine/wire.ts for the merge rule); anything else — a first frame,
//     a phone from before a restart, a rev too old — is a whole frame. Keyed
//     by the room OBJECT, so a room read back from the table (a restart, or a
//     lost write race) starts with no memory, and its rev moves on past
//     anything sent before it (hometowns.ts `revive`), so a `since` from the
//     old timeline never names a rev of the new one: no delta is ever cut
//     against a state from another timeline.
//   - THE VIEWER'S TOWN IS CAUGHT UP ON ACCESS (§10.5). Town ticks are not
//     scheduled one by one; a frame for a seat first brings that seat's own
//     town up to now (never past an unrun Regional Day), which is a pure
//     function of stored state, so it needs no write.
//
// `derived` (stars, wants, advisors, needs, the pipeline, Town Talk) is the
// month step's blackboard, which is never stored (§10.2). It is read by
// running one month step on a throwaway copy of the town with one extra
// step at the end that keeps the blackboard (the probe), cached until the
// town ticks or something a month step reads changes (a hello does not).
// It is only shown, never hashed. A probe costs one month step, so its
// price is the engine's (§10.15 budgets 3 ms; see the WP4 handback).

import {
  ENGINE_HASH,
  STEPS,
  TICKS_PER_YEAR,
  catchUpTown,
  effectiveNow,
  fnv64,
  gridEndAt,
  gridTickAt,
  isCountyWeek,
  makeContext,
  monthStep,
  napStartAt,
  nextRegionalDayAt,
  paramsFor,
  population,
  publicCard,
  stateHash,
  type CountyState,
  type DerivedCache,
  type StepTable,
  type TownState,
} from './engine/index';
import { BUILDINGS, POLICY_SLOTS, RAIL_DEF, ROAD_DEFS, ZONE_DEFS } from './engine/content';
import { NEED_ITEMS, ladder } from './engine/needs';
import { ADVISOR_RULES } from './engine/advisors';
import { PAGE_HASH } from './page-hash.generated';
import type { AdvisorCard, Card, CountyWire, HometownsWire, MeWire, PublicTown, VisitView, Want } from './engine/wire';
import type { Room } from './hometowns';
import { canPause } from './solo';

/**
 * The map page the wire names (§10.10): its folder is PAGE_HASH, which covers
 * the engine and the page's own build inputs, so a page-only change is a new
 * path and the phone reloads into it (A39). `client.engineHash` stays the
 * simulation's hash, which the page's canary and predictor compare.
 */
export const PAGE_PATH = `/projects/hometowns/${PAGE_HASH}/mobile.html`;

/** Frame budgets (§10.7): a first frame, and an ordinary delta. */
export const FIRST_FRAME_BUDGET = 80 * 1024;
export const DELTA_BUDGET = 4 * 1024;
/** Frames remembered per viewer for cutting deltas. */
const VERSIONS_KEPT = 16;
/** Of the seat's own logged moves, how many the frame lists (A28). */
const MOVES_SHOWN = 20;
/** Days in a season (A22: six County Weeks). */
const SEASON_DAYS = 42;

export interface WireOptions {
  /** False: build the frame without catching the viewer's town up first (tests). */
  catchUp?: boolean;
}

// ---- Per-room memory (in this process only) ---------------------------------------------------

interface Version {
  rev: number;
  parts: Record<string, string>;
  cards: Record<string, string>[];
  fields: Record<string, string> | null;
}

/** Per room object: each viewer's recent frames, as hashes. */
const VERSIONS = new WeakMap<object, Map<string, Version[]>>();
/** Per room object: the probe's last blackboard per seat. */
const PROBES = new WeakMap<object, Map<string, { key: string; derived: DerivedCache | null }>>();

function mapFor<V>(store: WeakMap<object, Map<string, V>>, room: object): Map<string, V> {
  let m = store.get(room);
  if (!m) store.set(room, (m = new Map()));
  return m;
}

/** An erased player (hometowns.ts `erasePlayer`): what this process remembers sending them, and their seat's probe. */
export function forgetViewer(room: object, playerId: string, seat: string | null): void {
  VERSIONS.get(room)?.delete(playerId);
  if (seat) PROBES.get(room)?.delete(seat);
}

const hashJson = (v: unknown): string => fnv64(JSON.stringify(v ?? null));

// ---- The derived block -----------------------------------------------------------------------------

/** The month step's blackboard for town i as of now, from a throwaway copy (null if the month would not run). */
function probe(c: CountyState, i: number): DerivedCache | null {
  const copy = JSON.parse(JSON.stringify(c.towns[i])) as TownState;
  let got: DerivedCache | null = null;
  const keep = { id: 'WP4 wire probe', owner: 'WP4' as const, writes: [], run: (_t: TownState, m: { derived: DerivedCache }) => void (got = m.derived) };
  const steps: StepTable = { tick: STEPS.tick, month: [...STEPS.month, keep], regional: STEPS.regional };
  try {
    monthStep(copy, makeContext(c, i, copy.tick), steps);
  } catch {
    return null;
  }
  return got;
}

function derivedFor(room: Room, i: number): DerivedCache | null {
  const c = room.county;
  const t = c.towns[i];
  // What a month step reads that a move can change without ticking or touching the planes;
  // a hello, a seen or a visit leaves it alone, so they never pay for a probe.
  const inputs = hashJson([t.taxes, t.funding, t.policies, t.orders, t.buildings, t.construction, t.money, t.parcels]);
  const key = `${t.tick}|${t.planesRev}|${c.dayIndex}|${inputs}`;
  const cache = mapFor(PROBES, room);
  const hit = cache.get(t.seat);
  if (hit && hit.key === key) return hit.derived;
  const derived = probe(c, i);
  cache.set(t.seat, { key, derived });
  return derived;
}

const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;
const sum = (xs: readonly number[] | undefined): number => (xs ?? []).reduce((a, b) => a + b, 0);

function derivedBlock(room: Room, i: number): NonNullable<MeWire['derived']> {
  const t = room.county.towns[i];
  const d = derivedFor(room, i);
  const memo = t.civicMemo;
  const mood = d?.mood ?? null;
  const reach = d?.housing?.reachable ?? d?.development?.reachableHomes ?? null;
  const homesTier = t.meters.slice(0, 3).indexOf(Math.max(...t.meters.slice(0, 3)));
  const wants: Want[] = (mood?.wants ?? memo?.wants ?? []).map((w) => ({
    key: w.key,
    severity: Math.round(w.severity),
    tile: -1,
    // A9: a Homes want no zoned land can meet shows hatched, with a "what's missing" Why.
    hatched: w.key === 'homes' && !!reach && reach[homesTier] === false,
  }));
  const advisors: AdvisorCard[] = (mood?.advisors ?? memo?.advisors ?? []).map((id) => {
    const rule = ADVISOR_RULES.find((r) => r.id === id);
    const data: Record<string, string> = rule ? { action: rule.action } : {};
    return { advisor: rule?.advisor ?? (id.split('.')[0] as AdvisorCard['advisor']), key: id, data };
  });
  const needs = d?.needs
    ? [0, 1, 2].map((h) => ({
        cohort: h * 3 + 1,
        tier: h,
        items: ladder(h).map((k, j) => ({ key: NEED_ITEMS[k].id, met: r2(d.needs!.items[h]?.[j] ?? 0), buildable: NEED_ITEMS[k].unlock <= t.tier })),
      }))
    : [];
  return {
    // Rounded: these are shown, never predicted, and a delta should not resend noise.
    stars: t.perceived.map(r1),
    meters: t.meters.map(r1),
    wants,
    advisors,
    needs,
    pipeline: { homes: Math.round(sum(d?.development?.pipeline)), movers: Math.round(sum(t.applicants)) },
    townTalk: (mood?.townTalk ?? memo?.talk ?? []).map(([k, v]) => [k, v] as [string, number]),
  };
}

/** What the viewer may build now, what everything costs, and what can still be undone today. */
function affordancesOf(c: CountyState, t: TownState): NonNullable<MeWire['affordances']> {
  const roads = [...ROAD_DEFS.filter((r) => r.id !== 'county'), RAIL_DEF];
  const unlocked = [
    ...BUILDINGS.filter((b) => !b.free && b.tier <= t.tier).map((b) => b.id),
    ...roads.filter((r) => r.unlock <= t.tier).map((r) => `road:${r.id}`),
    ...ZONE_DEFS.filter((z) => z.unlock <= t.tier && t.tier <= z.zoneUntil).map((z) => `zone:${z.id}`),
  ];
  const costs: Record<string, number> = {};
  for (const b of BUILDINGS) if (!b.free) costs[b.id] = b.build;
  for (const r of roads) costs[`road:${r.id}`] = r.build;
  return {
    unlocked,
    costs,
    initiatives: t.initiatives,
    slots: POLICY_SLOTS[t.tier] ?? 0,
    canUndo: t.undo.filter((u) => u.day === c.dayIndex).map((u) => u.planId),
  };
}

/** Welcome back (§9.9): more than a day of the town's ticks since the phone last said `seen`. */
function welcomeOf(c: CountyState, t: TownState, i: number): Card[] {
  if (t.gridBase === null || t.tick - t.lastSeenTick < TICKS_PER_YEAR) return [];
  const cards: Card[] = [
    { key: 'welcomeBack.away', data: { ticks: t.tick - t.lastSeenTick } },
    { key: 'welcomeBack.people', data: { pop: population(t) } },
  ];
  for (const b of (c.bulletin[i] ?? []).slice(-3)) cards.push({ key: b.key, data: { ...b.data } });
  if (t.inbox.length) cards.push({ key: 'welcomeBack.inbox', data: { n: t.inbox.length } });
  return cards;
}

// ---- Public parts ---------------------------------------------------------------------------------

function linkedTo(c: CountyState, i: number): number[] {
  const out: number[] = [];
  for (const l of c.links) {
    if (l.state !== 'open' && l.state !== 'closing') continue;
    const other = l.a === i ? l.b : l.b === i ? l.a : -1;
    if (other >= 0 && !out.includes(other)) out.push(other);
  }
  return out.sort((a, b) => a - b);
}

function publicTownOf(room: Room, i: number): PublicTown {
  const c = room.county;
  const t = c.towns[i];
  const mayor = room.players.find((p) => p.seat === t.seat)?.name ?? '';
  return { ...publicCard(t), mayor, linked: linkedTo(c, i) };
}

function kingsportCard(c: CountyState): PublicTown {
  return {
    seat: 'kingsport',
    name: 'Kingsport',
    avatar: 'kingsport',
    flag: 0,
    tier: 4,
    pop: c.kingsport.pop,
    faces: [],
    stars: c.kingsport.stars.slice(0, 11),
    taxes: { homes: [0, 0, 0], business: 0, sales: 0, hotel: 0 },
    holiday: false,
    archived: false,
    inFortnight: false,
    skyline: '',
    mayor: '',
    linked: [],
  };
}

function visitOf(c: CountyState, seat: string | null | undefined): VisitView | null {
  if (!seat) return null;
  const t = c.towns.find((x) => x.seat === seat);
  if (!t) return null;
  // Planes, buildings and terrain only: never money, orders, books or people.
  return {
    seat: t.seat,
    planes: t.planes,
    lv: t.lv,
    buildings: t.buildings.map((b) => [...b]),
    terrainSeed: t.terrainSeed,
    siteKind: t.siteKind,
    terrainEdits: [...t.terrainEdits],
    construction: [...t.construction],
  };
}

function countyOf(c: CountyState, i: number): CountyWire {
  const p = paramsFor(c.paramsVersion);
  const f = i >= 0 ? c.flows.towns[i] : null;
  const realised = i >= 0 ? c.towns[i].realised : null;
  const gw = c.greatWork;
  const issue = c.gazette[c.gazette.length - 1];
  return {
    name: c.name,
    sites: c.sites.map((s) => ({ index: s.index, kind: s.kind, terrainSeed: s.terrainSeed, owner: s.owner === null ? null : c.towns.findIndex((t) => t.seat === s.owner) })),
    kingsport: kingsportCard(c),
    links: c.links,
    // Mine only: an offer or a contract is the two parties' business.
    offers: i < 0 ? [] : c.offers.filter((o) => o.from === i || o.to === i),
    contracts: i < 0 ? [] : c.contracts.filter((k) => k.seller === i || k.buyer === i),
    pacts: c.pacts,
    market: {
      goods: { p: c.market.goods.p, band: [p.firms.exportPrice[0], p.firms.goodsImport] },
      food: { p: c.market.food.p, band: [p.firms.foodBand[0] / p.firms.foodUnit, p.firms.foodBand[1] / p.firms.foodUnit] },
    },
    flowsSummary: {
      commutersIn: Math.round(sum(f?.commutersIn)),
      commutersOut: Math.round(sum(f?.commutersOut)),
      shoppersIn: Math.round(f?.shoppersIn ?? 0),
      shoppersOut: Math.round(realised?.shopperSpendOut ?? 0),
      dayTrips: Math.round(f?.dayTripsIn ?? 0),
      touristShare: f?.touristShare ?? 0,
    },
    greatWork: gw ? { id: gw.id, stage: gw.stage, progress: [...gw.progress], needs: [], myCredit: i >= 0 ? (gw.credit[i] ?? 0) : 0 } : null,
    goals: c.goals,
    // Each town's vote is its own; the totals are WP3's to publish after the close.
    council: { question: c.council.question, options: [...c.council.options], myVote: i >= 0 ? (c.council.votes[i] ?? null) : null, totals: null },
    awards: { week: c.awards.week, recent: c.awards.history.filter((h) => h.week === c.awards.week).map((h) => ({ town: h.town, award: h.award })) },
    fund: c.fund,
    bulletin: i >= 0 ? (c.bulletin[i] ?? []) : [],
    ...(issue ? { gazette: issue } : {}),
  };
}

// ---- The clock ------------------------------------------------------------------------------------

/** The next Sunday Regional Day (the Gazette), looking up to a week ahead. */
function nextGazetteAt(c: CountyState, devTicks: number): number {
  let at = nextRegionalDayAt(c, devTicks);
  for (let k = 0; k < 8; k++) {
    if (isCountyWeek(c, at, c.dayIndex + k)) return at;
    // The same rule nextRegionalDayAt uses, on a shallow copy that has had one more day.
    at = nextRegionalDayAt({ ...c, dayIndex: c.dayIndex + k + 1, lastRegionalDayAt: at }, devTicks);
  }
  return at;
}

function clockOf(c: CountyState, now: number): HometownsWire['clock'] {
  const p = paramsFor(c.paramsVersion);
  const eff = effectiveNow(c, now, p.clock.napAfterMs);
  const g = gridTickAt(c, eff);
  const day = Math.max(0, c.dayIndex - c.season.startedDay);
  return {
    gridTick: g,
    tickMs: c.tickMs,
    nextTickAt: gridEndAt(c, g),
    nextRegionalDayAt: nextRegionalDayAt(c, p.clock.devRegionalTicks),
    nextGazetteAt: nextGazetteAt(c, p.clock.devRegionalTicks),
    paused: c.pause !== null,
    napping: c.nap !== null || napStartAt(c, p.clock.napAfterMs) <= now,
    season: { n: c.season.n, theme: c.season.theme, day, daysLeft: Math.max(0, SEASON_DAYS - day) },
  };
}

// ---- Frames ---------------------------------------------------------------------------------------

const ME_PARTS = ['derived', 'affordances', 'snapshot', 'inbox', 'predict', 'moves', 'welcomeBack'] as const;
const TOP_PARTS = ['county', 'visiting'] as const;

/** Per public card, per field: what a delta compares the cards by. */
function cardHashes(towns: PublicTown[]): Record<string, string>[] {
  return towns.map((card) => Object.fromEntries(Object.entries(card).map(([k, v]) => [k, hashJson(v)])));
}

/**
 * §10.7: the frame for `meId` at `now`. With `since`, cut against that rev
 * if this viewer's frame at that rev is remembered; else whole.
 */
/**
 * The server's `me`: the engine's MeWire (engine/wire.ts, hashed with the
 * engine, so not changed for an adapter rule) plus what only the server
 * knows. `canPause`: this viewer is the sole mayor of the running county, on
 * a parent's seat (decision 13, solo.ts); the phone shows Pause only then.
 * Always present, like `isParent`. The map page ignores keys it does not read.
 */
export type ServerMeWire = MeWire & { canPause: boolean };
export type ServerWire = Omit<HometownsWire, 'me'> & { me: ServerMeWire | null };

export function toWire(room: Room, meId: string, now: number, since: number | null = null, o: WireOptions = {}): ServerWire {
  const c = room.county;
  const p = paramsFor(c.paramsVersion);
  const meP = room.players.find((q) => q.id === meId) ?? null;
  const seat = meP?.seat ?? null;
  const i = seat ? c.towns.findIndex((t) => t.seat === seat) : -1;

  // The viewer's own town is caught up first (§10.5), bounded by an unrun Regional Day.
  if (room.phase === 'running' && i >= 0 && o.catchUp !== false) {
    const limit = Math.min(effectiveNow(c, now, p.clock.napAfterMs), nextRegionalDayAt(c, p.clock.devRegionalTicks));
    if (catchUpTown(c, i, gridTickAt(c, limit)) > 0) room.rev += 1;
  }

  const t = i >= 0 ? c.towns[i] : null;
  const towns = c.towns.map((_, k) => publicTownOf(room, k));
  const parts: Record<string, unknown> = {
    county: countyOf(c, i),
    visiting: seat ? visitOf(c, room.viewing?.[seat]) : null,
  };
  const meParts: Record<string, unknown> = {};
  if (seat) {
    meParts.derived = t ? derivedBlock(room, i) : { stars: [], meters: [], wants: [], advisors: [], needs: [], pipeline: { homes: 0, movers: 0 }, townTalk: [] };
    meParts.affordances = t ? affordancesOf(c, t) : { unlocked: [], costs: {}, initiatives: 0, slots: 0, canUndo: [] };
    // The skylines travel once, on the public cards: no step reads the snapshot's copy.
    meParts.snapshot = { ...c.snapshot, towns: c.snapshot.towns.map((r) => ({ ...r, skyline: '' })) };
    meParts.inbox = t ? t.inbox : [];
    meParts.predict = { townIndex: i, dayIndex: c.dayIndex, rivalry: c.settings.rivalry, mishaps: c.settings.mishaps, paramsVersion: c.paramsVersion };
    meParts.moves = c.log
      .filter((r) => r.seat === seat && r.id)
      .slice(-MOVES_SHOWN)
      .map((r) => ({ id: r.id, type: r.type, atTick: r.atTick }));
    meParts.welcomeBack = t ? welcomeOf(c, t, i) : [];
  }

  // What this viewer was last sent at `since`, if remembered.
  const versions = mapFor(VERSIONS, room);
  const ring = versions.get(meId) ?? [];
  const held = since === null ? null : (ring.find((v) => v.rev === since) ?? null);

  const hashes: Record<string, string> = {};
  for (const k of TOP_PARTS) hashes[k] = hashJson(parts[k]);
  const cards = cardHashes(towns);
  for (const k of ME_PARTS) if (k in meParts) hashes[`me.${k}`] = hashJson(meParts[k]);
  const fields: Record<string, string> | null = t ? {} : null;
  if (t && fields) for (const k of Object.keys(t)) fields[k] = hashJson((t as unknown as Record<string, unknown>)[k]);

  const frame: HometownsWire = {
    id: room.id,
    game: 'hometowns',
    phase: room.phase,
    serverNow: now,
    rev: room.rev,
    base: held ? held.rev : null,
    hostId: room.hostId,
    meId,
    players: room.players.map((q) => ({ id: q.id, name: q.name, status: q.status, seat: q.seat })),
    client: { engineHash: ENGINE_HASH, page: PAGE_PATH, bridge: 1 },
    clock: clockOf(c, now),
    me: null,
  };
  const out = frame as unknown as Record<string, unknown>;
  for (const k of TOP_PARTS) if (!held || held.parts[k] !== hashes[k]) out[k] = parts[k];
  // The public cards: whole on a whole frame (or when a town was founded); else only the fields that changed.
  if (!held || held.cards.length !== cards.length) frame.towns = towns;
  else {
    const patch = towns.map((card, k) => {
      const was = held.cards[k];
      const changed = Object.keys(card).filter((f) => was[f] !== cards[k][f]);
      return changed.length ? (Object.fromEntries(changed.map((f) => [f, card[f as keyof PublicTown]])) as Partial<PublicTown>) : null;
    });
    if (patch.some((x) => x !== null)) frame.townsPatch = patch;
  }

  if (seat) {
    const me: Record<string, unknown> = {
      seat,
      // A seat with no settings (a damaged row) shows a child's wording: the safe side.
      profile: c.settings.perSeat[seat]?.profile ?? 'kid',
      isParent: c.parents.includes(seat),
      // Decision 13: the sole mayor of a running county, on a parent's seat (solo.ts).
      canPause: canPause(room, meId),
      townHash: t ? stateHash(t) : '',
    };
    for (const k of ME_PARTS) if (!held || held.parts[`me.${k}`] !== hashes[`me.${k}`]) me[k] = meParts[k];
    if (t && fields) {
      const before = held?.fields ?? null;
      const gone = before ? Object.keys(before).some((k) => !(k in fields)) : true;
      if (!before || gone || before.planes !== fields.planes) me.town = t;
      else {
        const changed: Record<string, unknown> = {};
        for (const k of Object.keys(fields)) if (before[k] !== fields[k]) changed[k] = (t as unknown as Record<string, unknown>)[k];
        if (Object.keys(changed).length) me.townDelta = { tick: t.tick, tileEvents: '', changed };
      }
    }
    frame.me = me as unknown as ServerMeWire;
  }

  const kept = ring.filter((v) => v.rev !== room.rev);
  kept.push({ rev: room.rev, parts: hashes, cards, fields });
  while (kept.length > VERSIONS_KEPT) kept.shift();
  versions.set(meId, kept);

  if (!held) {
    const bytes = JSON.stringify(frame).length;
    if (bytes > FIRST_FRAME_BUDGET) console.warn(`[hometowns] large frame ${JSON.stringify({ room: room.id, rev: room.rev, bytes })}`);
  }
  return frame as ServerWire;
}

/**
 * The merge rule (engine/wire.ts) as code: `held` is the whole frame the
 * phone holds, `frame` the next one; the result is the whole frame it
 * stands for. The app's store and the page apply the same rule.
 */
export function applyFrame(held: HometownsWire | null, frame: HometownsWire): HometownsWire {
  if (frame.base === null) return frame;
  if (!held || held.rev !== frame.base) throw new Error(`frame ${frame.rev} is cut against ${frame.base}, not ${held?.rev ?? 'nothing'}: fetch the room whole`);
  const out = { ...frame, base: null } as HometownsWire;
  for (const k of TOP_PARTS) if (!(k in frame)) (out as unknown as Record<string, unknown>)[k] = held[k];
  if (!frame.towns) {
    const patch = frame.townsPatch;
    out.towns = (held.towns ?? []).map((card, k) => (patch?.[k] ? { ...card, ...patch[k] } : card));
  }
  delete out.townsPatch;
  if (frame.me) {
    const hm = (held.me ?? {}) as unknown as Record<string, unknown>;
    const me = { ...frame.me } as unknown as Record<string, unknown>;
    for (const k of ME_PARTS) if (!(k in frame.me)) me[k] = hm[k];
    if (!frame.me.town) {
      const town = hm.town as TownState | undefined;
      if (frame.me.townDelta) me.town = { ...town, ...frame.me.townDelta.changed };
      else if (town) me.town = town;
      delete me.townDelta;
    }
    out.me = me as unknown as MeWire;
  }
  return out;
}
