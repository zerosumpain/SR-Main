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
//    model's `placeQuery`, never by coordinates the model writes.

import {
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
import { isLocalDate, parseBookingPatch, parseTripInput, parseWishPatch, safeUrl, type BookingPatch, type TripInput, type WishPatch } from './intake';

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
  /** Links that may be stored: researched facts, the trip guide, what the person typed. */
  knownUrls: Set<string>;
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
}

/** The side effects, supplied by the server (or a test). */
export interface OpEffects {
  resolvePlace(query: string, near: LatLng | null): Promise<PlacedResult | null>;
  setTrip(fields: TripInput): Promise<void>;
  addStay(fields: StayFields): Promise<Stay>;
  updateStay(id: string, fields: Partial<StayFields>): Promise<void>;
  removeStay(id: string): Promise<void>;
  addWish(fields: NewWishFields): Promise<Wish>;
  updateWish(id: string, patch: WishPatch): Promise<void>;
  removeWish(id: string): Promise<void>;
  addBooking(fields: BookingPatch & { title: string; wishId: string | null }): Promise<Booking>;
  updateBooking(id: string, patch: BookingPatch): Promise<void>;
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
  for (const k of ['title', 'priority', 'partOfDay', 'fixedDate', 'fixedStartMin', 'note', 'locked', 'skipped'] as const) if (k in fields) body[k] = fields[k];
  if ('durationMin' in fields) body.durationMin = fields.durationMin === null ? null : fields.durationMin;
  if ('suggested' in fields) {
    if (fields.suggested !== false) return { ok: false, reason: 'A suggestion can only be accepted (suggested: false).' };
    body.suggested = false;
  }
  const parsed = parseWishPatch(body);
  if (!parsed.ok) return { ok: false, reason: parsed.error };
  return { ok: true, patch: parsed.value, placeQuery: 'placeQuery' in fields ? str(fields.placeQuery, 200) : null };
}

function draftFrom(raw: unknown): { ok: true; draft: WishDraft } | { ok: false; reason: string } {
  if (!isObj(raw)) return { ok: false, reason: 'addWish needs a wish object.' };
  const title = str(raw.title, 160);
  if (!title) return { ok: false, reason: 'A wish needs a title.' };
  const patch = wishPatchFrom({ ...raw, title });
  if (!patch.ok) return patch;
  const p = patch.patch;
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
    },
  };
}

/** The first stay's position, else any placed wish's: where "near" means for a place search. */
function nearOf(ctx: OpContext): LatLng | null {
  return ctx.stays[0]?.location ?? ctx.wishes.find((w) => w.place)?.place?.location ?? null;
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
        const allowed = ['title', 'destination', 'timeZone', 'startDate', 'endDate', 'pace', 'modes', 'notes'];
        const fields = Object.fromEntries(Object.entries(f).filter(([k]) => allowed.includes(k)));
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
        const d = draftFrom(raw.wish);
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
        const place = draft.placeQuery ? await fx.resolvePlace(draft.placeQuery, nearOf(ctx)) : null;
        const wish = await fx.addWish({
          title: draft.title,
          priority: draft.priority,
          durationSec: draft.durationMin ? draft.durationMin * 60 : null,
          partOfDay: draft.partOfDay,
          fixedDate: draft.fixedDate,
          fixedStartMin: draft.fixedStartMin,
          note: draft.note,
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
          const place = await fx.resolvePlace(p.placeQuery, wish.place?.location ?? nearOf(ctx));
          if (!place) {
            reject(raw, `Could not find “${p.placeQuery}” on the map.`);
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
      default:
        reject(raw, `Unknown operation “${String(raw.op).slice(0, 40)}”.`);
    }
  }
  return out;
}

/** One line per op, for an `event` message logging a form edit. */
export function describeOp(op: TripOp, titles: Record<string, string> = {}): string {
  const name = (id: string) => titles[id] ?? 'a wish';
  switch (op.op) {
    case 'setTrip':
      return `Trip details changed (${Object.keys(op.fields).join(', ')}).`;
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
  }
}
