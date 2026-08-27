import { describe, it, expect } from 'vitest';
import { validateAction, fromProposedAction, toProposedAction } from '../actions';
import { assemblePack, renderPack, type PackInputs } from './pack';
import { validatePonderOutput, MAX_MUSINGS } from './schema';
import { assembleProfile } from './profile';
import type { DaydreamSnapshot } from '../snapshot-types';

// A minimal but realistic snapshot for pack assembly.
function snap(over: Partial<DaydreamSnapshot> = {}): DaydreamSnapshot {
  const NOW = new Date('2026-08-27T10:00:00Z');
  return {
    now: NOW,
    localDate: '2026-08-27',
    localDay: 3,
    localHour: 11,
    isWeekday: true,
    current: {
      ts: NOW, lat: 54.5, lon: -1.5, mode: 'still', isHome: true,
      placeId: 'p-home', accuracyM: 10, ageMins: 3,
    },
    trail: [],
    trailDays: 30,
    trailSpanDays: 30,
    places: [
      {
        id: 'p-home', lat: 54.5, lon: -1.5, radiusM: 200, label: 'Home', kind: 'home',
        source: 'confirmed', visitCount: 40, distinctDays: 40, medianDwellMins: 600,
        dayHistogram: [], hourHistogram: [], firstSeenAt: null, lastSeenAt: null, status: 'active',
      },
    ],
    coverage: { last24h: 0.9, last7d: 0.9 },
    health: {
      lastNightSleep: { performance: 71, durationMins: 402 },
      sleepBaseline: 80,
      readiness: { score: 44, label: 'Recovery Priority' },
      daysSinceWorkout: 4,
      trainingLoad: null,
    },
    calendar: { events: [], partial: false, available: true },
    interests: [],
    offers: { available: true, items: [] },
    memories: [{ id: 'm1', category: 'people', content: 'Jemima swims on Tuesdays.' }],
    emailFacts: {
      available: true,
      upcoming: [{ id: 'te1', date: '2026-09-12', type: 'renewal', title: 'Car insurance renewal £744', noteId: 'n1' }],
      recent: [],
    },
    spend: {
      available: true,
      recent: [{ id: 's1', day: '2026-08-26', merchant: 'Tesco', amountMinor: 1250, currency: 'GBP' }],
      totalMinor30d: 4200,
    },
    family: {
      available: true,
      members: [
        { subject: 'katie', isHome: false, placeLabel: null, distanceHomeKm: 4.2, ageMins: 5, lastSeenAt: NOW },
        { subject: 'rory', isHome: null, placeLabel: null, distanceHomeKm: null, ageMins: null, lastSeenAt: null },
      ],
    },
    sources: [],
    ...over,
  };
}

function inputs(over: Partial<PackInputs> = {}): PackInputs {
  return {
    snapshot: snap(),
    verdicts: [{ id: 'h1', question: 'Do busy days cost sleep?', verdict: 'refuted', summary: null }],
    aggregates: [{ key: 'sleep7', text: 'Average sleep last 7 days: 6.7h a night.' }],
    weekAhead: [{ title: 'Dentist', whenText: '2026-08-29 14:00', location: null }],
    feedbackLines: [],
    profileLines: [],
    ...over,
  };
}

describe('assemblePack', () => {
  it('cards every feed with sequential ids and no coordinates', () => {
    const pack = assemblePack(inputs());
    expect(pack.cards.length).toBeGreaterThan(8);
    expect(pack.cards[0].id).toBe('F1');
    const text = renderPack(pack);
    expect(text).toContain('Katie is out, 4.2 km from home');
    expect(text).toContain('Rory: not tracked right now');
    expect(text).toContain('Car insurance renewal');
    expect(text).toContain('£12.50');
    // The one leak that would actually matter.
    expect(text).not.toMatch(/54\.5|-1\.5/);
  });

  it('distinguishes an untracked member from an away one', () => {
    const pack = assemblePack(inputs());
    const rory = pack.cards.find((c) => c.ref.id === 'rory');
    expect(rory?.text).toContain('not tracked');
  });
});

