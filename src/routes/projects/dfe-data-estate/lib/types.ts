// Shared, client-safe types for the DfE Data Estate page.
// (The live fetchers live in live.server.ts; the page only imports these types.)

export interface ResolvedStat {
  id: string;
  label: string;
  value: number;
  detail?: string;
  source: string;
  sourceUrl: string;
  api: string; // short descriptor shown on the chip, e.g. "REST · /api/v1/jobs.json"
  apiUrl: string; // the actual endpoint the number came from
  live: boolean; // true = fetched fresh this request; false = snapshot fallback
  asOf: string; // date the snapshot was captured (shown when !live)
}

export interface Publication {
  title: string;
  slug: string;
  url: string;
  lastPublished: string | null; // ISO date
  summary?: string;
}

export interface EstatePayload {
  stats: ResolvedStat[];
  publications: Publication[];
  publicationsLive: boolean;
  fetchedAt: string; // ISO timestamp of this load
}
