import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import HealthDashboard from './HealthDashboard.svelte';
import type { OwnerHealthData } from './types';

// The repo's documented fabrication failure mode, on the one page that exists
// to be trusted: with no real day in the 30-day window `getHealthSeries30d`
// substitutes a deterministic MOCK series — plus workouts and rings — so the
// page still renders on a cold start or through a sync outage, and stamps
// `provenance.seriesIsMock`. The anonymous landing has labelled that state
// since it shipped. The owner dashboard did not, so the owner was the ONLY
// reader shown invented figures presented as measurements.
const BANNER = 'Nothing below is a measurement';

function ownerData(over: Partial<OwnerHealthData> = {}): OwnerHealthData {
  return {
    dashboardUpdatedAt: '2026-08-31T14:23:45.000Z',
    provenance: { seriesIsMock: false, correlationsAreIllustrative: false },
    today: null,
    series: [],
    rhrBaseline: 0,
    todayDeltas: null,
    syncedAgoSeconds: 300,
    readiness: null,
    volume: null,
    dashboard: null,
    acwr: null,
    monotony: null,
    polarised: null,
    sleepRegularity: null,
    circadian: null,
    autonomic: null,
    recoveryDebt: null,
    vo2max: null,
    forecast: { sleep: null, hrv: null, vo2max: null, acwr: null },
    moves: [],
    tripwires: [],
    experiments: [],
    verdict: null,
    segmentForms: null,
    segments: null,
    chains: [],
    coach: null,
    ...over,
  };
}

const html = (data: OwnerHealthData) => render(HealthDashboard, { props: { data } }).body;

describe('HealthDashboard — refresh flag', () => {
  it('shows when this dashboard payload was assembled in the footer', () => {
    const body = html(ownerData());
    expect(body).toContain('Dashboard updated 31 Aug 2026, 15:23:45 BST');
  });
});

describe('HealthDashboard — mock-series provenance', () => {
  it('says so, prominently, when the series it is drawing is a fake', () => {
    const body = html(ownerData({ provenance: { seriesIsMock: true, correlationsAreIllustrative: false } }));
    expect(body).toContain(BANNER);
    expect(body).toContain('Sample data');
  });

  it('uses the same words the anonymous landing uses for the same state', () => {
    const body = html(ownerData({ provenance: { seriesIsMock: true, correlationsAreIllustrative: false } }));
    expect(body).toContain(
      'Sample data — no readings have synced into this window yet. Nothing below is a measurement.',
    );
  });

  it('stops claiming a live sync while the numbers are invented', () => {
    // A "Whoop · Apple · Strava" live dot over fabricated data is the specific
    // combination that makes a mock series read as a measurement.
    const mock = html(ownerData({ provenance: { seriesIsMock: true, correlationsAreIllustrative: false } }));
    expect(mock).not.toContain('Whoop · Apple · Strava');
    const real = html(ownerData());
    expect(real).toContain('Whoop · Apple · Strava');
  });

  it('shows no banner at all on real data — it is a warning, not furniture', () => {
    const body = html(ownerData());
    expect(body).not.toContain(BANNER);
    expect(body).not.toContain('Sample data');
  });

  it('leaves the illustrative-correlations flag alone: it is a different claim', () => {
    // The loader already drops illustrative correlations from the owner payload
    // outright, so this flag must not raise the series banner on its own.
    const body = html(ownerData({ provenance: { seriesIsMock: false, correlationsAreIllustrative: true } }));
    expect(body).not.toContain(BANNER);
  });

  it('renders the banner ahead of the first section, not buried in the page', () => {
    const body = html(ownerData({ provenance: { seriesIsMock: true, correlationsAreIllustrative: false } }));
    const banner = body.indexOf('Sample data');
    const firstSection = body.indexOf('State of play');
    expect(banner).toBeGreaterThan(-1);
    if (firstSection > -1) expect(banner).toBeLessThan(firstSection);
  });
});
