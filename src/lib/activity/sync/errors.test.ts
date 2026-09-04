import { describe, expect, it } from 'vitest';
import {
  computeActivityRetryDelayMs,
  isRetryableActivityFailure,
  safeActivityErrorText,
} from './errors';

describe('activity sync failure policy', () => {
  it('retries temporary failures but not credentials, privacy or invalid data', () => {
    expect(isRetryableActivityFailure('rate_limited')).toBe(true);
    expect(isRetryableActivityFailure('temporary_provider')).toBe(true);
    expect(isRetryableActivityFailure('credential')).toBe(false);
    expect(isRetryableActivityFailure('private_source')).toBe(false);
    expect(isRetryableActivityFailure('invalid_payload')).toBe(false);
  });

  it('uses Retry-After ahead of exponential backoff', () => {
    expect(computeActivityRetryDelayMs({ attempt: 5, retryAfterMs: 123_000, jitter: 0 })).toBe(123_000);
  });

  it('bounds deterministic exponential backoff', () => {
    expect(computeActivityRetryDelayMs({ attempt: 1, baseMs: 1_000, jitter: 0 })).toBe(750);
    expect(
      computeActivityRetryDelayMs({ attempt: 20, baseMs: 1_000, maxMs: 10_000, jitter: 1 }),
    ).toBe(12_500);
  });

  it('redacts bearer and query secrets before persistence', () => {
    const safe = safeActivityErrorText(
      'Authorization: Bearer abc123 https://x.test/?access_token=secret&key=also-secret',
    );
    expect(safe).not.toContain('abc123');
    expect(safe).not.toContain('secret');
    expect(safe).toContain('[redacted]');
  });
});
