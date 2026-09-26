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

/** The rooms, in rail order, each a real route. The feed is the hub's own
 *  page; the rest are not daydream at all and are only housed here. The old
 *  engine rooms (memory, places, money, engine, discoveries, calendar, feed)
 *  are 308 stubs to the feed since P4 of the 2026-09-25 simplification; the
 *  backlog, improvement and the doctor moved to the build process, /jkai/develop. */
export const ROOMS = ['feed', 'watches'] as const;
export type RoomId = (typeof ROOMS)[number];

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

/** PURE. The rail: the ONE feed of think notes plus the rooms housed here
 *  that are not daydream at all. */
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
  ];
}

/**
 * Does this arrival at the bare path carry an OLD link? A `?tab=` link, or a
 * notification's `?rate=` / `?open=` deep link into the retired feed room.
 * Everything else at the bare path — including `?note=` — is the feed.
 */
export function isLegacyLink(url: { searchParams: URLSearchParams }): boolean {
  const q = url.searchParams;
  return q.has('tab') || q.has('rate') || q.has('open');
}

/** Where an old link lands. A `?tab=` naming a room still housed here goes to
 *  it; everything else — a retired room, `?rate=` / `?open=` on a thought the
 *  feed no longer shows — lands on the bare feed. The legacy keys are always
 *  stripped, so the target can never be a legacy link itself (no loop); any
 *  other query rides along. */
export function legacyTabTarget(url: { searchParams: URLSearchParams }): string {
  const tab = url.searchParams.get('tab');
  const q = new URLSearchParams(url.searchParams);
  for (const k of ['tab', 'rate', 'open']) q.delete(k);
  const qs = q.toString();
  // No fragment: a server `load` may not read `url.hash` (SvelteKit throws),
  // and it does not need to — the browser carries it across a 3xx.
  // The backlog and improvement left the hub for /jkai/develop; old tabs follow.
  const path =
    tab === 'backlog' || tab === 'improvement'
      ? `/jkai/develop/${tab}`
      : isRoom(tab) && tab !== 'feed'
        ? `${HUB_BASE}/${tab}`
        : HUB_BASE;
  return `${path}${qs ? `?${qs}` : ''}`;
}
