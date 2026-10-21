// src/lib/trips/brief.ts
//
// v8: the brief — what the planner knows about a trip, each item labelled with
// where it came from (./decisions FactSource): where, when, who, the pace, how
// they get about, each stay, each journey, what is booked, the must-dos, what
// the owner's notes say they like or cannot do, and the planner's own working
// assumptions. Built from the trip, its stays, journeys, bookings, wishes and
// profile, and the trip's stored provenance (`trip.provenance`). PURE.
//
// Why: Rome's stay arrived from memory with no label, and Darlington's planner
// asked five questions instead of assuming and saying so. The brief is the one
// visible record of the facts, so a guess is never passed off as a fact (an
// 'assumed' item is shown amber with Right / Change) and nothing known is
// asked again.
//
// Defaults when a fact has no provenance entry: a stay, booking or must-do is
// 'you' — data from before v8 must not suddenly look assumed; a journey reads
// its own `confidence` (stated → you, researched/live → found, estimated →
// assumed), which has always said how sure we were of its times.
//
// Also here, the direct edits to it (`BriefPatch` → ops, read leniently):
// site and phone change dates, who, pace and stays without the chat.

import { dayLabel } from './changes';
import type { BriefItem, BriefKind, BriefPatch, FactSource, Provenance, ProvenanceEntry, TripBrief } from './decisions';
import type { Booking, LocalDate, Stay, TransportSegment, TravelMode, TravellerProfile, Trip, TripOp, Wish } from './model';
import { NEW_TRIP } from './prompt';

export interface BriefInput {
  trip: Trip;
  stays: Stay[];
  wishes: Wish[];
  bookings: Booking[];
  transport: TransportSegment[];
  profile: TravellerProfile | null;
  provenance: Provenance;
  /** What the planner still needs (./prompt `missingInfo`). */
  missing: string[];
}

// ── Small formatters (dates without a time-zone round trip, as ./changes) ──

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;

