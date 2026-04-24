import { describe, it, expect, afterEach } from 'vitest';
import { extractPlan, awaitPlanApproval } from './plan-phase';
import { createJob, respondToWaiter, cleanOldJobs, subscribeJob } from './job-store';
import type { JobEvent } from './job-store';

afterEach(() => cleanOldJobs(0));

describe('extractPlan', () => {
  it('returns null when no plan block is present', () => {
    expect(extractPlan('just some text')).toBeNull();
  });

  it('parses a minimal plan block', () => {
    const raw = `Here is my plan:\n<plan>{"summary":"do x","steps":[{"id":"s1","title":"step","detail":"detail"}],"filesToTouch":[]}</plan>\n`;
    const out = extractPlan(raw);
    expect(out).not.toBeNull();
    expect(out!.plan.steps.length).toBe(1);
    expect(out!.plan.summary).toBe('do x');
    expect(out!.cleaned).toBe('Here is my plan:');
  });

  it('returns null on malformed JSON', () => {
    const raw = `<plan>{ not json }</plan>`;
    expect(extractPlan(raw)).toBeNull();
  });

  it('returns null when steps is empty', () => {
    const raw = `<plan>{"summary":"x","steps":[],"filesToTouch":[]}</plan>`;
    expect(extractPlan(raw)).toBeNull();
  });

  it('tolerates missing filesToTouch', () => {
    const raw = `<plan>{"summary":"x","steps":[{"id":"s1","title":"t","detail":"d"}]}</plan>`;
    const out = extractPlan(raw);
    expect(out!.plan.filesToTouch).toEqual([]);
  });
});

describe('awaitPlanApproval', () => {
  it('emits a plan event and resolves on respondToWaiter', async () => {
    const { jobId } = createJob('test');
    const received: JobEvent[] = [];
    subscribeJob(jobId, (e) => received.push(e));

    const plan = { steps: [{ id: 's1', title: 't', detail: 'd' }], filesToTouch: [] };
    const pending = awaitPlanApproval(jobId, plan);

    // Grab the emitted planId, respond with approval
    await new Promise((r) => setTimeout(r, 5));
    const planEv = received.find((e) => e.type === 'plan') as Extract<JobEvent, { type: 'plan' }> | undefined;
    expect(planEv).toBeDefined();
    respondToWaiter(jobId, `plan:${planEv!.planId}`, { decision: 'approved' });

    await expect(pending).resolves.toEqual({ decision: 'approved' });
  });
});
