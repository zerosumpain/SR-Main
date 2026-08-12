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

  it('names the missing pi login instead of reporting a bare exit code', () => {
    // Verbatim from pi 0.72.1 on the VPS with no ChatGPT login. It arrives on
    // stderr with exit 1 and NO provider output, so without this branch the
    // build record just said "pi exited with code 1".
    const f = classifyFailure(
      base({
        exitCode: 1,
        stderrTail:
          'Warning: Model "gpt-5.6-terra" not found for provider "openai-codex". Using custom model id.\n' +
          'No API key found for openai-codex.\n\nUse /login to log into a provider via OAuth or API key.',
      }),
    );
    expect(f?.kind).toBe('auth_failed');
    expect(f?.message).toMatch(/\/login/);
    expect(f?.message).toMatch(/\.pi\/agent\/auth\.json/);
  });

  it('does not read a stale login line as a failure on a clean run', () => {
    expect(
      classifyFailure(base({ exitCode: 0, stderrTail: 'No API key found for openai-codex.' })),
    ).toBeNull();
  });
});

// A provider error must survive pi's exit code.
//
// The classifier used to require `exitCode === 0` to call something a
// `provider_error`, on the (currently true) observation that pi reports the
// error and then exits cleanly. That coupling was load-bearing in the wrong
// direction: `isTransientProviderFailure` only accepts `provider_error`,
// `stalled` and `rate_limited`, so a Codex overload arriving with a non-zero
// exit would have become `nonzero_exit` and aborted the build on the FIRST
// blip. Change request #223 absorbed four of them.
describe('classifyFailure — provider errors vs pi’s exit code', () => {
  const OVERLOADED =
    '{"type":"error","error":{"type":"service_unavailable_error","code":"server_is_overloaded"}}';

  it('still classifies the ordinary case (provider reports, pi exits 0)', () => {
    const f = classifyFailure(base({ errorMessage: OVERLOADED, exitCode: 0, providerReportedError: true }));
    expect(f?.kind).toBe('provider_error');
  });

  it('classifies a provider error that arrives with a NON-ZERO exit', () => {
    const f = classifyFailure(base({ errorMessage: OVERLOADED, exitCode: 1, providerReportedError: true }));
    expect(f?.kind).toBe('provider_error');
  });

  it('does NOT promote a crash whose stderr merely mentions a 5xx', () => {
    // `errorMessage` is synthesised from stderr on a non-zero exit, and the
    // transient patterns match a bare "503" anywhere in the string. Retrying
    // this forever is the failure mode the flag exists to prevent.
    const f = classifyFailure(
      base({
        errorMessage: 'TypeError: cannot read x\n  at foo (bar.ts:503)',
        exitCode: 1,
        providerReportedError: false,
      }),
    );
    expect(f?.kind).toBe('nonzero_exit');
  });

  it('falls back to the exit code when nobody said who wrote the message', () => {
    // Older callers and fixtures do not set the flag; absent must behave as
    // before rather than throwing or silently reclassifying.
    expect(classifyFailure(base({ errorMessage: OVERLOADED, exitCode: 0 }))?.kind).toBe('provider_error');
    expect(classifyFailure(base({ errorMessage: 'boom', exitCode: 1 }))?.kind).toBe('nonzero_exit');
  });

  it('the whole point: the non-zero case is now retryable', async () => {
    const { isTransientProviderFailure } = await import('./transient-failure');
    const f = classifyFailure(base({ errorMessage: OVERLOADED, exitCode: 1, providerReportedError: true }));
    expect(isTransientProviderFailure(f)).toBe(true);
  });
});