describe('validatePonderOutput — the citation audit', () => {
  const pack = assemblePack(inputs());
  const good = {
    slug: 'insurance-vs-last-year',
    theme: 'money',
    title: 'Insurance renewal worth a look',
    salience: 0.7,
    text: 'The car insurance renews on 12 Sep and recent spend is light — worth a comparison run before it auto-renews.',
    cites: ['F1', 'F2'],
  };

  it('keeps a musing whose citations resolve, building a code-side explanation', () => {
    const out = validatePonderOutput({ musings: [good] }, pack);
    expect(out.musings).toHaveLength(1);
    const c = out.musings[0].candidate;
    expect(c.kind).toBe('musing_money');
    expect(c.dedupeKey).toBe('musing:insurance-vs-last-year');
    expect(c.explanation).toContain('Drawn from 2 cited facts');
    expect(c.evidence).toHaveLength(2);
  });

  it('kills a musing citing a card that does not exist — whole, not repaired', () => {
    const out = validatePonderOutput({ musings: [{ ...good, cites: ['F1', 'F999'] }] }, pack);
    expect(out.musings).toHaveLength(0);
    expect(out.rejected[0]).toContain('F999');
  });

  it('kills an uncited musing', () => {
    const out = validatePonderOutput({ musings: [{ ...good, cites: [] }] }, pack);
    expect(out.musings).toHaveLength(0);
    expect(out.rejected[0]).toContain('no citations');
  });

  it('refuses a theme outside the closed set — mutes must mean something', () => {
    const out = validatePonderOutput({ musings: [{ ...good, theme: 'gossip' }] }, pack);
    expect(out.musings).toHaveLength(0);
  });

  it('caps musings per run', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...good, slug: `m-${i}` }));
    const out = validatePonderOutput({ musings: many }, pack);
    expect(out.musings).toHaveLength(MAX_MUSINGS);
  });

  it('validates leads against the sweep metric allow-list', () => {
    const out = validatePonderOutput(
      {
        leads: [
          { leadKey: 'busy-sleep', title: 'Busy days and sleep', rationale: 'Diary now in the store; test load against rest.', metrics: ['calendarBusyMinutes', 'sleepMinutes'] },
          { leadKey: 'bad', title: 'Nope', rationale: 'Uses a metric that does not exist anywhere.', metrics: ['vibes', 'sleepMinutes'] },
        ],
      },
      pack,
    );
    expect(out.leads).toHaveLength(1);
    expect(out.leads[0].leadKey).toBe('busy-sleep');
    expect(out.rejected.some((r) => r.includes('vibes'))).toBe(true);
  });

  it('refuses a malformed action on a musing but keeps the musing', () => {
    const out = validatePonderOutput(
      { musings: [{ ...good, actions: [{ kind: 'launch_missiles', params: {} }] }] },
      pack,
    );
    expect(out.musings).toHaveLength(1);
    expect(out.musings[0].candidate.proposedActions).toHaveLength(0);
    expect(out.rejected.some((r) => r.includes('launch_missiles'))).toBe(true);
  });
});

describe('action vocabulary', () => {
  it('round-trips a valid remind through propose → store → execute validation', () => {
    const v = validateAction({ kind: 'remind', params: { inHours: 48, text: 'Chase the insurance quote' } });
    expect('action' in v).toBe(true);
    if ('action' in v) {
      const stored = toProposedAction(v.action);
      const back = fromProposedAction(stored);
      expect('action' in back && back.action.params.text).toBe('Chase the insurance quote');
    }
  });

  it('bounds the delay — refused, never coerced', () => {
    expect('error' in validateAction({ kind: 'remind', params: { inHours: 0.2, text: 'too soon' } })).toBe(true);
    expect('error' in validateAction({ kind: 'remind', params: { inHours: 9000, text: 'too far' } })).toBe(true);
    expect('error' in validateAction({ kind: 'remind', params: { inHours: '48', text: 'stringly' } })).toBe(true);
  });
});

describe('assembleProfile', () => {
  it('says so when there is no feedback yet, rather than inventing taste', () => {
    const lines = assembleProfile({ feedback: [], muted: [], recentAsks: [] });
    expect(lines.join(' ')).toContain('No thought feedback yet');
  });
  it('splits liked from disliked kinds', () => {
    const lines = assembleProfile({
      feedback: [
        { kind: 'unknown_place', up: 3, down: 0 },
        { kind: 'near_offer', up: 0, down: 2 },
      ],
      muted: ['musing_patterns'],
      recentAsks: ['how do I get the daydream engine to notice more'],
    });
    const text = lines.join('\n');
    expect(text).toContain('unknown_place (3↑)');
    expect(text).toContain('near_offer (2↓)');
    expect(text).toContain('musing_patterns');
    expect(text).toContain('daydream engine');
  });
});
