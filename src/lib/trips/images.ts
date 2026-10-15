// src/lib/trips/images.ts
//
// Places you can picture (red team 2026-10-15, proposal B): a photograph of
// each place from Wikimedia Commons, found through the place's Wikidata
// entry (OpenStreetMap's `wikidata` tag → Wikidata's "image" claim, P18 →
// the Commons file). Free to show with its author and licence, which always
// travel with it. No image is better than a wrong one: only the entry's own
// P18 is used — never a search.
//
// PURE: the fetches and the cache are in ./images.server.

import type { PlaceImage } from './model';

/** Wikidata ids only: `Q` and digits. */
export function wikidataId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^(Q\d{1,12})$/.exec(raw.trim());
  return m ? m[1] : null;
}

export const WIKIDATA_URL = (q: string) => `https://www.wikidata.org/wiki/Special:EntityData/${q}.json`;

/** The Commons API asking for an ~800 px thumbnail and the file's credits. */
export function commonsInfoUrl(file: string, width = 800): string {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.searchParams.set('action', 'query');
  u.searchParams.set('format', 'json');
  u.searchParams.set('prop', 'imageinfo');
  u.searchParams.set('iiprop', 'url|extmetadata|size');
  u.searchParams.set('iiurlwidth', String(width));
  u.searchParams.set('titles', `File:${file}`);
  return u.toString();
}

/** The entry's first "image" (P18) file name, from Special:EntityData JSON. */
export function imageFileFromEntity(json: unknown, q: string): string | null {
  const entity = (json as { entities?: Record<string, unknown> } | null)?.entities?.[q] as
    | { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } }; rank?: string }>> }
    | undefined;
  const claims = entity?.claims?.P18 ?? [];
  // A preferred image first, then the first that is not deprecated.
  const ordered = [...claims.filter((c) => c.rank === 'preferred'), ...claims.filter((c) => c.rank !== 'preferred' && c.rank !== 'deprecated')];
  for (const c of ordered) {
    const v = c.mainsnak?.datavalue?.value;
    if (typeof v === 'string' && v.trim() && /\.(jpe?g|png|webp|tiff?)$/i.test(v.trim())) return v.trim();
  }
  return null;
}

/** Plain text from Commons' HTML credit fields ("<a …>Jane</a>" → "Jane"). */
export function plainText(html: unknown, max = 160): string | null {
  if (typeof html !== 'string') return null;
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Wikimedia's own image hosts: thumbnails moved to `thumb.` in 2026. */
const IMAGE_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);

/** An https URL on Wikimedia's image hosts, without tracking parameters; else null. */
export function cleanImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || !IMAGE_HOSTS.has(u.hostname)) return null;
    for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return null;
  }
}

/** The Commons answer as our image, or null when it has no usable thumbnail. */
export function imageFromCommons(json: unknown, q: string): PlaceImage | null {
  const pages = (json as { query?: { pages?: Record<string, unknown> } } | null)?.query?.pages ?? {};
  for (const page of Object.values(pages)) {
    const info = (page as { imageinfo?: Array<Record<string, unknown>> }).imageinfo?.[0];
    if (!info) continue;
    // The thumbnail only: an original can be tens of megabytes.
    const url = cleanImageUrl(info.thumburl);
    const sourceUrl = typeof info.descriptionurl === 'string' ? info.descriptionurl : null;
    if (!url || !sourceUrl) continue;
    const meta = (info.extmetadata ?? {}) as Record<string, { value?: unknown } | undefined>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      url,
      width: num(info.thumbwidth) ?? num(info.width),
      height: num(info.thumbheight) ?? num(info.height),
      credit: plainText(meta.Artist?.value) ?? plainText(meta.Credit?.value),
      license: plainText(meta.LicenseShortName?.value, 60),
      sourceUrl,
      wikidata: q,
    };
  }
  return null;
}
