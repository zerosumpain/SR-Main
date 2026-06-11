// tracking/sources.server.ts — live fetchers for the non-EES sources. Each returns null
// on any failure so the ingest orchestrator can fall back to the last snapshot.

import ExcelJS from 'exceljs';

const TIMEOUT_MS = 15000;
const timeout = () => AbortSignal.timeout(TIMEOUT_MS);

export interface ObservedPoint {
  value: number;
  refYear: number;
  refPeriodLabel: string;
  releaseDate: string | null;
}

const ONS_NEET_BASE =
  'https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/datasets/youngpeoplenotineducationemploymentortrainingneettable1/current';

const NEET_COL: Record<'level' | 'unemployed' | 'inactive' | 'rate', number> = {
  level: 2, unemployed: 3, inactive: 4, rate: 6, // 1-indexed exceljs columns on the "People - SA" sheet (Aged 16-24)
};

const QUARTER_RE = /^[A-Z][a-z]{2}-[A-Z][a-z]{2}\s+(\d{4})$/;

/** ONS Table NEET 1 (xlsx). UK, seasonally adjusted, Aged 16-24 — latest quarter. */
export async function fetchOnsNeet(
  field: 'level' | 'unemployed' | 'inactive' | 'rate',
  fetchImpl: typeof fetch = fetch,
): Promise<ObservedPoint | null> {
  try {
    const manifest = (await (await fetchImpl(`${ONS_NEET_BASE}/data`, { signal: timeout() })).json()) as {
      downloads?: Array<{ file?: string }>;
    };
    const file = manifest?.downloads?.[0]?.file;
    if (!file) return null;
    const url = `https://www.ons.gov.uk/file?uri=/employmentandlabourmarket/peoplenotinwork/unemployment/datasets/youngpeoplenotineducationemploymentortrainingneettable1/current/${file}`;
    const res = await fetchImpl(url, { signal: timeout() });
    if (!res.ok) return null;
    const wb = new ExcelJS.Workbook();
    // exceljs's bundled Buffer typing conflicts with @types/node's; bypass the defs mismatch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as any);
    const ws = wb.worksheets.find((w) => /People.*SA/i.test(w.name));
    if (!ws) return null;

    // publication date sits in row 2 (the first ISO-looking cell)
    let releaseDate: string | null = null;
    const pubRow = ws.getRow(2).values as unknown[];
    for (const c of pubRow) {
      if (c instanceof Date) { releaseDate = c.toISOString(); break; }
      if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(c)) { releaseDate = new Date(c).toISOString(); break; }
    }

    // walk to the last data row with a quarter label + a finite value in the wanted column
    let best: ObservedPoint | null = null;
    ws.eachRow((row) => {
      const vals = row.values as unknown[]; // 1-indexed
      const label = typeof vals[1] === 'string' ? vals[1].trim() : '';
      const m = QUARTER_RE.exec(label);
      if (!m) return;
      const raw = vals[NEET_COL[field]];
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return;
      best = { value: n, refYear: Number(m[1]), refPeriodLabel: label, releaseDate };
    });
    return best;
  } catch {
    return null;
  }
}

/** World Bank Open Data — latest non-null value for an indicator/country. */
export async function fetchWorldBank(
  indicator: string,
  country: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ObservedPoint | null> {
  try {
    const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicator}?format=json&date=2015:2025&per_page=100`;
    const res = await fetchImpl(url, { signal: timeout() });
    if (!res.ok) return null;
    const json = (await res.json()) as [unknown, Array<{ value: number | null; date: string }> | null];
    const rows = json?.[1] ?? [];
    // rows come newest-first; take the first non-null
    for (const r of rows) {
      if (r.value != null && Number.isFinite(r.value)) {
        return { value: r.value, refYear: Number(r.date), refPeriodLabel: r.date, releaseDate: null };
      }
    }
    return null;
  } catch {
    return null;
  }
}
