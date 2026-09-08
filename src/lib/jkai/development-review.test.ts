import { expect, it } from 'vitest';
import { criterionResult, acceptanceBlocker, newDelivery } from './development';
import { parseCriterionAssessment } from './development-review.server';
const assessment = { verdict: 'passed' as const, basis: 'inferred' as const, evidence: 'Source implements the choice; browser showed the selected stop.', model: 'fixture', revision: 'candidate', at: 'today' };
it('uses current model inference for unanswered criteria and preserves explicit owner verdicts', () => {
  const c = { id: 'one', text: 'Save a stop', verdict: 'unverified' as const, evidence: '', revision: null, assessment };
  expect(criterionResult(c, 'candidate')).toMatchObject({ verdict: 'passed', source: 'model' });
  expect(criterionResult({ ...c, verdict: 'failed', revision: 'candidate', evidence: 'I saw the wrong stop' }, 'candidate')).toMatchObject({ verdict: 'failed', source: 'owner' });
  expect(criterionResult(c, 'new-candidate').verdict).toBe('unverified');
  const state = newDelivery('Example'); state.brief.acceptedAt = 'today'; state.candidate = 'candidate'; state.criteria = [c];
  state.preview = { status: 'ready', revision: 'candidate', url: 'https://preview.test', detail: '' };
  expect(acceptanceBlocker(state)).toContain('repository gate');
  state.gate = { passed: true, revision: 'candidate', evidence: 'Checked' };
  expect(acceptanceBlocker(state)).toBeNull();
});
it('requires one nonempty, attributed judgement for every requested criterion', () => {
  const c = { id: 'one', verdict: 'passed', basis: 'inferred', evidence: 'The source implements it.' };
  expect(parseCriterionAssessment(JSON.stringify({ criteria: [c] }), ['one'])).toEqual([c]);
  for (const criteria of [[], [c, c], [{ ...c, id: 'invented' }], [{ ...c, evidence: '' }]]) {
    expect(() => parseCriterionAssessment(JSON.stringify({ criteria }), ['one'])).toThrow();
  }
});
