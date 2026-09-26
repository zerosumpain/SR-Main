export interface ChartFilters {
  kind: string;
  q: string;
  from: string;
  to: string;
  impact?: string;
  via?: string;
}

/** Monday and Sunday of an ISO week, both inclusive UTC dates. */
export function weekDates(week: string): { from: string; to: string } {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) throw new Error(`Invalid ISO week: ${week}`);
  const year = Number(match[1]);
  const number = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (number - 1) * 7);
  const from = jan4.toISOString().slice(0, 10);
  jan4.setUTCDate(jan4.getUTCDate() + 6);
  return { from, to: jan4.toISOString().slice(0, 10) };
}

/** Chart links use the same URL grammar as the filter form, and reset paging. */
export function chartHref(filters: ChartFilters, patch: Partial<ChartFilters>): string {
  const merged = { ...filters, ...patch };
  const params = new URLSearchParams();
  for (const key of ['q', 'kind', 'impact', 'via', 'from', 'to'] as const) {
    const value = merged[key];
    if (value && value !== 'all') params.set(key, value);
  }
  const query = params.toString();
  return `/releases${query ? `?${query}` : ''}#release-log`;
}

export function weekHref(filters: ChartFilters, week: string): string {
  const range = weekDates(week);
  const active = filters.from === range.from && filters.to === range.to;
  return chartHref(filters, active ? { from: '', to: '' } : range);
}

export function kindHref(filters: ChartFilters, kind: string): string {
  return chartHref(filters, { kind: filters.kind === kind ? 'all' : kind });
}
