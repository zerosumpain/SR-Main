// src/lib/trips/notes.server.ts
//
// v8: "From your notes", the I/O half (./notes has the rules). OWNER ONLY:
// the owner's memory and knowledge are searched for bookings that fit the
// destination and dates, ONE reader call extracts them as trip facts, and
// they come back as NoteFacts for a one-tap confirm on the guided start.
// Anyone else gets []. The phone gets the same facts with no memory
// reference (`ref: null`); their labels never held memory text.
//
// What was found is kept in this process for an hour, so the start job can
// apply the facts the person confirmed (by id) without a second model call.

import { isOwnerEmail } from '$lib/server/access';
import type { NoteFact } from './decisions';
import { jsonCall } from './llm.server';
import type { LocalDate } from './model';
import { NOTES_SYSTEM, notesPrompt, phoneNotes, readNoteFacts, relevantRows, type NoteRow } from './notes';
import { isLocalDate } from './intake';
import { datesBetween } from './solver/calendar';

const CACHE_MS = 60 * 60_000;

export interface NotesQuery {
  destination: string;
  startDate: LocalDate;
  endDate: LocalDate;
}

export interface NotesDeps {
  /** The owner's memories and knowledge for these searches (member-sourced memories already removed). */
  rows(queries: string[], destination: string): Promise<NoteRow[]>;
  model(system: string, user: string): Promise<unknown>;
  now(): number;
}

const LIVE: NotesDeps = {
  async rows(queries, destination) {
    const { ownerMemories, ownerKnowledge } = await import('./profile.server');
    const [memories, knowledge] = await Promise.all([
      ownerMemories(queries, 15).catch(() => []),
      ownerKnowledge(`${destination} booking flight hotel`).catch(() => []),
    ]);
    return [
      ...memories.map((m) => ({ id: m.id, text: m.content })),
      ...knowledge.filter((k) => k.ref).map((k) => ({ id: String(k.ref), text: `${k.title}: ${k.passage}` })),
    ];
  },
  model: (system, user) => jsonCall('trips-reader', [{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens: 2000, temperature: 0, timeoutMs: 60_000 }),
  now: () => Date.now(),
};

const cache = new Map<string, { at: number; facts: NoteFact[] }>();
const keyOf = (email: string, q: NotesQuery) => `${email.trim().toLowerCase()}|${q.destination.trim().toLowerCase()}|${q.startDate}|${q.endDate}`;

/** A usable query, or null (→ []). */
export function readNotesQuery(params: URLSearchParams | Record<string, unknown>): NotesQuery | null {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : (params[k] as string | undefined)) ?? '';
  const destination = String(get('destination')).trim().slice(0, 120);
  const startDate = String(get('startDate'));
  const endDate = String(get('endDate'));
  if (!destination || !isLocalDate(startDate) || !isLocalDate(endDate) || endDate < startDate) return null;
  if (datesBetween(startDate, endDate).length > 31) return null;
  return { destination, startDate, endDate };
}

/**
 * The owner's bookings for a trip, as NoteFacts (site: with the memory id
 * as `ref`; phone: `ref` null). [] for anyone but an allow-listed owner, for
 * a query that is not a trip, and when nothing relevant is in memory.
 */
export async function noteFacts(caller: { email: string; isOwner: boolean }, q: NotesQuery, opts: { surface: 'site' | 'phone'; deps?: NotesDeps } = { surface: 'site' }): Promise<NoteFact[]> {
  if (!caller.isOwner || !isOwnerEmail(caller.email)) return [];
  const deps = opts.deps ?? LIVE;
  const key = keyOf(caller.email, q);
  const hit = cache.get(key);
  let facts: NoteFact[];
  if (hit && deps.now() - hit.at < CACHE_MS) facts = hit.facts;
  else {
    const place = q.destination.split(',')[0].trim();
    const month = new Date(`${q.startDate}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
    const queries = [`${place} flight`, `${place} hotel airbnb booking`, `${place} tour tickets booked`, `${place} trip ${month}`, 'flight booking confirmation'];
    let rows: NoteRow[] = [];
    try {
      rows = relevantRows(await deps.rows(queries, place), q);
    } catch (err) {
      console.warn('[trips/notes] memory unavailable:', (err as Error)?.message);
    }
    if (!rows.length) return [];
    try {
      facts = readNoteFacts(await deps.model(NOTES_SYSTEM, notesPrompt(q, rows)), q, new Set(rows.map((r) => r.id)));
    } catch (err) {
      console.warn('[trips/notes] reader unavailable:', (err as Error)?.message);
      return [];
    }
    cache.set(key, { at: deps.now(), facts });
    for (const [k, v] of cache) if (deps.now() - v.at > CACHE_MS) cache.delete(k);
  }
  return opts.surface === 'phone' ? phoneNotes(facts) : facts;
}

/** The NoteFacts a person confirmed on the start, by id — from the hour's cache, else read again. */
export async function confirmedNotes(caller: { email: string; isOwner: boolean }, q: NotesQuery, ids: string[], deps?: NotesDeps): Promise<NoteFact[]> {
  if (!ids.length) return [];
  const all = await noteFacts(caller, q, { surface: 'site', deps });
  const wanted = new Set(ids);
  return all.filter((n) => wanted.has(n.id));
}

/** Tests only. */
export function clearNotesCacheForTest(): void {
  cache.clear();
}
