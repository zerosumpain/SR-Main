import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Module-level singleton, so each test gets a fresh copy via resetModules +
// dynamic import (same shape as open-tabs.test.ts). localStorage is stubbed
// because the suite runs in node: without it every persist would take the silent
// catch and the restore tests would prove nothing.
type Q = typeof import('./queued-sends.svelte');

let q: Q;
let store: Record<string, string>;

beforeEach(async () => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  vi.resetModules();
  q = await import('./queued-sends.svelte');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('queue order', () => {
  it('answers them in the order they were typed', () => {
    q.pushQueued('conv-1', 'one');
    q.pushQueued('conv-1', 'two');
    q.pushQueued('conv-1', 'three');
    expect(q.takeQueued('conv-1')).toBe('one');
    expect(q.takeQueued('conv-1')).toBe('two');
    expect(q.takeQueued('conv-1')).toBe('three');
    expect(q.takeQueued('conv-1')).toBeNull();
  });

  it('keeps threads apart', () => {
    // One pane per open tab, each with its own queue.
    q.pushQueued('conv-1', 'for one');
    q.pushQueued('conv-2', 'for two');
    expect(q.queuedFor('conv-1')).toEqual(['for one']);
    expect(q.queuedFor('conv-2')).toEqual(['for two']);
    expect(q.takeQueued('conv-1')).toBe('for one');
    expect(q.queuedFor('conv-2')).toEqual(['for two']);
  });

  it('has nothing queued for a thread that has none', () => {
    expect(q.queuedFor('nobody')).toEqual([]);
    expect(q.queuedFor(null)).toEqual([]);
  });

  it('drops the one you pointed at, by position', () => {
    q.pushQueued('conv-1', 'a');
    q.pushQueued('conv-1', 'b');
    q.pushQueued('conv-1', 'c');
    q.dropQueued('conv-1', 1);
    expect(q.queuedFor('conv-1')).toEqual(['a', 'c']);
  });

  it('forgets a deleted thread entirely', () => {
    q.pushQueued('conv-1', 'a');
    q.forgetQueued('conv-1');
    expect(q.queuedFor('conv-1')).toEqual([]);
  });
});

describe('across a reload', () => {
  it('restores what was still pending', async () => {
    q.pushQueued('conv-1', 'still waiting');
    q.pushQueued('conv-1', 'and this');

    vi.resetModules();
    const reloaded = await import('./queued-sends.svelte');
    reloaded.hydrateQueuedSends();
    expect(reloaded.queuedFor('conv-1')).toEqual(['still waiting', 'and this']);
  });

  it('does not restore one that has already been sent', async () => {
    // Taken BEFORE sending, so a reload cannot replay it.
    q.pushQueued('conv-1', 'gone');
    q.pushQueued('conv-1', 'kept');
    expect(q.takeQueued('conv-1')).toBe('gone');

    vi.resetModules();
    const reloaded = await import('./queued-sends.svelte');
    reloaded.hydrateQueuedSends();
    expect(reloaded.queuedFor('conv-1')).toEqual(['kept']);
  });

  it('drops a queue older than the restore window', async () => {
    // A queue is a statement about what to send NEXT. Firing yesterday's
    // half-thought at the model on a morning page load is worse than losing it.
    q.pushQueued('conv-1', 'from yesterday');
    const raw = JSON.parse(store['jkai.queuedSends']);
    store['jkai.queuedSends'] = JSON.stringify({ ...raw, savedAt: Date.now() - 3 * 60 * 60 * 1000 });

    vi.resetModules();
    const reloaded = await import('./queued-sends.svelte');
    reloaded.hydrateQueuedSends();
    expect(reloaded.queuedFor('conv-1')).toEqual([]);
    expect(store['jkai.queuedSends']).toBeUndefined();
  });

  it('survives a corrupt entry rather than throwing on page load', async () => {
    store['jkai.queuedSends'] = 'not json';
    vi.resetModules();
    const reloaded = await import('./queued-sends.svelte');
    expect(() => reloaded.hydrateQueuedSends()).not.toThrow();
    expect(reloaded.queuedFor('conv-1')).toEqual([]);
  });

  it('ignores junk inside an otherwise valid entry', async () => {
    store['jkai.queuedSends'] = JSON.stringify({
      savedAt: Date.now(),
      byConversation: { 'conv-1': ['real', '', '   ', 42, null], 'conv-2': 'not an array', 'conv-3': [] },
    });
    vi.resetModules();
    const reloaded = await import('./queued-sends.svelte');
    reloaded.hydrateQueuedSends();
    expect(reloaded.queuedFor('conv-1')).toEqual(['real']);
    expect(reloaded.queuedFor('conv-2')).toEqual([]);
    expect(reloaded.queuedFor('conv-3')).toEqual([]);
  });

  it('is idempotent, so every mounted pane can call it', async () => {
    q.pushQueued('conv-1', 'mine');
    vi.resetModules();
    const reloaded = await import('./queued-sends.svelte');
    reloaded.hydrateQueuedSends();
    reloaded.pushQueued('conv-1', 'typed after hydrating');
    // A second pane mounting must not wipe what the first has already done.
    reloaded.hydrateQueuedSends();
    expect(reloaded.queuedFor('conv-1')).toEqual(['mine', 'typed after hydrating']);
  });

  it('clears the entry once the last queue empties', () => {
    q.pushQueued('conv-1', 'only one');
    expect(store['jkai.queuedSends']).toBeDefined();
    q.takeQueued('conv-1');
    expect(store['jkai.queuedSends']).toBeUndefined();
  });
});
