// src/lib/trips/provenance.ts
//
// v8: where each fact on a trip came from, recorded as the ops that set it
// are applied (./decisions Provenance, keyed 'destination', 'dates', 'pace',
// 'modes', 'travellers', `stay:<id>`, `transport:<id>`, `booking:<id>`,
// `wish:<id>`). PURE: the caller writes the result with
// ./decisions.store.server `noteProvenance`.
//
// Two kinds of writer:
//  - the planner (a conversation turn): each op may say `"source": "you" |
//    "notes" | "found" | "assumed"` and a `"sourceNote"`. An op that SETS A
//    FACT without one — a stay, a journey, a booking, the destination, dates
//    or pace — is recorded as 'assumed', so a guess is never passed off as a
//    fact (Rome's stay arrived from memory with no label). A journey without
//    one reads its own `confidence` instead (stated → you, researched → found,
//    estimated → assumed): that has always said how sure the planner was.
//  - a person (a form on the site, PATCH brief, accepting a proposal): every
//    fact they touch becomes 'you'.
//
// `applyOps` returns the ops it applied but not the ids of the rows they
// created, so the effects are wrapped (`captureCreated`) to collect those, in
// order, and each applied op is paired back with the raw op it came from
// (`pairApplied`) to read its source.

import type { FactSource, ProvenanceEntry } from './decisions';
import { FACT_SOURCES } from './decisions';
import type { TransportSegment, TripOp } from './model';
import type { ApplyResult, OpEffects } from './ops';

export type ProvenancePatch = Record<string, Omit<ProvenanceEntry, 'at'> | null>;

