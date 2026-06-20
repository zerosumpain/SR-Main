// Tide helper for the Broads Pilot. Drives "best time to pass" from a baked
// table of REAL High/Low Water at Gorleston (Great Yarmouth) — the standard port
// the whole Broads references — applying each bridge's average time offset.
// Low water = maximum headroom = the window to pass the low tide-dependent
// bridges. Pure + display-only; the app keeps its 0.3 m safety margin and defers
// to the on-site gauge board. Times render in Europe/London (handles BST/GMT).
import type { TideTable, Bridge } from './types';

/** Mean semidiurnal tidal period (s) = 12 h 25 m. */
const SEMIDIURNAL_S = 44700;
const SEMIDIURNAL_MS = SEMIDIURNAL_S * 1000;
/** Slack water lags low water by ~1 h on the Yarmouth transit. */
const SLACK_OFFSET_S = 3600;
/** Half-width of a comfortable crossing window. */
const HALF_WINDOW_S = 90 * 60;
/** Yarmouth town tide lags Gorleston by ~1 h (HW & LW). */
export const YARMOUTH_OFFSET_MIN = 60;

export interface SlackWindow {
  start: Date;
  mid: Date;
  end: Date;
}

/**
 * Project `count` slack-water crossing windows from a known low water.
 * Each window is centred at LW + 1 h and is ±90 min wide; successive windows
 * are spaced one semidiurnal period (≈12 h 25 m) apart.
 */
export function nextSlackWindows(refLowWater: Date, count = 4): SlackWindow[] {
  const windows: SlackWindow[] = [];
  const base = refLowWater.getTime();
  for (let i = 0; i < count; i++) {
    const midMs = base + (SLACK_OFFSET_S + i * SEMIDIURNAL_S) * 1000;
    windows.push({
      start: new Date(midMs - HALF_WINDOW_S * 1000),
      mid: new Date(midMs),
      end: new Date(midMs + HALF_WINDOW_S * 1000),
    });
  }
  return windows;
}

/** Fixed Breydon Water crossing guidance (fallback when no tide table). */
export function breydonAdvice(): string {
  return 'Breydon Water is tidal — cross at slack water, about 1 hour after low water at Great Yarmouth. Plan ~2¼ h from Acle or ~2 h from Reedham. Keep inside the red & green posts.';
}

// ---------------------------------------------------------------------------
// Table-driven tide times (real Gorleston predictions + per-bridge offsets)
// ---------------------------------------------------------------------------

export interface Extreme {
  at: Date;
  type: 'low' | 'high';
  h: number | null; // metres above chart datum
  approx?: boolean; // projected (outside the baked table), not a real prediction
}

/** Europe/London YYYY-MM-DD for an instant (TZ-correct regardless of runtime). */
function londonDayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Format an instant as HH:MM in Europe/London (BST in summer, GMT in winter). */
export function fmtTideTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

export function hasTideData(table: TideTable | null | undefined): boolean {
  return !!table?.events?.length;
}

/** All baked Gorleston extremes, sorted ascending by time. */
export function parseTides(table: TideTable | null | undefined): Extreme[] {
  if (!table?.events?.length) return [];
  return table.events
    .map((e) => ({ at: new Date(e.t), type: e.type, h: e.h }))
    .filter((e) => !Number.isNaN(e.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Gorleston HW/LW falling on the same Europe/London day as `day` (empty if the
 *  baked table doesn't cover that day). */
export function gorlestonExtremesOnDay(table: TideTable | null | undefined, day: Date): Extreme[] {
  const key = londonDayKey(day);
  return parseTides(table).filter((e) => londonDayKey(e.at) === key);
}

/** True when the baked table has real predictions for `day`. */
export function hasRealDataForDay(table: TideTable | null | undefined, day: Date): boolean {
  return gorlestonExtremesOnDay(table, day).length > 0;
}

/** Project low waters for `day` from the nearest real Gorleston low water, using
 *  the mean semidiurnal period. Flagged approx — used beyond the table's dates. */
function projectLowWaters(all: Extreme[], day: Date, offsetMin: number): Extreme[] {
  const lows = all.filter((e) => e.type === 'low');
  if (!lows.length) return [];
  const key = londonDayKey(day);
  const targetNoon = new Date(`${key}T12:00:00Z`).getTime();
  let anchor = lows[0].at.getTime();
  for (const l of lows) if (Math.abs(l.at.getTime() - targetNoon) < Math.abs(anchor - targetNoon)) anchor = l.at.getTime();
  const k0 = Math.round((targetNoon - anchor) / SEMIDIURNAL_MS);
  const out: Extreme[] = [];
  for (let k = k0 - 2; k <= k0 + 2; k++) {
    const at = new Date(anchor + k * SEMIDIURNAL_MS + offsetMin * 60_000);
    if (londonDayKey(at) === key) out.push({ at, type: 'low', h: null, approx: true });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Local low waters (= max headroom) at a bridge for the Europe/London day of
 *  `day`. Uses real Gorleston predictions + the bridge offset where the table
 *  covers the day, otherwise projects approximate windows. */
export function bridgeLowWaters(table: TideTable | null | undefined, offsetMin: number, day: Date): Extreme[] {
  const key = londonDayKey(day);
  const all = parseTides(table);
  if (!all.length) return [];
  const real = all
    .filter((e) => e.type === 'low')
    .map((e) => ({ at: new Date(e.at.getTime() + offsetMin * 60_000), type: 'low' as const, h: e.h }))
    .filter((e) => londonDayKey(e.at) === key);
  if (real.length) return real.sort((a, b) => a.at.getTime() - b.at.getTime());
  return projectLowWaters(all, day, offsetMin);
}

/** Bridge low waters keyed off a Bridge record's tide_offset_min (null → []). */
export function bridgeTideWindows(table: TideTable | null | undefined, bridge: Bridge, day: Date): Extreme[] {
  if (!bridge.tide_dependent || bridge.tide_offset_min == null) return [];
  return bridgeLowWaters(table, bridge.tide_offset_min, day);
}

/** Breydon Water slack-water crossing windows for `day`: ~1 h after low water at
 *  Great Yarmouth (itself Gorleston + ~1 h), ±90 min. */
export function breydonCrossings(table: TideTable | null | undefined, day: Date): (SlackWindow & { approx: boolean })[] {
  return bridgeLowWaters(table, YARMOUTH_OFFSET_MIN, day).map((l) => {
    const mid = new Date(l.at.getTime() + SLACK_OFFSET_S * 1000);
    return {
      start: new Date(mid.getTime() - HALF_WINDOW_S * 1000),
      mid,
      end: new Date(mid.getTime() + HALF_WINDOW_S * 1000),
      approx: !!l.approx,
    };
  });
}
