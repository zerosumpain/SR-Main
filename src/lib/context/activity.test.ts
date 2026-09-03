import { describe, it, expect } from 'vitest';
import { withActivity, currentActivityId, untaggedOrigin } from './activity';

describe('withActivity', () => {
  it('is a no-op outside a wrapped call', () => {
    expect(currentActivityId()).toBeNull();
  });

  it('tags everything inside it', async () => {
    const seen = await withActivity('vision', async () => currentActivityId());
    expect(seen).toBe('vision');
    expect(currentActivityId()).toBeNull();
  });

  it('lets an INNER tag win, which is how a heartbeat scan is corrected', async () => {
    // heartbeat/engine.ts wraps every scan in the ACTIVITY's name, which is not
    // a workload id. The fix is an inner tag at the LLM call, so this ordering
    // is load-bearing rather than incidental.
    const seen = await withActivity('daydream-ponder', () =>
      withActivity('daydream', async () => currentActivityId()),
    );
    expect(seen).toBe('daydream');
  });
});

describe('untaggedOrigin', () => {
  it('says nothing when the call IS tagged', async () => {
    // The role is a better answer than a stack frame, and recording both would
    // put a second, weaker attribution next to the real one.
    const origin = await withActivity('vision', async () => untaggedOrigin());
    expect(origin).toBeNull();
  });

  it('names the caller when nothing has claimed the call', () => {
    function aRealisticCallSite() {
      return untaggedOrigin();
    }
    const origin = aRealisticCallSite();
    expect(origin).toBeTruthy();
    expect(origin).toContain('aRealisticCallSite');
    // `fn@file:line` — the shape the costs page renders.
    expect(origin).toMatch(/^[^@]*@?[\w.-]+:\d+$/);
  });

  it('skips the LLM plumbing every call passes through', () => {
    // Naming usage-capture would identify no caller at all, which is exactly
    // the state the untagged bucket was already in.
    const origin = untaggedOrigin();
    expect(origin).not.toMatch(/usage-capture|usage-log|context[/\\]activity/);
  });

  it('stays short enough to render in a table cell', () => {
    expect((untaggedOrigin() ?? '').length).toBeLessThanOrEqual(120);
  });
});