/** Ids of the rows the effects created, per kind, in the order they were made. */
export interface CreatedIds {
  stays: string[];
  wishes: string[];
  bookings: string[];
  transport: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** The same effects, noting the id of every row they create. */
export function captureCreated(fx: OpEffects): { fx: OpEffects; created: CreatedIds } {
  const created: CreatedIds = { stays: [], wishes: [], bookings: [], transport: [] };
  const wrapped: OpEffects = {
    ...fx,
    addStay: async (f) => {
      const s = await fx.addStay(f);
      created.stays.push(s.id);
      return s;
    },
    addWish: async (f) => {
      const w = await fx.addWish(f);
      created.wishes.push(w.id);
      return w;
    },
    addBooking: async (b) => {
      const x = await fx.addBooking(b);
      created.bookings.push(x.id);
      return x;
    },
    ...(fx.addTransport
      ? {
          addTransport: async (s: Omit<TransportSegment, 'id'>) => {
            const t = await fx.addTransport!(s);
            created.transport.push(t.id);
            return t;
          },
        }
      : {}),
  };
  return { fx: wrapped, created };
}

export interface AppliedPair {
  /** The op as the model (or form) sent it — where `source` is read. */
  raw: Obj | null;
  /** The op as applied. */
  op: TripOp;
  /** The row it created, for an add. */
  createdId: string | null;
}

/**
 * Each applied op with the raw op it came from and the row it created.
 * `applyOps` handles each raw op exactly once — applied or rejected (the
 * rejected entry keeps the raw object) — so the raw ops that are objects and
 * were not rejected line up, in order, with `applied`.
 */
export function pairApplied(rawOps: unknown[], result: Pick<ApplyResult, 'applied' | 'rejected'>, created: CreatedIds): AppliedPair[] {
  const rejected = new Set<unknown>(result.rejected.map((r) => r.op));
  const raws = rawOps.filter((o) => isObj(o) && !rejected.has(o)) as Obj[];
  const aligned = raws.length === result.applied.length;
  const next = { addStay: 0, addWish: 0, addBooking: 0, addTransport: 0 };
  const take = (op: TripOp): string | null => {
    switch (op.op) {
      case 'addStay':
        return created.stays[next.addStay++] ?? null;
      case 'addWish':
        return created.wishes[next.addWish++] ?? null;
      case 'addBooking':
        return created.bookings[next.addBooking++] ?? null;
      case 'addTransport':
        return created.transport[next.addTransport++] ?? null;
      default:
        return null;
    }
  };
  return result.applied.map((op, i) => ({ raw: aligned ? raws[i] : null, op, createdId: take(op) }));
}

/** The source an op states, if it states one. */
export function opSource(raw: Obj | null): { source: FactSource; note: string | null } | null {
  if (!raw || !FACT_SOURCES.includes(raw.source as FactSource)) return null;
  const note = typeof raw.sourceNote === 'string' && raw.sourceNote.trim() ? raw.sourceNote.trim().replace(/\s+/g, ' ').slice(0, 200) : null;
  return { source: raw.source as FactSource, note };
}

const fromConfidence = (c: unknown): FactSource | null => (c === 'stated' ? 'you' : c === 'researched' || c === 'live' ? 'found' : c === 'estimated' ? 'assumed' : null);

/**
 * The keys an op touches. `fact` = it sets something the planner could have
 * guessed (recorded 'assumed' when no source is given); `fallback` = what to
 * record without a source instead of 'assumed' (a journey's confidence);
 * `remove` = the row is gone, so its entry goes too.
 */
function touches(op: TripOp, createdId: string | null): Array<{ key: string; fact: boolean; fallback?: FactSource | null; remove?: boolean }> {
  switch (op.op) {
    case 'setTrip': {
      const f = op.fields ?? {};
      const out: Array<{ key: string; fact: boolean }> = [];
      if ('destination' in f || 'timeZone' in f) out.push({ key: 'destination', fact: true });
      if ('startDate' in f || 'endDate' in f) out.push({ key: 'dates', fact: true });
      if ('pace' in f) out.push({ key: 'pace', fact: true });
      if ('modes' in f) out.push({ key: 'modes', fact: false });
      return out;
    }
    case 'addStay':
      return createdId ? [{ key: `stay:${createdId}`, fact: true }] : [];
    case 'updateStay': {
      const f = op.fields ?? {};
      return [{ key: `stay:${op.id}`, fact: 'placeQuery' in f || 'fromDate' in f || 'toDate' in f }];
    }
    case 'removeStay':
      return [{ key: `stay:${op.id}`, fact: false, remove: true }];
    case 'addWish':
      return createdId ? [{ key: `wish:${createdId}`, fact: false }] : [];
    case 'updateWish':
      return [{ key: `wish:${op.id}`, fact: false }];
    case 'removeWish':
      return [{ key: `wish:${op.id}`, fact: false, remove: true }];
    case 'addBooking':
      return createdId ? [{ key: `booking:${createdId}`, fact: true }] : [];
    case 'updateBooking':
      return [{ key: `booking:${op.id}`, fact: false }];
    case 'addTransport':
      return createdId ? [{ key: `transport:${createdId}`, fact: true, fallback: fromConfidence(op.segment?.confidence) }] : [];
    case 'updateTransport': {
      const f = op.fields ?? {};
      const timed = ['departDate', 'departMin', 'arriveDate', 'arriveMin'].some((k) => k in f);
      return [{ key: `transport:${op.id}`, fact: timed, fallback: 'confidence' in f ? fromConfidence(f.confidence) : null }];
    }
    case 'removeTransport':
      return [{ key: `transport:${op.id}`, fact: false, remove: true }];
    case 'updateProfile':
      return op.profile && 'travellers' in op.profile ? [{ key: 'travellers', fact: false }] : [];
    default:
      return [];
  }
}

/**
 * What to record for a set of applied ops. `by: 'you'` — a person's direct
 * edit: everything touched is 'you'. `by: 'planner'` — the op's own source;
 * without one, a fact is 'assumed' (a journey: its confidence) and anything
 * else is left as it was.
 */
export function provenanceFor(pairs: AppliedPair[], by: 'you' | 'planner'): ProvenancePatch {
  const out: ProvenancePatch = {};
  for (const p of pairs) {
    const stated = by === 'planner' ? opSource(p.raw) : null;
    for (const t of touches(p.op, p.createdId)) {
      if (t.remove) {
        out[t.key] = null;
        continue;
      }
      if (by === 'you') {
        out[t.key] = { source: 'you', note: null, ref: null };
        continue;
      }
      if (stated) out[t.key] = { source: stated.source, note: stated.note, ref: null };
      else if (t.fallback) out[t.key] = { source: t.fallback, note: null, ref: null };
      else if (t.fact) out[t.key] = { source: 'assumed', note: null, ref: null };
    }
  }
  return out;
}

/**
 * The rows a direct edit on the site created, read from the response the
 * route already builds (`{ stay }`, `{ wishes }`, `{ wish }`, `{ booking }`)
 * — the form routes insert before they re-plan, so the ids are there.
 */
export function createdFromExtra(extra: Record<string, unknown>): CreatedIds {
  const id = (v: unknown) => (isObj(v) && typeof v.id === 'string' ? [v.id] : []);
  return {
    stays: id(extra.stay),
    wishes: Array.isArray(extra.wishes) ? extra.wishes.flatMap(id) : id(extra.wish),
    bookings: id(extra.booking),
    transport: id(extra.segment ?? extra.transport),
  };
}

/** Pair a direct edit's ops with the rows it created (no raw ops: a person's edit has no stated source). */
export function pairDirect(ops: TripOp[], created: CreatedIds): AppliedPair[] {
  return pairApplied(ops, { applied: ops, rejected: [] }, created).map((p) => ({ ...p, raw: null }));
}
