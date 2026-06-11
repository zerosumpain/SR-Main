import { describe, it, expect } from 'vitest';
import { buildEesQuery, extractEesValue, refYearFromTimePeriod, refPeriodLabel } from './ees.server';
import type { EesFetch } from './types';

const a8Total: EesFetch = {
  kind: 'ees',
  datasetGuid: '19e39901-560d-f972-b6f3-dd085539c095',
  publicationSlug: 'key-stage-4-performance',
  timePeriod: { code: 'AY', period: '2024/2025' },
  indicatorId: 'H21zL',
  filters: { eWguS: 'pmYIS', OYzCL: 'oQRmX' },
};

describe('buildEesQuery', () => {
  it('targets the data-set query endpoint for the dataset GUID', () => {
    const { url } = buildEesQuery(a8Total);
    expect(url).toBe('https://api.education.gov.uk/statistics/v1/data-sets/19e39901-560d-f972-b6f3-dd085539c095/query');
  });

  it('emits one filter clause per pinned option, plus time period and NAT geography', () => {
    const { body } = buildEesQuery(a8Total);
    expect(body.criteria.and).toContainEqual({ filters: { eq: 'pmYIS' } });
    expect(body.criteria.and).toContainEqual({ filters: { eq: 'oQRmX' } });
    expect(body.criteria.and).toContainEqual({ timePeriods: { eq: { code: 'AY', period: '2024/2025' } } });
    expect(body.criteria.and).toContainEqual({ geographicLevels: { eq: 'NAT' } });
    expect(body.indicators).toEqual(['H21zL']);
    expect(body.pageSize).toBe(1);
  });
});

describe('extractEesValue', () => {
  it('reads results[0].values[indicatorId] as a number', () => {
    const resp = { results: [{ values: { H21zL: '46', fLjYF: '45.4' } }] };
    expect(extractEesValue(resp, 'H21zL')).toBe(46);
    expect(extractEesValue(resp, 'fLjYF')).toBeCloseTo(45.4, 4);
  });

  it('returns null on a missing or non-numeric value', () => {
    expect(extractEesValue({ results: [] }, 'H21zL')).toBeNull();
    expect(extractEesValue({ results: [{ values: { H21zL: 'z' } }] }, 'H21zL')).toBeNull();
    expect(extractEesValue(null, 'H21zL')).toBeNull();
  });
});

describe('time period helpers', () => {
  it('derives the calendar reference year (academic year → its spring/summer year)', () => {
    expect(refYearFromTimePeriod({ code: 'AY', period: '2024/2025' })).toBe(2025);
    expect(refYearFromTimePeriod({ code: 'CY', period: '2024' })).toBe(2024);
  });

  it('formats a compact period label', () => {
    expect(refPeriodLabel({ code: 'AY', period: '2024/2025' })).toBe('2024/25');
    expect(refPeriodLabel({ code: 'CY', period: '2024' })).toBe('2024');
  });
});
