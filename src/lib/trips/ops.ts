// src/lib/trips/ops.ts
//
// The planner's operations (v2): the ONLY way the model changes a trip. Its
// answer is `{ reply, ops, quickReplies }`; each op is validated against the
// trip as it stands and applied IN ORDER, so a later op sees what an earlier
// one did. An invalid op is rejected with a reason and the rest still run.
//
// Validation is pure; the effects (database writes, the OpenStreetMap place
// lookup) are passed in, so the rules are tested without either.
//
// Two rules the model cannot talk its way round:
//  - Links: a booking URL is kept only when it is already known — a wish's
//    researched facts, the trip guide, or a link the person typed. Anything
//    else is dropped (D5, and "never invent booking URLs").
//  - Places: a stay or wish is placed by an OpenStreetMap search for the
//    model's `placeQuery`, never by coordinates the model writes; a wish's
//    place more than 100 km from every stay is a namesake, not found.

import {
  type TransportSegment,
  type TravellerProfile,
  type Booking,
  type BookingStatus,
  type LatLng,
  type LocalDate,
  type Stay,
  type Trip,
  type TripOp,
  type Wish,
  type WishDraft,
} from './model';
import { isLocalDate, isTimeZone, parseBookingPatch, parseTripInput, parseWishPatch, safeUrl, type BookingPatch, type TripInput, type WishPatch } from './intake';
import { mergeProfile } from './profile';
import { withinReach } from './research';

/** The most ops one turn may apply. */
export const MAX_OPS = 25;

export interface PlacedResult {
  name: string;
  location: LatLng;
  osmId: string | null;
  address: string | null;
}

/** What the ops act on, kept current as they apply. */
export interface OpContext {
  trip: Trip;
  stays: Stay[];
  wishes: Wish[];
  bookings: Booking[];
  /** Links that may be stored: researched facts, the trip guide, what the person typed, this turn's research. */
  knownUrls: Set<string>;
  /** v3 */
  transport?: TransportSegment[];
  profile?: TravellerProfile | null;
}

export interface StayFields {
  name: string;
  address: string | null;
  location: LatLng;
  fromDate: LocalDate;
  toDate: LocalDate;
  checkInMin: number | null;
  checkOutMin: number | null;
}

export interface NewWishFields {
  title: string;
  priority: Wish['priority'];
  durationSec: number | null;
  partOfDay: Wish['partOfDay'];
  fixedDate: LocalDate | null;
  fixedStartMin: number | null;
  note: string | null;
  place: Wish['place'];
  replacesMeal: Wish['replacesMeal'];
}

/** The side effects, supplied by the server (or a test). */
export interface OpEffects {
  resolvePlace(query: string, near: LatLng | null): Promise<PlacedResult | null>;
  setTrip(fields: TripInput): Promise<void>;
  addStay(fields: StayFields): Promise<Stay>;
  updateStay(id: string, fields: Partial<StayFields>): Promise<void>;
  removeStay(id: string): Promise<void>;
  addWish(fields: NewWishFields): Promise<Wish>;
  /** v7: an addWish may carry a place already found (a suggestion being approved). Never set for a model's ops. */
  trustsPlaces?: boolean;
  updateWish(id: string, patch: WishPatch): Promise<void>;
  removeWish(id: string): Promise<void>;
  addBooking(fields: BookingPatch & { title: string; wishId: string | null }): Promise<Booking>;
  updateBooking(id: string, patch: BookingPatch): Promise<void>;
  /** v3 */
  addTransport?(s: Omit<TransportSegment, 'id'>): Promise<TransportSegment>;
  updateTransport?(id: string, fields: Partial<Omit<TransportSegment, 'id'>>): Promise<void>;
  removeTransport?(id: string): Promise<void>;
  /** Save a stated, lasting preference to JKAI memory (the one memory write). */
  remember?(text: string, category: 'preferences' | 'people' | 'health' | 'places'): Promise<{ stored: boolean }>;
  saveProfile?(profile: TravellerProfile): Promise<void>;
}

