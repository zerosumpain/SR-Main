/**
 * Concurrency limiter for the deep-research engine.
 *
 * `pLimit(max)` returns a wrapper function that queues async tasks so that at
 * most `max` are executing concurrently at any point in time (classic
 * counting-semaphore). Tasks beyond the limit are queued and start as soon as
 * a running slot becomes free.
 *
 * Usage:
 *   const limit = pLimit(3);
 *   const results = await Promise.all(items.map(item => limit(() => processItem(item))));
 */
export function pLimit(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`pLimit: max must be a positive integer, got ${max}`);
  }

  let active = 0;
  const queue: Array<() => void> = [];

  function tryNext(): void {
    if (active >= max || queue.length === 0) return;
    const run = queue.shift()!;
    active++;
    run();
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(
          (value) => {
            resolve(value);
            active--;
            tryNext();
          },
          (err) => {
            reject(err);
            active--;
            tryNext();
          },
        );
      };

      queue.push(run);
      tryNext();
    });
  };
}

/**
 * Read the DEEPDIVE_LLM_CONCURRENCY env var (or keys.json override not
 * needed — env is sufficient here).  Falls back to 3.
 *
 * Kept in a function so test code can re-invoke after setting process.env.
 */
export function getLlmConcurrencyLimit(): number {
  const raw = process.env.DEEPDIVE_LLM_CONCURRENCY;
  if (!raw) return 3;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 3;
}
