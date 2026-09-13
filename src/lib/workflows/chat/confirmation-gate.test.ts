import { describe, it, expect, afterEach } from 'vitest';
import { requireConfirmation, isDestructive, describeDestructiveAction } from './confirmation-gate';
import { createJob, subscribeJob, respondToWaiter, cleanOldJobs, cancelJob } from './job-store';
import type { JobEvent } from './job-store';

afterEach(() => cleanOldJobs(0));

describe('isDestructive', () => {
  it('flags known write tools', async () => {
    expect(await isDestructive('workflow_delete')).toBe(true);
    expect(await isDestructive('gmail_send')).toBe(true);
    expect(await isDestructive('whatsapp_send')).toBe(true);
  });
  it('does not flag read-only tools', async () => {
    expect(await isDestructive('web_search')).toBe(false);
    expect(await isDestructive('intel_search')).toBe(false);
    expect(await isDestructive('unknown_tool')).toBe(false);
  });
});

describe('describeDestructiveAction', () => {
  it('produces tool-specific prompts', async () => {
    expect(describeDestructiveAction('workflow_delete', { name: 'canvas-x' })).toContain('canvas-x');
    expect(describeDestructiveAction('gmail_send', { to: 'a@b.com' })).toContain('a@b.com');
  });
  it('describes Apple Calendar edits and irreversible deletes', async () => {
    expect(describeDestructiveAction('apple_calendar_update', { eventId: '/family/event.ics', calendar: 'Family' })).toContain('/family/event.ics');
    expect(describeDestructiveAction('apple_calendar_delete', { eventId: '/family/event.ics', calendar: 'Family' })).toMatch(/cannot be undone/i);
  });

  it('has a default for unknown tools', async () => {
    expect(describeDestructiveAction('mystery_tool', {})).toContain('mystery_tool');
  });

  it('names what a change request will actually do', async () => {
    const prompt = describeDestructiveAction('request_change', {
      title: 'Add a /projects/tide-times page',
      request: 'the long body',
    });
    expect(prompt).toContain('Add a /projects/tide-times page');
    expect(prompt).toContain('GitHub issue');
  });

  it('falls back to the arguments rather than an empty question', async () => {
    // A destructive tool with no hand-written case must still tell the user
    // what it is about to act on — a bare "Proceed with X?" is not consent.
    const prompt = describeDestructiveAction('mystery_tool', { target: 'production-db' });
    expect(prompt).toContain('mystery_tool');
    expect(prompt).toContain('target: production-db');
  });

  it('says so explicitly when there is nothing to show', async () => {
    expect(describeDestructiveAction('mystery_tool', {})).toContain('no arguments');
  });

  it('drops routing args and truncates long values', async () => {
    const prompt = describeDestructiveAction('mystery_tool', {
      workflow_id: 'chat_123',
      body: 'x'.repeat(500),
    });
    expect(prompt).not.toContain('chat_123');
    expect(prompt).toContain('…');
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
