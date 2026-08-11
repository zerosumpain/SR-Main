import { describe, it, expect } from 'vitest';
import {
  isTransientProviderFailure,
  transientBackoffMs,
  MAX_CONSECUTIVE_TRANSIENT,
} from './transient-failure';

describe('isTransientProviderFailure', () => {
  // The exact payload that killed build 3d62ae01 after three good iterations.
  it('recognises the Codex overload that cost us a build', () => {
    expect(
      isTransientProviderFailure({
        kind: 'provider_error',
        message:
          'Codex error: {"type":"error","error":{"type":"service_unavailable_error","code":"server_is_overloaded","message":"Our servers are currently overloaded. Please try again later."}}',
      }),
    ).toBe(true);
  });

  it('treats rate_limited as transient whatever the message says', () => {
    expect(isTransientProviderFailure({ kind: 'rate_limited', message: '' })).toBe(true);
  });

  it.each([
    ['503 Service Unavailable'],
    ['502 Bad Gateway'],
    ['504 gateway timeout'],
    ['429 Too Many Requests'],
    ['Rate limit exceeded, retry after 20s'],
    ['read ECONNRESET'],
    ['connect ETIMEDOUT'],
    ['The service is temporarily unavailable'],
  ])('recognises %s', (message) => {
    expect(isTransientProviderFailure({ kind: 'provider_error', message })).toBe(true);
  });

  // The important negative: a real defect must still count towards the abort
  // threshold, or a genuinely broken build retries until its budget runs out.
  it.each([
    ['provider_error', 'Invalid API key supplied'],
    ['provider_error', 'context_length_exceeded: the prompt is too long'],
    ['nonzero_exit', 'pi exited with code 1'],
    ['no_progress', '3 consecutive iterations changed no files.'],
    ['design_lint_loop', 'linter rejected 3 consecutive iterations'],
    ['tooling_unavailable', 'the tool bridge did not load'],
  ])('does NOT treat %s / %s as transient', (kind, message) => {
    expect(isTransientProviderFailure({ kind, message })).toBe(false);
  });

  it('is false for no failure at all', () => {
    expect(isTransientProviderFailure(null)).toBe(false);
  });

  // A stalled stream is only transient when the message says why; a bare stall
  // is the watchdog naming itself, not evidence of an upstream problem.
  it('needs evidence before calling a stall transient', () => {
    expect(isTransientProviderFailure({ kind: 'stalled', message: 'went quiet for 300s' })).toBe(false);
    expect(isTransientProviderFailure({ kind: 'stalled', message: 'upstream 503' })).toBe(true);
  });
});

describe('transientBackoffMs', () => {
  it('grows with each consecutive failure', () => {
    const waits = [1, 2, 3, 4].map(transientBackoffMs);
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
    expect(new Set(waits).size).toBe(waits.length);
  });

  it('starts long enough to let a blip pass', () => {
    expect(transientBackoffMs(1)).toBeGreaterThanOrEqual(30_000);
  });

  // Unbounded exponential backoff inside a 480-minute build would eventually
  // wait longer than the build has left.
  it('caps so a retry never outlives the build', () => {
    expect(transientBackoffMs(99)).toBeLessThanOrEqual(5 * 60_000);
  });

  it('gives up before the total wait becomes absurd', () => {
    const total = Array.from({ length: MAX_CONSECUTIVE_TRANSIENT }, (_, i) => transientBackoffMs(i + 1)).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBeLessThanOrEqual(25 * 60_000);
  });
});
