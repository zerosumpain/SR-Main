// The owner's photo library for jkai chat: the PURE half (no I/O).
//
// SR-Drive owns the Immich connection (face clusters with the names John gave
// them, CLIP smart search, OCR, EXIF and reverse geocoding) and answers four
// owner-only service-lane reads: /api/photos/people, /search, /assets/<id> and
// /stats. `./photos.server` relays them; this module turns a tool call's
// arguments into Drive's query string and Drive's answer into the compact
// shape the model reads: ISO dates with their offset, a place as "City,
// Country" with lat/lon, people by name, the Drive link. No prose, no nulls
// the model would have to read past.

export const PEOPLE_FILTERS = ['all', 'named', 'unnamed'] as const;
export const ASSET_TYPES = ['photo', 'video'] as const;

/** The site path John opens; Drive's own deep link to a photo's file. */
export const PHOTOS_PAGE = '/drive?tab=people';

const clampInt = (raw: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

const text = (raw: unknown, max = 200): string | null => {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().slice(0, max);
  return t || null;
};

function qs(pairs: Array<[string, string]>): string {
  const q = new URLSearchParams();
  for (const [k, v] of pairs) q.append(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** `YYYY-MM-DD` or a full ISO timestamp, as given; anything unparseable is refused. */
export function isoDateArg(raw: unknown, field: string): string | null {
  const t = text(raw, 40);
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(t) || Number.isNaN(Date.parse(t))) {
    throw new PhotoArgError(`${field} must be a date, YYYY-MM-DD (or a full ISO timestamp); got "${t}"`);
  }
  return t;
}

export class PhotoArgError extends Error {}

/** photo_people → GET /api/photos/people */
export function peoplePath(args: Record<string, unknown>): string {
  const filter = (PEOPLE_FILTERS as readonly string[]).includes(String(args.filter)) ? String(args.filter) : 'all';
  const pairs: Array<[string, string]> = [['filter', filter]];
  const name = text(args.name, 80);
  if (name) pairs.push(['q', name]);
  pairs.push(['limit', String(clampInt(args.limit, 1, 200, 50))]);
  return `/api/photos/people${qs(pairs)}`;
}

/** A list of names or ids, from an array or a comma list. */
function names(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return [...new Set(parts.map((p) => text(p, 80)).filter((p): p is string => !!p))].slice(0, 10);
}

/** photo_search → GET /api/photos/search */
export function searchPath(args: Record<string, unknown>): string {
  const pairs: Array<[string, string]> = [];
  for (const p of names(args.people)) pairs.push(['person', p]);
  const t = text(args.text);
  if (t) pairs.push(['text', t]);
  const ocr = text(args.text_in_image);
  if (ocr) pairs.push(['ocr', ocr]);
  const place = text(args.place, 100);
  if (place) pairs.push(['place', place]);
  const from = isoDateArg(args.from, 'from');
  const to = isoDateArg(args.to, 'to');
  if (from && to && Date.parse(from) > Date.parse(to)) throw new PhotoArgError(`from (${from}) is after to (${to})`);
  if (from) pairs.push(['from', from]);
  if (to) pairs.push(['to', to]);
  if ((ASSET_TYPES as readonly string[]).includes(String(args.type))) pairs.push(['type', String(args.type)]);
  pairs.push(['limit', String(clampInt(args.limit, 1, 100, 25))]);
  const page = clampInt(args.page, 1, 1000, 1);
  if (page > 1) pairs.push(['page', String(page)]);
  return `/api/photos/search${qs(pairs)}`;
}

/** photo_detail → GET /api/photos/assets/<id>. Immich ids are UUIDs. */
export function detailPath(args: Record<string, unknown>): string {
  const id = text(args.id, 64);
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new PhotoArgError('id must be a photo id from photo_search (a UUID)');
  }
  return `/api/photos/assets/${id.toLowerCase()}`;
}

export const STATS_PATH = '/api/photos/stats';

// ---------------------------------------------------------------- Drive's wire

export interface WireLocation {
  lat?: number | null;
  lon?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export interface WireAsset {
  id: string;
  type?: string;
  takenAt?: string | null;
  timeZone?: string | null;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  location?: WireLocation | null;
  camera?: { make?: string | null; model?: string | null; lens?: string | null } | null;
  people?: Array<{ id: string; name?: string | null }>;
  driveFile?: { id: string; name: string; url?: string } | null;
  thumbnailPath?: string;
  ocrText?: string | null;
  faces?: Array<{ personId?: string | null; name?: string | null; box?: unknown }>;
}

export interface WirePerson {
  id: string;
  name?: string | null;
  isHidden?: boolean;
  assetCount?: number | null;
  firstSeen?: string | null;
  lastSeen?: string | null;
}

// ---------------------------------------------------------------- compact shapes

/** "City, Country" (or the nearest names there are), never empty. */
export function placeName(loc: WireLocation | null | undefined): string | null {
  if (!loc) return null;
  const parts = [loc.city || loc.state, loc.country].map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean);
  return parts.length ? [...new Set(parts)].join(', ') : null;
}

const round5 = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1e5) / 1e5 : null);

