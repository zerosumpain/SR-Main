import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The tab set is a module-level singleton, so each test gets a fresh copy via
// resetModules + dynamic import (same shape as throughput-bus.test.ts).
// localStorage is stubbed because the suite runs in node: without it every
// persist would take the silent catch and the restore tests would prove nothing.
type Tabs = typeof import('./open-tabs.svelte');

let tabs: Tabs;
let store: Record<string, string>;

beforeEach(async () => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  vi.resetModules();
  tabs = await import('./open-tabs.svelte');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('opening tabs', () => {
  it('puts a newly opened thread on screen', () => {
    tabs.openTab('a');
    tabs.openTab('b');
    expect(tabs.openTabs.items.map((t) => t.id)).toEqual(['a', 'b']);
    expect(tabs.openTabs.activeId).toBe('b');
  });

  it('raises the existing tab instead of opening a second one', () => {
    tabs.openTab('a');
    tabs.openTab('b');
    expect(tabs.openTab('a')).toBe(true);
    expect(tabs.openTabs.items).toHaveLength(2);
    expect(tabs.openTabs.activeId).toBe('a');
  });

  it('refuses past the limit and says so, rather than silently dropping one', () => {
    for (let i = 0; i < tabs.MAX_TABS; i++) tabs.openTab(`t${i}`);
    expect(tabs.openTab('one-too-many')).toBe(false);
    expect(tabs.openTabs.items).toHaveLength(tabs.MAX_TABS);
    expect(tabs.openTabs.limitHit).toBe(true);
    // The refused thread must not have stolen the screen either.
    expect(tabs.openTabs.activeId).toBe(`t${tabs.MAX_TABS - 1}`);
  });
});

describe('closing tabs', () => {
  it('lands on the neighbour to the right', () => {
    tabs.openTab('a');
    tabs.openTab('b');
    tabs.openTab('c');
    tabs.activateTab('b');
    tabs.closeTab('b');
    expect(tabs.openTabs.activeId).toBe('c');
  });

  it('lands on the last tab when the rightmost one closes', () => {
    tabs.openTab('a');
    tabs.openTab('b');
    tabs.closeTab('b');
    expect(tabs.openTabs.activeId).toBe('a');
  });

  it('leaves the screen empty when the last tab closes', () => {
    tabs.openTab('a');
    tabs.closeTab('a');
    expect(tabs.openTabs.items).toEqual([]);
    expect(tabs.openTabs.activeId).toBeNull();
  });

  it('does not move the screen when a background tab closes', () => {
    tabs.openTab('a');
    tabs.openTab('b');
    tabs.closeTab('a');
    expect(tabs.openTabs.activeId).toBe('b');
  });

  it('clears the limit warning, since closing is the fix it asks for', () => {
    for (let i = 0; i < tabs.MAX_TABS; i++) tabs.openTab(`t${i}`);
    tabs.openTab('refused');
    expect(tabs.openTabs.limitHit).toBe(true);
    tabs.closeTab('t0');
    expect(tabs.openTabs.limitHit).toBe(false);
  });
});

describe('activity', () => {
  it('clears a reply badge when you look at the thread', () => {
    tabs.openTab('a');
    tabs.openTab('b');
    tabs.setTabActivity('a', 'reply');
    tabs.activateTab('a');
    expect(tabs.openTabs.items.find((t) => t.id === 'a')?.activity).toBe('idle');
  });

  it('does not clear a thread that has started working again', () => {
    // The badge means "a reply landed while you were away". A thread mid-turn
    // must keep its live dot when you switch to it, or the strip goes quiet
    // while work is still running.
    tabs.openTab('a');
    tabs.openTab('b');
    tabs.setTabActivity('a', 'running');
    tabs.activateTab('a');
    expect(tabs.openTabs.items.find((t) => t.id === 'a')?.activity).toBe('running');
  });

  it('ignores activity for a thread that is no longer open', () => {
    tabs.openTab('a');
    tabs.closeTab('a');
    tabs.setTabActivity('a', 'running');
    expect(tabs.openTabs.items).toEqual([]);
  });
});

describe('cycling', () => {
  it('wraps in both directions', () => {
    tabs.openTab('a');
    tabs.openTab('b');
    tabs.openTab('c');
    tabs.activateTab('c');
    tabs.cycleTab(1);
    expect(tabs.openTabs.activeId).toBe('a');
    tabs.cycleTab(-1);
    expect(tabs.openTabs.activeId).toBe('c');
  });

  it('does nothing with a single tab', () => {
    tabs.openTab('a');
    tabs.cycleTab(1);
    expect(tabs.openTabs.activeId).toBe('a');
  });
});

describe('persistence', () => {
  it('restores the set and the thread that was on screen', async () => {
    tabs.openTab('a');
    tabs.openTab('b');
    tabs.activateTab('a');

    vi.resetModules();
    const reloaded = await import('./open-tabs.svelte');
    const stored = reloaded.readStoredTabs();
    expect(stored.ids).toEqual(['a', 'b']);
    expect(stored.activeId).toBe('a');
  });

  it('ignores a set older than the resume window', async () => {
    tabs.openTab('a');
    // Rewrite the stamp to three hours ago — a day-old working set is noise,
    // not a working set.
    const raw = JSON.parse(store['jkai.openTabs']);
    store['jkai.openTabs'] = JSON.stringify({ ...raw, savedAt: Date.now() - 3 * 60 * 60 * 1000 });

    vi.resetModules();
    const reloaded = await import('./open-tabs.svelte');
    expect(reloaded.readStoredTabs().ids).toEqual([]);
  });

  it('survives a corrupt entry rather than throwing on load', async () => {
    store['jkai.openTabs'] = 'not json';
    vi.resetModules();
    const reloaded = await import('./open-tabs.svelte');
    expect(reloaded.readStoredTabs()).toEqual({ ids: [], activeId: null });
  });

  it('falls back to the first tab when the saved active id is not in the set', () => {
    // Happens when the thread on screen last visit has since been deleted, so
    // the page filters it out of the ids it hands back.
    tabs.restoreTabs(['a', 'b'], 'gone');
    expect(tabs.openTabs.activeId).toBe('a');
  });
});