export interface ApplyResult {
  applied: TripOp[];
  rejected: Array<{ op: TripOp; reason: string }>;
  /** Research to queue after the turn (D4 brief scan, or "look deeper"). */
  research: Array<{ wishIds: string[]; depth: 'brief' | 'deep' }>;
  /** Nearby suggestions to look for after the turn. */
  suggest: Array<{ near: string | null; theme: string | null }>;
  /** True when a constraint changed, so the trip must re-solve. */
  changed: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);

/** The model's whole answer, read leniently: a reply always comes back. */
export function readPlannerAnswer(raw: unknown): { reply: string; ops: unknown[]; quickReplies: string[] } {
  const o = isObj(raw) ? raw : {};
  const reply = str(o.reply, 4000) ?? (typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 4000) : 'Sorry — I lost my thread there. Could you say that again?');
  const ops = Array.isArray(o.ops) ? o.ops : [];
  const quickReplies = (Array.isArray(o.quickReplies) ? o.quickReplies : [])
    .map((q) => str(q, 80))
    .filter((q): q is string => !!q)
    .filter((q, i, a) => a.indexOf(q) === i)
    .slice(0, 4);
  return { reply, ops, quickReplies };
}

function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A date the trip can use: inside it (a stay may end the morning after). */
function inTrip(trip: Trip, date: LocalDate, allowDayAfter = false): boolean {
  return date >= trip.startDate && date <= (allowDayAfter ? addDays(trip.endDate, 1) : trip.endDate);
}

function minutes(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return v === null ? null : undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < 24 * 60 ? n : undefined;
}

/** Keep a URL only when it is already known; otherwise drop it. */
export function knownUrlOrNull(url: unknown, known: Set<string>): string | null {
  const clean = safeUrl(url);
  if (!clean) return null;
  const bare = (u: string) => u.replace(/\/+$/, '');
  for (const k of known) if (bare(k) === bare(clean)) return k;
  return null;
}

/** Every http(s) link in a piece of text — for the person's own messages. */
export function urlsIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>()"']+/g)].map((m) => m[0].replace(/[.,;:!?]+$/, ''));
}

/** Links a trip already holds: researched facts, guides. */
export function knownUrlsOf(wishes: Wish[], extra: string[] = []): Set<string> {
  const out = new Set<string>();
  for (const w of wishes) {
    for (const u of [w.facts?.bookingUrl, w.facts?.officialUrl, ...(w.facts?.sources ?? []).map((s) => s.url), ...(w.guide?.links ?? []).map((l) => l.url)]) {
      if (u) out.add(u);
    }
  }
  for (const u of extra) out.add(u);
  return out;
}

function wishPatchFrom(fields: Obj): { ok: true; patch: WishPatch; placeQuery: string | null } | { ok: false; reason: string } {
  const body: Obj = {};
  for (const k of ['title', 'priority', 'partOfDay', 'fixedDate', 'fixedStartMin', 'note', 'locked', 'skipped', 'replacesMeal'] as const) if (k in fields) body[k] = fields[k];
  if ('durationMin' in fields) body.durationMin = fields.durationMin === null ? null : fields.durationMin;
  if ('suggested' in fields) {
    if (fields.suggested !== false) return { ok: false, reason: 'A suggestion can only be accepted (suggested: false).' };
    body.suggested = false;
  }
  const parsed = parseWishPatch(body);
  if (!parsed.ok) return { ok: false, reason: parsed.error };
  return { ok: true, patch: parsed.value, placeQuery: 'placeQuery' in fields ? str(fields.placeQuery, 200) : null };
}

