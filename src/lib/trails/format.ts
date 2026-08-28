// Display formatting for /trails. Storage is SI; every unit the reader sees is
// converted here and nowhere else.

const M_PER_MILE = 1609.344;

export function formatDistance(metres: number | null | undefined, unit: 'km' | 'mi' = 'km'): string {
  if (metres == null || !Number.isFinite(metres)) return '—';
  const value = unit === 'mi' ? metres / M_PER_MILE : metres / 1000;
  return `${value.toFixed(value >= 100 ? 0 : 2)} ${unit}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Pace as mm:ss per km or mile — the unit runners actually read. */
export function formatPace(
  secondsPerKm: number | null | undefined,
  unit: 'km' | 'mi' = 'km',
): string {
  if (secondsPerKm == null || !Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return '—';
  const perUnit = unit === 'mi' ? secondsPerKm * (M_PER_MILE / 1000) : secondsPerKm;
  const m = Math.floor(perUnit / 60);
  const s = Math.round(perUnit % 60);
  // 4:60 is not a pace.
  const [mm, ss] = s === 60 ? [m + 1, 0] : [m, s];
  return `${mm}:${String(ss).padStart(2, '0')} /${unit}`;
}

/** Speed in km/h — the unit cyclists read, from the same stored pace. */
export function formatSpeed(secondsPerKm: number | null | undefined): string {
  if (secondsPerKm == null || !Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return '—';
  return `${(3600 / secondsPerKm).toFixed(1)} km/h`;
}

export function formatElevation(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres)) return '—';
  return `${Math.round(metres)} m`;
}

export function formatHeartrate(bpm: number | null | undefined): string {
  if (bpm == null || !Number.isFinite(bpm) || bpm <= 0) return '—';
  return `${Math.round(bpm)} bpm`;
}

export function formatEnergy(kj: number | null | undefined): string {
  if (kj == null || !Number.isFinite(kj)) return '—';
  return `${Math.round(kj / 4.184)} kcal`;
}

const TYPE_LABELS: Record<string, string> = {
  run: 'Run',
  trail_run: 'Trail run',
  ride: 'Ride',
  mtb: 'MTB',
  hike: 'Hike',
  walk: 'Walk',
  swim: 'Swim',
  other: 'Other',
};

export function activityLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
}

/** Cyclists want speed, runners want pace. The stored value is the same. */
export function isPaceSport(type: string): boolean {
  return type === 'run' || type === 'trail_run' || type === 'hike' || type === 'walk';
}

/**
 * Offroad by declared sport. Segments carry no surface data (a GPS trace does
 * not say what it crossed), so the activity type is the honest proxy: the
 * sports that only happen off the tarmac count, and a road walk that wandered
 * onto a bridleway does not sneak in.
 */
export function isOffroadType(type: string): boolean {
  return type === 'trail_run' || type === 'mtb' || type === 'hike';
}

/**
 * Date shown as it was lived, not as the server sees it.
 *
 * `startDateLocal` is the string the phone sent, already in the workout's own
 * offset. Reformatting it through a Date would re-interpret it in the server's
 * zone and slide evening runs into the next day, so the parts are read directly.
 */
export function formatLocalDate(startDateLocal: string, startDate: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(startDateLocal.trim());
  if (!m) {
    return new Date(startDate * 1000).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    });
  }
  const [, y, mo, d, h, mi] = m;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${+d} ${monthNames[+mo - 1]} ${y}, ${h}:${mi}`;
}
