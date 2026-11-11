/**
 * What each feature event carries, built in one place.
 *
 * A feature that raises an event hands its facts to a builder here and emits
 * what comes back (the shape `news/item-event.ts` set). The builders are the
 * allow-list: a payload holds the keys written below and nothing else, so a
 * producer that has a position, an address, an email or a visitor's network in
 * scope cannot leak it by spreading an object into `emit`. A workflow's output
 * can travel anywhere; these events carry names and ids only.
 *
 * Pure and dependency-free, like the catalogue.
 */

const clip = (value: unknown, max: number): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function compact<T extends Record<string, unknown>>(payload: T): T {
  for (const key of Object.keys(payload)) {
    const v = payload[key];
    if (v === undefined || v === null || v === '') delete payload[key];
  }
  return payload;
}

// ————————————————————————————— family.alert

const COORDINATE_PAIR = /-?\d{1,3}\.\d{3,}\s*[,;/ ]\s*-?\d{1,3}\.\d{3,}/;
const DECIMAL_DEGREES = /-?\d{1,3}\.\d{4,}/;
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
const HOUSE_NUMBER = /^\s*(?:flat\s+)?\d+[a-z]?[\s,]/i;
const CONTACT = /@|\+?\d[\d\s().-]{6,}\d/;
const STREET = /\b(?:road|rd|street|st|avenue|ave|lane|ln|close|crescent|drive|parade|terrace|way|court|grove|gardens|place|row|square|walk)\.?$/i;

/**
 * A place NAME, or null when the text reads like a position, a street address
 * or a contact detail. A label somebody typed ("School", "Gran's") passes; one
 * a geocoder or a phone filled in with "12 Example Road, AB1 2CD" does not.
 * It fails closed: a name that merely looks like a street is dropped too.
 */
export function safePlaceName(value: unknown): string | null {
  const text = clip(value, 80);
  if (!text) return null;
  if (COORDINATE_PAIR.test(text) || DECIMAL_DEGREES.test(text)) return null;
  if (UK_POSTCODE.test(text) || HOUSE_NUMBER.test(text) || CONTACT.test(text)) return null;
  // "Example Road" and "Example Road, Exampletown" are where, not what it is called.
  if (text.includes(',') || STREET.test(text)) return null;
  return text;
}

export interface FamilyAlertFacts {
  /** arrive | leave | stopped | school-late | journey | battery | alarm | bat-phone */
  kind: string;
  /** A display name, never a subject id or an email. */
  person: string;
  place?: string | null;
  title: string;
}

export function familyAlertPayload(facts: FamilyAlertFacts): Record<string, unknown> {
  const raw = clip(facts.place, 200);
  const place = safePlaceName(raw);
  let title = clip(facts.title, 160);
  // A title is worded round the place; one that is not a name goes from both.
  if (raw && !place) title = title.split(raw).join('a place');
  return compact({ kind: clip(facts.kind, 40), person: clip(facts.person, 80), place, title });
}

// ————————————————————————————— the rest

export function wishlistOfferPayload(facts: { wishId: string; title: string; pricePence?: number | null; url?: string | null }): Record<string, unknown> {
  const pence = typeof facts.pricePence === 'number' && Number.isFinite(facts.pricePence) ? facts.pricePence : null;
  return compact({
    wishId: clip(facts.wishId, 120),
    title: clip(facts.title, 200),
    price: pence === null ? null : Math.round(pence) / 100,
    currency: pence === null ? null : 'GBP',
    url: /^https?:\/\//i.test(String(facts.url ?? '')) ? clip(facts.url, 500) : null,
  });
}

export function tripNeedsYouPayload(facts: { tripId: string; title: string; reason: string }): Record<string, unknown> {
  return { tripId: clip(facts.tripId, 120), title: clip(facts.title, 200), reason: clip(facts.reason, 200) };
}

export function shareOpenedPayload(facts: { shareId: string; project?: string | null; label?: string | null }): Record<string, unknown> {
  return compact({ shareId: clip(facts.shareId, 120), project: clip(facts.project, 120), label: clip(facts.label, 120) });
}

export function captureReadyPayload(facts: { captureId: string; title?: string | null; followUps?: number | null }): Record<string, unknown> {
  const n = Number(facts.followUps);
  return {
    captureId: clip(facts.captureId, 120),
    title: clip(facts.title, 200) || 'Capture',
    followUps: Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0,
  };
}

export function releaseLivePayload(facts: { app: string; sha?: string | null }): Record<string, unknown> {
  return compact({ app: clip(facts.app, 120), sha: clip(facts.sha, 64) });
}

export function pullOpenedPayload(facts: { repo: string; number: number; title: string }): Record<string, unknown> {
  return { repo: clip(facts.repo, 140), number: facts.number, title: clip(facts.title, 250) };
}

export function gameFinishedPayload(facts: { game: string; roomId: string; winner?: string | null }): Record<string, unknown> {
  return compact({ game: clip(facts.game, 80), roomId: clip(facts.roomId, 120), winner: clip(facts.winner, 120) });
}

export function daydreamActedPayload(facts: { daydreamId: string; title?: string | null; action: string }): Record<string, unknown> {
  return { daydreamId: clip(facts.daydreamId, 120), title: clip(facts.title, 200) || 'Daydream note', action: clip(facts.action, 80) };
}

// ————————————————————————————— say it once

/**
 * True the first time `key` is seen inside `windowMs`, false after. In memory
 * and per process: enough to stop one alert retried per recipient, or one
 * share link's burst of page loads, raising the same event over and over. A
 * restart forgets, which costs at most one repeat.
 */
const lastSaid = new Map<string, number>();
const MAX_KEYS = 5_000;

export function firstInWindow(key: string, windowMs: number, now = Date.now()): boolean {
  const last = lastSaid.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  lastSaid.delete(key);
  if (lastSaid.size >= MAX_KEYS) lastSaid.delete(lastSaid.keys().next().value as string);
  lastSaid.set(key, now);
  return true;
}

/** For tests. */
export function resetSaid(): void {
  lastSaid.clear();
}
