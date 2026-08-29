// Who is who, visually — the one place a player's colour, hatch and initial are
// decided.
//
// CLIENT-SAFE ON PURPOSE. It is imported by the page, the map, the feed and the
// boards, so it must never reach for `$lib/geo` (server-only) or the database.
//
// Decision 14 of the spec: five on-brand hues cannot be simultaneously >=3:1 on
// cream and deuteranope-safe, so COLOUR NEVER CARRIES IDENTITY ALONE. Every
// player is a triple — colour, hatch and a mono initial — and every surface
// that names a player shows at least two of the three.

import { CLUSTER_COLOURS } from '$lib/components/intel/graph-visual';

/**
 * The hatch alphabet. Six, so the sixth player is still distinguishable in a
 * greyscale print of the map, and ordered so adjacent slots never share an
 * angle.
 */
export const HATCHES = ['diag', 'back', 'vert', 'horiz', 'grid', 'dots'] as const;
export type Hatch = (typeof HATCHES)[number];

export interface PlayerIdentity {
  subject: string;
  /** Display name — the subject key is lower-case throughout the ledger. */
  name: string;
  /** The mono badge glyph. */
  initial: string;
  /** Durable palette slot. */
  slot: number;
  colour: string;
  hatch: Hatch;
}

/** FNV-1a. Small, stable, and identical on the server and in the browser. */
function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const titleCase = (subject: string): string =>
  subject.length ? subject.charAt(0).toUpperCase() + subject.slice(1) : subject;

/**
 * Durable colour slots for a roster.
 *
 * Hash-preferred with a linear probe, walked in alphabetical order. The hash is
 * what makes a slot durable: John is the same teal whether he is alone on the
 * board or one of five, which a positional assignment could not promise. The
 * probe only fires when two names collide in a ten-slot palette, and the
 * alphabetical walk makes the tie-break deterministic rather than
 * insertion-ordered.
 */
export function assignIdentities(subjects: readonly string[]): PlayerIdentity[] {
  const ordered = [...new Set(subjects)].sort();
  const taken = new Set<number>();
  return ordered.map((subject) => {
    let slot = hashOf(subject) % CLUSTER_COLOURS.length;
    for (let i = 0; i < CLUSTER_COLOURS.length && taken.has(slot); i++) {
      slot = (slot + 1) % CLUSTER_COLOURS.length;
    }
    taken.add(slot);
    return {
      subject,
      name: titleCase(subject),
      initial: (subject.charAt(0) || '?').toUpperCase(),
      slot,
      colour: CLUSTER_COLOURS[slot],
      hatch: HATCHES[slot % HATCHES.length],
    };
  });
}

export function identityMap(players: readonly PlayerIdentity[]): Map<string, PlayerIdentity> {
  return new Map(players.map((p) => [p.subject, p]));
}

/** The one unattributed "owner" the ledger can name. */
export const UNCLAIMED = 'unclaimed';

export const UNCLAIMED_IDENTITY: PlayerIdentity = {
  subject: UNCLAIMED,
  name: 'Open ground',
  initial: '·',
  slot: -1,
  colour: 'rgba(26, 16, 8, 0.45)',
  hatch: 'dots',
};

/** Activity filter dimensions, in the order the toolbar shows them. */
export const ACTIVITY_FILTERS = [
  'walk',
  'run',
  'trail_run',
  'hike',
  'ride',
  'mtb',
] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

/** Life360 carries no activity type. The UI says so rather than guessing. */
export const UNTYPED_LABEL = 'untyped';

// ---------------------------------------------------------------------------
// The date window
// ---------------------------------------------------------------------------

/**
 * How far back a capture is allowed to count, as a fixed small set rather than
 * a date picker.
 *
 * A picker would offer a range whose two ends are separately wrong: the score
 * decays with AGE, so an arbitrary end date changes the answer in a way nobody
 * reading the map could predict, while a start date alone is the only half
 * anyone actually wants ("the last week"). Four durations, no calendar, and the
 * window slides with the clock — which is also what makes the week-on-week
 * board still mean something under one.
 *
 * `ms: null` is all time, and is the default. That branch must stay exactly the
 * unfiltered query, because it is the one the materialised geo_tile_state fast
 * path answers.
 */
export const DATE_WINDOWS = [
  { key: '24h', label: '24 hours', short: '24h', ms: 86_400_000 },
  { key: '7d', label: '7 days', short: '7d', ms: 7 * 86_400_000 },
  { key: '30d', label: '30 days', short: '30d', ms: 30 * 86_400_000 },
  { key: 'all', label: 'All time', short: 'all', ms: null },
] as const;

export type DateWindow = (typeof DATE_WINDOWS)[number];
export type DateWindowKey = DateWindow['key'];

export const DEFAULT_WINDOW: DateWindowKey = 'all';

/** Unknown or absent reads as all time — a bad query string never hides ground. */
export function windowOf(key: string | null | undefined): DateWindow {
  for (const w of DATE_WINDOWS) if (w.key === key) return w;
  for (const w of DATE_WINDOWS) if (w.ms === null) return w;
  return DATE_WINDOWS[0];
}

/** "the last 7 days" — the phrase every surface that respects the window uses. */
export function windowPhrase(key: string | null | undefined): string {
  const w = windowOf(key);
  return w.ms === null ? 'all time' : `the last ${w.label.toLowerCase()}`;
}

/**
 * The same fact in a board header's worth of room: "last 7d".
 *
 * Board headers are two mono labels on one baseline in a 380 px rail, and the
 * long phrase wraps them onto three lines. Prose keeps `windowPhrase`; a header
 * that is already a label uses this. Never a bare "7d" — a duration with no
 * "last" reads as a column unit rather than a period.
 */
export function windowShort(key: string | null | undefined): string {
  const w = windowOf(key);
  return w.ms === null ? 'all time' : `last ${w.short}`;
}

export const activityLabel = (type: string | null): string =>
  type === null ? UNTYPED_LABEL : type.replace(/_/g, ' ');

// ---------------------------------------------------------------------------
// Formatting — shared so the map legend, the feed and the boards cannot drift.
// ---------------------------------------------------------------------------

export function km2(m2: number): string {
  const v = m2 / 1_000_000;
  if (v === 0) return '0.00';
  if (v < 0.01) return v.toFixed(3);
  return v.toFixed(2);
}

export function relativeAge(iso: string | null, ref: number): string {
  if (!iso) return '';
  const ms = ref - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const mins = Math.round(ms / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}
