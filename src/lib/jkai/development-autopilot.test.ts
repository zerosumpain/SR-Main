import { describe, expect, it } from 'vitest';
import { newDelivery, autopilotActive, releaseBlocker, criterionResult } from './development';
import { parseReleaseVeto, coachingInstruction } from './development-review.server';
import { prBody } from './development-release.server';
import { developmentLane } from '$lib/builds/development-progress';
import { AUTOPILOT_ROUNDS } from '$lib/constants/development';

const ready = () => {
  const state = newDelivery('Compare two weeks of health data', 'Health', ['Save a comparison'], {
    releasePolicy: 'production', autopilot: true,
  });
  state.brief.acceptedAt = 'today';
  state.candidate = 'c'.repeat(40);
  state.gate = { passed: true, revision: state.candidate, evidence: 'Isolated verification passed' };
  state.acceptedAt = 'today';
  state.batch = 'b'.repeat(40);
  return state;
};

describe('autopilot bounds', () => {
  it('is active only while enabled, unstopped and inside its round limit', () => {
    const state = ready();
    expect(autopilotActive(state)).toBe(true);
    expect(autopilotActive({ ...state, autopilot: { ...state.autopilot!, rounds: AUTOPILOT_ROUNDS.default } })).toBe(false);
    expect(autopilotActive({ ...state, autopilot: { ...state.autopilot!, stopReason: 'A decision needs you' } })).toBe(false);
    expect(autopilotActive({ ...state, autopilot: { ...state.autopilot!, enabled: false } })).toBe(false);
    expect(autopilotActive(newDelivery('No autopilot'))).toBe(false);
  });

  it('clamps the round limit to the documented ceiling and floor', () => {
    expect(newDelivery('x', 'Platform', [], { autopilot: true, maxRounds: 999 }).autopilot?.maxRounds).toBe(AUTOPILOT_ROUNDS.max);
    expect(newDelivery('x', 'Platform', [], { autopilot: true, maxRounds: 0 }).autopilot?.maxRounds).toBe(1);
    expect(newDelivery('x', 'Platform', [], { autopilot: true }).autopilot?.maxRounds).toBe(AUTOPILOT_ROUNDS.default);
  });

  it('defaults a new feature to preview only, with no autopilot', () => {
    const state = newDelivery('Something');
    expect(state.releasePolicy).toBe('preview_only');
    expect(state.autopilot).toBeUndefined();
  });
});

describe('release permission', () => {
  it('refuses a preview-only feature however complete it is', () => {
    expect(releaseBlocker({ ...ready(), releasePolicy: 'preview_only' })).toContain('preview only');
  });

  it('requires the batch and a gate that names this exact candidate', () => {
    const state = ready();
    expect(releaseBlocker({ ...state, acceptedAt: null, batch: null })).toContain('Accept the candidate');
    expect(releaseBlocker({ ...state, gate: { passed: true, revision: 'other', evidence: '' } })).toContain('repository gate');
    expect(releaseBlocker({ ...state, gate: { passed: false, revision: state.candidate!, evidence: '' } })).toContain('repository gate');
    expect(releaseBlocker(state)).toBeNull();
  });

  it('will not open a second pull request for the same candidate', () => {
    const state = ready();
    expect(releaseBlocker({ ...state, release: { revision: state.candidate!, prUrl: 'https://github.com/x/y/pull/1' } })).toContain('already has a pull request');
    // A newer candidate is a new proposal, so the old PR must not block it.
    expect(releaseBlocker({ ...state, release: { revision: 'older', prUrl: 'https://github.com/x/y/pull/1' } })).toBeNull();
  });
});

describe('the portfolio lane follows the release, not the acceptance', () => {
  it('files a released feature under shipped even though it is also accepted', () => {
    const state = ready();
    expect(developmentLane(state)).toBe('accepted');
    expect(developmentLane({ ...state, stage: 'pr_open' })).toBe('shipped');
    expect(developmentLane({ ...state, stage: 'deployed' })).toBe('shipped');
  });
});

describe('the adversary’s veto', () => {
  it('accepts an evidenced veto and a clean pass', () => {
    expect(parseReleaseVeto('{"veto":false,"reason":"","evidence":""}')).toMatchObject({ veto: false });
    expect(parseReleaseVeto('```json\n{"veto":true,"reason":"The save button does nothing","evidence":"Clicking Save left the page unchanged"}\n```'))
      .toMatchObject({ veto: true, reason: 'The save button does nothing' });
  });

  it('discards a veto with no evidence rather than stranding finished work', () => {
    expect(parseReleaseVeto('{"veto":true,"reason":"Consider adding tests","evidence":""}')).toMatchObject({ veto: false });
    expect(parseReleaseVeto('{"veto":true,"reason":"","evidence":"something"}')).toMatchObject({ veto: false });
  });

  it('refuses output that is not a verdict at all', () => {
    expect(() => parseReleaseVeto('{"criteria":[]}')).toThrow();
    expect(() => parseReleaseVeto('not json')).toThrow();
  });
});

