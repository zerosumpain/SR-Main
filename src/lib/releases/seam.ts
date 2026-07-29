/**
 * Geometry for the landing page's shipping seam.
 *
 * The seam is one continuous mark: a comb of daily deploys rising ABOVE a
 * horizon rule, and a mirrored comb of the capabilities those deploys carried
 * falling BELOW it. Deploys are effort, capability is result, and the horizon
 * is the same 2px accent rail the rest of the site uses as its brand gesture.
 *
 * An earlier draft stacked cumulative bands below the line instead. That was
 * dropped deliberately: a cumulative area chart is monotonic by construction,
 * so it can only ever say "it went up" — it cannot show a quiet fortnight or a
 * heavy week, which is the whole point of drawing 133 days rather than printing
 * one total.
 *
 * Kept pure and free of Svelte so the maths is testable, and because the SVG is
 * drawn with preserveAspectRatio="none" — under non-uniform scale a mistake
 * here is invisible in code review and obvious only on a wide monitor.
 */

import type { CadenceDay } from './public';

/** The logical drawing buffer. Mirrors Ecg.svelte's stretched-viewBox trick. */
export const VIEW_W = 1200;
export const VIEW_H = 320;
/** y of the horizon rule; deploys occupy above, capabilities below. */
export const HORIZON = 168;
const TOP_PAD = 16;
const BOTTOM_PAD = 12;

export interface SeamColumn {
  /** Index into the cadence array. */
  i: number;
  date: string;
  deploys: number;
  shipped: number;
  /** Centre x in view units. */
  cx: number;
  /** Bar width in view units. */
  w: number;
  /** Top y of the upward (deploy) bar; equals HORIZON when there were none. */
  upY: number;
  /** Bottom y of the downward (capability) bar. */
  downY: number;
  /** 0–1, drives fill opacity: how much of the day's work is describable. */
  yield: number;
}

export interface SeamField {
  columns: SeamColumn[];
  days: number;
  /** Month boundaries for the ruler: index + short label. */
  ticks: { i: number; label: string; cx: number }[];
  maxDeploys: number;
  maxShipped: number;
}

/**
 * Compress with log1p so a single 12-deploy day does not flatten the other 132.
 * Real range is 1–12 deploys; linear scaling would make the median day 1px.
 */
function scale(v: number, max: number, span: number): number {
  if (v <= 0 || max <= 0) return 0;
  return Math.max(2, (span * Math.log1p(v)) / Math.log1p(max));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function buildSeamField(cadence: CadenceDay[]): SeamField {
  const days = cadence.length;
  if (days === 0) {
    return { columns: [], days: 0, ticks: [], maxDeploys: 0, maxShipped: 0 };
  }

  const maxDeploys = Math.max(...cadence.map((d) => d.count), 1);
  const maxShipped = Math.max(...cadence.map((d) => d.shipped), 1);
  const w = VIEW_W / days;
  const barW = Math.max(1.4, w * 0.44);
  const upSpan = HORIZON - TOP_PAD;
  const downSpan = VIEW_H - BOTTOM_PAD - HORIZON;

  const columns: SeamColumn[] = cadence.map((d, i) => {
    const up = scale(d.count, maxDeploys, upSpan);
    const down = scale(d.shipped, maxShipped, downSpan);
    return {
      i,
      date: d.date,
      deploys: d.count,
      shipped: d.shipped,
      cx: (i + 0.5) * w,
      w: barW,
      upY: HORIZON - up,
      downY: HORIZON + down,
      // Capped at 1: a day can ship more items than it had deploys.
      yield: d.count > 0 ? Math.min(1, d.shipped / d.count) : 0,
    };
  });

  const ticks: { i: number; label: string; cx: number }[] = [];
  let lastMonth = -1;
  cadence.forEach((d, i) => {
    const month = Number(d.date.slice(5, 7)) - 1;
    if (month !== lastMonth) {
      lastMonth = month;
      ticks.push({ i, label: MONTHS[month] ?? '', cx: (i + 0.5) * w });
    }
  });

  return { columns, days, ticks, maxDeploys, maxShipped };
}

/**
 * The envelope through the deploy peaks — turns 133 separate bars into one
 * continuous signal, which is what makes the field read as an organism rather
 * than a bar chart.
 */
export function envelopePoints(field: SeamField): string {
  return field.columns.map((c) => `${c.cx.toFixed(2)},${c.upY.toFixed(2)}`).join(' ');
}

/** Nearest column to a pointer position given as a 0–1 fraction of the width. */
export function columnAtFraction(field: SeamField, fraction: number): number {
  if (field.days === 0) return -1;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.min(field.days - 1, Math.floor(clamped * field.days));
}

/** "19 Mar" — the ruler and tooltip both want a short, unambiguous date. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`;
}
