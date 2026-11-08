import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: { insert: () => ({ values: () => Promise.resolve() }) } }));
vi.mock('$lib/llm/keys', () => ({ getBraveKey: () => 'BSAtestkey0000000000000' }));

const { parseBraveRateLimits, normaliseBraveResults, braveCanServe, rankScore } = await import('./brave');

describe('Brave rate-limit headers', () => {
  it('splits the burst window from the monthly allowance by the policy windows', () => {
    const limits = parseBraveRateLimits(new Headers({
      'x-ratelimit-limit': '20, 15000',
      'x-ratelimit-remaining': '19, 9876',
      'x-ratelimit-reset': '1, 1419704',
      'x-ratelimit-policy': '20;w=1, 15000;w=2592000',
    }));
    expect(limits.perWindow).toEqual({ limit: 20, remaining: 19, windowSeconds: 1 });
    expect(limits.monthly).toEqual({ limit: 15000, remaining: 9876, resetSeconds: 1419704 });
  });

  it('reads the documented order when no policy header names the windows', () => {
    const limits = parseBraveRateLimits(new Headers({ 'x-ratelimit-limit': '1, 2000', 'x-ratelimit-remaining': '0, 1500' }));
    expect(limits.perWindow?.limit).toBe(1);
    expect(limits.monthly).toEqual({ limit: 2000, remaining: 1500, resetSeconds: null });
  });

  it('gives nulls for missing or mismatched headers rather than guessing', () => {
    expect(parseBraveRateLimits(new Headers())).toEqual({ perWindow: null, monthly: null });
    expect(parseBraveRateLimits(new Headers({ 'x-ratelimit-limit': '1, 2000', 'x-ratelimit-remaining': '1' }))).toEqual({ perWindow: null, monthly: null });
  });
});

describe('Brave results in the Tavily shape', () => {
  it('drops excluded domains and their subdomains, and scores by the kept rank', () => {
    const out = normaliseBraveResults(
      [
        { title: 'a', url: 'https://news.blocked.example/x', description: 'x' },
        { title: 'b &amp; c', url: 'https://ok.example/y', description: '<strong>y</strong>' },
        { title: 'no url' },
      ],
      { maxResults: 10, excludeDomains: ['blocked.example'] },
    );
    expect(out).toEqual([{ title: 'b & c', url: 'https://ok.example/y', content: 'y', score: 0.9 }]);
  });

  it('caps at maxResults and never scores below 0.3', () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, url: `https://e${i}.example/`, description: 'd' }));
    const out = normaliseBraveResults(raw, { maxResults: 3 });
    expect(out.map((r) => r.score)).toEqual([0.9, 0.86, 0.82]);
    expect(rankScore(19)).toBe(0.3);
  });

  it('refuses queries Brave would reject', () => {
    expect(braveCanServe('short question')).toBe(true);
    expect(braveCanServe('x'.repeat(401))).toBe(false);
    expect(braveCanServe(Array.from({ length: 51 }, () => 'w').join(' '))).toBe(false);
    expect(braveCanServe('q', { includeDomains: ['a.example', 'b.example'] })).toBe(true);
  });
});
