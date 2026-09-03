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

/** The eleven rooms, in rail order, each a real route. */
export const ROOMS = [
  'feed',
  'memory',
  'briefing',
  'watches',
  'family',
  'discoveries',
  'calendar',
  'places',
  'money',
  'engine',
  'improvement',
] as const;
export type RoomId = (typeof ROOMS)[number];

export function isRoom(s: string | null | undefined): s is RoomId {
  return !!s && (ROOMS as readonly string[]).includes(s);
}

/** PURE. The rail, with its badges. Tested so a badge can never count the
 *  wrong population without a test saying so. */
export interface BadgeCounts {
  /** Reached him and never rated — the starved input. */
  needsRating: number;
  /** Verdicts with no memory behind them. */
  unrememberedRulings: number;
  activeWatches: number;
  /** Unnamed active places at or over the ask threshold, by distinct days. */
  needsNaming: number;
  proposedRules: number;
  /** Daydream heartbeat rows in trouble: failures counted or paused. */
  failingJobs: number;
}

export function hubTabs(c: BadgeCounts): HubTab[] {
  const room = (id: RoomId, label: string, extra: Partial<HubTab> = {}): HubTab => ({
    id,
    label,
    href: `${HUB_BASE}/${id}`,
    ...extra,
  });
  return [
    room('feed', 'Feed', { count: c.needsRating, tone: 'action' }),
    room('memory', 'Memory', { count: c.unrememberedRulings, tone: 'watch' }),
    room('briefing', 'Briefing'),
    room('watches', 'Watches', { count: c.activeWatches, tone: 'quiet' }),
    room('family', 'Family'),
    room('discoveries', 'Discoveries'),
    room('calendar', 'Calendar'),
    room('places', 'Places', { count: c.needsNaming, tone: 'action' }),
    room('money', 'Money'),
    room('engine', 'Engine', {
      count: c.proposedRules || c.failingJobs,
      tone: c.failingJobs ? 'watch' : 'action',
    }),
    room('improvement', 'Improvement'),
  ];
}

/** Where an old `?tab=` link lands. Unknown tabs go to the feed; the rest of
 *  the query (`?rate=`) rides along, because a notification's deep link is
 *  the one link that must keep working. */
export function legacyTabTarget(url: { searchParams: URLSearchParams }): string {
  const tab = url.searchParams.get('tab');
  const room: RoomId = isRoom(tab) ? tab : 'feed';
  const q = new URLSearchParams(url.searchParams);
  q.delete('tab');
  const qs = q.toString();
  // No fragment: a server `load` may not read `url.hash` (SvelteKit throws),
  // and it does not need to — the browser carries `#place-…` across a 3xx
  // whose Location has no fragment of its own.
  return `${HUB_BASE}/${room}${qs ? `?${qs}` : ''}`;
}
