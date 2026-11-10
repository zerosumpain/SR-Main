/**
 * The places the map's box can take you, and which of them a typed line means.
 *
 * The box (`NavMap.svelte`) is one field for two jobs: type a place and Enter
 * goes there; type anything else and it is a question for jkai. This file is
 * the half that decides which — PURE, like `site-nav.ts`, which it reads and
 * never extends: a place is a row the manifest already has, so nothing here is
 * derived from the route tree either.
 */
import {
  JKAI_ITEM,
  SECTIONS,
  isItemActive,
  subnavFor,
  visibleItems,
  visibleRooms,
  type NavItem,
} from './site-nav';

export type Place = {
  label: string;
  href: string;
  /** What it is filed under: the room for a destination, the section for a page in one. */
  context: string;
  item: NavItem;
};

/**
 * Every place this viewer can open, in manifest order: home, the rooms'
 * destinations, jkai, then each section's own pages (Health's Plan, Intel's
 * Graph). A page already listed keeps its first, shorter name.
 */
export function placesFor(isOwner: boolean, reach: readonly string[] = []): Place[] {
  const home: NavItem = { label: 'Home', href: '/', match: (p) => p === '/' };
  const out: Place[] = [{ label: home.label, href: home.href, context: 'Front page', item: home }];
  const seen = new Set([home.href]);
  const add = (item: NavItem, context: string) => {
    if (seen.has(item.href)) return;
    seen.add(item.href);
    out.push({ label: item.label, href: item.href, context, item });
  };
  for (const room of visibleRooms(isOwner, reach)) for (const item of room.items) add(item, room.label);
  for (const item of visibleItems([JKAI_ITEM], isOwner, reach)) add(item, 'Chat');
  for (const section of SECTIONS) {
    for (const item of subnavFor(section.rootHref, isOwner, reach)) add(item, section.label);
  }
  return out;
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * The places a typed line names, best first; empty when it names none, which
 * is what makes it a question.
 *
 * Every word typed must begin a word of the place's name, its context or its
 * address, so "health plan" is a place and "what should I plan" is not. A name
 * that starts with the whole line beats one that merely contains its words.
 */
export function matchPlaces(query: string, places: readonly Place[]): Place[] {
  const typed = words(query);
  if (!typed.length) return [];
  const line = typed.join(' ');
  const scored: { place: Place; score: number }[] = [];
  for (const place of places) {
    const name = words(place.label);
    const rest = [...words(place.context), ...words(place.href)];
    if (!typed.every((t) => [...name, ...rest].some((w) => w.startsWith(t)))) continue;
    const score = name.join(' ').startsWith(line) ? 0 : typed.every((t) => name.some((w) => w.startsWith(t))) ? 1 : 2;
    scored.push({ place, score });
  }
  // Array.prototype.sort is stable: ties stay in manifest order.
  return scored.sort((a, b) => a.score - b.score).map((s) => s.place);
}

/** The place a path is in: the most specific one that claims it. */
export function placeAt(path: string, places: readonly Place[]): Place | undefined {
  let best: Place | undefined;
  for (const place of places) {
    if (!isItemActive(place.item, path)) continue;
    if (!best || place.href.length > best.href.length) best = place;
  }
  return best;
}

/** Where a question goes: jkai's chat, sent on arrival. */
export function askHref(question: string): string {
  return `/jkai?q=${encodeURIComponent(question.trim())}&send=1`;
}

/** How many places "Lately" remembers. One more than it shows: the current one is left out. */
export const LATELY_KEPT = 5;

/** `visited` moved to the front of the remembered addresses, most recent first. */
export function latelyWith(lately: readonly string[], visited: string): string[] {
  return [visited, ...lately.filter((h) => h !== visited)].slice(0, LATELY_KEPT);
}
