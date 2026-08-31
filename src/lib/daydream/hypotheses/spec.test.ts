import { describe, it, expect } from 'vitest';
import {
  hypothesisKey,
  judge,
  MIN_PAIRS_FOR_VERDICT,
  validateHypothesis,
} from './spec';

const good = {
  a: 'sleepMinutes',
  b: 'distinctPlaces',
  lagDays: 0,
  direction: 'positive',
  question: 'Do I get about more on days after sleeping well?',
  rationale: 'Sleep debt tends to shrink the day.',
};

describe('validateHypothesis', () => {
  it('accepts a well-formed cross-domain question', () => {
    const v = validateHypothesis(good);
    expect(v.ok).toBe(true);
    expect(v.spec?.a).toBe('sleepMinutes');
  });

  it('refuses a metric that does not exist', () => {
    expect(validateHypothesis({ ...good, a: 'moonPhase' }).reason).toContain('unknown metric');
  });

  // The same list the exhaustive sweep uses. A model asking "does resting heart
  // rate track recovery score" has asked how the score is defined.
  it('refuses a pair that is entangled by definition', () => {
    const v = validateHypothesis({ ...good, a: 'recoveryScore', b: 'restingHeartRate' });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('entangled');
  });

  it('refuses a metric predicting itself', () => {
    expect(validateHypothesis({ ...good, b: 'sleepMinutes' }).reason).toContain('itself');
  });

  it('refuses a lag it cannot test', () => {
    expect(validateHypothesis({ ...good, lagDays: 7 }).reason).toContain('lagDays');
  });

  it('requires a stated direction, so the data can contradict it', () => {
    expect(validateHypothesis({ ...good, direction: 'maybe' }).reason).toContain('direction');
  });

  it('requires a question and a rationale', () => {
    expect(validateHypothesis({ ...good, question: '  ' }).reason).toBe('no question');
    expect(validateHypothesis({ ...good, rationale: '' }).reason).toBe('no rationale');
  });
});

describe('hypothesisKey', () => {
  // A same-day claim is symmetric: "sleep tracks steps" and "steps tracks
  // sleep" are one question, and asking both is asking twice.
  it('treats a same-day pair as one question either way round', () => {
    expect(hypothesisKey({ a: 'steps', b: 'sleepMinutes', lagDays: 0 })).toBe(
      hypothesisKey({ a: 'sleepMinutes', b: 'steps', lagDays: 0 }),
    );
  });

  // A lagged claim is not symmetric — which comes first IS the claim.
  it('treats a lagged pair as two different questions', () => {
    expect(hypothesisKey({ a: 'steps', b: 'sleepMinutes', lagDays: 1 })).not.toBe(
      hypothesisKey({ a: 'sleepMinutes', b: 'steps', lagDays: 1 }),
    );
  });
});

describe('judge', () => {
  const fdr = 0.1;

  it('supports a claim that held', () => {
    const o = judge({ direction: 'positive' }, { r: 0.5, p: 0.001, qValue: 0.01, n: 60 }, fdr);
    expect(o.verdict).toBe('supported');
    expect(o.summary).toContain('Held up');
  });

  it('refutes a claim that found nothing', () => {
    const o = judge({ direction: 'positive' }, { r: 0.06, p: 0.6, qValue: 0.9, n: 60 }, fdr);
    expect(o.verdict).toBe('refuted');
    expect(o.summary).toContain('No relationship');
  });

  it('does not promote a trivial effect merely because it is significant', () => {
    const o = judge({ direction: 'either' }, { r: 0.1, p: 0.001, qValue: 0.01, n: 500 }, fdr);
    expect(o.verdict).toBe('refuted');
    expect(o.summary).toContain('too small');
  });

  // THE case this function exists for. A claim that predicted positive and
  // found a significant NEGATIVE relationship has been refuted, however small
  // the p-value. Reporting it as supported — because something significant
  // turned up — is the most seductive version of this feature's failure mode,
  // since the statistics genuinely are significant.
  it('does not call a backwards result a success', () => {
    const o = judge({ direction: 'positive' }, { r: -0.55, p: 0.0001, qValue: 0.002, n: 60 }, fdr);
    expect(o.verdict).toBe('wrong_direction');
    expect(o.summary).toContain('opposite way round');
  });

  it('accepts either sign when the claim did not commit', () => {
    const o = judge({ direction: 'either' }, { r: -0.55, p: 0.0001, qValue: 0.002, n: 60 }, fdr);
    expect(o.verdict).toBe('supported');
  });

  // Silence beats a verdict on six days of overlap.
  it('says underpowered rather than guessing', () => {
    const o = judge(
      { direction: 'positive' },
      { r: 0.9, p: 0.0001, qValue: 0.001, n: MIN_PAIRS_FOR_VERDICT - 1 },
      fdr,
    );
    expect(o.verdict).toBe('underpowered');
    expect(o.summary).toContain('Not enough overlapping days');
  });

  // Every verdict carries its own numbers, so nothing downstream can quote a
  // finding without its uncertainty.
  it('always reports r, q and n', () => {
    const o = judge({ direction: 'either' }, { r: 0.3, p: 0.02, qValue: 0.05, n: 40 }, fdr);
    expect(o.r).toBeCloseTo(0.3);
    expect(o.qValue).toBeCloseTo(0.05);
    expect(o.n).toBe(40);
    expect(o.summary).toContain('n = 40');
  });
});