describe('the coaching instruction', () => {
  const base = {
    criteria: [
      { text: 'Save a comparison', verdict: 'failed', evidence: 'No save control was present', source: 'model' },
      { text: 'Show two weeks', verdict: 'passed', evidence: 'Both weeks rendered', source: 'model' },
    ],
    blocker: 'At least one criterion is not met yet.',
    lessons: [{ lesson: 'Health charts read strain on two scales', evidence: 'PR #412' }],
    round: 2,
    maxRounds: 6,
  };

  it('names the failing criteria, protects the passing ones and carries the round', () => {
    const text = coachingInstruction(base);
    expect(text).toContain('round 2 of at most 6');
    expect(text).toContain('No save control was present');
    expect(text).toContain('do not regress');
    expect(text).toContain('Show two weeks');
  });

  it('injects the area lessons and the standing house rules', () => {
    const text = coachingInstruction(base);
    expect(text).toContain('Health charts read strain on two scales');
    expect(text).toContain('No raw hex colours');
    expect(text).toContain('Do not weaken or delete an existing test');
  });

  it('forbids releasing from inside the worker', () => {
    expect(coachingInstruction(base)).toContain('Do not push, open a pull request, merge or deploy.');
  });

  it('passes a veto through with its evidence', () => {
    const text = coachingInstruction({ ...base, veto: { reason: 'Scope crept', evidence: 'It edited the nav manifest' } });
    expect(text).toContain('Scope crept');
    expect(text).toContain('It edited the nav manifest');
  });
});

describe('the pull request says who judged it', () => {
  const input = {
    outcome: 'Compare two weeks of health data',
    criteria: [{ text: 'Save a comparison', verdict: 'passed', evidence: 'Saved and reloaded' }],
    gateEvidence: 'Isolated verification passed',
    buildId: 'abcd1234-0000-0000-0000-000000000000',
  };

  it('states plainly when nothing independent reviewed it', () => {
    expect(prBody({ ...input, independent: false })).toContain('same model that wrote the change');
    expect(prBody({ ...input, independent: true })).toContain('separate from the one that wrote the change');
  });

  it('links back to the workspace and carries the evidence per criterion', () => {
    const body = prBody({ ...input, independent: true });
    expect(body).toContain('/jkai/develop/abcd1234-0000-0000-0000-000000000000');
    expect(body).toContain('Saved and reloaded');
  });
});

describe('the release branch names its candidate', () => {
  it('gives every candidate its own branch, so a plain push always works', async () => {
    const { releaseBranchFor } = await import('./development-release.server');
    const a = releaseBranchFor('abcd1234-0000-0000-0000-000000000000', 'a'.repeat(40));
    const b = releaseBranchFor('abcd1234-0000-0000-0000-000000000000', 'b'.repeat(40));
    expect(a).not.toBe(b);
    // CI's auto-merge only ever considers a head_ref starting `agent/`.
    expect(a.startsWith('agent/')).toBe(true);
    expect(a).toMatch(/^agent\/dev-[a-z0-9]{8}-[a-f0-9]{8}$/);
  });
});

describe('nothing carries the token out of a failed command', () => {
  it('drops the base64 envelope that redacting the literal string cannot reach', async () => {
    const { redactCommandOutput } = await import('./development-release.server');
    const token = 'ghp_secretvalue';
    const envelope = Buffer.from(`git clone https://x-access-token:${token}@github.com/o/r`).toString('base64');
    const message = `Command failed: bash -c "echo '${envelope}' | base64 -d | bash"\nfatal: could not read Username`;
    const safe = redactCommandOutput(message, token);
    expect(safe).not.toContain(token);
    expect(safe).not.toContain(envelope);
    expect(safe).toContain('could not read Username');
  });

  it('still strips the literal token when it appears on its own', () => {
    return import('./development-release.server').then(({ redactCommandOutput }) => {
      expect(redactCommandOutput('remote: https://x-access-token:tok123@github.com', 'tok123')).not.toContain('tok123');
    });
  });
});

describe('an owner verdict judges what was on screen', () => {
  it('holds only while the candidate is the revision it judged', () => {
    const previewed = 'a'.repeat(40);
    const criterion = { id: 'criterion-1', text: 'Save it', verdict: 'passed' as const, evidence: 'I saw it save', revision: previewed };
    // While the candidate is what the owner looked at, their verdict rules.
    expect(criterionResult(criterion, previewed)).toMatchObject({ verdict: 'passed', source: 'owner' });
    // Once the worker moves past it, the stale verdict must not leak into
    // acceptance — which is what makes recording it against the PREVIEWED
    // revision safe even while the build is running.
    expect(criterionResult(criterion, 'b'.repeat(40))).toMatchObject({ verdict: 'unverified' });
  });

  it('keeps the reviewer’s assessment beside the owner’s verdict rather than replacing it', () => {
    const previewed = 'a'.repeat(40);
    const assessment = { verdict: 'failed' as const, basis: 'inferred' as const, evidence: 'No handler', model: 'reviewer/model', independent: true, revision: previewed, at: 'now' };
    const owner = { id: 'criterion-1', text: 'Save it', verdict: 'passed' as const, evidence: 'I saw it save', revision: previewed, assessment };
    // The owner wins the verdict...
    expect(criterionResult(owner, previewed)).toMatchObject({ verdict: 'passed', source: 'owner' });
    // ...and the reasoning survives to be read beside it.
    expect(owner.assessment.evidence).toBe('No handler');
  });
});
