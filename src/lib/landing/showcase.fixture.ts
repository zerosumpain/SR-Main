// showcase.fixture.ts — plausible, plainly synthetic figures for the local
// preview, where the synthetic database has no thinks, no ratings and no
// readings. Loaded only by showcase.server.ts inside its `dev` branch, through a
// dynamic import, so a production build never carries it, and only when the
// preview sets LANDING_SHOWCASE_FIXTURE=1. The page then shows "preview
// figures" so nobody mistakes these for the record.
//
// The app's facts are never faked: they come from the manifest and the routes
// even locally, so the fixture covers Daydream's measured figures and health only.

import { shiftDay } from './showcase-data';
import type { DaydreamShowcase, HealthShowcase } from './showcase';

/** A repeatable wobble, so the preview draws the same chart every reload. */
function wobble(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Thirty complete days ending yesterday, Mondays to Sundays of an ordinary month. */
function steps30(today: string): number[] {
  return Array.from({ length: 30 }, (_, i) => {
    const date = shiftDay(today, i - 30);
    const weekend = [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
    const base = weekend ? 11_500 : 7_800;
    return Math.round(base + (wobble(i + 1) - 0.45) * 8_000);
  });
}

/** Twelve Monday-start weeks ending this week, the first few before the loop. */
function weeks(today: string): NonNullable<DaydreamShowcase['impact']>['weeks'] {
  const d = new Date(`${today}T00:00:00Z`);
  const monday = shiftDay(today, -((d.getUTCDay() + 6) % 7));
  return Array.from({ length: 12 }, (_, i) => {
    const start = shiftDay(monday, (i - 11) * 7);
    const useful = Math.round(2 + wobble(i + 40) * 6 + i * 0.5);
    const notUseful = Math.round(1 + wobble(i + 80) * 4);
    const undecided = i === 11 ? 5 : Math.round(wobble(i + 120) * 3);
    return { start, useful, notUseful, undecided };
  });
}

export interface ShowcaseFixture {
  daydream: Pick<DaydreamShowcase, 'week' | 'impact'>;
  health: HealthShowcase;
}

export function showcaseFixture(today: string): ShowcaseFixture {
  const s30 = steps30(today);
  return {
    daydream: {
      week: { questions: 142, hours: 31.5, lookups: 1204, struckOut: 18, areasCovered: 6 },
      impact: { hitRate: 0.73, previousHitRate: 0.64, rated: 41, noticed: 58, shipped: 3, accepted: 7, weeks: weeks(today) },
    },
    health: {
      steps30: s30,
      stepsYear: 2_412_806,
      daysOver10k: 97,
      // A day months back, well outside the chart, so the two never disagree.
      bestDay: { date: shiftDay(today, -117), steps: 24_318 },
      kmYear: 1650.4,
      recovery30: { high: 17, mid: 10, low: 3 },
      sleepAvg7: 7.1,
      bands: { sleep: 'mid', recovery: 'high' },
      kinds: null,
    },
  };
}
