import { describe, it, expect } from 'vitest';
import { isCreditHeadroomError, isRateLimitError } from './resilience';

/**
 * OpenRouter reserves credit for the full `max_tokens` before running a call.
 * On a nearly-spent balance it refuses large reservations while still serving
 * the same prompt at a smaller ceiling — measured 2026-08-14: 500 and 1,000
 * returned 200, 2,000 and above returned 402. That makes it retryable, and
 * distinguishing it from a genuine rate limit is what lets the retry pick the
 * right remedy (a lower ceiling, not a different model).
 */
describe('isCreditHeadroomError', () => {
  it('matches the OpenRouter 402 wording', () => {
    expect(
      isCreditHeadroomError({
        status: 402,
        message: 'This request requires more credits, or fewer max_tokens.',
      }),
    ).toBe(true);
  });

  it('matches when the message is nested under error', () => {
    expect(
      isCreditHeadroomError({
        status: 402,
        error: { message: 'This request requires more credits, or fewer max_tokens.' },
      }),
    ).toBe(true);
  });

  // The distinctive phrase is enough on its own — providers move status codes
  // around, and this is the sentence that names the remedy.
  it('matches on the phrase even without the status code', () => {
    expect(isCreditHeadroomError({ message: 'requires more credits, or fewer max_tokens' })).toBe(true);
  });

  it('ignores unrelated failures', () => {
    expect(isCreditHeadroomError({ status: 429, message: 'rate limit exceeded' })).toBe(false);
    expect(isCreditHeadroomError({ status: 500, message: 'internal error' })).toBe(false);
    expect(isCreditHeadroomError(new Error('socket hang up'))).toBe(false);
    expect(isCreditHeadroomError(undefined)).toBe(false);
  });

  // A 402 that is genuinely about an empty account, with no mention of credits,
  // should not be mistaken for the retryable headroom case.
  it('requires the error to actually mention credit when matching on status alone', () => {
    expect(isCreditHeadroomError({ status: 402, message: 'payment required' })).toBe(false);
  });

  it('is distinct from a rate limit', () => {
    const credit = { status: 402, message: 'This request requires more credits, or fewer max_tokens.' };
    expect(isCreditHeadroomError(credit)).toBe(true);
    expect(isRateLimitError(credit)).toBe(false);
  });
});
