import { describe, expect, it } from 'vitest';
import { newDelivery, failureSignature, deliveryPrompt } from './development';
import { restartDecision } from './development-autopilot.server';
import { pickIndependentAssessor, independentlyJudged, coachingInstruction } from './development-review.server';
import { ciVerdict, ciLogExcerpt, parseRiskOutput, prBody, releaseBranchFor } from './development-release.server';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const pilotState = (cycle: { failureKind?: 'infrastructure' | 'feature' | 'deadline'; failure?: string }, autopilot: Record<string, unknown> = {}) => {
  const state = newDelivery('A jokes page', 'Platform', ['Show a joke'], { autopilot: true, releasePolicy: 'production' });
  state.autopilot = { ...state.autopilot!, lastRoundAt: new Date(NOW - 60 * 60 * 1000).toISOString(), ...autopilot };
  state.cycle = { startedAt: 'x', repairAttempts: 0, modelMs: 0, previewMs: 0, verificationMs: 0, ...cycle };
  return state;
};

// The real failure that spent five rounds of build f3a6c096 (2026-09-27).
const feedChecks = (rev: string) => `tests failed in isolated verification; full output retained in /var/lib/development-broker/f3a6c096-${rev}-gate-tests.log. FAIL src/lib/home/presence/feed-checks.test.ts > feed checks against test PostgreSQL\nError: Requires a loopback test database\n Test Files  1 failed | 592 passed (593) in 41.2s`;

describe('failureSignature', () => {
  it('is stable across revisions, log paths and timings', () => {
    expect(failureSignature(feedChecks('aaaa1111bbbb2222'))).toBe(failureSignature(feedChecks('cccc3333dddd4444')));
    expect(failureSignature(feedChecks('a'))).toContain('feed-checks.test.ts');
  });

  it('tells different failures apart', () => {
    expect(failureSignature(feedChecks('a'))).not.toBe(failureSignature('types failed in isolated verification; error TS2322: Type string is not assignable'));
    expect(failureSignature('')).toBeNull();
  });
});

describe('restartDecision', () => {
  it('retries an infrastructure failure without spending a round', () => {
    const decision = restartDecision(pilotState({ failureKind: 'infrastructure', failure: 'could not write init file' }), NOW);
    expect(decision).toEqual({ action: 'retry', autopilot: { infraRetries: 1 } });
  });

  it('backs off before retrying again, widening each time', () => {
    const state = pilotState({ failureKind: 'infrastructure' }, { infraRetries: 1, lastRoundAt: new Date(NOW - 6 * 60 * 1000).toISOString() });
    // Second retry waits 2 × 5 minutes from the last restart.
    expect(restartDecision(state, NOW)).toEqual({ action: 'wait' });
    expect(restartDecision(state, NOW + 5 * 60 * 1000)).toMatchObject({ action: 'retry', autopilot: { infraRetries: 2 } });
  });

  it('stops after three infrastructure failures in a row', () => {
    const decision = restartDecision(pilotState({ failureKind: 'infrastructure', failure: 'disk full' }, { infraRetries: 3 }), NOW);
    expect(decision.action).toBe('stop');
    expect(decision.action === 'stop' && decision.reason).toContain('disk full');
  });

  it('spends a round on a feature failure and resets the infrastructure count', () => {
    const decision = restartDecision(pilotState({ failureKind: 'feature', failure: feedChecks('a') }, { infraRetries: 2 }), NOW);
    expect(decision).toMatchObject({ action: 'round', autopilot: { rounds: 1, infraRetries: 0, lastFailure: { count: 1 } } });
  });

  it('ends the run when the same failure comes back a third round running', () => {
    const signature = failureSignature(feedChecks('old'))!;
    const second = restartDecision(pilotState({ failureKind: 'feature', failure: feedChecks('new') }, { lastFailure: { signature, count: 1 } }), NOW);
    expect(second).toMatchObject({ action: 'round', autopilot: { lastFailure: { signature, count: 2 } } });
    const third = restartDecision(pilotState({ failureKind: 'feature', failure: feedChecks('newer') }, { lastFailure: { signature, count: 2 } }), NOW);
    expect(third.action).toBe('stop');
    expect(third.action === 'stop' && third.reason).toContain('may not be this feature');
  });
});

