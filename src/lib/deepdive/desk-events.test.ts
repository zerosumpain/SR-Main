import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  nextSeq,
  emitArtefact,
  flushArtefacts,
  disposeArtefacts,
  __setEmitForTest,
  __resetForTest,
} from './desk-events';
import type { SSEEvent } from './types';

type Captured = { sessionId: string; event: SSEEvent };

describe('desk-events', () => {
  let captured: Captured[];

  beforeEach(() => {
    captured = [];
    __resetForTest();
    __setEmitForTest((sessionId, event) => captured.push({ sessionId, event }));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    __setEmitForTest(null);
  });

  describe('nextSeq', () => {
    it('is monotonic starting at 1 for a session', () => {
      expect(nextSeq('s1')).toBe(1);
      expect(nextSeq('s1')).toBe(2);
      expect(nextSeq('s1')).toBe(3);
    });

    it('is isolated per session', () => {
      expect(nextSeq('a')).toBe(1);
      expect(nextSeq('b')).toBe(1);
      expect(nextSeq('a')).toBe(2);
      expect(nextSeq('b')).toBe(2);
      expect(nextSeq('a')).toBe(3);
    });
  });

  describe('emitArtefact coalescing', () => {
    it('does not emit synchronously — it queues', () => {
      emitArtefact('s1', 'source', 1, { id: 'src-1', url: 'http://a' });
      expect(captured.length).toBe(0);
    });

    it('flushes the whole queue on the ~100ms timer, one event per artefact in seq order', () => {
      emitArtefact('s1', 'source', 1, { id: 'src-1', url: 'http://a' });
      emitArtefact('s1', 'fact', 2, { id: 'fact-1', content: 'x' });
      emitArtefact('s1', 'entity', 2, { id: 'ent-1', name: 'Acme' });
      expect(captured.length).toBe(0);

      vi.advanceTimersByTime(100);

      expect(captured.length).toBe(3);
      expect(captured.every((c) => c.sessionId === 's1')).toBe(true);
      expect(captured.every((c) => c.event.type === 'artefact')).toBe(true);

      const seqs = captured.map((c) => c.event.data!.seq as number);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b)); // ordering preserved
      expect(new Set(seqs).size).toBe(3); // all distinct

      expect(captured[0].event.data).toMatchObject({
        artefactType: 'source',
        id: 'src-1',
        phase: 1,
        url: 'http://a',
      });
      expect(typeof captured[0].event.data!.seq).toBe('number');
    });

    it('coalesces many emits into a single timer flush (no synchronous storm)', () => {
      for (let i = 0; i < 50; i++) {
        emitArtefact('s1', 'fact', 2, { id: `fact-${i}`, content: `c${i}` });
      }
      expect(captured.length).toBe(0); // nothing yet — all queued under one timer
      vi.advanceTimersByTime(100);
      expect(captured.length).toBe(50);
      const ids = captured.map((c) => c.event.data!.id);
      expect(ids).toEqual(Array.from({ length: 50 }, (_, i) => `fact-${i}`)); // order preserved
    });

    it('keeps per-session queues separate', () => {
      emitArtefact('s1', 'fact', 2, { id: 'a' });
      emitArtefact('s2', 'fact', 2, { id: 'b' });
      vi.advanceTimersByTime(100);
      const s1 = captured.filter((c) => c.sessionId === 's1');
      const s2 = captured.filter((c) => c.sessionId === 's2');
      expect(s1.map((c) => c.event.data!.id)).toEqual(['a']);
      expect(s2.map((c) => c.event.data!.id)).toEqual(['b']);
    });
  });

  describe('flushArtefacts', () => {
    it('drains the queue immediately without waiting for the timer', () => {
      emitArtefact('s1', 'source', 1, { id: 'src-1' });
      emitArtefact('s1', 'fact', 2, { id: 'fact-1' });
      flushArtefacts('s1');
      expect(captured.length).toBe(2);
      // timer flush after an explicit flush must not double-emit
      vi.advanceTimersByTime(100);
      expect(captured.length).toBe(2);
    });

    it('is a no-op when the queue is empty', () => {
      flushArtefacts('s1');
      expect(captured.length).toBe(0);
    });
  });

  describe('disposeArtefacts', () => {
    it('flushes any pending queued artefacts before disposing (no loss)', () => {
      emitArtefact('s1', 'source', 1, { id: 'src-1', url: 'http://a' });
      emitArtefact('s1', 'fact', 2, { id: 'fact-1', content: 'x' });
      // Timer has NOT fired yet — artefacts are still queued.
      expect(captured.length).toBe(0);

      disposeArtefacts('s1');

      // Both artefacts must have been flushed before disposal.
      expect(captured.length).toBe(2);
      expect(captured.map((c) => c.event.data!.id)).toEqual(['src-1', 'fact-1']);
    });

    it('removes the session from both maps so nextSeq restarts at 1', () => {
      emitArtefact('s1', 'fact', 2, { id: 'f1' });
      // Advance seq to 3 so we can verify the counter is truly reset.
      nextSeq('s1'); // 2
      nextSeq('s1'); // 3

      disposeArtefacts('s1');

      // The timer is gone — advancing should not double-emit.
      vi.advanceTimersByTime(100);
      // Only the one artefact flushed during dispose (seq=1); nothing more.
      expect(captured.length).toBe(1);

      // After disposal the seq counter is gone; the next call restarts at 1.
      expect(nextSeq('s1')).toBe(1);
    });

    it('is safe and idempotent when nothing is queued', () => {
      // Pre-seed a seq counter but no queued artefact.
      nextSeq('s1');
      nextSeq('s1'); // now at 2

      expect(() => disposeArtefacts('s1')).not.toThrow();
      expect(() => disposeArtefacts('s1')).not.toThrow(); // second call also safe
      expect(captured.length).toBe(0);

      // Counter reset — restarts at 1.
      expect(nextSeq('s1')).toBe(1);
    });

    it('does not affect other sessions', () => {
      emitArtefact('s1', 'fact', 1, { id: 'a' });
      emitArtefact('s2', 'fact', 1, { id: 'b' });
      nextSeq('s2'); // s2 seq now at 2

      disposeArtefacts('s1');

      // s1 flushed, s2 still pending.
      expect(captured.length).toBe(1);
      expect(captured[0].event.data!.id).toBe('a');

      // s2 timer fires normally.
      vi.advanceTimersByTime(100);
      expect(captured.length).toBe(2);
      expect(captured[1].event.data!.id).toBe('b');

      // s2 seq counter is intact.
      expect(nextSeq('s2')).toBe(3);
    });
  });
});