export function draftFrom(raw: unknown, opts: { allowPlace?: boolean } = {}): { ok: true; draft: WishDraft } | { ok: false; reason: string } {
  if (!isObj(raw)) return { ok: false, reason: 'addWish needs a wish object.' };
  const title = str(raw.title, 160);
  if (!title) return { ok: false, reason: 'A wish needs a title.' };
  const patch = wishPatchFrom({ ...raw, title });
  if (!patch.ok) return patch;
  const p = patch.patch;
  // v7: a place already found on the map rides along only where the caller
  // trusts it (the phone's suggestion, the server's approval) — never a model's.
  let place: WishDraft['place'] = undefined;
  if (opts.allowPlace && 'place' in raw && raw.place != null) {
    const parsed = parseWishPatch({ place: raw.place });
    if (!parsed.ok) return { ok: false, reason: parsed.error };
    place = parsed.value.place ?? null;
  }
  return {
    ok: true,
    draft: {
      title,
      placeQuery: str(raw.placeQuery, 200),
      priority: p.priority ?? 'nice',
      durationMin: p.durationSec ? Math.round(p.durationSec / 60) : null,
      partOfDay: p.partOfDay ?? 'any',
      fixedDate: p.fixedDate ?? null,
      fixedStartMin: p.fixedStartMin ?? null,
      note: p.note ?? null,
      replacesMeal: p.replacesMeal ?? null,
      ...(place ? { place } : {}),
    },
  };
}

/** The first stay's position, else any placed wish's: where "near" means for a place search. */
function nearOf(ctx: OpContext): LatLng | null {
  return ctx.stays[0]?.location ?? ctx.wishes.find((w) => w.place)?.place?.location ?? null;
}

/**
 * What a wish's place found by name must be near (./research `withinReach`):
 * any of the stays — a trip may have more than one city — or, before there
 * is a stay, the places already on the trip.
 */
function anchorsOf(ctx: OpContext): LatLng[] {
  if (ctx.stays.length) return ctx.stays.map((s) => s.location);
  return ctx.wishes.flatMap((w) => (w.place ? [w.place.location] : []));
}

/** A wish's place by name, or null when the map has none near the trip. */
async function wishPlace(fx: OpEffects, ctx: OpContext, query: string, near: LatLng | null): Promise<PlacedResult | null> {
  const place = await fx.resolvePlace(query, near);
  return place && withinReach(place.location, anchorsOf(ctx)) ? place : null;
}

/**
 * Validate and apply ops in order. Never throws for a bad op: it is listed in
 * `rejected` with a sentence and the turn carries on. An effect that throws
 * (the database) does propagate — that is a server fault, not a bad op.
 */
