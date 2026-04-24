import { describe, it, expect, afterEach, vi } from 'vitest';
import type { JobEvent } from './job-store';

afterEach(async () => {
  const { cleanOldJobs } = await import('./job-store');
  cleanOldJobs(0);
});

describe('runSubAgent', () => {
  it('emits subagent_start and subagent_done on the parent job', async () => {
    // Stub generalChat before importing runSubAgent so the dynamic import
    // inside runSubAgent picks up the mock. resetModules() also means we must
    // re-import job-store to get the same module instance sub-agent.ts uses.
    vi.resetModules();
    vi.doMock('./general-chat', () => ({
      generalChat: async () => ({ response: 'sub-agent done' }),
    }));
    const { runSubAgent } = await import('./sub-agent');
    const { createJob, subscribeJob } = await import('./job-store');

    const { jobId: parentId } = createJob('parent');
    const events: JobEvent[] = [];
    subscribeJob(parentId, (e) => events.push(e));

    await runSubAgent(parentId, { task: 'find x' }, { provider: 'openrouter', modelId: 'test' } as any);

    const starts = events.filter((e) => e.type === 'subagent_start');
    const dones = events.filter((e) => e.type === 'subagent_done');
    expect(starts.length).toBe(1);
    expect(dones.length).toBe(1);
    expect((dones[0] as any).summary).toBe('sub-agent done');
    vi.doUnmock('./general-chat');
  });

  it('rejects empty task', async () => {
    vi.resetModules();
    vi.doMock('./general-chat', () => ({
      generalChat: async () => ({ response: 'never' }),
    }));
    const { runSubAgent } = await import('./sub-agent');
    const { createJob } = await import('./job-store');
    const { jobId } = createJob('parent');
    await expect(runSubAgent(jobId, { task: '  ' }, { provider: 'openrouter', modelId: 'test' } as any))
      .rejects.toThrow(/non-empty task/);
    vi.doUnmock('./general-chat');
  });
});
