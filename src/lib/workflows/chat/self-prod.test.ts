import { describe, it, expect } from 'vitest';
import { shouldSelfProd, buildProdMessage } from './self-prod';
import type { OrchestratorJob, PlanPayload } from './job-store';

const plan: PlanPayload = {
  steps: [
    { id: 's1', title: 'Read config', detail: '' },
    { id: 's2', title: 'Apply migration', detail: '' },
    { id: 's3', title: 'Run smoke tests', detail: '' },
  ],
  filesToTouch: [],
};

function jobWith(overrides: Partial<OrchestratorJob>): OrchestratorJob {
  return {
    status: 'running',
    progress: [],
    toolSteps: [],
    abortController: new AbortController(),
    startedAt: Date.now(),
    message: 'm',
    scope: { workflowId: null, conversationId: null, chatNodeId: null },
    lastEventAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    partialResponse: '',
    inflightTool: null,
    awaitingWaiter: null,
    plan: null,
    coveredStepIds: new Set(),
    selfProdCount: 0,
    lastSelfProdAt: null,
    lastTokenAt: null,
    ...overrides,
  } as unknown as OrchestratorJob;
}

describe('shouldSelfProd', () => {
  it('returns false with no plan', () => {
    expect(shouldSelfProd(jobWith({}), 'done')).toBe(false);
  });

  it('returns true with uncovered steps + non-question reply', () => {
    expect(shouldSelfProd(jobWith({ plan }), 'I read the config.')).toBe(true);
  });

  it('returns false when reply ends in a question', () => {
    expect(shouldSelfProd(jobWith({ plan }), 'I read the config. Should I continue?')).toBe(false);
  });

  it('returns false on "would you like" phrasing', () => {
    expect(shouldSelfProd(jobWith({ plan }), 'Would you like me to continue.')).toBe(false);
  });

  it('returns false when prod count is at cap', () => {
    expect(shouldSelfProd(jobWith({ plan, selfProdCount: 2 }), 'Done with read.')).toBe(false);
  });

  it('returns false when waiter is open', () => {
    expect(shouldSelfProd(
      jobWith({ plan, awaitingWaiter: { kind: 'plan', key: 'plan:x', since: Date.now() } }),
      'Done with read.',
    )).toBe(false);
  });

  it('returns false when all steps covered', () => {
    expect(shouldSelfProd(
      jobWith({ plan, coveredStepIds: new Set(['s1', 's2', 's3']) }),
      'All done.',
    )).toBe(false);
  });
});

describe('buildProdMessage', () => {
  it('lists uncovered step titles in the default template', () => {
    const msg = buildProdMessage(jobWith({ plan }), 0);
    expect(msg).toContain('Read config');
    expect(msg).toContain('Apply migration');
    expect(msg).toContain('Run smoke tests');
  });
  it('uses harsher template on second prod', () => {
    const msg = buildProdMessage(jobWith({ plan, selfProdCount: 1 }), 1);
    expect(msg.toLowerCase()).toContain('paused again');
  });
});
