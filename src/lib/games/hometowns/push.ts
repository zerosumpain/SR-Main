// Who a county's one daily push goes to (spec §10.11, §9.12, A29, A37).
//
// The framework pushes `waitingOn(room).ids` once per `key` and never to a
// phone that is streaming the room. A county turns that into AT MOST ONE
// push per player per day by opening a short "push window" only when a
// Regional Day has just run, and keying it by that day:
//   - key `d<dayIndex>` (Sunday's County Week: `d<dayIndex>g`), so it
//     changes at most once per Regional Day;
//   - only the most recent Regional Day of a catch-up may open a window, and
//     only if it ran within two hours of its own instant (A29: a late day
//     after an outage stays quiet) and inside allowed hours (08:00–20:00
//     London; a child's seat also never during weekday school hours);
//   - only one window per London calendar day, so the dev clock (a Regional
//     Day every 24 minutes) still rings a phone once a day;
//   - each `advance` drops from an open window the seats that may not be
//     rung at that moment (a child's once school starts), and the window
//     closes at the next `advance` after two hours or 20:00, whichever is
//     first. `waitingOn` has no `now`, so a window left open past its time
//     would let a restart (which forgets which phones were tried) ring
//     somebody at midnight.
// Push is best effort: pull (the lobby poll, the in-game inbox) is the floor,
// and no mechanic may depend on a push arriving (A37).
//
// Hours are read with Intl here, in the adapter. The engine may not use
// Intl (§10.4), but nothing a push decides is ever hashed or predicted.

import { isCountyWeek, type CountyState } from './engine/index';

/** A Regional Day more than this late does not push (A29). */
export const LATE_MS = 2 * 3_600_000;
/** Allowed hours for any push, London local time: [from, to). */
export const PUSH_FROM_HOUR = 8;
export const PUSH_TO_HOUR = 20;
/** A child's seat is not pushed on a weekday between these times (§9.12). */
const SCHOOL_FROM_MIN = 8 * 60 + 30;
const SCHOOL_TO_MIN = 15 * 60 + 30;
/** Inbox kinds worth a push: something social to open, or a decision waiting. */
export const PUSH_KINDS: readonly string[] = ['gift', 'aid', 'ribbon', 'offer', 'link', 'contract', 'share', 'pact', 'vote', 'deal', 'stamp'];

export interface PushWindow {
  key: string;
  /** Seat ids with something unseen. */
  seats: string[];
  line: string;
  /** The window shuts at the first `advance` at or after this instant. */
  until: number;
}

export interface PushState {
  open: PushWindow | null;
  /** London day number of the last window opened (one a day). */
  lastDay: number | null;
  /** Each town's tier at the last Regional Day, by town index: "a new tier" is a reason to ring. */
  tiers: number[];
}

export function emptyPush(): PushState {
  return { open: null, lastDay: null, tiers: [] };
}

const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

/** London local parts of an instant: the day number (days since 1970-01-01 local), minutes into the day, weekday 0 = Sunday. */
export function londonParts(at: number): { day: number; minutes: number; weekday: number } {
  const parts: Record<string, string> = {};
  for (const p of LONDON.formatToParts(new Date(at))) parts[p.type] = p.value;
  const day = Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86_400_000);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { day, minutes, weekday };
}

/** Whether a push may ring a seat at `at`: allowed hours, and for a child no weekday school hours. */
export function pushAllowedAt(at: number, profile: 'kid' | 'adult'): boolean {
  const { minutes, weekday } = londonParts(at);
  if (minutes < PUSH_FROM_HOUR * 60 || minutes >= PUSH_TO_HOUR * 60) return false;
  if (profile === 'kid' && weekday >= 1 && weekday <= 5 && minutes >= SCHOOL_FROM_MIN && minutes < SCHOOL_TO_MIN) return false;
  return true;
}

/** When the window for a Regional Day at `at` shuts: two hours on, or 20:00 London that day if sooner. */
function closesAt(at: number): number {
  const { minutes } = londonParts(at);
  const toQuiet = (PUSH_TO_HOUR * 60 - minutes) * 60_000;
  return at + Math.min(LATE_MS, Math.max(0, toQuiet));
}

/**
 * After a catch-up that ran one or more Regional Days at `now`: open the
 * window for the most recent one, or leave it shut. `seated` says which
 * seats have a joined player (only they can be rung). Returns the window
 * (also stored on `push`).
 */
export function openPushWindow(push: PushState, c: CountyState, now: number, seated: (seat: string) => boolean): PushWindow | null {
  const at = c.lastRegionalDayAt;
  const day = c.dayIndex - 1;
  const before = push.tiers;
  push.tiers = c.towns.map((t) => t.tier);
  push.open = null;
  if (day < 0 || now - at > LATE_MS || now < at) return null;
  const local = londonParts(at);
  if (push.lastDay !== null && local.day <= push.lastDay) return null;
  const week = isCountyWeek(c, at, day);
  const seats: string[] = [];
  let reasons = 0;
  c.towns.forEach((t, i) => {
    if (t.archived || !seated(t.seat)) return;
    const s = c.settings.perSeat[t.seat];
    if (!s?.pushes || !pushAllowedAt(at, s.profile)) return;
    let n = 0;
    if (week) n++; // the Gazette
    if (t.tier > (before[i] ?? t.tier)) n++; // a new tier
    if (t.inbox.some((item) => item.day >= day && PUSH_KINDS.includes(item.kind))) n++;
    if (n === 0) return;
    seats.push(t.seat);
    reasons = Math.max(reasons, n);
  });
  if (!seats.length) return null;
  push.lastDay = local.day;
  const things = reasons === 1 ? '1 thing is' : `${reasons} things are`;
  push.open = { key: week ? `d${day}g` : `d${day}`, seats, line: `News from ${c.name}: ${things} waiting for you.`, until: closesAt(at) };
  return push.open;
}

/**
 * An open window's seats that may not be rung NOW: a child's in weekday
 * school hours (a window opened at 08:00 runs to 10:00, and a restart
 * forgets which phones were tried, so a retry could ring a child at 09:00),
 * or anyone's once the push hours are over. The window shuts when nobody is
 * left. True when it changed.
 */
export function prunePushWindow(push: PushState, c: CountyState, now: number): boolean {
  const open = push.open;
  if (!open) return false;
  const seats = open.seats.filter((seat) => pushAllowedAt(now, c.settings.perSeat[seat]?.profile ?? 'kid'));
  if (seats.length === open.seats.length) return false;
  if (seats.length) push.open = { ...open, seats };
  else push.open = null;
  return true;
}

/** Shuts an open window whose time is up. True when it changed. */
export function closePushWindow(push: PushState, now: number): boolean {
  if (!push.open || now < push.open.until) return false;
  push.open = null;
  return true;
}
