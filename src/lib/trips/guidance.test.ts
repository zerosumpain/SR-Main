import { describe, expect, it } from 'vitest';
import {
  decoratePlan,
  guidanceDates,
  legKey,
  legsLacking,
  localMinutes,
  readLegWords,
  readStopGuide,
  readTripGuide,
  routerGuidance,
  stepsFromMotis,
  stepsFromOrs,
  transitFromMotis,
} from './guidance';
import type { LegGuidance, PlannedLeg, SolvedPlan } from './model';
import { emptyFacts } from './research';

const A = { lat: 41.895, lng: 12.4716 };
const B = { lat: 41.8986, lng: 12.4769 };
const leg = (mode: PlannedLeg['mode'], over: Partial<PlannedLeg> = {}): PlannedLeg => ({ fromStopId: 'a', toStopId: 'b', mode, durationSec: 720, distanceM: 900, estimated: false, line: null, ...over });
const plan = (mode: PlannedLeg['mode'] = 'walk'): SolvedPlan => ({
  days: ['2026-10-27', '2026-10-28', '2026-10-29'].map((date) => ({
    date,
    stayId: 's',
    stops: [
      { id: 'a', kind: 'stay', wishId: null, title: 'Flat', location: A, arriveMin: 540, departMin: 540, waitSec: 0, locked: true, bookingId: null, warnings: [] },
      { id: 'b', kind: 'wish', wishId: 'b', title: 'Pantheon', location: B, arriveMin: 552, departMin: 600, waitSec: 0, locked: false, bookingId: null, warnings: [] },
    ],
    legs: [leg(mode)],
    warnings: [],
  })),
  dropped: [],
  warnings: [],
  score: 0,
});

describe('the guidance cache', () => {
  it('decorates legs by date, mode and places, and finds the ones lacking', () => {
    const g = { summary: 'x' } as LegGuidance;
    const cache = { [legKey('2026-10-28', 'walk', A, B)]: g };
    const out = decoratePlan(plan(), cache);
    expect(out.days.map((d) => d.legs[0].guidance)).toEqual([null, g, null]);
    expect(legsLacking(plan(), ['2026-10-27', '2026-10-28'], cache).map((l) => l.day.date)).toEqual(['2026-10-27']);
    // A different mode is a different leg.
    expect(legsLacking(plan('taxi'), ['2026-10-28'], cache)).toHaveLength(1);
  });

  it('makes today and tomorrow when under way, else the first two days', () => {
    expect(guidanceDates(plan(), '2026-10-14')).toEqual(['2026-10-27', '2026-10-28']);
    expect(guidanceDates(plan(), '2026-10-28')).toEqual(['2026-10-28', '2026-10-29']);
    expect(guidanceDates(plan(), '2026-11-01')).toEqual([]);
  });
});

describe('routed steps', () => {
  it('merges Transitous walking pieces into readable directions', () => {
    const steps = stepsFromMotis([
      { relativeDirection: 'CONTINUE', streetName: '', distance: 22 },
      { relativeDirection: 'CONTINUE', streetName: 'Via dei Baullari', distance: 49 },
      { relativeDirection: 'CONTINUE', streetName: 'Via dei Baullari', distance: 57 },
      { relativeDirection: 'LEFT', streetName: "Corso Vittorio Emanuele II", distance: 230 },
      { relativeDirection: 'CONTINUE', streetName: '', distance: 4 },
      { relativeDirection: 'SLIGHTLY_RIGHT', streetName: 'Piazza della Rotonda', distance: 1200 },
    ]);
    expect(steps).toEqual([
      'Head off along Via dei Baullari (110 m)',
      'Turn left onto Corso Vittorio Emanuele II (230 m)',
      'Bear right onto Piazza della Rotonda (1.2 km)',
    ]);
  });

  it('keeps openrouteservice instructions', () => {
    expect(stepsFromOrs([{ steps: [{ instruction: 'Head north on Via Giulia', distance: 120 }, { instruction: 'Arrive at your destination', distance: 0 }] }])).toEqual([
      'Head north on Via Giulia (120 m)',
      'Arrive at your destination',
    ]);
  });
});

describe('transitFromMotis', () => {
  it('names the lines, stops and the next departures in local time', () => {
    const ride = (start: string) => ({
      mode: 'BUS', routeShortName: '64', headsign: 'San Pietro', startTime: start,
      from: { name: 'Largo Argentina' }, to: { name: 'Stazione San Pietro' }, intermediateStops: [{}, {}, {}],
    });
    const its = [
      { legs: [{ mode: 'WALK', steps: [{ relativeDirection: 'LEFT', streetName: 'Via Arenula', distance: 200 }] }, ride('2026-10-27T08:05:00Z')] },
      { legs: [ride('2026-10-27T08:17:00Z')] },
      { legs: [{ mode: 'TRAM', routeShortName: '8', startTime: '2026-10-27T08:20:00Z' }] },
    ];
    expect(transitFromMotis(its, 'Europe/Rome')).toEqual({
      transit: [{ line: '64 towards San Pietro', vehicle: 'bus', fromStop: 'Largo Argentina', toStop: 'Stazione San Pietro', stops: 4, departuresMin: [545, 557] }],
      walkSteps: ['Turn left onto Via Arenula (200 m)'],
    });
    expect(transitFromMotis([], 'Europe/Rome')).toBeNull();
    expect(localMinutes('2026-10-27T08:05:00Z', 'Europe/Rome')).toBe(545);
  });
});

