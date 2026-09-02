import { describe, it, expect } from 'vitest';
import {
  TONE_RANK,
  byTone,
  thoughtTone,
  thoughtRank,
  detectorTone,
  jobTone,
  verdictTone,
  leadTone,
  provenanceTone,
  bandTone,
  placeTone,
} from './priority';

describe('tone ordering', () => {
  it('puts broken before waiting-on-you before merely true', () => {
    expect(TONE_RANK.urgent).toBeLessThan(TONE_RANK.action);
    expect(TONE_RANK.action).toBeLessThan(TONE_RANK.watch);
    expect(TONE_RANK.watch).toBeLessThan(TONE_RANK.good);
    expect(TONE_RANK.steady).toBeLessThan(TONE_RANK.quiet);
  });

  it('sorts a mixed list highest-priority first', () => {
    const sorted = (['quiet', 'good', 'urgent', 'action'] as const).slice().sort(byTone);
    expect(sorted).toEqual(['urgent', 'action', 'good', 'quiet']);
  });
});

describe('thoughtTone', () => {
  it('calls an unrated delivered thought an action — that is the starved input', () => {
    expect(thoughtTone({ status: 'delivered' })).toBe('action');
    expect(thoughtTone({ status: 'new' })).toBe('action');
    expect(thoughtTone({ status: 'seen' })).toBe('action');
  });

  it('stops asking once it has been rated', () => {
    expect(thoughtTone({ status: 'delivered', feedback: 'useful' })).toBe('steady');
  });

  it('treats a refuted review as urgent, whatever the status says', () => {
    expect(thoughtTone({ status: 'delivered', reviewVerdict: 'refuted' })).toBe('urgent');
    expect(thoughtTone({ status: 'suppressed', reviewVerdict: 'refuted' })).toBe('urgent');
  });

  it('separates held-back from never-pushes-by-design', () => {
    expect(thoughtTone({ status: 'suppressed', suppressedReason: 'below_threshold' })).toBe('watch');
    expect(thoughtTone({ status: 'suppressed', suppressedReason: 'feed_only' })).toBe('quiet');
  });

  it('ranks an unrated delivery above a dismissed one', () => {
    expect(thoughtRank({ status: 'delivered' })).toBeLessThan(thoughtRank({ status: 'dismissed' }));
  });
});

describe('detectorTone', () => {
  it('muted is a choice, not a fault', () => {
    expect(detectorTone({ muted: true, readiness: { ready: false } })).toBe('quiet');
  });
  it('ready is good, still gathering is a wait', () => {
    expect(detectorTone({ readiness: { ready: true } })).toBe('good');
    expect(detectorTone({ readiness: { ready: false } })).toBe('watch');
    expect(detectorTone({ readiness: null })).toBe('watch');
  });
});

describe('jobTone', () => {
  it('a failing streak is urgent even when the last pulse says ok', () => {
    expect(jobTone({ consecutiveFailures: 2, pulse: { outcome: 'ok' } })).toBe('urgent');
  });
  it('skipped is a wait; never-run is a wait too, not a success', () => {
    expect(jobTone({ pulse: { outcome: 'skipped' } })).toBe('watch');
    expect(jobTone({ pulse: null })).toBe('watch');
  });
  it('ok is good', () => {
    expect(jobTone({ consecutiveFailures: 0, pulse: { outcome: 'ok' } })).toBe('good');
  });
});

describe('verdictTone', () => {
  it('held up is good and nothing-there is a plain fact, not a failure', () => {
    expect(verdictTone('supported')).toBe('good');
    expect(verdictTone('refuted')).toBe('steady');
  });
  it('backwards is worth a look; underpowered and unanswered are waits', () => {
    expect(verdictTone('wrong_direction')).toBe('action');
    expect(verdictTone('underpowered')).toBe('watch');
    expect(verdictTone(null)).toBe('watch');
  });
});

describe('the rest of the vocabulary', () => {
  it('leads', () => {
    expect(leadTone('open')).toBe('good');
    expect(leadTone('abandoned')).toBe('quiet');
  });

  it('provenance keeps a deliberate gap distinct from a broken one', () => {
    expect(provenanceTone('by_design')).toBe('quiet');
    expect(provenanceTone('blocked')).toBe('urgent');
    expect(provenanceTone('waiting')).toBe('watch');
    expect(provenanceTone('flowing')).toBe('good');
  });

  it('bands', () => {
    expect(bandTone('held')).toBe('watch');
    expect(bandTone('strong')).toBe('action');
  });

  it('an unnamed place past the ask threshold is the loudest thing on the hub', () => {
    expect(placeTone({ status: 'active', distinctDays: 5 }, 3)).toBe('action');
    expect(placeTone({ status: 'active', distinctDays: 1 }, 3)).toBe('watch');
    expect(placeTone({ status: 'active', label: 'Costa', distinctDays: 5 }, 3)).toBe('good');
    expect(placeTone({ status: 'transit', distinctDays: 9 }, 3)).toBe('quiet');
  });
});

describe('reviewTone', () => {
  it('refuted is loud, verified calm, uncertain a watch, nothing quiet', async () => {
    const { reviewTone } = await import('./priority');
    expect(reviewTone('refuted')).toBe('urgent');
    expect(reviewTone('verified')).toBe('good');
    expect(reviewTone('uncertain')).toBe('watch');
    expect(reviewTone(null)).toBe('quiet');
  });
});
