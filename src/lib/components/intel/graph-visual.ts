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

// ── Relevance: how big and how vivid ────────────────────────────────────────
//
// Age used to be carried by opacity alone, which is the one channel already
// spoken for: `confirmed`, the keyword dimming and cluster focus all multiply
// into the same alpha, so a stale-but-confirmed node and a fresh-but-unconfirmed
// one landed on the same value and the graph said nothing about either. Size and
// hue are free, so staleness takes those.

/** The page cream. Both views draw on it, and 3D cannot read a CSS variable. */
export const PAGE_BG = '#ede4d4';

/**
 * How small the least relevant node is allowed to get, as a fraction of the
 * size its structural importance earned it.
 *
 * Structure still WINS: relevance modulates the size curve, it does not replace
 * it, so a hub that has gone quiet stays visibly a hub. Anything stronger and
 * the graph would stop answering "what is connected to what" — which is the
 * question it exists for — in order to answer "what is new", which the timeline
 * already answers better.
 */
export const RELEVANCE_SIZE_FLOOR = 0.55;

/** How far a stale node's colour is washed towards the page. Same reasoning as
 *  STALE_FLOOR: faded, never invisible. */
const MAX_WASH = 0.55;

/**
 * The relevance the renderers should size and shade by.
 *
 * `relevance` is confidence discounted by age and is what the entity card shows;
 * `recency` is age alone. Falling back to recency keeps a payload from before
 * this field existed — a tab left open across a deploy — drawing something
 * sensible rather than treating every node as maximally stale.
 */
export function nodeRelevance(n: { relevance?: number; recency?: number }): number {
  const r = Number.isFinite(n.relevance as number) ? (n.relevance as number) : n.recency;
  if (!Number.isFinite(r as number)) return 1;
  return Math.max(0, Math.min(1, r as number));
}

/**
 * Plain-language reading of a relevance score, for tooltips and the legend.
 *
 * A tooltip saying "0.42" tells you nothing without the curve in your head; the
 * words are what make the size and shade encodings readable rather than
 * decorative.
 *
 * The cuts are QUARTILES of the real distribution, measured over the 4,523 dated
 * entities in the production graph rather than picked to look round:
 *
 *   min 0.181 · p25 0.416 · p50 0.510 · p75 0.614 · max 0.920
 *
 * So "current" is the top quarter and "dormant" the tail below the bottom one.
 *
 * Cut against the WHOLE graph on purpose, not against whatever is on screen. The
 * default view is the 600 most central entities, whose relevance skews high
 * (min 0.298 · p50 0.614 · max 0.920), so most nodes you hover will read
 * "recent" or "current" — and they should, because they ARE among the more
 * relevant things known. Calibrating to the visible subset instead would make
 * the same entity change its word every time a filter changed, which is a label
 * that means nothing.
 *
 * If the graph's composition shifts a long way — a much larger mailbox, a change
 * to how confidence is scored — re-measure rather than assuming these still cut
 * where they say they do.
 */
export function relevancePhrase(relevance: number): string {
  // The measured percentiles themselves, not values rounded near them: at 0.42
  // the entity sitting exactly on p25 fell into the band BELOW the one the
  // quartile defines, which is the kind of off-by-a-rounding that makes a
  // calibrated scale quietly uncalibrated.
  if (relevance >= 0.614) return 'current'; // p75 and above
  if (relevance >= 0.416) return 'recent'; // p25..p75, the middle half
  if (relevance >= 0.3) return 'cooling'; // upper half of the bottom quartile
  return 'dormant';
}

/** Size multiplier from relevance, in `[RELEVANCE_SIZE_FLOOR, 1]`. */
export function relevanceScale(relevance: number): number {
  const r = Number.isFinite(relevance) ? Math.max(0, Math.min(1, relevance)) : 1;
  return RELEVANCE_SIZE_FLOOR + (1 - RELEVANCE_SIZE_FLOOR) * r;
}

/**
 * A cluster colour washed towards the page by how irrelevant the node is.
 *
 * Mixing towards the background rather than dropping saturation on purpose: the
 * cluster palette is already fairly desaturated, so a saturation shift is barely
 * visible, whereas moving a colour towards the surface it sits on reads exactly
 * as "receding" — and it keeps the hue, so the cluster remains identifiable at
 * every age.
 */
export function washOut(hex: string, relevance: number, towards: string = PAGE_BG): string {
  const amount = MAX_WASH * (1 - Math.max(0, Math.min(1, relevance)));
  if (amount <= 0.001) return hex;
  const a = parseHex(hex);
  const b = parseHex(towards);
  if (!a || !b) return hex;
  const mix = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return `#${[mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6) return null;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ── Edge weight: the number that was being thrown away ───────────────────────
//
// Both views drew edge width from the three-value `strength` bucket, and on the
// real graph 4,452 of 4,649 relationships are 'moderate' — 96% of the edges
// rendered at exactly the same width, discarding a continuous `weight` that
// actually spans 0.25 to 0.99. `strength` is a bucketing OF that weight
// (weak ≤0.25, strong ≥0.75), so nothing is added by reading the bucket; the
// number underneath it is the one carrying information.

/** Where the mass of the real distribution sits, so the ramp spans it. */
const WEIGHT_LO = 0.25;
const WEIGHT_HI = 0.75;

/** Weight on a 0..1 ramp across the range the data actually occupies. */
export function weightRamp(weight: number | null | undefined): number {
  if (!Number.isFinite(weight as number)) return 0.5;
  const w = weight as number;
  return Math.max(0, Math.min(1, (w - WEIGHT_LO) / (WEIGHT_HI - WEIGHT_LO)));
}

/** Stroke width for an edge. Spans roughly the old 0.7–2 range, continuously. */
export function edgeWidth(weight: number | null | undefined): number {
  return 0.6 + weightRamp(weight) * 2.2;
}

/** Opacity multiplier: a barely-corroborated link should not shout. */
export function edgeEmphasis(weight: number | null | undefined): number {
  return 0.55 + 0.45 * weightRamp(weight);
}

/**
 * Link-force scalars, so PROXIMITY in the layout means evidential strength and
 * not merely adjacency.
 *
 * Both views run the same force configuration and must keep running the same
 * one, so these live here rather than in either component. A well-corroborated
 * pair pulls to about four fifths of the neutral distance and pulls harder; a
 * single-mention pair sits a quarter further out and barely pulls at all.
 */
export function edgeDistanceScale(weight: number | null | undefined): number {
  return 1.25 - 0.45 * weightRamp(weight);
}

export function edgeForceStrength(weight: number | null | undefined): number {
  return 0.2 + 0.3 * weightRamp(weight);
}