export async function applyOps(rawOps: unknown[], ctx: OpContext, fx: OpEffects): Promise<ApplyResult> {
  const out: ApplyResult = { applied: [], rejected: [], research: [], suggest: [], changed: false };
  const reject = (op: unknown, reason: string) => out.rejected.push({ op: (isObj(op) ? op : { op: 'unknown' }) as TripOp, reason });

  for (const [i, raw] of rawOps.entries()) {
    if (i >= MAX_OPS) {
      reject(raw, `At most ${MAX_OPS} changes in one turn.`);
      continue;
    }
    if (!isObj(raw) || typeof raw.op !== 'string') {
      reject(raw, 'Not an operation.');
      continue;
    }
    const f = isObj(raw.fields) ? raw.fields : {};
    switch (raw.op) {
      case 'setTrip': {
        const allowed = ['title', 'destination', 'timeZone', 'startDate', 'endDate', 'pace', 'modes', 'notes', 'dayLoads'];
        const fields = Object.fromEntries(Object.entries(f).filter(([k]) => allowed.includes(k)));
        // Day loads MERGE into the trip's (a day set back to 'normal' is removed), so
        // "make Wednesday lighter" does not wipe the other days' loads.
        if (isObj(fields.dayLoads)) fields.dayLoads = { ...(ctx.trip.dayLoads ?? {}), ...fields.dayLoads };
        if (!Object.keys(fields).length) {
          reject(raw, 'setTrip changed nothing.');
          break;
        }
        const parsed = parseTripInput({ ...ctx.trip, ...fields });
        if (!parsed.ok) {
          reject(raw, parsed.error);
          break;
        }
        await fx.setTrip(parsed.value);
        ctx.trip = { ...ctx.trip, ...parsed.value };
        // Record what was actually stored (normal and out-of-trip days fall away).
        if ('dayLoads' in fields) fields.dayLoads = parsed.value.dayLoads;
        out.applied.push({ op: 'setTrip', fields: fields as never });
        out.changed = true;
        break;
      }
      case 'addStay': {
        const name = str(raw.name, 120);
        const q = str(raw.placeQuery, 200) ?? name;
        if (!name || !q) {
          reject(raw, 'A stay needs a name and a place to look up.');
          break;
        }
        if (!isLocalDate(raw.fromDate) || !isLocalDate(raw.toDate) || raw.toDate <= raw.fromDate) {
          reject(raw, 'A stay needs a first night and a later departure date.');
          break;
        }
        if (!inTrip(ctx.trip, raw.fromDate) || !inTrip(ctx.trip, raw.toDate, true)) {
          reject(raw, `The stay's dates fall outside the trip (${ctx.trip.startDate} to ${ctx.trip.endDate}).`);
          break;
        }
        const ci = minutes(raw.checkInMin);
        const co = minutes(raw.checkOutMin);
        if (ci === undefined && raw.checkInMin !== undefined) {
          reject(raw, 'Check-in is not a time of day.');
          break;
        }
        const place = await fx.resolvePlace(q, nearOf(ctx) ?? null);
        if (!place) {
          reject(raw, `Could not find “${q}” on the map — give a street address or a nearby landmark.`);
          break;
        }
        const stay = await fx.addStay({
          name,
          address: place.address,
          location: place.location,
          fromDate: raw.fromDate,
          toDate: raw.toDate,
          checkInMin: ci ?? null,
          checkOutMin: co ?? null,
        });
        ctx.stays = [...ctx.stays, stay];
        out.applied.push({ op: 'addStay', name, placeQuery: q, fromDate: raw.fromDate, toDate: raw.toDate, checkInMin: ci ?? null, checkOutMin: co ?? null });
        out.changed = true;
        break;
      }
      case 'updateStay': {
        const stay = ctx.stays.find((s) => s.id === raw.id);
        if (!stay) {
          reject(raw, 'No such stay.');
          break;
        }
        const fields: Partial<StayFields> = {};
        if ('name' in f) {
          const n = str(f.name, 120);
          if (!n) {
            reject(raw, 'A stay needs a name.');
            break;
          }
          fields.name = n;
        }
        const badDate = (['fromDate', 'toDate'] as const).find(
          (k) => k in f && (!isLocalDate(f[k]) || !inTrip(ctx.trip, f[k] as string, k === 'toDate')),
        );
        if (badDate) {
          reject(raw, `${badDate} is not a date in the trip.`);
          break;
        }
        if (isLocalDate(f.fromDate)) fields.fromDate = f.fromDate;
        if (isLocalDate(f.toDate)) fields.toDate = f.toDate;
        if ((fields.toDate ?? stay.toDate) <= (fields.fromDate ?? stay.fromDate)) {
          reject(raw, 'A stay is at least one night.');
          break;
        }
        for (const k of ['checkInMin', 'checkOutMin'] as const) if (k in f) fields[k] = minutes(f[k]) ?? null;
        const q = str(f.placeQuery, 200);
        if (q) {
          const place = await fx.resolvePlace(q, stay.location);
          if (!place) {
            reject(raw, `Could not find “${q}” on the map.`);
            break;
          }
          fields.location = place.location;
          fields.address = place.address;
        }
        await fx.updateStay(stay.id, fields);
        ctx.stays = ctx.stays.map((s) => (s.id === stay.id ? { ...s, ...fields } : s));
        out.applied.push({ op: 'updateStay', id: stay.id, fields: f as never });
        out.changed = true;
        break;
      }
      case 'removeStay': {
        if (!ctx.stays.some((s) => s.id === raw.id)) {
          reject(raw, 'No such stay.');
          break;
        }
        await fx.removeStay(raw.id as string);
        ctx.stays = ctx.stays.filter((s) => s.id !== raw.id);
        out.applied.push({ op: 'removeStay', id: raw.id as string });
        out.changed = true;
        break;
      }
      case 'addWish': {
        const d = draftFrom(raw.wish, { allowPlace: fx.trustsPlaces === true });
        if (!d.ok) {
          reject(raw, d.reason);
          break;
        }
        const draft = d.draft;
        if (draft.fixedDate && !inTrip(ctx.trip, draft.fixedDate)) {
          reject(raw, `${draft.fixedDate} is not a day of the trip.`);
          break;
        }
        if (ctx.wishes.some((w) => w.title.toLowerCase() === draft.title.toLowerCase() && !w.skipped)) {
          reject(raw, `“${draft.title}” is already a wish.`);
          break;
        }
        // A namesake far from the trip is not found: the wish waits for a place.
        const place = draft.place ?? (draft.placeQuery ? await wishPlace(fx, ctx, draft.placeQuery, nearOf(ctx)) : null);
        const wish = await fx.addWish({
          title: draft.title,
          priority: draft.priority,
          durationSec: draft.durationMin ? draft.durationMin * 60 : null,
          partOfDay: draft.partOfDay,
          fixedDate: draft.fixedDate,
          fixedStartMin: draft.fixedStartMin,
          note: draft.note,
          replacesMeal: draft.replacesMeal ?? null,
          place: place ? { name: place.name, location: place.location, osmId: place.osmId, address: place.address } : null,
        });
        ctx.wishes = [...ctx.wishes, wish];
        out.applied.push({ op: 'addWish', wish: draft });
        out.changed = true;
        // A new wish is researched (D4 brief scan) once the turn is done.
        out.research.push({ wishIds: [wish.id], depth: 'brief' });
        break;
      }
      case 'updateWish': {
        const wish = ctx.wishes.find((w) => w.id === raw.id);
        if (!wish) {
          reject(raw, 'No such wish.');
          break;
        }
        const p = wishPatchFrom(f);
        if (!p.ok) {
          reject(raw, p.reason);
          break;
        }
        if (p.patch.fixedDate && !inTrip(ctx.trip, p.patch.fixedDate)) {
          reject(raw, `${p.patch.fixedDate} is not a day of the trip.`);
          break;
        }
        const patch: WishPatch = { ...p.patch };
        if (p.placeQuery) {
          const place = await wishPlace(fx, ctx, p.placeQuery, wish.place?.location ?? nearOf(ctx));
          if (!place) {
            reject(raw, `Could not find “${p.placeQuery}” on the map near the trip.`);
            break;
          }
          patch.place = { name: place.name, location: place.location, osmId: place.osmId, address: place.address };
        }
        if (!Object.keys(patch).length) {
          reject(raw, 'updateWish changed nothing.');
          break;
        }
        await fx.updateWish(wish.id, patch);
        ctx.wishes = ctx.wishes.map((w) => (w.id === wish.id ? ({ ...w, ...patch } as Wish) : w));
        out.applied.push({ op: 'updateWish', id: wish.id, fields: f as never });
        out.changed = true;
        break;
      }
      case 'removeWish': {
        if (!ctx.wishes.some((w) => w.id === raw.id)) {
          reject(raw, 'No such wish.');
          break;
        }
        await fx.removeWish(raw.id as string);
        ctx.wishes = ctx.wishes.filter((w) => w.id !== raw.id);
        out.applied.push({ op: 'removeWish', id: raw.id as string });
        out.changed = true;
        break;
      }
      case 'addBooking':
      case 'updateBooking': {
        const body = raw.op === 'addBooking' ? (isObj(raw.booking) ? raw.booking : null) : f;
        if (!body) {
          reject(raw, 'addBooking needs a booking object.');
          break;
        }
        const existing = raw.op === 'updateBooking' ? ctx.bookings.find((b) => b.id === raw.id) : null;
        if (raw.op === 'updateBooking' && !existing) {
          reject(raw, 'No such booking.');
          break;
        }
        const { url, ...rest } = body;
        const parsed = parseBookingPatch(rest);
        if (!parsed.ok) {
          reject(raw, parsed.error);
          break;
        }
        const patch: BookingPatch = { ...parsed.value };
        if (url !== undefined) patch.url = knownUrlOrNull(url, ctx.knownUrls);
        if (patch.date && !inTrip(ctx.trip, patch.date)) {
          reject(raw, `${patch.date} is not a day of the trip.`);
          break;
        }
        if (raw.op === 'updateBooking') {
          await fx.updateBooking(existing!.id, patch);
          ctx.bookings = ctx.bookings.map((b) => (b.id === existing!.id ? { ...b, ...patch } as Booking : b));
          out.applied.push({ op: 'updateBooking', id: existing!.id, fields: patch as never });
        } else {
          const wishId = typeof body.wishId === 'string' ? body.wishId : null;
          if (wishId && !ctx.wishes.some((w) => w.id === wishId)) {
            reject(raw, 'That booking names a wish that does not exist.');
            break;
          }
          const title = patch.title ?? (wishId ? ctx.wishes.find((w) => w.id === wishId)!.title : null);
          if (!title) {
            reject(raw, 'A booking needs a title.');
            break;
          }
          const status: BookingStatus = patch.status ?? 'to-book';
          const booking = await fx.addBooking({ ...patch, title, status, wishId });
          ctx.bookings = [...ctx.bookings, booking];
          out.applied.push({ op: 'addBooking', booking: { ...booking, id: undefined } as never });
        }
        out.changed = true;
        break;
      }
      case 'research': {
        const ids = (Array.isArray(raw.wishIds) ? raw.wishIds : []).filter((id): id is string => typeof id === 'string' && ctx.wishes.some((w) => w.id === id)).slice(0, 10);
        if (!ids.length) {
          reject(raw, 'research names no wish that exists.');
          break;
        }
        const depth = raw.depth === 'deep' ? 'deep' : 'brief';
        out.research.push({ wishIds: ids, depth });
        out.applied.push({ op: 'research', wishIds: ids, depth });
        break;
      }
      case 'suggestNearby': {
        const near = str(raw.near, 160);
        const theme = str(raw.theme, 80);
        out.suggest.push({ near, theme });
        out.applied.push({ op: 'suggestNearby', near, theme });
        break;
      }
      case 'addTransport':
      case 'updateTransport': {
        const adding = raw.op === 'addTransport';
        const existing = adding ? null : (ctx.transport ?? []).find((t) => t.id === raw.id);
        if (!adding && !existing) {
          reject(raw, 'No such journey.');
          break;
        }
        const parsed = parseTransport(adding ? raw.segment : f, ctx, !adding);
        if (!parsed.ok) {
          reject(raw, parsed.reason);
          break;
        }
        const seg = parsed.value;
        // "Researched" means found online: times with no source seen are the
        // planner's own estimate, and say so (never passed off as looked up).
        if (seg.confidence === 'researched' && !(seg.sources ?? existing?.sources ?? []).length) {
          seg.confidence = 'estimated';
          if (adding) seg.checkedAt = null;
        }
        // Locate each end by name on OpenStreetMap.
        for (const end of ['from', 'to'] as const) {
          const e = seg[end];
          if (!e) continue;
          const q = `${e.name}${e.code ? ` ${e.code}` : ''}${(seg.kind ?? existing?.kind) === 'flight' && !/airport/i.test(e.name) ? ' airport' : ''}`;
          const place = await fx.resolvePlace(q, null);
          seg[end] = { ...e, location: place?.location ?? null };
        }
        if (adding) {
          if (!fx.addTransport) {
            reject(raw, 'Journeys cannot be saved here.');
            break;
          }
          const saved = await fx.addTransport(seg as Omit<TransportSegment, 'id'>);
          ctx.transport = [...(ctx.transport ?? []), saved];
          out.applied.push({ op: 'addTransport', segment: seg as Omit<TransportSegment, 'id'> });
        } else {
          await fx.updateTransport?.(existing!.id, seg);
          ctx.transport = (ctx.transport ?? []).map((t) => (t.id === existing!.id ? { ...t, ...seg } : t));
          out.applied.push({ op: 'updateTransport', id: existing!.id, fields: seg });
        }
        out.changed = true;
        break;
      }
      case 'removeTransport': {
        if (!(ctx.transport ?? []).some((t) => t.id === raw.id)) {
          reject(raw, 'No such journey.');
          break;
        }
        await fx.removeTransport?.(raw.id as string);
        ctx.transport = (ctx.transport ?? []).filter((t) => t.id !== raw.id);
        out.applied.push({ op: 'removeTransport', id: raw.id as string });
        out.changed = true;
        break;
      }
      case 'remember': {
        const text = str(raw.text, 300);
        const category = raw.category as 'preferences' | 'people' | 'health' | 'places';
        if (!text || text.length < 6) {
          reject(raw, 'remember needs the preference in a short sentence.');
          break;
        }
        if (!['preferences', 'people', 'health', 'places'].includes(category)) {
          reject(raw, 'remember’s category is preferences, people, health or places.');
          break;
        }
        if (!fx.remember) {
          reject(raw, 'Memory is not available here.');
          break;
        }
        await fx.remember(text, category);
        // The profile shows it at once, sourced to this conversation.
        ctx.profile = mergeProfile(
          ctx.profile ?? null,
          category === 'health'
            ? { constraints: [...(ctx.profile?.constraints ?? []), { text, source: 'conversation', ref: null }] }
            : { preferences: [...(ctx.profile?.preferences ?? []), { text, source: 'conversation', ref: null }] },
          new Date().toISOString(),
        );
        await fx.saveProfile?.(ctx.profile);
        out.applied.push({ op: 'remember', text, category });
        break;
      }
      case 'updateProfile': {
        if (!isObj(raw.profile)) {
          reject(raw, 'updateProfile needs a profile object.');
          break;
        }
        const allowed = ['travellers', 'preferences', 'constraints', 'history'];
        const patch = Object.fromEntries(Object.entries(raw.profile).filter(([k]) => allowed.includes(k)));
        if (!Object.keys(patch).length) {
          reject(raw, 'updateProfile changed nothing.');
          break;
        }
        ctx.profile = mergeProfile(ctx.profile ?? null, patch, new Date().toISOString());
        await fx.saveProfile?.(ctx.profile);
        out.applied.push({ op: 'updateProfile', profile: patch });
        break;
      }
      default:
        reject(raw, `Unknown operation “${String(raw.op).slice(0, 40)}”.`);
    }
  }
  return out;
}

