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

/** The same document as an anonymous visitor gets it: sections A–F, H, I. */
const publicHtml = (data: OwnerHealthData) =>
  render(HealthDashboard, { props: { data, audience: 'public' } }).body;

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

// ---------------------------------------------------------------------------
// The public audience — 2026-09-02.
//
// The loader has already withheld the data behind sections F and G, so these
// assertions are about the half a payload cannot reach: the header nav into
// owner-gated children, and the FIXED editorial copy inside RoutesPlan, which
// names real trail corridors near home and would have rendered in full behind a
// null `coach`.

/** Every place name hardcoded into `RoutesPlan.svelte`'s four route cards. */
const HOME_GROUND = ['Darlington', 'Teesdale', 'Tees riverside', 'North York Moors', 'Cleveland Way'];

describe('HealthDashboard — the public audience', () => {
  it('does not render section G, or any of the ground it names', () => {
    const body = publicHtml(ownerData());
    for (const place of HOME_GROUND) {
      expect(body).not.toContain(place);
    }
    expect(body).not.toContain('Routes &amp; plan');
    expect(body).not.toContain('discovery radius');
  });

  it('still renders section G for the owner — this is a split, not a deletion', () => {
    const body = html(ownerData());
    expect(body).toContain('Darlington');
  });

  it('offers no way into the owner-only children', () => {
    const body = publicHtml(ownerData());
    for (const child of [
      '/health/activities',
      '/health/segments',
      '/health/plan',
      '/health/routes',
      '/health/record',
    ]) {
      expect(body).not.toContain(`href="${child}"`);
    }
  });

  it('keeps the nav for the owner', () => {
    expect(html(ownerData())).toContain('href="/health/activities"');
  });

  it('closes the section lettering up rather than leaving a hole where G was', () => {
    const body = publicHtml(
      ownerData({
        experiments: [
          {
            id: 'sleep-window',
            code: 'X1',
            state: 'LIVE',
            title: 'Fixed wake time',
            hypothesis: 'A fixed wake time lifts the regularity index.',
            change: 'Wake at 06:30 daily.',
            measure: 'SRI over 21 days.',
            horizon: '21 days',
            entry: null,
          },
        ] as unknown as OwnerHealthData['experiments'],
        verdict: {
          headline: ['HOLDING', 'sleep is the lever'],
          body: ['One paragraph.'],
          pullQuoteLabel: 'The one thing',
          pullQuote: 'Hold the window.',
          pullQuoteFollow: 'Everything else follows it.',
          reviews: [],
        },
      }),
    );
    expect(body).toContain('G / Experiments');
    expect(body).toContain('H / The verdict');
    expect(body).not.toContain('H / Experiments');
    expect(body).not.toContain('I / The verdict');
  });

  it('says how far the document runs, in the kicker and in the footer', () => {
    const body = publicHtml(ownerData());
    expect(body).toContain('sections A–H');
    expect(body).not.toContain('sections A–I');
    expect(body).toContain('routes and locations withheld');
  });

  it('carries the methodology drawer, which is the one thing kept from the old page', () => {
    expect(publicHtml(ownerData())).toContain('How these numbers are computed');
    // The owner reaches methodology from the activity pages; adding a second
    // entry point here would have changed a surface this work did not touch.
    expect(html(ownerData())).not.toContain('How these numbers are computed');
  });

  it('withholds the gettable board rather than claiming there is nothing on it', () => {
    const forms = {
      gettable: 2,
      improving: 9,
      withForm: 61,
      nearest: null,
      taxonomy: { improving: 9, holding: 22, slipping: 30, noRead: 326, total: 387 },
      board: [],
    };
    const body = publicHtml(ownerData({ segmentForms: forms }));
    // The four counts are the same document for everybody.
    expect(body).toContain('387');
    expect(body).toContain('so it is withheld');
    // The empty-board copy is a claim about the corpus, and it would be false.
    expect(body).not.toContain('Nothing clears all four today');
  });
});
