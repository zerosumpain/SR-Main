export type PeriodPreset = '24h' | 'this-week' | 'last-week' | '30d' | 'last-month' | 'all';
export type Granularity = 'hour' | 'day' | 'week';

export interface ResolvedPeriod {
  preset: PeriodPreset;
  from: Date;
  to: Date;
  granularity: Granularity;
}

const VALID = new Set<PeriodPreset>(['24h', 'this-week', 'last-week', '30d', 'last-month', 'all']);

function coerce(p: string | null | undefined): PeriodPreset {
  if (p && (VALID as Set<string>).has(p)) return p as PeriodPreset;
  return '30d';
}

/** ISO week: Monday 00:00 UTC of the week containing `d`. */
function startOfISOWeekUTC(d: Date): Date {
  const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = c.getUTCDay(); // 0=Sun..6=Sat
  const delta = dow === 0 ? 6 : dow - 1;
  c.setUTCDate(c.getUTCDate() - delta);
  return c;
}

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function resolvePeriod(
  rawPreset: string | null | undefined,
  now: Date,
  earliestForAll?: Date,
): ResolvedPeriod {
  const preset = coerce(rawPreset);

  switch (preset) {
    case '24h': {
      const to = new Date(now);
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return { preset, from, to, granularity: 'hour' };
    }
    case 'this-week': {
      const from = startOfISOWeekUTC(now);
      return { preset, from, to: new Date(now), granularity: 'day' };
    }
    case 'last-week': {
      const thisStart = startOfISOWeekUTC(now);
      const from = new Date(thisStart);
      from.setUTCDate(from.getUTCDate() - 7);
      return { preset, from, to: thisStart, granularity: 'day' };
    }
    case '30d': {
      const to = new Date(now);
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { preset, from, to, granularity: 'day' };
    }
    case 'last-month': {
      const thisMonth = startOfMonthUTC(now);
      const prev = new Date(thisMonth);
      prev.setUTCMonth(prev.getUTCMonth() - 1);
      return { preset, from: prev, to: thisMonth, granularity: 'day' };
    }
    case 'all': {
      const from = earliestForAll ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const to = new Date(now);
      const spanMs = to.getTime() - from.getTime();
      const granularity: Granularity = spanMs > 90 * 24 * 60 * 60 * 1000 ? 'week' : 'day';
      return { preset, from, to, granularity };
    }
  }
}