function parts(date: LocalDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

function monthName(date: LocalDate): string {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
}

/** Whole days from a to b. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const p = (s: string) => {
    const { y, m, d } = parts(s);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(b) - p(a)) / 86_400_000);
}

/** "26–30 Oct", "30 Oct – 2 Nov", "30 Dec 2026 – 2 Jan 2027", "15 Oct". */
export function dateRangeLabel(start: LocalDate, end: LocalDate): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${a.d} ${monthName(start)}`;
  if (a.y !== b.y) return `${a.d} ${monthName(start)} ${a.y} – ${b.d} ${monthName(end)} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${monthName(start)} – ${b.d} ${monthName(end)}`;
  return `${a.d}–${b.d} ${monthName(end)}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

// ── Stays: a short area from the address ──────────────────────────────────

/** A street, not an area: "Via del Governo Vecchio", "Grey Street", "Rue de Rivoli". */
const STREET_START = /^(via|viale|vicolo|piazza|piazzale|piazzetta|largo|corso|lungotevere|salita|calle|carrer|carrera|avenida|rua|rue|avenue|boulevard|bd|place|quai|impasse|chemin|allée|strada|straße|strasse|gasse|platz|weg|ulica|plaza|paseo)\b/i;
const STREET_END = /\b(street|st|road|rd|lane|ln|avenue|ave|way|drive|dr|terrace|crescent|close|square|place|row|gardens|grove|walk|mews|hill|wynd|vennel|strasse|straße|gasse|weg|platz|allee)\.?$/i;
/** Administrative layers that are not what anyone calls the area. */
const ADMIN = /^(municipio|municipality|arrondissement|bezirk|borough of|district|county|comune|city of|ward|region|regione|provincia|province|state of)\b/i;

/**
 * The area a stay is in, from its OpenStreetMap address — "Parione" from
 * "69, Via del Governo Vecchio, Parione, Municipio Roma I, Roma, …". Skips
 * the house number, the place's own name, the street and administrative
 * layers; null when what is left is the city itself (the label then uses the
 * stay's name) or there is no address.
 */
export function stayArea(stay: Pick<Stay, 'name' | 'address'>, destination: string): string | null {
  if (!stay.address) return null;
  const city = destination.split(',')[0].trim().toLowerCase();
  const name = stay.name.trim().toLowerCase();
  const bits = stay.address
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
  for (const b of bits) {
    const low = b.toLowerCase();
    if (/\d/.test(b) && (/^\d/.test(b) || /\d{3,}/.test(b))) continue; // house numbers, postcodes, "Via X 69"
    if (low === name || name.startsWith(low) || low.startsWith(name)) continue;
    if (STREET_START.test(b) || STREET_END.test(b)) continue;
    if (ADMIN.test(b)) continue;
    // The first remaining part: a neighbourhood or suburb — or the city.
    if (low === city || city.startsWith(low) || low.startsWith(city)) return null;
    return clip(b, 28);
  }
  return null;
}

// ── Labels ─────────────────────────────────────────────────────────────────

const PACE_LABEL: Record<Trip['pace'], string> = { relaxed: 'Relaxed pace', normal: 'Normal pace', packed: 'Packed pace' };
const MODE_WORD: Record<TravelMode, string> = { walk: 'walking', transit: 'public transport', taxi: 'taxis', cycle: 'cycling', drive: 'driving' };

/** "Walking, public transport and taxis". */
export function modesLabel(modes: TravelMode[]): string {
  const words = modes.map((m) => MODE_WORD[m]).filter(Boolean);
  const text = words.length <= 1 ? (words[0] ?? 'walking') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "John, Sam + 2" for a chip; "John, Sam (9), Alex, Robin" for the detail. */
export function travellersLabel(travellers: TravellerProfile['travellers']): { label: string; detail: string } | null {
  const named = travellers.filter((t) => t.name && t.name.trim());
  if (!named.length) return null;
  const names = named.map((t) => t.name.trim());
  const label = names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} + ${names.length - 2}`;
  const detail = named.map((t) => `${t.name.trim()}${t.age != null ? ` (${t.age})` : ''}`).join(', ');
  return { label, detail };
}

/** "NCL 07:35 → FCO". */
export function transportLabel(t: TransportSegment): string {
  const end = (e: TransportSegment['from']) => e.code ?? clip(e.name.replace(/\s+(airport|station)$/i, ''), 18);
  return `${end(t.from)} ${hhmm(t.departMin)} → ${end(t.to)}`;
}

function transportDetail(t: TransportSegment): string {
  const lands = t.arriveDate === t.departDate ? hhmm(t.arriveMin) : `${dayLabel(t.arriveDate)} ${hhmm(t.arriveMin)}`;
  const verb = t.kind === 'flight' ? 'lands' : 'arrives';
  return `${t.number ? `${t.number} · ` : ''}${dayLabel(t.departDate)}, ${verb} ${lands}`;
}

/** A journey's origin when nothing was recorded: what its own confidence has always said. */
export function transportOrigin(t: Pick<TransportSegment, 'confidence'>): FactSource {
  if (t.confidence === 'researched' || t.confidence === 'live') return 'found';
  if (t.confidence === 'estimated') return 'assumed';
  return 'you';
}

/** Known assumption keys the planner records without a note of its own. */
const ASSUMPTION_LABEL: Record<string, string> = {
  'meal-times': 'Usual meal times',
  'stay-centre': 'Planning from the centre',
  'travellers-default': 'Travellers not known yet',
};

const ROW_KEY = /^(stay|transport|booking|wish):/;

// ── The builder ────────────────────────────────────────────────────────────

export function buildBrief(input: BriefInput): TripBrief {
  const { trip } = input;
  const prov = (key: string): ProvenanceEntry | undefined => input.provenance[key];
  const items: BriefItem[] = [];
  const add = (item: Omit<BriefItem, 'origin' | 'note' | 'ref'> & { fallback: FactSource; note?: string | null; ref?: string | null }) => {
    const p = prov(item.key);
    const { fallback, note, ref, ...rest } = item;
    items.push({ ...rest, origin: p?.source ?? fallback, note: p?.note ?? note ?? null, ref: p?.ref ?? ref ?? null });
  };
  const placeholder = !trip.destination || trip.destination === NEW_TRIP;

  // Where and when. A trip started from a sentence has placeholder values
  // until the planner sets them: shown as assumed, never as facts.
  add({
    key: 'destination',
    kind: 'destination',
    label: placeholder ? 'Where: not set yet' : clip(trip.destination.split(',')[0].trim(), 40),
    detail: placeholder ? null : `${trip.destination} · ${trip.timeZone}`,
    editable: true,
    fallback: placeholder ? 'assumed' : 'you',
  });
  const days = daysBetween(trip.startDate, trip.endDate) + 1;
  add({
    key: 'dates',
    kind: 'dates',
    label: dateRangeLabel(trip.startDate, trip.endDate),
    detail: trip.startDate === trip.endDate ? `${dayLabel(trip.startDate)}, 1 day` : `${dayLabel(trip.startDate)} – ${dayLabel(trip.endDate)}, ${plural(days, 'day')}`,
    editable: true,
    fallback: placeholder ? 'assumed' : 'you',
  });

  // Who. The profile's travellers were gathered from the roster and the
  // owner's notes; without them, what the trip's own notes say.
  const who = travellersLabel(input.profile?.travellers ?? []);
  if (who) add({ key: 'travellers', kind: 'travellers', label: who.label, detail: who.detail, editable: true, fallback: 'notes' });
  else if (trip.notes) add({ key: 'travellers', kind: 'travellers', label: clip(trip.notes, 40), detail: trip.notes.length > 40 ? trip.notes : null, editable: true, fallback: 'you' });
  else add({ key: 'travellers', kind: 'travellers', label: 'Who: not known yet', detail: 'Planning for adults; say who is coming', editable: true, fallback: 'assumed' });

  add({ key: 'pace', kind: 'pace', label: PACE_LABEL[trip.pace] ?? 'Normal pace', detail: null, editable: true, fallback: 'you' });
  const modes = trip.modes?.length ? trip.modes : (['walk'] as TravelMode[]);
  if (modes.some((m) => m !== 'walk')) add({ key: 'modes', kind: 'modes', label: modesLabel(modes), detail: null, editable: true, fallback: 'you' });

  // Where they sleep: what every day starts and ends at.
  if (!input.stays.length) {
    add({ key: 'stay', kind: 'stay', label: 'Stay: not known yet', detail: 'Planning from the centre until you add one', editable: true, fallback: 'assumed' });
  }
  for (const s of input.stays) {
    const nights = daysBetween(s.fromDate, s.toDate);
    add({
      key: `stay:${s.id}`,
      kind: 'stay',
      label: `Stay: ${stayArea(s, trip.destination) ?? clip(s.name, 28)}`,
      detail: `${s.name}, ${plural(nights, 'night')}`,
      editable: true,
      fallback: 'you',
    });
  }

  for (const t of input.transport) {
    const found = t.sources?.[0];
    add({
      key: `transport:${t.id}`,
      kind: 'transport',
      label: transportLabel(t),
      detail: transportDetail(t),
      editable: false,
      fallback: transportOrigin(t),
      ref: transportOrigin(t) === 'found' ? (found?.url ?? null) : null,
    });
  }

  for (const b of input.bookings.filter((x) => x.status === 'booked')) {
    const when = b.date ? `${dayLabel(b.date)}${b.startMin !== null ? ` ${hhmm(b.startMin)}` : ''}` : null;
    add({
      key: `booking:${b.id}`,
      kind: 'booking',
      label: `Booked: ${clip(b.title, 32)}`,
      detail: [when, b.reference ? `ref ${b.reference}` : null].filter(Boolean).join(' · ') || null,
      editable: false,
      fallback: 'you',
    });
  }

  for (const w of input.wishes.filter((x) => x.priority === 'must' && !x.suggested && !x.skipped)) {
    const when = w.fixedDate ? `${dayLabel(w.fixedDate)}${w.fixedStartMin !== null ? ` ${hhmm(w.fixedStartMin)}` : ''}` : null;
    add({ key: `wish:${w.id}`, kind: 'must', label: clip(w.title, 40), detail: when, editable: false, fallback: 'you' });
  }

  // What the owner's notes say they like or cannot do (site only: the phone
  // drops these, ./decisions.bundle.server `phoneBrief`).
  const fromNotes = (s: TravellerProfile['preferences'][number]['source']): FactSource => (s === 'conversation' ? 'you' : 'notes');
  const profileItems = (list: TravellerProfile['preferences'], kind: Extract<BriefKind, 'preference' | 'constraint'>) =>
    list.forEach((p, i) =>
      items.push({
        key: `${kind}:${i}`,
        kind,
        label: clip(p.text, 60),
        detail: p.text.length > 60 ? p.text : null,
        origin: fromNotes(p.source),
        note: null,
        ref: p.ref ?? null,
        editable: false,
      }),
    );
  profileItems(input.profile?.constraints ?? [], 'constraint');
  profileItems(input.profile?.preferences ?? [], 'preference');

  // The planner's own working assumptions not already shown on an item.
  const shown = new Set(items.map((i) => i.key));
  for (const [key, p] of Object.entries(input.provenance)) {
    if (p.source !== 'assumed' || shown.has(key) || ROW_KEY.test(key)) continue;
    if (['destination', 'dates', 'travellers', 'pace', 'modes', 'stay'].includes(key)) continue;
    items.push({
      key,
      kind: 'assumption',
      label: clip(p.note?.replace(/^assumed:\s*/i, '') || ASSUMPTION_LABEL[key] || key.replace(/[-_]/g, ' '), 60),
      detail: null,
      origin: 'assumed',
      note: p.note,
      ref: p.ref,
      editable: true,
    });
  }

  return { items, assumed: items.filter((i) => i.origin === 'assumed').length, missing: input.missing };
}

// ── Direct edits ───────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const isDate = (v: unknown): v is LocalDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const PACES = ['relaxed', 'normal', 'packed'] as const;
const MODES: readonly TravelMode[] = ['walk', 'cycle', 'drive', 'transit', 'taxi'];

/** A `BriefPatch` from a request body, or a sentence saying what is wrong. */
export function readBriefPatch(raw: unknown): { ok: true; patch: BriefPatch } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'Send the change as JSON.' };
  switch (raw.field) {
    case 'dates':
      if (!isDate(raw.startDate) || !isDate(raw.endDate)) return { ok: false, error: 'Give the first and last day as dates.' };
      return { ok: true, patch: { field: 'dates', startDate: raw.startDate, endDate: raw.endDate } };
    case 'destination': {
      const destination = str(raw.destination, 120);
      if (!destination) return { ok: false, error: 'Where are you going?' };
      return { ok: true, patch: { field: 'destination', destination, timeZone: str(raw.timeZone, 60) } };
    }
    case 'pace':
      if (!PACES.includes(raw.pace as (typeof PACES)[number])) return { ok: false, error: 'Pace is relaxed, normal or packed.' };
      return { ok: true, patch: { field: 'pace', pace: raw.pace as (typeof PACES)[number] } };
    case 'modes': {
      const modes = (Array.isArray(raw.modes) ? raw.modes : []).filter((m): m is TravelMode => MODES.includes(m as TravelMode));
      return { ok: true, patch: { field: 'modes', modes: [...new Set(['walk' as const, ...modes])] } };
    }
    case 'travellers': {
      const list = (Array.isArray(raw.travellers) ? raw.travellers : [])
        .filter(isObj)
        .map((t) => {
          const age = Number(t.age);
          return { name: str(t.name, 60), age: t.age === null || t.age === undefined || !Number.isInteger(age) || age < 0 || age > 120 ? null : age, personId: str(t.personId, 80) };
        })
        .filter((t): t is { name: string; age: number | null; personId: string | null } => !!t.name)
        .slice(0, 20);
      if (!list.length) return { ok: false, error: 'Say who is travelling.' };
      return { ok: true, patch: { field: 'travellers', travellers: list } };
    }
    case 'stay': {
      const name = str(raw.name, 120);
      const placeQuery = str(raw.placeQuery, 200) ?? name;
      if (!name || !placeQuery) return { ok: false, error: 'A stay needs a name and an address or landmark.' };
      if (!isDate(raw.fromDate) || !isDate(raw.toDate) || raw.toDate <= raw.fromDate) return { ok: false, error: 'A stay needs a first night and a later departure date.' };
      return { ok: true, patch: { field: 'stay', id: str(raw.id, 80), name, placeQuery, fromDate: raw.fromDate, toDate: raw.toDate } };
    }
    case 'confirm':
    case 'remove': {
      const key = str(raw.key, 120);
      if (!key) return { ok: false, error: 'Say which item.' };
      return { ok: true, patch: { field: raw.field, key } };
    }
    default:
      return { ok: false, error: "field is dates, destination, pace, modes, travellers, stay, confirm or remove." };
  }
}

/**
 * The ops a direct edit becomes (each recorded as 'you'), or a sentence when
 * it cannot be done this way. `confirm` and removing an assumption change no
 * constraint: they only rewrite provenance (`provenance`).
 */
export function briefPatchOps(
  patch: BriefPatch,
  ctx: { trip: Trip; stays: Stay[]; wishes: Wish[]; transport: TransportSegment[]; provenance: Provenance; profile: TravellerProfile | null },
): { ok: true; ops: TripOp[]; provenance: Record<string, Omit<ProvenanceEntry, 'at'> | null> } | { ok: false; error: string } {
  const none = {} as Record<string, Omit<ProvenanceEntry, 'at'> | null>;
  switch (patch.field) {
    case 'dates':
      return { ok: true, ops: [{ op: 'setTrip', fields: { startDate: patch.startDate, endDate: patch.endDate } }], provenance: none };
    case 'destination':
      return { ok: true, ops: [{ op: 'setTrip', fields: { destination: patch.destination, ...(patch.timeZone ? { timeZone: patch.timeZone } : {}) } }], provenance: none };
    case 'pace':
      return { ok: true, ops: [{ op: 'setTrip', fields: { pace: patch.pace } }], provenance: none };
    case 'modes':
      return { ok: true, ops: [{ op: 'setTrip', fields: { modes: patch.modes } }], provenance: none };
    case 'travellers': {
      // Keep what the profile already knows about each named traveller.
      const known = new Map((ctx.profile?.travellers ?? []).map((t) => [t.name.trim().toLowerCase(), t]));
      const travellers = patch.travellers.map((t) => {
        const was = known.get(t.name.toLowerCase());
        return { name: t.name, relation: was?.relation ?? null, notes: was?.notes ?? [], age: t.age ?? was?.age ?? null, personId: t.personId ?? was?.personId ?? null };
      });
      return { ok: true, ops: [{ op: 'updateProfile', profile: { travellers } }], provenance: none };
    }
    case 'stay': {
      if (patch.id) {
        const stay = ctx.stays.find((s) => s.id === patch.id);
        if (!stay) return { ok: false, error: 'No such stay.' };
        const placeChanged = patch.placeQuery !== stay.name && patch.placeQuery !== stay.address;
        return {
          ok: true,
          ops: [{ op: 'updateStay', id: stay.id, fields: { name: patch.name, fromDate: patch.fromDate, toDate: patch.toDate, ...(placeChanged ? { placeQuery: patch.placeQuery } : {}) } }],
          provenance: none,
        };
      }
      return { ok: true, ops: [{ op: 'addStay', name: patch.name, placeQuery: patch.placeQuery, fromDate: patch.fromDate, toDate: patch.toDate, checkInMin: null, checkOutMin: null }], provenance: none };
    }
    case 'confirm': {
      if (/^(preference|constraint):/.test(patch.key)) return { ok: false, error: 'That comes from your notes; change it there.' };
      const was = ctx.provenance[patch.key];
      // "Right": the person vouches for it now. A note from their notes keeps its pointer.
      return { ok: true, ops: [], provenance: { [patch.key]: { source: 'you', note: was?.source === 'notes' ? was.note : null, ref: was?.source === 'notes' ? was.ref : null } } };
    }
    case 'remove': {
      const [kind, id] = patch.key.split(/:(.+)/);
      if (kind === 'stay' && id) return ctx.stays.some((s) => s.id === id) ? { ok: true, ops: [{ op: 'removeStay', id }], provenance: none } : { ok: false, error: 'No such stay.' };
      if (kind === 'transport' && id) return ctx.transport.some((t) => t.id === id) ? { ok: true, ops: [{ op: 'removeTransport', id }], provenance: none } : { ok: false, error: 'No such journey.' };
      // A must-do taken off the brief stays on the trip as a nice-to-have.
      if (kind === 'wish' && id) return ctx.wishes.some((w) => w.id === id) ? { ok: true, ops: [{ op: 'updateWish', id, fields: { priority: 'nice' } }], provenance: none } : { ok: false, error: 'No such wish.' };
      if (!ROW_KEY.test(patch.key) && ctx.provenance[patch.key]?.source === 'assumed') return { ok: true, ops: [], provenance: { [patch.key]: null } };
      return { ok: false, error: 'That cannot be removed here.' };
    }
  }
}
