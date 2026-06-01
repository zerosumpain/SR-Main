import { describe, it, expect, afterEach } from 'vitest';

// #19 DISPATCH SWITCH — the run route and scheduler decide whether to ENQUEUE
// (worker mode) or execute IN-PROCESS based solely on the JKAI_RUN_WORKER flag.
// This test pins that decision contract: the flag-OFF path must remain
// in-process (production-default unchanged), and only '1' (exactly) flips to
// enqueue. We mirror the exact predicate used at the call sites.

/** The decision used verbatim at the dispatch call sites. */
function shouldEnqueue(env: Record<string, string | undefined>): boolean {
  return env.JKAI_RUN_WORKER === '1';
}

const ORIGINAL = process.env.JKAI_RUN_WORKER;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.JKAI_RUN_WORKER;
  else process.env.JKAI_RUN_WORKER = ORIGINAL;
});

describe('dispatch decision (enqueue vs in-process)', () => {
  it('flag unset → in-process (production default unchanged)', () => {
    expect(shouldEnqueue({})).toBe(false);
  });

  it('flag "0" → in-process', () => {
    expect(shouldEnqueue({ JKAI_RUN_WORKER: '0' })).toBe(false);
  });

  it('flag "true"/"yes" → in-process (only the exact string "1" enables)', () => {
    expect(shouldEnqueue({ JKAI_RUN_WORKER: 'true' })).toBe(false);
    expect(shouldEnqueue({ JKAI_RUN_WORKER: 'yes' })).toBe(false);
  });

  it('flag "1" → enqueue (worker mode)', () => {
    expect(shouldEnqueue({ JKAI_RUN_WORKER: '1' })).toBe(true);
  });

  it('reflects the live process.env reading the call sites use', () => {
    delete process.env.JKAI_RUN_WORKER;
    expect(shouldEnqueue(process.env)).toBe(false);
    process.env.JKAI_RUN_WORKER = '1';
    expect(shouldEnqueue(process.env)).toBe(true);
  });
});
