import { describe, expect, it } from 'vitest';
import {
  attempt,
  boardNotes,
  boardRows,
  climbMetric,
  conditionsCells,
  conditionsVerdict,
  efficiencyDeltaPct,
  effortsPerYear,
  formCards,
  formTitle,
  gettable,
  groundNote,
  identityCells,
  longDate,
  matchedSpan,
  pbStepGeometry,
  profileGeometry,
  rollingMedian,
  scatterGeometry,
  shortDate,
} from './segment-detail';
import { segmentForm } from '$lib/trails/segments/form';
import { gradientBands } from '$lib/trails/segments/gradient-bands';
import { makeTrack } from '$lib/trails/segments/fixtures';
import type { SegmentDetail, SegmentEffortRow } from '$lib/trails/segments-service';

// 2026-08-30T12:00:00Z — every relative figure below is measured from here, so
// nothing in this file depends on the clock.
const NOW = 1787054400;
const DAY = 86_400;

function effort(over: Partial<SegmentEffortRow> & { startedAt: number; durationS: number }): SegmentEffortRow {
  const iso = new Date(over.startedAt * 1000).toISOString();
  return {
    id: over.startedAt,
    activityId: `apple:${over.startedAt}`,
    activityName: 'Morning run',
    activityType: 'trail_run',
    startDateLocal: iso.slice(0, 19),
    lapIndex: 1,
    distanceM: 1840,
    speedMps: 1840 / over.durationS,
    paceSPerKm: (over.durationS / 1840) * 1000,
    avgHeartrate: 155,
    maxHeartrate: 172,
    elevationGainM: 112,
    efficiencyFactor: 1.0,
    beatsPerKm: 1000,
    temperatureC: 11,
    ...over,
  };
}

function segment(efforts: SegmentEffortRow[], over: Partial<SegmentDetail> = {}): SegmentDetail {
  return {
    id: 47,
    name: 'curlew.ochre.holloway',
    activityType: 'trail_run',
    distanceM: 1840,
    elevationGainM: 112,
    elevationLossM: 6,
    effortCount: efforts.length,
    firstEffortAt: efforts.length ? Math.min(...efforts.map((e) => e.startedAt)) : null,
    lastEffortAt: efforts.length ? Math.max(...efforts.map((e) => e.startedAt)) : null,
    polyline: null,
    descriptor: '1.84 km · +106 m climb · 63 efforts',
    terrain: 'climb',
    gradientPct: 5.8,
    offroad: true,
    bests: { durationS: null, paceSPerKm: null, efficiencyFactor: 1.01, beatsPerKm: 988 },
    form: segmentForm(efforts, { now: NOW }),
    coordinates: [],
    bounds: null,
    efforts,
    conditions: { meanC: 11.4, quickestC: 8.2, slowestC: 17.6, sample: 41 },
    ...over,
  } as SegmentDetail;
}

/** Twelve efforts, improving, with the PB 400 days back. */
function twelveEfforts(): SegmentEffortRow[] {
  const times = [860, 845, 850, 830, 835, 820, 825, 698, 790, 780, 770, 755];
  return times.map((durationS, i) =>
    effort({ startedAt: NOW - (11 - i) * 40 * DAY, durationS }),
  );
}

describe('dates', () => {
  it('splits the string rather than parsing a Date', () => {
    expect(shortDate('2025-06-14T07:12:00')).toBe('14 JUN 2025');
    expect(longDate('2026-03-08')).toBe('8 March 2026');
  });

  it('says nothing when there is no date', () => {
    expect(shortDate(null)).toBe('—');
  });
});

