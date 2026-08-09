import { describe, it, expect } from 'vitest';
import {
  codexMeter,
  formatResetIn,
  formatWindowLabel,
  isSubscriptionModelId,
  type CodexUsageView,
} from './usage-meter';

const NOW = 1_786_000_000_000;

const usage = (over: Partial<CodexUsageView> = {}): CodexUsageView => ({
  planType: 'plus',
  windows: [{ usedPercent: 3, windowSeconds: 604_800, resetAt: NOW + 6 * 86_400_000 }],
  headline: { usedPercent: 3, windowSeconds: 604_800, resetAt: NOW + 6 * 86_400_000 },
  limitReached: false,
  creditBalanceUsd: null,
  fetchedAt: NOW,
  ...over,
});

describe('isSubscriptionModelId', () => {
  it('recognises the codex/ prefix and nothing else', () => {
    expect(isSubscriptionModelId('codex/gpt-5.6-terra')).toBe(true);
    expect(isSubscriptionModelId('google/gemini-3.5-flash')).toBe(false);
    // A bare Codex slug is exactly the case the prefix exists to prevent —
    // without it the id would be posted to OpenRouter as an unknown model.
    expect(isSubscriptionModelId('gpt-5.6-terra')).toBe(false);
    expect(isSubscriptionModelId(null)).toBe(false);
    expect(isSubscriptionModelId(undefined)).toBe(false);
  });
});

describe('formatWindowLabel', () => {
  it('names the windows ChatGPT actually reports', () => {
    expect(formatWindowLabel(604_800)).toBe('WEEKLY');
    expect(formatWindowLabel(86_400)).toBe('DAILY');
    expect(formatWindowLabel(18_000)).toBe('5H');
    expect(formatWindowLabel(1_800)).toBe('30M');
  });

  it('degrades to a generic label rather than NaN', () => {
    expect(formatWindowLabel(0)).toBe('LIMIT');
    expect(formatWindowLabel(Number.NaN)).toBe('LIMIT');
  });
});

describe('formatResetIn', () => {
  it('picks a unit that stays two characters wide', () => {
    expect(formatResetIn(NOW + 25 * 60_000, NOW)).toBe('25m');
    expect(formatResetIn(NOW + 4 * 3_600_000, NOW)).toBe('4h');
    expect(formatResetIn(NOW + 6 * 86_400_000, NOW)).toBe('6d');
  });

  it('handles a window that has already rolled over', () => {
    expect(formatResetIn(NOW - 1000, NOW)).toBe('now');
    expect(formatResetIn(null, NOW)).toBe(null);
  });
});

describe('codexMeter', () => {
  it('stays out of the way for an OpenRouter model', () => {
    expect(codexMeter(usage(), 'google/gemini-3.5-flash', NOW)).toBe(null);
    // No active thread (any non-chat hub page) — the header keeps the balance.
    expect(codexMeter(usage(), null, NOW)).toBe(null);
  });

  it('reports remaining capacity, not spent, so it reads like the balance', () => {
    const m = codexMeter(usage(), 'codex/gpt-5.6-terra', NOW);
    expect(m?.remainingPercent).toBe(97);
    expect(m?.usedPercent).toBe(3);
    expect(m?.windowLabel).toBe('WEEKLY');
    expect(m?.resetIn).toBe('6d');
  });

  it('leads with the window nearest its ceiling, not the first one', () => {
    // A 5h window at 80% and a weekly at 10%: the 5h is what will stop you.
    const m = codexMeter(
      usage({
        windows: [
          { usedPercent: 80, windowSeconds: 18_000, resetAt: NOW + 3_600_000 },
          { usedPercent: 10, windowSeconds: 604_800, resetAt: NOW + 6 * 86_400_000 },
        ],
        headline: { usedPercent: 80, windowSeconds: 18_000, resetAt: NOW + 3_600_000 },
      }),
      'codex/gpt-5.6-terra',
      NOW,
    );
    expect(m?.windowLabel).toBe('5H');
    expect(m?.remainingPercent).toBe(20);
    // Both windows still appear in the hover text.
    expect(m?.title).toContain('5H: 80% used');
    expect(m?.title).toContain('WEEKLY: 10% used');
  });

  it('falls back to the balance when this host has no Codex login', () => {
    expect(codexMeter(null, 'codex/gpt-5.6-terra', NOW)).toBe(null);
    expect(codexMeter(usage({ headline: null }), 'codex/gpt-5.6-terra', NOW)).toBe(null);
  });

  it('says so when the subscription is exhausted', () => {
    const m = codexMeter(usage({ limitReached: true }), 'codex/gpt-5.6-terra', NOW);
    expect(m?.limitReached).toBe(true);
    expect(m?.title).toContain('limit reached');
  });

  it('mentions top-up credit only when the account has some', () => {
    expect(codexMeter(usage(), 'codex/gpt-5.6-terra', NOW)?.title).not.toContain('Top-up');
    const m = codexMeter(usage({ creditBalanceUsd: 12.5 }), 'codex/gpt-5.6-terra', NOW);
    expect(m?.title).toContain('Top-up credit $12.50');
  });

  it('admits when the reading is stale', () => {
    const m = codexMeter(usage({ fetchedAt: NOW - 9 * 60_000 }), 'codex/gpt-5.6-terra', NOW);
    expect(m?.title).toContain('as of 9m ago');
  });
});
