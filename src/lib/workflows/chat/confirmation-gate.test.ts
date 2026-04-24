import { describe, it, expect, afterEach } from 'vitest';
import { requireConfirmation, isDestructive, describeDestructiveAction } from './confirmation-gate';
import { createJob, subscribeJob, respondToWaiter, cleanOldJobs, cancelJob } from './job-store';
import type { JobEvent } from './job-store';

afterEach(() => cleanOldJobs(0));

describe('isDestructive', () => {
  it('flags known write tools', () => {
    expect(isDestructive('workflow_delete')).toBe(true);
    expect(isDestructive('gmail_send')).toBe(true);
    expect(isDestructive('whatsapp_send')).toBe(true);
  });
  it('does not flag read-only tools', () => {
    expect(isDestructive('web_search')).toBe(false);
    expect(isDestructive('intel_search')).toBe(false);
    expect(isDestructive('unknown_tool')).toBe(false);
  });
});

describe('describeDestructiveAction', () => {
  it('produces tool-specific prompts', () => {
    expect(describeDestructiveAction('workflow_delete', { name: 'canvas-x' })).toContain('canvas-x');
    expect(describeDestructiveAction('gmail_send', { to: 'a@b.com' })).toContain('a@b.com');
  });
  it('has a default for unknown tools', () => {
    expect(describeDestructiveAction('mystery_tool', {})).toContain('mystery_tool');
  });
});

describe('requireConfirmation', () => {
  it('emits a confirm event and resolves true on approved', async () => {
    const { jobId } = createJob('test');
    const received: JobEvent[] = [];
    subscribeJob(jobId, (e) => received.push(e));

    const pending = requireConfirmation(jobId, 'Delete?', { x: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const ev = received.find((e) => e.type === 'confirm') as Extract<JobEvent, { type: 'confirm' }> | undefined;
    expect(ev).toBeDefined();
    respondToWaiter(jobId, `confirm:${ev!.confirmId}`, { decision: 'approved' });
    await expect(pending).resolves.toBe(true);
  });

  it('resolves false on rejected', async () => {
    const { jobId } = createJob('test');
    const received: JobEvent[] = [];
    subscribeJob(jobId, (e) => received.push(e));

    const pending = requireConfirmation(jobId, 'Delete?', { x: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const ev = received.find((e) => e.type === 'confirm') as Extract<JobEvent, { type: 'confirm' }> | undefined;
    respondToWaiter(jobId, `confirm:${ev!.confirmId}`, { decision: 'rejected' });
    await expect(pending).resolves.toBe(false);
  });

  it('rejects if the job is cancelled while awaiting', async () => {
    const { jobId } = createJob('test');
    const pending = requireConfirmation(jobId, 'Delete?', { x: 1 });
    setTimeout(() => cancelJob(jobId), 10);
    await expect(pending).rejects.toThrow();
  });
});