describe('identityCells', () => {
  it('carries a footnote on every card', () => {
    const efforts = twelveEfforts();
    const cells = identityCells(segment(efforts), NOW);
    expect(cells.map((c) => c.key)).toEqual(['pb', 'median', 'last', 'gradient', 'first']);
    expect(cells.every((c) => !!c.sub)).toBe(true);
  });

  it('lights the personal best and dates it', () => {
    const cells = identityCells(segment(twelveEfforts()), NOW);
    const pb = cells[0];
    expect(pb.lit).toBe(true);
    expect(pb.value).toBe('11:38');
    // The PB is the eighth of twelve, 160 days back, and staleness runs to now.
    expect(pb.sub).toContain('160d ago');
  });

  it('reports the descent and the net separately from the gradient', () => {
    const cells = identityCells(segment(twelveEfforts()), NOW);
    expect(cells[3].value).toBe('+5.8');
    expect(cells[3].unit).toBe('%');
    expect(cells[3].sub).toBe('−6 m descent · net +106 m');
  });

  it('survives a segment with no efforts', () => {
    const cells = identityCells(segment([], { effortCount: 0 }), NOW);
    expect(cells[0].value).toBe('—');
    expect(cells[0].sub).toBe('No efforts yet');
  });
});

describe('effortsPerYear', () => {
  it('measures the rate to now, not to the last effort', () => {
    // Twenty efforts, all inside one month, two years ago.
    const efforts = Array.from({ length: 20 }, (_, i) =>
      effort({ startedAt: NOW - 730 * DAY + i * DAY, durationS: 800 }),
    );
    expect(effortsPerYear(segment(efforts), NOW)).toBe(10);
  });
});

describe('matchedSpan', () => {
  it('collapses a single year', () => {
    const one = [effort({ startedAt: NOW - 10 * DAY, durationS: 800 })];
    expect(matchedSpan(one)).toBe('2026');
  });
});

describe('formTitle', () => {
  it('names the direction and the gap', () => {
    const form = segmentForm(twelveEfforts(), { now: NOW });
    expect(form.direction).toBe('improving');
    expect(formTitle(form)[0]).toBe('Gaining ground,');
    expect(formTitle(form)[1]).toMatch(/^Still \d+\.\d% short$/);
  });

  it('says so when there is no read', () => {
    expect(formTitle(segmentForm([], { now: NOW }))).toEqual(['Not enough', 'efforts yet']);
  });
});

describe('formCards', () => {
  it('spells the gap out in seconds', () => {
    const cards = formCards(segment(twelveEfforts()), NOW);
    const gap = cards.find((c) => c.key === 'gap')!;
    // Best of the last three is 755, PB is 698.
    expect(gap.note).toContain('Fifty-seven seconds.');
  });

  it('names the holding band when the direction is a direction', () => {
    const cards = formCards(segment(twelveEfforts()), NOW);
    expect(cards[0].note).toContain('±2% holding band');
    expect(cards[0].tone).toBe('good');
  });

  it('marks the verdict card loud and leaves the rest plain', () => {
    const cards = formCards(segment(twelveEfforts()), NOW);
    expect(cards.filter((c) => c.loud)).toHaveLength(1);
    expect(cards[3].key).toBe('gettable');
  });
});

describe('gettable', () => {
  it('names the failing test', () => {
    const verdict = gettable(segment(twelveEfforts()));
    expect(verdict.passed).toBe(false);
    expect(verdict.headline).toBe('Not yet');
    expect(verdict.note).toContain('Fails the gap test');
    expect(verdict.note).toContain('the board wants under 3%');
  });

  it('passes when the form is improving and the gap is inside 3%', () => {
    // Same shape, but the recent efforts close on the record.
    const times = [860, 845, 850, 830, 835, 820, 825, 698, 760, 730, 715, 710];
    const efforts = times.map((durationS, i) =>
      effort({ startedAt: NOW - (11 - i) * 40 * DAY, durationS }),
    );
    const verdict = gettable(segment(efforts));
    expect(verdict.passed).toBe(true);
    expect(verdict.headline).toBe('Yes');
    expect(verdict.note).toContain('Passes on sample, direction and gap');
  });

  it('fails the sample test under the six-effort floor', () => {
    const efforts = [800, 790, 780].map((durationS, i) =>
      effort({ startedAt: NOW - (2 - i) * 40 * DAY, durationS }),
    );
    const verdict = gettable(segment(efforts));
    expect(verdict.tests.find((t) => t.name === 'sample')!.passed).toBe(false);
    expect(verdict.note).toContain('Fails the sample test');
  });
});