describe('router guidance', () => {
  const tripGuide = {
    gettingAround: 'Walk.',
    taxi: { how: 'Use the white licensed taxis at ranks.', links: [{ label: 'Call 060609', url: 'tel:060609' }], phone: '060609' },
    transitTickets: 'Buy a BIT ticket at a tabacchi and validate it on board.',
    tips: [],
    generatedAt: 'x',
  };
  it('writes a usable card for every mode without a model', () => {
    expect(routerGuidance({ leg: leg('walk'), toTitle: 'Pantheon', steps: ['a'], transit: null, tripGuide, now: 'n' })).toMatchObject({ summary: '12 min walk to Pantheon', steps: ['a'], booking: null, source: 'router' });
    expect(routerGuidance({ leg: leg('taxi', { estimated: true }), toTitle: 'Vatican', steps: [], transit: null, tripGuide, now: 'n' })).toMatchObject({
      summary: 'Taxi to Vatican, about 12 min including the wait',
      booking: tripGuide.taxi,
    });
    expect(routerGuidance({ leg: leg('taxi'), toTitle: 'X', steps: [], transit: null, tripGuide: null, now: 'n' }).booking).toEqual({
      how: 'Ask at a taxi rank or your hotel to call one; no booking details are known for this city yet.',
      links: [],
      phone: null,
    });
    const t = [{ line: '64', vehicle: 'bus' as const, fromStop: 'Largo Argentina', toStop: 'San Pietro', stops: 4, departuresMin: [] }];
    expect(routerGuidance({ leg: leg('transit'), toTitle: 'Vatican', steps: [], transit: t, tripGuide, now: 'n' })).toMatchObject({
      summary: 'Bus 64 from Largo Argentina, 4 stops, to Vatican',
      tips: [tripGuide.transitTickets],
    });
  });

  it('lets a model add words but never links, lines or steps', () => {
    const base = [routerGuidance({ leg: leg('taxi'), toTitle: 'X', steps: [], transit: null, tripGuide, now: 'n' })];
    const out = readLegWords({ legs: [{ i: 0, summary: 'Taxi from the rank on Corso', tips: ['Agree it is metered'], costText: '€15', booking: { links: [{ url: 'https://evil.example' }] } }] }, base);
    expect(out[0]).toMatchObject({ summary: 'Taxi from the rank on Corso', tips: ['Agree it is metered'], costText: null, booking: tripGuide.taxi, source: 'mixed' });
    expect(readLegWords(null, base)).toBe(base);
  });
});

describe('model-written guides keep only known links', () => {
  it('stop guide: links from the facts, official ones always offered', () => {
    const facts = { ...emptyFacts(), officialUrl: 'https://www.pantheonroma.com/', sources: [{ url: 'https://src.example/p', title: null }] };
    const g = readStopGuide({ summary: 'A Roman temple, now a church.', tips: ['Dress modestly'], links: [{ label: 'Tickets', url: 'https://www.tiqets.com/x' }, { label: 'Guide', url: 'https://src.example/p' }] }, facts, 'n');
    expect(g).toEqual({ summary: 'A Roman temple, now a church.', tips: ['Dress modestly'], links: [{ label: 'Guide', url: 'https://src.example/p' }, { label: 'Official site', url: 'https://www.pantheonroma.com/' }], generatedAt: 'n' });
    expect(readStopGuide({}, facts, 'n')).toBeNull();
  });

  it('trip guide: links and the phone number only when the search results carry them', () => {
    const results = [{ url: 'https://www.romamobilita.it/en/taxi', content: 'Licensed taxis are white. Call 06 0609 for Chiamataxi.' }];
    const g = readTripGuide(
      {
        gettingAround: 'Walk the centre; buses and two metro lines.',
        taxi: { how: 'White taxis from ranks.', links: [{ label: 'Rome taxis', url: 'https://www.romamobilita.it/en/taxi' }, { label: 'Made up', url: 'https://taxi-rome-cheap.example' }], phone: '06 0609' },
        transitTickets: 'BIT, 100 minutes.',
        tips: ['Validate'],
      },
      results,
      'n',
    );
    expect(g?.taxi).toEqual({ how: 'White taxis from ranks.', links: [{ label: 'Rome taxis', url: 'https://www.romamobilita.it/en/taxi' }, { label: 'Call 06 0609', url: 'tel:060609' }], phone: '06 0609' });
    const invented = readTripGuide({ gettingAround: 'x', taxi: { how: 'Call', phone: '+39 06 123 456 789', links: [] } }, results, 'n');
    expect(invented?.taxi).toEqual({ how: 'Call', links: [], phone: null });
  });
});

describe('batched guidance (v2.1)', () => {
  it('reads one day of stop guides from one answer, links per place', async () => {
    const { readStopGuides, guidanceOrder } = await import('./guidance');
    const f1 = { ...emptyFacts(), officialUrl: 'https://pantheon.example/' };
    const out = readStopGuides(
      { places: [{ i: 1, summary: 'Second.', tips: [], links: [{ label: 'x', url: 'https://pantheon.example/' }] }, { i: 0, summary: 'First.', tips: ['Go early'], links: [] }] },
      [f1, null, null],
      'n',
    );
    expect(out.map((g) => g?.summary ?? null)).toEqual(['First.', 'Second.', null]);
    expect(out[0]?.links).toEqual([{ label: 'Official site', url: 'https://pantheon.example/' }]);
    expect(out[1]?.links).toEqual([]); // that link belongs to another place's facts
    expect(guidanceOrder(plan(), '2026-10-28')).toEqual(['2026-10-28', '2026-10-29', '2026-10-27']);
  });
});
