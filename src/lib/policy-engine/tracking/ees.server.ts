// tracking/ees.server.ts — DfE Explore Education Statistics v1 query plumbing.
// Pure builders/extractors (tested) + a thin live fetcher with the same 5s-timeout +
// finite-value discipline as dfe-data-estate/lib/live.server.ts.

import type { EesFetch, TimePeriod } from './types';

const EES_BASE = 'https://api.education.gov.uk/statistics/v1';
const FETCH_TIMEOUT_MS = 8000;

export interface EesQuery {
  url: string;
  body: {
    criteria: { and: Array<Record<string, unknown>> };
    indicators: string[];
    page: number;
    pageSize: number;
  };
}

/** Build the POST query: every pinned filter option + the time period + NAT geography. */
export function buildEesQuery(f: EesFetch): EesQuery {
  const and: Array<Record<string, unknown>> = Object.values(f.filters).map((optId) => ({
    filters: { eq: optId },
  }));
  and.push({ timePeriods: { eq: { code: f.timePeriod.code, period: f.timePeriod.period } } });
  and.push({ geographicLevels: { eq: 'NAT' } });
  return {
    url: `${EES_BASE}/data-sets/${f.datasetGuid}/query`,
    body: { criteria: { and }, indicators: [f.indicatorId], page: 1, pageSize: 1 },
  };
}

/** Read results[0].values[indicatorId] as a finite number, else null. */
export function extractEesValue(resp: unknown, indicatorId: string): number | null {
  const raw = (resp as { results?: Array<{ values?: Record<string, unknown> }> })?.results?.[0]?.values?.[indicatorId];
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Academic year → its spring/summer calendar year; calendar/financial year → as-is. */
export function refYearFromTimePeriod(tp: TimePeriod): number {
  if (tp.code === 'AY' && tp.period.includes('/')) return Number(tp.period.split('/')[1]);
  return Number(tp.period.slice(0, 4));
}

/** '2024/2025' → '2024/25'; '2024' → '2024'. */
export function refPeriodLabel(tp: TimePeriod): string {
  if (tp.code === 'AY' && tp.period.includes('/')) {
    const [a, b] = tp.period.split('/');
    return `${a}/${b.slice(2)}`;
  }
  return tp.period;
}

/** Fetch the live value for one EES indicator. Returns null on any failure (caller falls back). */
export async function fetchEesValue(f: EesFetch, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  const { url, body } = buildEesQuery(f);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return extractEesValue(json, f.indicatorId);
  } catch {
    return null;
  }
}

export interface EesPublication {
  slug: string;
  lastPublished: string | null;
}

/** The publications feed — used to detect when a dataset's data was re-released. */
export async function fetchEesPublications(fetchImpl: typeof fetch = fetch): Promise<EesPublication[]> {
  try {
    const res = await fetchImpl(`${EES_BASE}/publications?page=1&pageSize=40`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: Array<{ slug: string; lastPublished?: string }> };
    return (json.results ?? []).map((p) => ({ slug: p.slug, lastPublished: p.lastPublished ?? null }));
  } catch {
    return [];
  }
}