describe('the adversary is not the builder', () => {
  const builder = 'codex/gpt-6-luna';
  it('keeps the role when it already differs', () => {
    expect(pickIndependentAssessor([{ modelId: 'codex/gpt-5.6-terra' }, { modelId: 'x' }], builder)).toEqual({ modelId: 'codex/gpt-5.6-terra', independent: true });
  });

  it('falls through the operator settings to the first model that differs', () => {
    // Production on 2026-09-30: role, routing pin and builder all resolved to luna.
    expect(pickIndependentAssessor([{ modelId: builder }, { modelId: builder }, { modelId: '~deepseek/deepseek-v4-flash-latest' }], builder))
      .toEqual({ modelId: '~deepseek/deepseek-v4-flash-latest', independent: true });
  });

  it('says so when nothing differs', () => {
    expect(pickIndependentAssessor([{ modelId: builder }, null], builder)).toEqual({ modelId: builder, independent: false });
  });

  it('counts a criterion as independently judged only on this candidate', () => {
    const state = newDelivery('x', 'Platform', ['a', 'b']);
    state.candidate = 'c'.repeat(40);
    const assessment = (independent: boolean, revision = state.candidate!) => ({ verdict: 'passed' as const, basis: 'observed' as const, evidence: 'seen', model: 'm', independent, revision, at: 'now' });
    state.criteria = state.criteria.map(c => ({ ...c, assessment: assessment(true) }));
    expect(independentlyJudged(state)).toBe(true);
    state.criteria[1] = { ...state.criteria[1], assessment: assessment(false) };
    expect(independentlyJudged(state)).toBe(false);
    // An owner verdict on this candidate is independent by definition.
    state.criteria[1] = { ...state.criteria[1], verdict: 'passed', revision: state.candidate };
    expect(independentlyJudged(state)).toBe(true);
    state.criteria[0] = { ...state.criteria[0], assessment: assessment(true, 'old') };
    expect(independentlyJudged(state)).toBe(false);
  });

  it('never tells the worker a self-review was independent', () => {
    const base = { criteria: [], blocker: null, lessons: [], round: 1, maxRounds: 6 };
    expect(coachingInstruction({ ...base, independent: false })).not.toContain('independent reviewer');
    expect(coachingInstruction({ ...base, independent: true })).toContain('independent reviewer');
  });
});

describe('CI after the pull request opens', () => {
  const run = (name: string, status: string, conclusion: string | null) => ({ id: 1, name, status, conclusion });
  it('reads a red required check as failure and ignores skipped and cancelled', () => {
    expect(ciVerdict([run('Gate', 'completed', 'failure'), run('Auto-merge', 'completed', 'skipped')])).toMatchObject({ state: 'failure' });
    expect(ciVerdict([run('Gate', 'completed', 'success'), run('Auto-merge', 'completed', 'skipped'), run('Old', 'completed', 'cancelled')]).state).toBe('success');
    expect(ciVerdict([run('Gate', 'in_progress', null)]).state).toBe('pending');
    expect(ciVerdict([]).state).toBe('pending');
  });

  it('extracts the lines before the first error from a job log', () => {
    const log = [
      ...Array.from({ length: 60 }, (_, i) => `2026-09-30T10:00:${String(i).padStart(2, '0')}.1234567Z noise ${i}`),
      '2026-09-30T10:01:00.0000000Z  FAIL  src/lib/x.test.ts > does a thing',
      '2026-09-30T10:01:01.0000000Z ##[error]Process completed with exit code 1.',
    ].join('\n');
    const excerpt = ciLogExcerpt(log);
    expect(excerpt).toContain('FAIL  src/lib/x.test.ts');
    expect(excerpt).toContain('##[error]Process completed');
    expect(excerpt).not.toContain('noise 10');
    expect(excerpt).not.toMatch(/^2026-/m);
  });

  it('re-releases a candidate on a new branch after its red pull request closed', () => {
    const id = 'abcd1234-0000-0000-0000-000000000000';
    expect(releaseBranchFor(id, 'a'.repeat(40), 1)).toBe(`${releaseBranchFor(id, 'a'.repeat(40))}-r1`);
    expect(releaseBranchFor(id, 'a'.repeat(40), 1).startsWith('agent/')).toBe(true);
  });
});

describe('protected paths are known before the pull request', () => {
  it('parses the classifier output, heredoc block included', () => {
    const out = 'tier=high\nmatched<<EOF_ab12\nsrc/lib/db/schema.ts (rule: src/lib/db/schema.ts)\npackage.json (rule: package.json)\n\nEOF_ab12\n';
    expect(parseRiskOutput(out)).toEqual({ tier: 'high', matched: ['src/lib/db/schema.ts', 'package.json'] });
    expect(parseRiskOutput('tier=low\nmatched=\n')).toEqual({ tier: 'low', matched: [] });
  });

  it('treats an unreadable classification as high, never low', () => {
    expect(parseRiskOutput('').tier).toBe('high');
  });

  it('says in the pull request that a protected change needs the owner', () => {
    const body = prBody({ outcome: 'x', criteria: [], gateEvidence: 'ok', buildId: 'b', independent: true, tier: 'high', protectedPaths: ['src/lib/db/schema.ts'] });
    expect(body).toContain('Needs owner review');
    expect(body).toContain('`src/lib/db/schema.ts`');
    expect(prBody({ outcome: 'x', criteria: [], gateEvidence: 'ok', buildId: 'b', independent: true, tier: 'low' })).not.toContain('Needs owner review');
  });

  it('tells the worker up front which paths wait for the owner', () => {
    expect(deliveryPrompt(newDelivery('x'))).toContain('.github/protected-paths.txt');
  });
});
