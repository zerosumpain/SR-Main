import { describe, it, expect } from 'vitest';
import { formatEfficiency, snapshotOf, trialImproved, trialIsDecidable } from './efficiency';
import { TRIAL } from './types';
import type { CallEfficiency } from '$lib/server/hermes-sessions';

function eff(patch: Partial<CallEfficiency['chat']> = {}): CallEfficiency {
  const seg = {
    turns: 100,
    totalCalls: 400,
    meanCalls: 4,
    medianCalls: 2,
    p90Calls: 10,
    maxCalls: 40,
    zeroToolTurns: 20,
    repeatCalls: 200,
    duplicateCalls: 10,
    ...patch,
  };
  return {
    days: 30,
    chat: seg,
    agentic: { ...seg, turns: 20, meanCalls: 26 },
    all: seg,
    patterns: [],
    discoveryCalls: 12,
    generatedAt: '2026-07-29T03:30:00.000Z',
  };
}

describe('trial decidability — 30 turns or 14 days, whichever first', () => {
  it('waits while both the turn count and the age are short', () => {
    expect(trialIsDecidable(5, 2)).toBe(false);
    expect(trialIsDecidable(TRIAL.minTurns - 1, TRIAL.maxDays - 1)).toBe(false);
  });

  it('decides once enough turns have accumulated, however recent', () => {
    expect(trialIsDecidable(TRIAL.minTurns, 0.5)).toBe(true);
  });

  it('decides on age alone so a quiet fortnight cannot leave a change unproven', () => {
    expect(trialIsDecidable(3, TRIAL.maxDays)).toBe(true);
  });
});

describe('trial verdict — a neutral result reverts', () => {
  it('keeps a change that clears the improvement threshold', () => {
    // 5% required; 4.00 → 3.60 is a 10% drop.
    expect(trialImproved(4, 3.6)).toBe(true);
  });

  it('reverts a change that made no measurable difference', () => {
    expect(trialImproved(4, 3.95)).toBe(false);
    expect(trialImproved(4, 4)).toBe(false);
  });

  it('reverts a change that made things worse', () => {
    expect(trialImproved(4, 5.2)).toBe(false);
  });

  it('sits exactly on the threshold as a keep', () => {
    expect(trialImproved(4, 4 * (1 - TRIAL.minImprovement))).toBe(true);
  });

  it('never claims improvement against a zero baseline', () => {
    expect(trialImproved(0, 0)).toBe(false);
  });
});

describe('snapshotting', () => {
  it('takes the CHAT segment, not the combined number', () => {
    const s = snapshotOf(eff({ meanCalls: 4.31, turns: 158, repeatCalls: 439 }));
    expect(s).toEqual({
      meanCalls: 4.31,
      turns: 158,
      repeatCalls: 439,
      takenAt: '2026-07-29T03:30:00.000Z',
    });
  });

  it('reports both segments so a long agentic task never reads as a regression', () => {
    const line = formatEfficiency(eff());
    expect(line).toContain('calls/chat turn');
    expect(line).toContain('Agentic:');
  });
});
