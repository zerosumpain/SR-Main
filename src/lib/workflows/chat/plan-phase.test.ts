import { describe, it, expect, afterEach } from 'vitest';
import { extractPlan, awaitPlanApproval, isReadOnlyPlan } from './plan-phase';
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

/**
 * The plan gate exists to get approval BEFORE side effects. Blocking a
 * read-only lookup on approval buys nothing and costs the turn: observed on
 * the in-process loop firing on roughly one ordinary ask in three, where an
 * unapproved plan just ends the turn looking like the tools were ignored.
 *
 * `kind` is optional on PlanStep, so "missing" deliberately counts as NOT
 * read-only. Erring the other way would auto-approve a plan that writes.
 */
describe('isReadOnlyPlan', () => {
  const step = (kind?: string) => ({ id: 's1', title: 't', detail: 'd', ...(kind ? { kind } : {}) }) as never;

  it('is true when every step reads and nothing is touched', () => {
    expect(isReadOnlyPlan({ steps: [step('read'), step('read')], filesToTouch: [] })).toBe(true);
  });

  it.each(['write', 'run', 'external'])('is false when any step is %j', (kind) => {
    expect(isReadOnlyPlan({ steps: [step('read'), step(kind)], filesToTouch: [] })).toBe(false);
  });

  it('is false when a step has no kind at all', () => {
    expect(isReadOnlyPlan({ steps: [step('read'), step()], filesToTouch: [] })).toBe(false);
  });

  it('is false when files would be touched, however read-only the steps claim to be', () => {
    expect(
      isReadOnlyPlan({ steps: [step('read')], filesToTouch: [{ path: 'a.ts', action: 'delete' }] }),
    ).toBe(false);
  });

  it('is false for an empty plan rather than vacuously true', () => {
    expect(isReadOnlyPlan({ steps: [], filesToTouch: [] })).toBe(false);
  });
});
