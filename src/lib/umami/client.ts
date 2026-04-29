import { createTTLCache } from './cache';

export type Stats = { pageviews: number; visitors: number };
export type DailyView = { date: string; count: number };
export type Referrer = { name: string; count: number };

type Init = {
  baseUrl: string;
  websiteId: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  ttlMs?: number;
};

export type UmamiClient = {
  getStatsForPath(path: string, days: number): Promise<Stats>;
  getStatsBatch(paths: string[], days: number): Promise<Record<string, Stats>>;
  getTopReferrers(path: string, days: number, limit?: number): Promise<Referrer[]>;
  getDailyViews(path: string, days: number): Promise<DailyView[]>;
};

export function createUmamiClient(init: Init): UmamiClient {
  const fetchFn = init.fetchFn ?? fetch;
  const cache = createTTLCache<string, unknown>({ ttlMs: init.ttlMs ?? 5 * 60 * 1000 });

  const range = (days: number): { startAt: number; endAt: number } => {
    const endAt = Date.now();
    const startAt = endAt - days * 24 * 60 * 60 * 1000;
    return { startAt, endAt };
  };

  async function call<T>(pathAndQuery: string): Promise<T | null> {
    try {
      const res = await fetchFn(`${init.baseUrl}${pathAndQuery}`, {
        headers: { Authorization: `Bearer ${init.apiKey}` },
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  const getStatsForPath: UmamiClient['getStatsForPath'] = (path, days) =>
    cache.getOrLoad(`stats|${path}|${days}`, async () => {
      const { startAt, endAt } = range(days);
      const q = `?startAt=${startAt}&endAt=${endAt}&url=${encodeURIComponent(path)}`;
      const r = await call<{ pageviews: { value: number }; visitors: { value: number } }>(
        `/api/websites/${init.websiteId}/stats${q}`,
      );
      if (!r) return { pageviews: 0, visitors: 0 };
      return { pageviews: r.pageviews?.value ?? 0, visitors: r.visitors?.value ?? 0 };
    }) as Promise<Stats>;

  const getStatsBatch: UmamiClient['getStatsBatch'] = async (paths, days) => {
    const entries = await Promise.all(paths.map(async (p) => [p, await getStatsForPath(p, days)] as const));
    return Object.fromEntries(entries);
  };

  const getTopReferrers: UmamiClient['getTopReferrers'] = (path, days, limit = 5) =>
    cache.getOrLoad(`refs|${path}|${days}|${limit}`, async () => {
      const { startAt, endAt } = range(days);
      const q = `?startAt=${startAt}&endAt=${endAt}&type=referrer&url=${encodeURIComponent(path)}&limit=${limit}`;
      const r = await call<Array<{ x: string; y: number }>>(
        `/api/websites/${init.websiteId}/metrics${q}`,
      );
      if (!r) return [];
      return r.map((row) => ({ name: row.x || '(direct)', count: row.y }));
    }) as Promise<Referrer[]>;

  const getDailyViews: UmamiClient['getDailyViews'] = (path, days) =>
    cache.getOrLoad(`daily|${path}|${days}`, async () => {
      const { startAt, endAt } = range(days);
      const q = `?startAt=${startAt}&endAt=${endAt}&unit=day&timezone=Europe/London&url=${encodeURIComponent(path)}`;
      const r = await call<{ pageviews: Array<{ x: string; y: number }> }>(
        `/api/websites/${init.websiteId}/pageviews${q}`,
      );
      if (!r?.pageviews) return [];
      return r.pageviews.map((row) => ({ date: row.x, count: row.y }));
    }) as Promise<DailyView[]>;

  return { getStatsForPath, getStatsBatch, getTopReferrers, getDailyViews };
}

let singleton: UmamiClient | null = null;

export function getUmami(): UmamiClient | null {
  if (singleton) return singleton;
  const baseUrl = process.env.UMAMI_API_BASE;
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  const apiKey = process.env.UMAMI_API_KEY;
  if (!baseUrl || !websiteId || !apiKey) return null;
  singleton = createUmamiClient({ baseUrl, websiteId, apiKey });
  return singleton;
}
