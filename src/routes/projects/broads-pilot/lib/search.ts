// Free-text feature search over the bundled datasets: bridges, the lock,
// moorings/boatyards and POIs. Bare graph nodes (broads/staithes) are excluded —
// they are not a Selection kind and so cannot open the detail drawer. Pure.
import type { Datasets, MooringTier, PoiKind } from './types';

export interface SearchEntry {
  /** matches the appState Selection union, so a pick can call app.select() */
  kind: 'mooring' | 'poi' | 'bridge' | 'lock';
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** short human descriptor, e.g. "Bridge · Bure", "Hire base", "Pub" */
  sublabel: string;
}

const TIER_LABEL: Record<MooringTier, string> = {
  ba_free: 'Free mooring',
  ba_staffed: 'Staffed mooring',
  yacht_station: 'Yacht station',
  pub: 'Pub mooring',
  private: 'Private mooring',
  marina: 'Marina',
  hire_yard: 'Hire base',
};
const POI_LABEL: Record<PoiKind, string> = {
  pub: 'Pub',
  walk: 'Walk',
  attraction: 'Attraction',
  shop: 'Shop',
  fuel: 'Fuel',
  fishing: 'Fishing',
  swim: 'Swim spot',
};

/** Flatten the selectable, named, geolocated features into one search index. */
export function buildSearchIndex(data: Datasets): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const b of data.restrictions.bridges)
    out.push({ kind: 'bridge', id: b.id, name: b.name, lat: b.lat, lng: b.lng, sublabel: `Bridge · ${b.river}` });
  const lk = data.restrictions.lock;
  out.push({ kind: 'lock', id: lk.id, name: lk.name, lat: lk.lat, lng: lk.lng, sublabel: 'Lock' });
  for (const m of data.moorings)
    out.push({ kind: 'mooring', id: m.id, name: m.name, lat: m.lat, lng: m.lng, sublabel: TIER_LABEL[m.tier] ?? 'Mooring' });
  for (const p of data.pois)
    out.push({ kind: 'poi', id: p.id, name: p.name, lat: p.lat, lng: p.lng, sublabel: POI_LABEL[p.kind] ?? 'Place' });
  return out;
}

/** all chars of `q` appear in order within `n` (both lower-cased) */
function isSubsequence(q: string, n: string): boolean {
  let i = 0;
  for (let j = 0; j < n.length && i < q.length; j++) if (n[j] === q[i]) i++;
  return i === q.length;
}

// Higher is better; -1 means no match. Shorter names win ties (subtract length).
function score(query: string, name: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return -1;
  if (n === q) return 1000 - n.length;
  if (n.startsWith(q)) return 800 - n.length;
  const words = n.split(/[\s(/,.&'’–-]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 600 - n.length;
  const idx = n.indexOf(q);
  if (idx >= 0) return 400 - idx - n.length * 0.1;
  if (q.length >= 3 && isSubsequence(q, n)) return 200 - n.length * 0.1;
  return -1;
}

/** Ranked search over a prebuilt index. Empty/whitespace query → no results. */
export function searchIndex(index: SearchEntry[], query: string, limit = 12): SearchEntry[] {
  if (!query.trim()) return [];
  return index
    .map((entry) => ({ entry, s: score(query, entry.name) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.entry);
}
