import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The scheduler contract, extracted as the two lines that actually mattered.
 *
 * `scheduleNext` had fourteen call sites and assigned `loopTimer` without
 * clearing it, so any two of them left two live timers and the orchestrator ran
 * one build's iterations CONCURRENTLY. Build 42244cc0 (2026-08-17) ran eleven
 * overlapping iterations — 1 and 2 started in the same second — each agent
 * redoing work another had done, all of them writing to one workspace, and the
 * read-modify-write on `iterationsCompleted` losing six of eleven increments so
 * `maxIterations: 8` never bound.
 *
 * The orchestrator itself cannot be imported here: it boots platform services
 * through `$lib/workflows` (see `bridge-token.ts`). So this pins the behaviour
 * of the pattern, and the guard it now carries.
 */
class Loop {
  timer: ReturnType<typeof setTimeout> | null = null;
  iterating: string | null = null;
  runs: string[] = [];
  concurrent = 0;
  maxConcurrent = 0;

  schedule(buildId: string, delayMs = 0) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(buildId), delayMs);
  }

  async run(buildId: string) {
    if (this.iterating) return; // refuse, and do NOT reschedule
    this.iterating = buildId;
    this.concurrent++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
    this.runs.push(buildId);
    try {
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      this.concurrent--;
      if (this.iterating === buildId) this.iterating = null;
    }
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('arming the loop', () => {
  it('replaces the armed timer instead of adding a second one', async () => {
    const loop = new Loop();
    // Two entry points both arming the loop — start and, say, plan approval.
    loop.schedule('b1');
    loop.schedule('b1');
    loop.schedule('b1');
    await vi.advanceTimersByTimeAsync(200);
    expect(loop.runs).toEqual(['b1']);
  });

  it('never runs two iterations of a build at once', async () => {
    const loop = new Loop();
    // Bypass the timer entirely: a late-resolving promise could call run()
    // directly while one is in flight, which clearTimeout cannot prevent.
    const a = loop.run('b1');
    const b = loop.run('b1');
    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([a, b]);
    expect(loop.maxConcurrent).toBe(1);
    expect(loop.runs).toEqual(['b1']);
  });

  it('releases the guard so the next iteration can run', async () => {
    const loop = new Loop();
    await Promise.all([loop.run('b1'), vi.advanceTimersByTimeAsync(100)]);
    expect(loop.iterating).toBeNull();
    await Promise.all([loop.run('b1'), vi.advanceTimersByTimeAsync(100)]);
    expect(loop.runs).toEqual(['b1', 'b1']);
  });

  it('a refused call does not arm another timer', async () => {
    // Rescheduling from inside a rejected call is how one build ends up with a
    // growing pile of timers — the in-flight iteration arms the next one.
    const loop = new Loop();
    const inflight = loop.run('b1');
    await loop.run('b1');
    expect(loop.timer).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    await inflight;
  });
});

describe('the guard must never stick', () => {
  /*
   * A leaked guard is worse than the concurrency it prevents: the build refuses
   * every later iteration forever. It was originally set before the try block
   * and before the liveness ticker started, so anything throwing in between
   * would have deadlocked the build permanently.
   */
  class ThrowingLoop extends Loop {
    override async run(buildId: string) {
      if (this.iterating) return;
      this.iterating = buildId;
      let ticker: ReturnType<typeof setInterval> | null = null;
      try {
        ticker = null;
        throw new Error('startLivenessTicker blew up');
      } finally {
        if (ticker) clearInterval(ticker);
        if (this.iterating === buildId) this.iterating = null;
      }
    }
  }

  it('releases even when the iteration throws before doing anything', async () => {
    const loop = new ThrowingLoop();
    await expect(loop.run('b1')).rejects.toThrow('blew up');
    expect(loop.iterating).toBeNull();
    // and the build is still able to iterate afterwards
    await expect(loop.run('b1')).rejects.toThrow('blew up');
  });
});
