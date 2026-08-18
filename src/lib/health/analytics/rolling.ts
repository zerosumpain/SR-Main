// src/lib/health/analytics/rolling.ts
// Rolling-window helpers for daily physiological series. Windows count DAYS,
// not array entries — daily series here have real gaps (no reading on a day),
// and an entry-counted window silently stretches across them.

export type DayPoint = { date: string; value: number }; // date = 'YYYY-MM-DD'

/**
 * Trailing mean over the previous `windowDays` calendar days (inclusive of the
 * point's own day). Points whose window holds fewer than `minCount` readings
 * are omitted rather than reported on thin air.
 */
export function rollingMean(series: DayPoint[], windowDays: number, minCount = 3): DayPoint[] {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const out: DayPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const end = dayNumber(sorted[i].date);
    const start = end - windowDays + 1;
    const inWindow = [];
    for (let j = i; j >= 0; j--) {
      const d = dayNumber(sorted[j].date);
      if (d < start) break;
      inWindow.push(sorted[j].value);
    }
    if (inWindow.length >= minCount) {
      const mean = inWindow.reduce((a, b) => a + b, 0) / inWindow.length;
      out.push({ date: sorted[i].date, value: Math.round(mean * 100) / 100 });
    }
  }
  return out;
}

/** Mean of the readings in the trailing `windowDays` days ending today-ish (the series max date). */
export function trailingMean(series: DayPoint[], windowDays: number): number | null {
  if (series.length === 0) return null;
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const end = dayNumber(sorted[sorted.length - 1].date);
  const start = end - windowDays + 1;
  const vals = sorted.filter((p) => dayNumber(p.date) >= start).map((p) => p.value);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(date + 'T00:00:00Z') / 86400000);
}