describe('rollingMedian', () => {
  it('leaves the ends empty rather than shrinking the window', () => {
    const out = rollingMedian([5, 4, 3, 2, 1], 5);
    expect(out).toEqual([null, null, 3, null, null]);
  });
});

describe('scatterGeometry', () => {
  it('marks the PB, the most recent and every unranked effort', () => {
    const efforts = twelveEfforts();
    efforts[3] = { ...efforts[3], avgHeartrate: null, efficiencyFactor: null, beatsPerKm: null };
    const geo = scatterGeometry(efforts)!;
    expect(geo.dots).toHaveLength(12);
    expect(geo.dots.filter((d) => d.kind === 'pb')).toHaveLength(1);
    expect(geo.dots.filter((d) => d.kind === 'last')).toHaveLength(1);
    expect(geo.dots.filter((d) => d.kind === 'unranked')).toHaveLength(1);
    expect(geo.dots[3].kind).toBe('unranked');
  });

  it('puts the quickest effort nearest the top of the box', () => {
    const geo = scatterGeometry(twelveEfforts())!;
    const pb = geo.dots.find((d) => d.kind === 'pb')!;
    expect(pb.y).toBeLessThan(Math.min(...geo.dots.filter((d) => d.kind !== 'pb').map((d) => d.y)));
    expect(geo.pb!.label).toBe('PB 11:38');
  });

  it('draws nothing from a single effort', () => {
    expect(scatterGeometry([effort({ startedAt: NOW, durationS: 800 })])).toBeNull();
  });
});

describe('pbStepGeometry', () => {
  it('uses H and V commands only, so the record can never rise', () => {
    const geo = pbStepGeometry(twelveEfforts(), NOW)!;
    expect(geo.path.startsWith('M0,')).toBe(true);
    expect(geo.path).not.toMatch(/[LCQSTA]/);
    const vs = [...geo.path.matchAll(/V([\d.]+)/g)].map((m) => Number(m[1]));
    // Falling time is a falling y — every V is above the one before it.
    expect(vs).toEqual([...vs].sort((a, b) => b - a));
  });

  it('measures the flat stretch to now', () => {
    const geo = pbStepGeometry(twelveEfforts(), NOW)!;
    // The PB is 160 days back: five whole months.
    expect(geo.flat!.label).toBe('5 months flat');
  });

  it('drops the flat marker when the record has just moved', () => {
    const efforts = [900, 880, 860, 840, 820, 700].map((durationS, i) =>
      effort({ startedAt: NOW - (5 - i) * 10 * DAY, durationS }),
    );
    expect(pbStepGeometry(efforts, NOW)!.flat).toBeNull();
  });
});