const KINDS: TransportSegment['kind'][] = ['flight', 'train', 'coach', 'ferry', 'car'];
const DIRECTIONS: TransportSegment['direction'][] = ['outbound', 'return', 'internal'];

/**
 * A transport segment from the model or a form: places by name (located later
 * by OpenStreetMap, never by coordinates the model writes), times local to
 * each end, links only when known. `partial` validates an update.
 */
export function parseTransport(
  raw: unknown,
  ctx: { trip: Trip; knownUrls: Set<string> },
  partial = false,
): { ok: true; value: Partial<Omit<TransportSegment, 'id'>> } | { ok: false; reason: string } {
  if (!isObj(raw)) return { ok: false, reason: 'A transport segment is an object.' };
  const out: Partial<Omit<TransportSegment, 'id'>> = {};
  const need = (k: string) => !partial || k in raw;
  if (need('kind')) {
    if (!KINDS.includes(raw.kind as TransportSegment['kind'])) return { ok: false, reason: 'kind is flight, train, coach, ferry or car.' };
    out.kind = raw.kind as TransportSegment['kind'];
  }
  if (need('direction')) {
    if (!DIRECTIONS.includes(raw.direction as TransportSegment['direction'])) return { ok: false, reason: 'direction is outbound, return or internal.' };
    out.direction = raw.direction as TransportSegment['direction'];
  }
  if ('carrier' in raw) out.carrier = str(raw.carrier, 60);
  if ('number' in raw) {
    const n = str(raw.number, 12)?.replace(/\s+/g, '').toUpperCase() ?? null;
    if (n && !/^[A-Z0-9]{2,3}\d{1,5}[A-Z]?$/.test(n) && out.kind === 'flight') return { ok: false, reason: `“${n}” is not a flight number.` };
    out.number = n;
  }
  for (const end of ['from', 'to'] as const) {
    if (!need(end)) continue;
    const e = isObj(raw[end]) ? (raw[end] as Obj) : null;
    const name = str(e?.name, 120);
    if (!name) return { ok: false, reason: `The ${end} end needs a name.` };
    const code = str(e?.code, 4)?.toUpperCase() ?? null;
    const tz = e?.timeZone === undefined || e?.timeZone === null ? ctx.trip.timeZone : e.timeZone;
    if (!isTimeZone(tz)) return { ok: false, reason: `The ${end} end's time zone is not a time zone.` };
    out[end] = { name, code: code && /^[A-Z]{3,4}$/.test(code) ? code : null, location: null, timeZone: tz as string };
  }
  for (const k of ['departDate', 'arriveDate'] as const) {
    if (!need(k)) continue;
    if (!isLocalDate(raw[k])) return { ok: false, reason: `${k} is not a date.` };
    out[k] = raw[k] as string;
  }
  for (const k of ['departMin', 'arriveMin'] as const) {
    if (!need(k)) continue;
    const m = minutes(raw[k]);
    if (m === undefined || m === null) return { ok: false, reason: `${k} must be minutes after midnight.` };
    out[k] = m;
  }
  if (out.departDate && out.arriveDate && out.arriveDate < out.departDate) return { ok: false, reason: 'It arrives before it leaves.' };
  // Never 'live' from a model or a form: only a status feed may say that.
  if ('confidence' in raw || !partial) out.confidence = raw.confidence === 'researched' ? 'researched' : raw.confidence === 'estimated' ? 'estimated' : 'stated';
  if ('bookingRef' in raw) out.bookingRef = str(raw.bookingRef, 40);
  if ('sources' in raw || !partial) {
    out.sources = (Array.isArray(raw.sources) ? raw.sources : [])
      .map((x) => (isObj(x) ? { url: knownUrlOrNull(x.url, ctx.knownUrls), title: str(x.title, 120) } : null))
      .filter((x): x is { url: string; title: string | null } => !!x?.url)
      .slice(0, 5);
  }
  if (!partial) {
    out.carrier ??= null;
    out.number ??= null;
    out.status = null;
    out.delayMin = null;
    out.bookingRef ??= null;
    out.checkedAt = out.confidence === 'researched' ? new Date().toISOString() : null;
  }
  return { ok: true, value: out };
}

