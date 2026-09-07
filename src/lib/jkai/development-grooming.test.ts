import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), resolve: vi.fn(async () => ({ modelId: 'owner-model' })) }));
vi.mock('$lib/llm/client', () => ({ getLLMClient: vi.fn(async () => ({ client: { chat: { completions: { create: mocks.create } } }, model: 'owner-model' })) }));
vi.mock('$lib/server/models/settings', () => ({ resolveDefaultModel: mocks.resolve }));
import { groomDevelopmentBrief, parseDevelopmentProposal, readBriefFields } from './development-grooming.server';
import { deliveryPrompt, newDelivery } from './development';
const proposal = { summary: 'Review visibility.', outcome: 'Save weekly comparisons', constraints: ['Owner only'], scope: ['Compare two weeks'], dependencies: ['Verify health data access'], assumptions: ['Use existing measurements'], questions: ['Which metrics?'], validation: ['Save, reload and compare values'], criteria: ['Saved comparison survives reload'], routes: ['/health'] };
beforeEach(() => vi.clearAllMocks());
it('calls the selected model with edited draft, owner answers and bounded site context', async () => {
  mocks.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
  const result = await groomDevelopmentBrief({ ...readBriefFields({ outcome: 'Compare weeks', dependencies: 'Keep my data source' }), area: 'Health' }, 'Use steps only', [{ lesson: 'Owner gated', evidence: 'Verified route' }]);
  expect(mocks.resolve).toHaveBeenCalledOnce();
  const request = mocks.create.mock.calls[0][0];
  const context = JSON.parse(request.messages[1].content);
  expect(context.message).toBe('Use steps only');
  expect(context.draft.dependencies).toBe('Keep my data source');
  expect(context.navigation).toContainEqual(expect.objectContaining({ href: '/health' }));
  expect(result.brief.dependencies).toContain('Verify health data');
  expect(result.criteria).toEqual(proposal.criteria);
  expect(result.grooming.model).toBe('owner-model');
  expect(result.brief).not.toHaveProperty('acceptedAt');
});
it('rejects empty or unsafe model responses instead of pretending grooming succeeded', () => {
  for (const content of ['not json', '{}', JSON.stringify({ ...proposal, criteria: [] }), JSON.stringify({ ...proposal, routes: ['//external.test'] })]) {
    expect(() => parseDevelopmentProposal(content, 'test')).toThrow(/proposal/);
  }
});
it('retains dependency and validation requirements in the Pi implementation prompt', () => {
  const state = newDelivery('Compare weeks');
  state.brief = { ...state.brief, ...parseDevelopmentProposal(JSON.stringify(proposal), 'test').brief };
  const prompt = deliveryPrompt(state);
  expect(prompt).toContain('Verify health data access');
  expect(prompt).toContain('Save, reload and compare values');
});
it('rejects malformed or oversized browser fields without altering input', () => {
  expect(() => readBriefFields({ outcome: 'Ask', questions: [] })).toThrow('Invalid questions');
  expect(() => readBriefFields({ outcome: 'a'.repeat(20001) })).toThrow('Invalid outcome');
});
