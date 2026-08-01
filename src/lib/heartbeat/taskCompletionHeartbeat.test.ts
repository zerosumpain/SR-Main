import { describe, it, expect, vi } from 'vitest';
import { handleHeartbeat } from './taskCompletionHeartbeat';
import type { PlatformCall } from '$lib/types/platform';

function createMockPlatform(overrides: {
  followups?: unknown;
  workflows?: unknown;
  schedule?: unknown;
} = {}): PlatformCall {
  return vi.fn(async (tool: string, name: string) => {
    if (tool === 'followups' && name === 'followup_status') {
      return overrides.followups ?? { items: [] };
    }
    if (tool === 'workflows' && name === 'workflow_list') {
      return overrides.workflows ?? { items: [] };
    }
    if (tool === 'schedule' && name === 'list_scheduled_callbacks') {
      return overrides.schedule ?? { items: [] };
    }
    throw new Error(`Unexpected call: ${tool}.${name}`);
  }) as PlatformCall;
}

describe('handleHeartbeat', () => {
  it('returns allLanded=true when nothing is pending', async () => {
    const platform = createMockPlatform();
    const result = await handleHeartbeat(platform);

    expect(result.allLanded).toBe(true);
    expect(result.pendingFollowUps).toBe(0);
    expect(result.activeWorkflows).toBe(0);
    expect(result.scheduledTasks).toBe(0);
    expect(result.summary).toContain('Everything is landed');
    expect(result.checkedAt).toBeTruthy();
  });

  it('detects pending follow-ups', async () => {
    const platform = createMockPlatform({
      followups: {
        items: [
          { id: '1', status: 'pending' },
          { id: '2', status: 'completed' },
          { id: '3', status: 'scheduled' },
        ],
      },
    });

    const result = await handleHeartbeat(platform);
    expect(result.allLanded).toBe(false);
    expect(result.pendingFollowUps).toBe(2);
    expect(result.summary).toContain('2 pending follow-ups');
  });

  it('detects active workflows', async () => {
    const platform = createMockPlatform({
      workflows: {
        items: [
          { id: 'w1', status: 'running' },
          { id: 'w2', status: 'completed' },
          { id: 'w3', status: 'queued' },
        ],
      },
    });

    const result = await handleHeartbeat(platform);
    expect(result.allLanded).toBe(false);
    expect(result.activeWorkflows).toBe(2);
    expect(result.summary).toContain('2 active workflows');
  });

  it('detects future scheduled callbacks', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    const platform = createMockPlatform({
      schedule: {
        items: [
          { id: 's1', at: future },
          { id: 's2', at: past },
          { id: 's3', scheduledAt: future },
        ],
      },
    });

    const result = await handleHeartbeat(platform);
    expect(result.allLanded).toBe(false);
    expect(result.scheduledTasks).toBe(2);
    expect(result.summary).toContain('2 scheduled tasks');
  });

  it('handles tool failures gracefully (fail-open)', async () => {
    const platform = vi.fn(async () => {
      throw new Error('tool unavailable');
    }) as PlatformCall;

    const result = await handleHeartbeat(platform);
    expect(result.allLanded).toBe(true);
    expect(result.pendingFollowUps).toBe(0);
    expect(result.activeWorkflows).toBe(0);
    expect(result.scheduledTasks).toBe(0);
  });

  it('combines multiple pending areas in summary', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const platform = createMockPlatform({
      followups: { items: [{ id: '1', status: 'pending' }] },
      workflows: { items: [{ id: 'w1', status: 'running' }] },
      schedule: { items: [{ id: 's1', at: future }] },
    });

    const result = await handleHeartbeat(platform);
    expect(result.allLanded).toBe(false);
    expect(result.summary).toContain('1 pending follow-up');
    expect(result.summary).toContain('1 active workflow');
    expect(result.summary).toContain('1 scheduled task');
  });

  it('handles direct array responses', async () => {
    const platform = createMockPlatform({
      followups: [{ id: '1', status: 'pending' }],
      workflows: [{ id: 'w1', status: 'running' }],
      schedule: [{ id: 's1', at: new Date(Date.now() + 60_000).toISOString() }],
    });

    const result = await handleHeartbeat(platform);
    expect(result.allLanded).toBe(false);
    expect(result.pendingFollowUps).toBe(1);
    expect(result.activeWorkflows).toBe(1);
    expect(result.scheduledTasks).toBe(1);
  });
});
