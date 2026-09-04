// src/lib/daydream/routes.ts
//
// Where each kind of thought is allowed to go. PURE; the setting that
// overrides it lives in `routes.server.ts`.
//
// Three destinations. `whatsapp` may interrupt (subject to the policy and
// the caps in `deliver.ts`); `briefing` waits for the next morning's card;
// `feed` sits on the hub and waits for him. A route is a CEILING, never a
// promise: a kind routed to WhatsApp still has to be verified, clear the
// bar, and find a free slot.
//
// Keyed by family (from `thought-groups.ts`) with per-kind exceptions, kind
// winning — a family default with one exception (`mail_security` inside
// `mail`) is the common case. Owner overrides are the same shape.

import { familyOf } from './thought-groups';

export const ROUTE_OPTIONS = ['whatsapp', 'briefing', 'feed'] as const;
export type Route = (typeof ROUTE_OPTIONS)[number];
export function isRoute(v: unknown): v is Route {
  return typeof v === 'string' && (ROUTE_OPTIONS as readonly string[]).includes(v);
}

/** Owner's D6 (2026-09-02): only security and policy-passing musings
 *  interrupt; graph links are applied and summarised; places are one
 *  naming session; patterns and rules wait for the morning; the quieter
 *  mail lanes never leave the feed. */
export const DEFAULT_ROUTES: Readonly<Record<string, Route>> = {
  // families
  musings: 'whatsapp',
  mail: 'feed',
  places: 'briefing',
  graph: 'briefing',
  patterns: 'briefing',
  rules: 'briefing',
  // What the engine would like to build never interrupts. It is not urgent by
  // construction — nothing about a missing data source becomes wrong if it
  // waits until morning — and a proposal that buzzes a phone is how a helpful
  // engine becomes a muted one.
  build: 'briefing',
  // kinds
  mail_security: 'whatsapp',
};

export type RouteOverrides = Readonly<Record<string, Route>>;

/** The route for a kind: the override for the kind, then its family, then
 *  the default for the kind, then its family, then `feed`. */
export function routeFor(kind: string, overrides: RouteOverrides = {}): Route {
  const fam = familyOf(kind).id;
  return overrides[kind] ?? overrides[fam] ?? DEFAULT_ROUTES[kind] ?? DEFAULT_ROUTES[fam] ?? 'feed';
}

/** Where a route decision came from, for the grid. */
export function routeSource(kind: string, overrides: RouteOverrides = {}): 'kind' | 'family' | 'default-kind' | 'default-family' | 'fallback' {
  const fam = familyOf(kind).id;
  if (overrides[kind]) return 'kind';
  if (overrides[fam]) return 'family';
  if (DEFAULT_ROUTES[kind]) return 'default-kind';
  if (DEFAULT_ROUTES[fam]) return 'default-family';
  return 'fallback';
}

/** Kinds whose DEFAULT is the feed — the old `FEED_ONLY_KINDS`, derived. */
export const DEFAULT_FEED_KINDS: ReadonlyArray<string> = ['mail_money_admin', 'mail_official', 'mail_unusual'];

/** Every kind rated 5 gets a short cooldown; every kind rated 1 a long one.
 *  Same currency as the weight, a second visible effect of the same dial. */
export const BASE_COOLDOWN_HOURS = 20;
export function cooldownHoursFor(meanRelevance: number | null | undefined): number {
  if (meanRelevance == null || !Number.isFinite(meanRelevance)) return BASE_COOLDOWN_HOURS;
  if (meanRelevance >= 4.5) return 8;
  if (meanRelevance >= 3.5) return 14;
  if (meanRelevance <= 1.5) return 48;
  if (meanRelevance <= 2.5) return 32;
  return BASE_COOLDOWN_HOURS;
}
