import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createUndoStore } from '$lib/blog/assistant/undo-store';

describe('undo store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('records and retrieves a snapshot', () => {
    const s = createUndoStore({ ttlMs: 60_000 });
    const token = s.put({ postId: 1, field: 'title', previousValue: 'old' });
    expect(s.take(token)).toEqual({ postId: 1, field: 'title', previousValue: 'old' });
  });

  it('returns null for unknown tokens', () => {
    const s = createUndoStore({ ttlMs: 60_000 });
    expect(s.take('nope')).toBeNull();
  });

  it('consumes the snapshot (single-use)', () => {
    const s = createUndoStore({ ttlMs: 60_000 });
    const token = s.put({ postId: 1, field: 'title', previousValue: 'old' });
    expect(s.take(token)).not.toBeNull();
    expect(s.take(token)).toBeNull();
  });

  it('expires after TTL', () => {
    const s = createUndoStore({ ttlMs: 1_000 });
    const token = s.put({ postId: 1, field: 'title', previousValue: 'old' });
    vi.advanceTimersByTime(2_000);
    expect(s.take(token)).toBeNull();
  });
});
