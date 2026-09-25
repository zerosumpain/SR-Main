// src/lib/daydream/hub.ts
//
// The daydream hub's rooms and rail — PURE. No database, no `$lib/server`,
// because `+layout.svelte` imports this into the browser and a page module
// that reaches `$lib/db` fails the BUILD, not the type-check. The counts that
// feed the rail live next door in `hub-counts.server.ts`.

export const HUB_BASE = '/jkai/daydreams';

/** One tab in the rail. Structurally the shell's `ShellTab`, declared here so
 *  the domain layer never imports a UI module (the boundary gate). */
export interface HubTab {
  id: RoomId;
  label: string;
  href: string;
  count?: number;
  tone?: 'action' | 'watch' | 'quiet';
}

/** The rooms, each a real route. Since P4a (2026-09-25) only the feed and
 *  the rooms housed here that are not the retired engine remain; the old
 *  rooms' URLs 308 to the feed in `hooks.server.ts` (`RETIRED_ROOMS`). */
export const ROOMS = ['feed', 'memory', 'briefing', 'watches', 'doctor', 'improvement', 'backlog'] as const;
export type RoomId = (typeof ROOMS)[number];

/** Rooms deleted in P4a. Their URLs redirect to the feed. (`family` is not
 *  here: it moved to `/home/people`, and hooks redirects it there.) */
export const RETIRED_ROOMS = ['feed', 'places', 'calendar', 'discoveries', 'money', 'engine'] as const;

export function isRoom(s: string | null | undefined): s is RoomId {
  return !!s && (ROOMS as readonly string[]).includes(s);
}

/** PURE. The rail, with its badges. Tested so a badge can never count the
 *  wrong population without a test saying so. */
export interface BadgeCounts {
  activeWatches: number;
  /** Think notes on the feed he has not rated yet — the Noticed badge. */
  notesToRate: number;
}

/**
 * PURE. The rail — since the 2026-09-25 simplification (P2), the ONE feed of
 * think notes plus the rooms housed here that are not daydream at all.
 */
export function hubTabs(c: BadgeCounts): HubTab[] {
  const room = (id: RoomId, label: string, extra: Partial<HubTab> = {}): HubTab => ({
    id,
    label,
    href: `${HUB_BASE}/${id}`,
    ...extra,
  });
  return [
    // The feed is the hub's own page now, not a room beneath it.
    { id: 'feed', label: 'Noticed', href: HUB_BASE, count: c.notesToRate, tone: 'action' },
    room('watches', 'Watches', { count: c.activeWatches, tone: 'quiet' }),
    room('improvement', 'Improvement'),
    room('backlog', 'Backlog'),
  ];
}

/**
 * Does this arrival at the bare path carry an OLD link? A `?tab=` link, or a
 * notification's `?rate=` / `?open=` deep link into the old feed room.
 */
export function isLegacyLink(url: { searchParams: URLSearchParams }): boolean {
  const q = url.searchParams;
  return q.has('tab') || q.has('rate') || q.has('open');
}

/**
 * Where an old link lands. A `?tab=` naming a room that still exists goes to
 * it; everything else — a retired room, an unknown tab, the old feed room —
 * lands on the feed, with a `?rate=` / `?open=` thought id carried as the
 * feed's own `?note=` so a notification's deep link still opens its note.
 * The result never carries `tab`, `rate` or `open`, so it cannot loop.
 */
export function legacyTabTarget(url: { searchParams: URLSearchParams }): string {
  const q = url.searchParams;
  const tab = q.get('tab');
  if (tab && tab !== 'feed' && isRoom(tab)) return `${HUB_BASE}/${tab}`;
  const note = q.get('rate') ?? q.get('open');
  return note ? `${HUB_BASE}?note=${encodeURIComponent(note)}` : HUB_BASE;
}
