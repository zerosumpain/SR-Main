import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordPick, getRecentCounts, RECENTS_KEY, MAX_RECENTS } from '$lib/canvas/recents';

describe('recents', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it('records picks and returns counts', () => {
    recordPick('llm-call');
    recordPick('llm-call');
    recordPick('chat');
    const counts = getRecentCounts();
    expect(counts['llm-call']).toBe(2);
    expect(counts['chat']).toBe(1);
  });

  it('caps recent history at MAX_RECENTS', () => {
    for (let i = 0; i < MAX_RECENTS + 5; i++) recordPick('chat');
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY)!);
    expect(raw.length).toBe(MAX_RECENTS);
  });

  it('returns empty counts when localStorage is unset', () => {
    expect(getRecentCounts()).toEqual({});
  });

  it('handles corrupted storage gracefully', () => {
    localStorage.setItem(RECENTS_KEY, 'not-json');
    expect(getRecentCounts()).toEqual({});
  });
});
