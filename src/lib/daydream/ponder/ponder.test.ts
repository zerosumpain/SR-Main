import { describe, it, expect } from 'vitest';
import { validateAction, fromProposedAction, toProposedAction } from '../actions';
import { assemblePack, renderPack, type PackInputs } from './pack';
import { validatePonderOutput, MAX_MUSINGS } from './schema';
import { ENTANGLED_PAIRS, isEntangled } from '../stats/sweep';
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
    calendar: { events: [], hiddenCount: 0, partial: false, available: true },
    interests: [],
    offers: { available: true, items: [] },
    memories: [{ id: 'm1', category: 'people', content: 'Jemima swims on Tuesdays.' }],
    memoryThemes: [],
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

  it('keeps unconsolidated raw memories out of the reasoning pack', () => {
    const pack = assemblePack(inputs());
    expect(pack.cards.some((c) => c.ref.kind === 'memory')).toBe(false);
    expect(renderPack(pack)).not.toContain('Jemima swims on Tuesdays');
  });

  it('cards consolidated memory as a sourced lesson and preserves that ref in a musing', () => {
    const pack = assemblePack(inputs({
      snapshot: snap({
        memories: [],
        memoryThemes: [{
          id: 'theme-health',
          kind: 'lesson',
          title: 'Readiness has contextual modifiers',
          statement: 'Alcohol can lower readiness even when sleep looks strong.',
          guidance: 'Consider alcohol as one possible modifier without assuming it was the cause.',
          confidence: 'high',
          sourceCount: 2,
        }],
      }),
    }));
    const card = pack.cards.find((c) => c.ref.kind === 'memory-theme');
    expect(card?.text).toContain('Lesson — Readiness has contextual modifiers');
    expect(card?.text).toContain('When relevant');

    const out = validatePonderOutput({
      musings: [{
        slug: 'sleep-readiness-context',
        theme: 'health',
        title: 'Sleep and readiness diverged',
        text: 'Sleep looked strong while readiness did not; context may be part of the gap.',
        salience: 0.7,
        cites: [card?.id],
      }],
    }, pack);
    expect(out.musings[0].candidate.evidence).toContainEqual(
      expect.objectContaining({ kind: 'memory-theme', id: 'theme-health' }),
    );
  });

  it('does not truncate practical guidance behind a long lesson statement', () => {
    const pack = assemblePack(inputs({
      snapshot: snap({
        memories: [],
        memoryThemes: [{
          id: 'theme-long',
          kind: 'lesson',
          title: 'Context changes interpretation',
          statement: 'A'.repeat(210),
          guidance: 'PRACTICAL GUIDANCE MUST REACH THE PONDER MODEL.',
          confidence: 'medium',
          sourceCount: 3,
        }],
      }),
    }));
    expect(pack.cards.find((c) => c.ref.id === 'theme-long')?.text)
      .toContain('PRACTICAL GUIDANCE MUST REACH THE PONDER MODEL');
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

describe('lead metrics — the fault that kept the frontier empty', () => {
  // Fourteen leads were proposed on production and every one was rejected for
  // `unknown metrics`. The names it offered are the pack's own prose labels,
  // because the prompt told it to pick from a vocabulary it was never shown.
  const PRODUCTION_REJECTIONS = [
    ['Time out', 'Verified spend'],
    ['Readiness', "Last night's sleep"],
    ['Average steps last 7 days', 'Average time out of the house last 7 days'],
    ['sleep_percentage', 'sleep_duration', 'time_away_from_home'],
  ];

  function leadOf(metrics: string[]) {
    return {
      musings: [],
      actionRules: [],
      leads: [
        {
          leadKey: 'a-lead',
          title: 'Does one thing move the other?',
          rationale: 'Something plausible has been happening for more than a week now.',
          metrics,
        },
      ],
    };
  }

  it('still refuses a label that is a GUESS about meaning, not a spelling', () => {
    // "Readiness" is not a misspelling of recoveryScore, and mapping it would
    // file a line of enquiry against a series nobody chose.
    for (const metrics of PRODUCTION_REJECTIONS.slice(0, 3)) {
      const v = validatePonderOutput(leadOf(metrics), assemblePack(inputs()));
      expect(v.leads).toHaveLength(0);
    }
  });

  it('names the vocabulary in the rejection, so the reason is actionable', () => {
    const v = validatePonderOutput(leadOf(['Time out', 'Verified spend']), assemblePack(inputs()));
    expect(v.rejected[0]).toMatch(/the vocabulary is/);
    expect(v.rejected[0]).toContain('sleepMinutes');
  });

  it('accepts the exact keys', () => {
    const v = validatePonderOutput(leadOf(['sleepMinutes', 'minutesOut']), assemblePack(inputs()));
    expect(v.leads).toHaveLength(1);
    expect(v.leads[0].metrics).toEqual(['sleepMinutes', 'minutesOut']);
    expect(v.coerced).toEqual([]);
  });

  it('repairs a difference of SPELLING, and says that it did', () => {
    const v = validatePonderOutput(leadOf(['sleep_minutes', 'MinutesOut']), assemblePack(inputs()));
    expect(v.leads).toHaveLength(1);
    expect(v.leads[0].metrics).toEqual(['sleepMinutes', 'minutesOut']);
    // Silently accepting an alias is how entity_id/entityId cost 44% of a
    // toolset's calls while reading as facts about the estate.
    expect(v.coerced).toHaveLength(2);
    expect(v.coerced[0]).toContain('sleepMinutes');
  });

  it('deduplicates after resolving, so two spellings of one metric are one', () => {
    const v = validatePonderOutput(
      leadOf(['sleepMinutes', 'sleep_minutes', 'minutesOut']),
      assemblePack(inputs()),
    );
    expect(v.leads[0].metrics).toEqual(['sleepMinutes', 'minutesOut']);
  });

  it('counts metrics AFTER resolving, not before', () => {
    // Two spellings of one metric is one metric, and a lead owning one metric
    // owns nothing.
    const v = validatePonderOutput(leadOf(['sleepMinutes', 'sleep_minutes']), assemblePack(inputs()));
    expect(v.leads).toHaveLength(0);
    expect(v.rejected.some((r) => /needs 2\.\.6 metrics/.test(r))).toBe(true);
  });
});

describe('the tautology hint', () => {
  it('names every entangled pair the sweep will skip', () => {
    // One source, two shapes. If the sweep learns a new tautology and the
    // prompt does not, the model keeps spending metric slots on it.
    for (const [a, b] of ENTANGLED_PAIRS) {
      expect(isEntangled(a, b)).toBe(true);
    }
    expect(ENTANGLED_PAIRS.length).toBeGreaterThan(10);
  });

  it('covers the two pairs the first real lead wasted', () => {
    // sleep-recovery-lag opened with sleepMinutes, recoveryScore,
    // sleepEfficiency and restingHeartRate — two of its six pairs were dead
    // before they ran.
    expect(isEntangled('sleepMinutes', 'sleepEfficiency')).toBe(true);
    expect(isEntangled('recoveryScore', 'restingHeartRate')).toBe(true);
  });
});