/** An unnamed face cluster, so the model can still say "the same unnamed person". */
const personLabel = (p: { id?: string | null; name?: string | null }): string =>
  p.name?.trim() || `unnamed:${String(p.id ?? '')}`;

export interface CompactAsset {
  id: string;
  type: string;
  takenAt: string | null;
  timeZone?: string;
  durationSec?: number;
  place?: string;
  lat?: number;
  lon?: number;
  people?: string[];
  camera?: string;
  file?: string;
  link?: string;
}

export function compactAsset(a: WireAsset): CompactAsset {
  const out: CompactAsset = { id: a.id, type: a.type === 'video' ? 'video' : 'photo', takenAt: a.takenAt ?? null };
  if (a.timeZone) out.timeZone = a.timeZone;
  if (out.type === 'video' && typeof a.durationSec === 'number') out.durationSec = Math.round(a.durationSec);
  const place = placeName(a.location);
  if (place) out.place = place;
  const lat = round5(a.location?.lat);
  const lon = round5(a.location?.lon);
  if (lat !== null && lon !== null) Object.assign(out, { lat, lon });
  if (a.people?.length) out.people = a.people.map(personLabel);
  const cam = [a.camera?.make, a.camera?.model].map((s) => s?.trim()).filter(Boolean);
  // "Apple iPhone 15 Pro", not "Apple Apple iPhone 15 Pro".
  if (cam.length) out.camera = cam.length === 2 && cam[1]!.toLowerCase().startsWith(cam[0]!.toLowerCase()) ? cam[1] : cam.join(' ');
  if (a.driveFile) {
    out.file = a.driveFile.name;
    out.link = a.driveFile.url || `/drive?file=${encodeURIComponent(a.driveFile.id)}`;
  }
  return out;
}

export function compactPerson(p: WirePerson) {
  return {
    id: p.id,
    name: p.name?.trim() || null,
    photos: typeof p.assetCount === 'number' ? p.assetCount : null,
    ...(p.firstSeen ? { firstSeen: p.firstSeen } : {}),
    ...(p.lastSeen ? { lastSeen: p.lastSeen } : {}),
    ...(p.isHidden ? { hidden: true } : {}),
  };
}

/** What a page of results adds up to: where and who, most frequent first. */
export function summarise(assets: CompactAsset[]) {
  const tally = (values: string[]) => {
    const m = new Map<string, number>();
    for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([name, count]) => ({ name, count }));
  };
  const times = assets.map((a) => a.takenAt).filter((t): t is string => !!t && !Number.isNaN(Date.parse(t)));
  times.sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    ...(times.length ? { span: { from: times[0], to: times[times.length - 1] } } : {}),
    places: tally(assets.flatMap((a) => (a.place ? [a.place] : []))),
    people: tally(assets.flatMap((a) => a.people ?? [])),
  };
}

export const NOT_CONNECTED =
  'Photos are not connected right now (the reason says why), so there is nothing to read. Tell John that plainly, with the reason; do not guess or describe photos.';
