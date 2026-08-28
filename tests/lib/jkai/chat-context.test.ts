import { describe, it, expect } from 'vitest';
import {
  withChatContext,
  currentChatContext,
  currentChatSessionId,
} from '$lib/context/chat';

describe('chat call context', () => {
  it('reports nothing outside a turn', () => {
    expect(currentChatContext()).toBeNull();
    expect(currentChatSessionId()).toBeNull();
  });

  it('prefers the job over the conversation — rounds per TURN is the metric', async () => {
    // A conversation-level id would average rounds-per-turn away, which is the
    // one number the whole exercise turns on.
    await withChatContext({ jobId: 'job-1', conversationId: 'conv-1' }, async () => {
      expect(currentChatSessionId()).toBe('job-1');
    });
  });

  it('falls back to the conversation when there is no job', async () => {
    await withChatContext({ conversationId: 'conv-1' }, async () => {
      expect(currentChatSessionId()).toBe('conv-1');
    });
  });

  it('carries the conversation id alongside, for turns that write no trace row', async () => {
    // jkai_tool_traces only gets a row when a turn calls a tool, so a tool-free
    // turn's jobId joins to nothing. The conversation id is the fallback path
    // back to the thread.
    await withChatContext({ jobId: 'job-1', conversationId: 'conv-1' }, async () => {
      expect(currentChatContext()).toEqual({ jobId: 'job-1', conversationId: 'conv-1' });
    });
  });

  it('does not leak past the turn', async () => {
    await withChatContext({ jobId: 'job-1' }, async () => {
      expect(currentChatSessionId()).toBe('job-1');
    });
    expect(currentChatSessionId()).toBeNull();
  });

  it('does not leak sideways into a concurrent turn', async () => {
    // The reason this is AsyncLocalStorage and not a module-level variable.
    // Two turns run at once on one process; a shared mutable would bill one
    // turn's rounds to the other.
    const seen: string[] = [];
    await Promise.all([
      withChatContext({ jobId: 'a' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(currentChatSessionId() ?? 'none');
      }),
      withChatContext({ jobId: 'b' }, async () => {
        seen.push(currentChatSessionId() ?? 'none');
      }),
    ]);
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('survives an await inside the turn', async () => {
    await withChatContext({ jobId: 'job-1' }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(currentChatSessionId()).toBe('job-1');
    });
  });

  it('restores the outer turn after a nested one — a sub-agent must not steal the parent', async () => {
    await withChatContext({ jobId: 'parent' }, async () => {
      await withChatContext({ jobId: 'child' }, async () => {
        expect(currentChatSessionId()).toBe('child');
      });
      expect(currentChatSessionId()).toBe('parent');
    });
  });
});
