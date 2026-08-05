// Encoding shared by the 2D and 3D graph views.
//
// The two components deliberately draw the same graph, and the rule that they
// "must never disagree about what the graph says" has so far been kept by hand —
// each held its own copy of the palette and the opacity thresholds. Anything NEW
// that both need goes here instead, so there is one place to change it.

import { RECENCY_FLOOR } from '$lib/jkai/intel/staleness';

/**
 * How faint the stalest thing on the graph is allowed to get, as a fraction of
 * its normal opacity.
 *
 * Not zero, and not close to it. Age is a hint, not a filter: a node nobody has
 * mentioned since June is still a real entity that must stay legible, hoverable
 * and clickable. Fading it out of existence would make the graph lie about what
 * it contains, and the source filter already exists for people who want things
 * gone. 0.45 is enough that a fresh cluster reads as the foreground without the
 * rest becoming a guess.
 */
export const STALE_FLOOR = 0.45;

/**
 * Opacity multiplier for a node or edge, from the recency the network route
 * ships (RECENCY_FLOOR..1).
 *
 * Linear between the floor and 1 rather than another exponential: `recency` has
 * already had the decay curve applied to it, and decaying a decayed value
 * collapses everything older than a few weeks into the same grey.
 */
export function recencyFade(recency: number | null | undefined): number {
  if (!Number.isFinite(recency as number)) return 1;
  const r = Math.max(RECENCY_FLOOR, Math.min(1, recency as number));
  const t = (r - RECENCY_FLOOR) / (1 - RECENCY_FLOOR);
  return STALE_FLOOR + (1 - STALE_FLOOR) * t;
}

/**
 * Cluster palette. The same cluster must be the same colour in the 2D view, the
 * 3D view and the cluster picker, or switching between them looks like
 * switching graphs.
 *
 * Both graph components held their own identical copy of this and kept them in
 * step by hand; a third copy in the picker was the point at which that stopped
 * being reasonable.
 */
export const CLUSTER_COLOURS = [
  '#0e5b66', '#c4570a', '#2d7a3a', '#7a3a8a', '#b0892a',
  '#3a6ea5', '#a53a3a', '#4a7a6a', '#8a5a2a', '#5a4a8a',
];

export const clusterColour = (c: number): string =>
  CLUSTER_COLOURS[((c % CLUSTER_COLOURS.length) + CLUSTER_COLOURS.length) % CLUSTER_COLOURS.length];
