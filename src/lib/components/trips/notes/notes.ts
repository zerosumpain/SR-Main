// notes.ts — the small pure helpers behind the notebook /trips pages: how a
// trip is named and dated on its card, how many days it spans, how the plan's
// revisions are summarised, and where the stops fall on a hand-drawn sketch
// when there is no map. Pure, so the server and the browser agree and the
// rules are unit tests (notes.test.ts).

/** The planner's placeholder title for a trip it has not named yet. */
const PLACEHOLDER_TITLES = new Set(['new trip', 'untitled trip', '']);

/**
 * A trip's name as a card should say it: its own title, or, while the planner
 * has only the placeholder, the destination's first part ("Rome, Italy" →
 * "Rome"), so six "New trip" rows stop looking identical.
 */
export function tripName(t: { title: string; destination: string }): { name: string; named: boolean } {
  if (!PLACEHOLDER_TITLES.has(t.title.trim().toLowerCase())) return { name: t.title.trim(), named: true };
  const place = t.destination.split(',')[0]?.trim();
  return { name: place || 'A trip', named: false };
}

/** Whole days from the first to the last, inclusive; 0 when the dates are out of order. */
export function dayCount(startDate: string, endDate: string): number {
  const a = Date.parse(`${startDate}T00:00:00Z`);
  const b = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** "27 Oct" for a stamp, without a time zone round trip. */
export function stampDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** "Tuesday" for a day heading. */
export function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
}

/** "27–30 Oct", "30 Oct – 2 Nov", "28 Oct" — a trip's dates as a person writes them. */
export function dateSpan(startDate: string, endDate: string): string {
  if (startDate === endDate) return stampDate(startDate);
  const [sy, sm] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  if (sy === ey && sm === em) return `${Number(startDate.slice(8, 10))}–${ed} ${stampDate(endDate).split(' ')[1]}`;
  return `${stampDate(startDate)} – ${stampDate(endDate)}`;
}

/** Numbers one to twelve as words, the rest as figures: "four days in Rome". */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export function countWord(n: number): string {
  return n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}

/** Trips still to come (or under way) first, soonest first; then the ones already been, latest first. */
export function splitTrips<T extends { startDate: string; endDate: string }>(trips: T[], today: string): { ahead: T[]; been: T[] } {
  const ahead = trips.filter((t) => t.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const been = trips.filter((t) => t.endDate < today).sort((a, b) => b.startDate.localeCompare(a.startDate));
  return { ahead, been };
}

/** How far away a trip is, said plainly: "in 11 days", "tomorrow", "under way". */
export function whenFrom(startDate: string, endDate: string, today: string): string {
  if (today >= startDate && today <= endDate) return 'under way';
  const days = dayCount(today, startDate) - 1;
  if (days < 0) return 'been';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

/** The latest revision's changes, cut to `limit` lines with a count of the rest. */
export function firstChanges(changes: string[], limit = 4): { shown: string[]; more: number } {
  return { shown: changes.slice(0, limit), more: Math.max(0, changes.length - limit) };
}

export interface SketchPoint {
  x: number;
  y: number;
}

/**
 * Stops projected onto a sketch `w`×`h` units with `pad` round the edge: an
 * equirectangular projection scaled by the cosine of the middle latitude (so
 * a city keeps its shape), fitted and centred. One point lands in the middle.
 */
export function sketchPoints(points: Array<{ lat: number; lng: number }>, w: number, h: number, pad: number): SketchPoint[] {
  if (!points.length) return [];
  const midLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const k = Math.cos((midLat * Math.PI) / 180) || 1;
  const xs = points.map((p) => p.lng * k);
  const ys = points.map((p) => -p.lat);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0);
  if (span === 0) return points.map(() => ({ x: w / 2, y: h / 2 }));
  const scale = Math.min((w - 2 * pad) / (x1 - x0 || span), (h - 2 * pad) / (y1 - y0 || span));
  const ox = (w - (x1 - x0) * scale) / 2;
  const oy = (h - (y1 - y0) * scale) / 2;
  return xs.map((x, i) => ({ x: Math.round((ox + (x - x0) * scale) * 10) / 10, y: Math.round((oy + (ys[i] - y0) * scale) * 10) / 10 }));
}