describe('boardRows', () => {
  it('ranks by time with ties sharing a rank', () => {
    const efforts = [
      effort({ startedAt: NOW - 5 * DAY, durationS: 800 }),
      effort({ startedAt: NOW - 4 * DAY, durationS: 820 }),
      effort({ startedAt: NOW - 3 * DAY, durationS: 820 }),
      effort({ startedAt: NOW - 2 * DAY, durationS: 840 }),
    ];
    const rows = boardRows(efforts, true);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('blanks every HR-derived column on an unranked effort and says why', () => {
    const efforts = [
      effort({ startedAt: NOW - 5 * DAY, durationS: 800 }),
      effort({
        startedAt: NOW - 4 * DAY,
        durationS: 820,
        avgHeartrate: null,
        efficiencyFactor: null,
        beatsPerKm: null,
      }),
    ];
    const row = boardRows(efforts, true)[1];
    expect(row.unranked).toBe(true);
    expect(row.avgHeartrate).toBe('—');
    expect(row.efficiencyFactor).toBe('—');
    expect(row.beatsPerKm).toBe('—');
    expect(row.note).toBe('HR coverage under 50% · unranked');
  });

  it('badges the PB, the cheapest and the most recent', () => {
    const efforts = [
      effort({ startedAt: NOW - 5 * DAY, durationS: 800, beatsPerKm: 1100, efficiencyFactor: 0.9 }),
      effort({ startedAt: NOW - 4 * DAY, durationS: 820, beatsPerKm: 900, efficiencyFactor: 1.1 }),
      effort({ startedAt: NOW - 3 * DAY, durationS: 840, beatsPerKm: 1000, efficiencyFactor: 1.0 }),
    ];
    const rows = boardRows(efforts, true);
    expect(rows[0].badges.map((b) => b.text)).toContain('PB time');
    const cheapest = rows.find((r) => r.badges.some((b) => b.text === 'Cheapest'))!;
    expect(cheapest.badges.map((b) => b.text)).toContain('1st EF');
    expect(rows.find((r) => r.isLast)!.badges.map((b) => b.text)).toContain('Most recent');
  });

  it('marks a shared EF rank with an equals sign', () => {
    const efforts = [
      effort({ startedAt: NOW - 5 * DAY, durationS: 800, efficiencyFactor: 1.01 }),
      effort({ startedAt: NOW - 4 * DAY, durationS: 820, efficiencyFactor: 1.01 }),
      effort({ startedAt: NOW - 3 * DAY, durationS: 840, efficiencyFactor: 0.9 }),
    ];
    const rows = boardRows(efforts, true);
    expect(rows.filter((r) => r.badges.some((b) => b.text === '=1st EF'))).toHaveLength(2);
  });

  it('prints speed rather than pace outside the pace sports', () => {
    const rows = boardRows([effort({ startedAt: NOW, durationS: 800 })], false);
    expect(rows[0].pace).toContain('km/h');
  });
});

describe('boardNotes', () => {
  it('only explains a tie when the board is showing one', () => {
    const efforts = twelveEfforts().map((e, i) => ({ ...e, efficiencyFactor: 0.9 + i * 0.01 }));
    expect(boardNotes(efforts).map((n) => n.key)).not.toContain('tie');
  });

  it('explains the unranked row by naming its date', () => {
    const efforts = twelveEfforts();
    efforts[2] = { ...efforts[2], avgHeartrate: null };
    const note = boardNotes(efforts).find((n) => n.key === 'unranked')!;
    expect(note.text).toContain(longDate(efforts[2].startDateLocal));
    expect(note.text).toContain('50%');
  });

  it('calls out the effort that was cheaper than the record', () => {
    const efforts = twelveEfforts().map((e, i) =>
      i === 11 ? { ...e, efficiencyFactor: 1.4, avgHeartrate: 140 } : e,
    );
    const note = boardNotes(efforts).find((n) => n.key === 'record')!;
    expect(note.text).toContain('fewer beats per minute');
    expect(note.text).toContain('That is fitness.');
  });
});

describe('profileGeometry', () => {
  const track = makeTrack(
    [
      [0, 0],
      [0, 1800],
    ],
    { ele: (d) => 78 + (d / 1800) * 106, spacingM: 10 },
  );

  it('draws a line and a closed area from the stored trace', () => {
    const geo = profileGeometry(track)!;
    expect(geo.line.split(' ').length).toBeGreaterThan(12);
    expect(geo.area.endsWith('Z')).toBe(true);
    expect(geo.startY).toBeGreaterThan(geo.endY);
  });

  it('labels the ends with elevation and the middle with distance', () => {
    const geo = profileGeometry(track)!;
    expect(geo.startLabel).toBe('78 m');
    expect(geo.endLabel).toBe('184 m');
    expect(geo.midLabel).toMatch(/^9\d\d m$/);
  });

  it('leaves the steepest quarter unmarked on even ground', () => {
    const flat = makeTrack(
      [
        [0, 0],
        [0, 1000],
      ],
      { ele: () => 40, spacingM: 10 },
    );
    expect(profileGeometry(flat)!.steepestX).toBeNull();
  });

  it('returns nothing when there is no trace to read', () => {
    expect(profileGeometry([])).toBeNull();
    expect(profileGeometry(null)).toBeNull();
  });
});

describe('groundNote', () => {
  it('binds the band strip to the real breakdown', () => {
    const track = makeTrack(
      [
        [0, 0],
        [0, 1800],
      ],
      { ele: (d) => 78 + (d / 1800) * 106, spacingM: 10 },
    );
    const bands = gradientBands(track);
    const note = groundNote(segment(twelveEfforts()), profileGeometry(track), bands);
    expect(note).toContain('off-road by sport');
    expect(note).toContain('steepest chord');
    expect(note).not.toContain('proposed');
  });
});

describe('conditions', () => {
  it('reads the difference as quickest minus slowest', () => {
    const cells = conditionsCells({ meanC: 11.4, quickestC: 8.2, slowestC: 17.6, sample: 41 })!;
    expect(cells.map((c) => c.value)).toEqual(['11.4', '8.2', '17.6', '−9.4']);
    expect(cells[1].lit).toBe(true);
  });

  it('claims nothing below the sample floor', () => {
    expect(conditionsCells({ meanC: 11, quickestC: 9, slowestC: 14, sample: 2 })).toBeNull();
  });

  it('spells the verdict out', () => {
    expect(conditionsVerdict({ meanC: 11.4, quickestC: 8.2, slowestC: 17.6, sample: 41 })).toBe(
      'Nine degrees cooler on the quick days. Worth knowing before booking the attempt.',
    );
  });
});

describe('comparable ground', () => {
  it('measures another segment against this one, better positive', () => {
    expect(efficiencyDeltaPct(1.06, 1.0)).toBeCloseTo(6, 5);
    expect(efficiencyDeltaPct(null, 1.0)).toBeNull();
    expect(efficiencyDeltaPct(1.06, null)).toBeNull();
  });

  it('drops EF from the metric span outside the pace sports', () => {
    expect(
      climbMetric({ distanceM: 1700, gradientPct: 5.8, bests: { efficiencyFactor: null } }),
    ).toBe('1.70 km · +5.8%');
  });
});

describe('attempt', () => {
  it('spells the gap, and every clause traces to a number', () => {
    const seg = segment(twelveEfforts());
    const out = attempt(seg, null, NOW)!;
    expect(out.headline).toEqual(['fifty-seven', 'seconds']);
    expect(out.rows.map((r) => r.label)).toEqual(['When', 'How', 'Target']);
    expect(out.rows[0].text).toContain('8.2°C against 17.6°C');
    expect(out.rows[2].text).toContain('inside the 3%');
  });

  it('targets three percent off the record and places it on the board', () => {
    const out = attempt(segment(twelveEfforts()), null, NOW)!;
    // PB 698s + 3% = 719s = 11:59, and only the PB itself is quicker.
    expect(out.rows[2].text).toContain('11:59');
    expect(out.rows[2].text).toContain('2nd on the board');
  });

  it('says so when the record is the recent one', () => {
    const times = [860, 845, 850, 830, 835, 820, 825, 810, 800, 790, 780, 698];
    const efforts = times.map((durationS, i) =>
      effort({ startedAt: NOW - (11 - i) * 40 * DAY, durationS }),
    );
    const out = attempt(segment(efforts), null, NOW)!;
    expect(out.headline).toEqual(['The record is', 'the recent one']);
  });

  it('renders nothing on a segment with one effort', () => {
    expect(attempt(segment([effort({ startedAt: NOW, durationS: 800 })]), null, NOW)).toBeNull();
  });
});