/** One line per op, for an `event` message logging a form edit. */
export function describeOp(op: TripOp, titles: Record<string, string> = {}): string {
  const name = (id: string) => titles[id] ?? 'a wish';
  switch (op.op) {
    case 'setTrip': {
      const loads = op.fields.dayLoads ? Object.entries(op.fields.dayLoads).map(([d, l]) => `${d} ${l}`).join(', ') : '';
      const rest = Object.keys(op.fields).filter((k) => k !== 'dayLoads');
      return [rest.length ? `Trip details changed (${rest.join(', ')}).` : '', loads ? `Day loads set: ${loads}.` : ''].filter(Boolean).join(' ');
    }
    case 'addStay':
      return `Stay added: ${op.name}.`;
    case 'updateStay':
      return 'A stay was changed.';
    case 'removeStay':
      return 'A stay was removed.';
    case 'addWish':
      return `Wish added: ${op.wish.title}.`;
    case 'updateWish':
      return `${name(op.id)} changed (${Object.keys(op.fields).join(', ')}).`;
    case 'removeWish':
      return `${name(op.id)} removed.`;
    case 'addBooking':
      return `Booking added: ${op.booking.title}.`;
    case 'updateBooking':
      return `Booking changed (${Object.keys(op.fields).join(', ')}).`;
    case 'research':
      return `Research asked for ${op.wishIds.length} wish${op.wishIds.length === 1 ? '' : 'es'}.`;
    case 'suggestNearby':
      return 'Nearby suggestions asked for.';
    case 'addTransport':
      return `Journey added: ${op.segment.number ?? op.segment.kind} ${op.segment.from.name} → ${op.segment.to.name}.`;
    case 'updateTransport':
      return 'A journey was changed.';
    case 'removeTransport':
      return 'A journey was removed.';
    case 'remember':
      return `Remembered: ${op.text}`;
    case 'updateProfile':
      return 'What I know about you was updated.';
  }
}
