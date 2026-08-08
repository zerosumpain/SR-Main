import { describe, it, expect } from 'vitest';
import { classifyFailure, type ClassifyInput } from './pi-runner';

// This function got two production builds diagnosed wrong on 2026-08-07: a
// watchdog kill was reported as `auth_failed` because the bridge extension had
// logged "manifest fetch failed: 401" to the same stderr stream. Everything
// here pins the ordering that prevents a repeat.

const base = (over: Partial<ClassifyInput> = {}): ClassifyInput => ({
  stalled: false,
  stalledAgeMs: 0,
  wallClockHit: false,
  tokenCapHit: false,
  exitCode: 0,
  errorMessage: null,
  providerHttpStatus: undefined,
  providerErrorCode: undefined,
  stderrTail: '',
  tokensUsed: 0,
  maxWallClockMs: 30 * 60 * 1000,
  ...over,
});

const BRIDGE_LINE = '[jkai-tools] manifest fetch failed: 401\n';

describe('classifyFailure', () => {
  it('returns null for a clean run', () => {
    expect(classifyFailure(base())).toBeNull();
  });

  it('does not fail a successful iteration just because the bridge logged once', () => {
    // The extension fetches the manifest once at startup and lets pi continue.
    // That line survives in stderrTail for the whole run.
    expect(classifyFailure(base({ stderrTail: BRIDGE_LINE }))).toBeNull();
  });

  it('does not read an extension log line as a provider auth failure', () => {
    const f = classifyFailure(
      base({
        stalled: true,
        stalledAgeMs: 183_000,
        exitCode: 143,
        errorMessage: BRIDGE_LINE,
        stderrTail: BRIDGE_LINE,
        tokensUsed: 1_308_560,
      }),
    );
    // The exact 2026-08-07 input. It must NOT come back as auth_failed.
    expect(f?.kind).toBe('tooling_unavailable');
  });

  it('still reports a real provider auth failure', () => {
    const f = classifyFailure(base({ exitCode: 1, providerHttpStatus: 401 }));
    expect(f?.kind).toBe('auth_failed');
  });

  it('prefers an explicit provider 401 over the bridge diagnosis', () => {
    const f = classifyFailure(
      base({ exitCode: 1, providerHttpStatus: 401, stderrTail: BRIDGE_LINE }),
    );
    expect(f?.kind).toBe('auth_failed');
  });

  it('never lets the bridge diagnosis steal a continuable budget stop', () => {
    // Both of these preserve their work and continue; tooling_unavailable
    // aborts. Losing an iteration's work to a stale stderr line would undo the
    // whole point of the budget stops.
    expect(
      classifyFailure(base({ tokenCapHit: true, exitCode: 143, stderrTail: BRIDGE_LINE }))?.kind,
    ).toBe('iteration_token_cap');
    expect(
      classifyFailure(base({ wallClockHit: true, exitCode: 143, stderrTail: BRIDGE_LINE }))?.kind,
    ).toBe('wall_clock_timeout');
  });

  it('reports a plain stall as a stall', () => {
    const f = classifyFailure(base({ stalled: true, stalledAgeMs: 180_000, exitCode: 143, tokensUsed: 42 }));
    expect(f?.kind).toBe('stalled');
    // The message must not claim to know the cause — it names the watchdog.
    expect(f?.message).toMatch(/watchdog|stderrTail/i);
  });

  it('still catches a text-only auth failure from the provider', () => {
    const f = classifyFailure(
      base({ exitCode: 1, errorMessage: '401 Unauthorized: invalid api key' }),
    );
    expect(f?.kind).toBe('auth_failed');
  });

  it('reports rate limits', () => {
    expect(classifyFailure(base({ exitCode: 1, providerHttpStatus: 429 }))?.kind).toBe(
      'rate_limited',
    );
  });
});
