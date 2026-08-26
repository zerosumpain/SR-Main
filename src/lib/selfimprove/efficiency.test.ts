import { describe, it, expect } from 'vitest';
import {
  formatEfficiency,
  isFresherThan,
  snapshotOf,
  trialImproved,
  trialIsDecidable,
} from './efficiency';
import { TRIAL } from './types';
import type { CallEfficiency } from './call-efficiency';

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
    newestTurnAt: '2026-07-29T03:00:00.000Z',
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

describe('staleness guard — never grade a trial on evidence older than itself', () => {
  // The real incident, 2026-08-24. Hermes stopped; its session store froze at
  // 06:34 but kept answering queries. Tool-policy v16's trial opened at 02:36
  // that morning and would decide on 09-07, by which time `windowDays` =
  // ceil(ageDays) opens the window well before the trial start. The 9 turns it
  // would have read were all dated 08-23 — the day BEFORE the trial — and they
  // average 2.0 against a 2.82 baseline, clearing the 5% bar comfortably.
  // v16 gets KEPT, with a verdict reading "-29% over 9 turns", on data that
  // cannot possibly reflect it.
  const TRIAL_STARTED = '2026-08-24T02:36:29.000Z';
  const STORE_FROZE = '2026-08-24T06:34:00.000Z';
  const EVIDENCE_PREDATING_TRIAL = '2026-08-23T21:10:00.000Z';

  it('refuses when the newest data predates the trial', () => {
    expect(isFresherThan(EVIDENCE_PREDATING_TRIAL, TRIAL_STARTED)).toBe(false);
  });

  it('accepts a store that received something after the trial opened', () => {
    // The frozen store is technically fresher than the trial start — this is
    // why "is the store newer than the trial" is the right question and
    // "is the store recent" is not. Once real turns resume, this passes.
    expect(isFresherThan(STORE_FROZE, TRIAL_STARTED)).toBe(true);
  });

  it('treats a missing timestamp as stale, not as fresh', () => {
    // An older homeserv, or a remote that predates the field, sends undefined.
    // Failing open here would restore the exact bug over the proxy boundary.
    expect(isFresherThan(null, TRIAL_STARTED)).toBe(false);
    expect(isFresherThan(undefined, TRIAL_STARTED)).toBe(false);
    expect(isFresherThan('', TRIAL_STARTED)).toBe(false);
  });

  it('treats an unparseable timestamp as stale', () => {
    expect(isFresherThan('not a date', TRIAL_STARTED)).toBe(false);
    expect(isFresherThan(STORE_FROZE, 'not a date')).toBe(false);
  });

  it('does not count data written at the exact trial start', () => {
    // Equal is not after. A row stamped at the same instant cannot have been
    // influenced by the change.
    expect(isFresherThan(TRIAL_STARTED, TRIAL_STARTED)).toBe(false);
  });

  it('is not satisfiable by a turn count — the turns existed, they were just old', () => {
    // Guarding on `turnsObserved === 0` was the tempting fix and would have
    // sailed straight past the incident: there were 9 turns.
    const stale = eff({ turns: 9, meanCalls: 2.0 });
    expect(stale.chat.turns).toBeGreaterThan(0);
    expect(trialImproved(2.82, stale.chat.meanCalls)).toBe(true); // would have been KEPT
    expect(isFresherThan(EVIDENCE_PREDATING_TRIAL, TRIAL_STARTED)).toBe(false); // now blocked
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
