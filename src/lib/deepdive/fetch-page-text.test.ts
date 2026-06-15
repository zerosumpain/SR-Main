// src/lib/deepdive/fetch-page-text.test.ts
//
// Unit tests for fetchPageText — pure order-logic tests, NO real network.
// All Tavily + fetch calls are injected as mocks.

import { describe, it, expect, vi } from 'vitest';
import { fetchPageText, type FetchPageTextDeps } from './fetch-page-text';

const GOOD_TEXT = 'A'.repeat(500);   // ≥ 400 chars → Tavily good
const THIN_TEXT = 'short';           // < 400 chars → Tavily thin
const GOOD_RESIDENTIAL = 'B'.repeat(300); // ≥ 200 chars → residential good

function makeDeps(overrides?: Partial<FetchPageTextDeps>): FetchPageTextDeps {
  return {
    tavilyExtract: vi.fn().mockResolvedValue({
      results: [],
      failed_results: [],
    }),
    fetchFn: vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, pages: [{ fields: { text: GOOD_RESIDENTIAL } }] }),
    } as any),
    scraperServiceUrl: undefined,
    scraperServiceToken: undefined,
    ...overrides,
  };
}

describe('fetchPageText — tavily-good path', () => {
  it('returns tavily text + method=tavily when raw_content is ≥ 400 chars', async () => {
    const deps = makeDeps({
      tavilyExtract: vi.fn().mockResolvedValue({
        results: [{ url: 'https://example.com', raw_content: GOOD_TEXT }],
        failed_results: [],
      }),
    });

    const result = await fetchPageText('https://example.com', {}, deps);
    expect(result.method).toBe('tavily');
    expect(result.text).toBe(GOOD_TEXT);
  });

  it('does NOT call residential fetch when tavily returns good content', async () => {
    const deps = makeDeps({
      tavilyExtract: vi.fn().mockResolvedValue({
        results: [{ url: 'https://example.com', raw_content: GOOD_TEXT }],
        failed_results: [],
      }),
      scraperServiceUrl: 'http://homeserv:5173/api/scraper/run',
    });

    await fetchPageText('https://example.com', {}, deps);
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });

  it('caps returned text at 8000 chars', async () => {
    const longText = 'X'.repeat(12000);
    const deps = makeDeps({
      tavilyExtract: vi.fn().mockResolvedValue({
        results: [{ url: 'https://example.com', raw_content: longText }],
        failed_results: [],
      }),
    });
    const result = await fetchPageText('https://example.com', {}, deps);
    expect(result.text.length).toBeLessThanOrEqual(8000);
  });
});

describe('fetchPageText — tavily-thin → residential path', () => {
  it('calls residential when tavily returns thin content and SCRAPER_SERVICE_URL is set', async () => {
    const deps = makeDeps({
      tavilyExtract: vi.fn().mockResolvedValue({
        results: [{ url: 'https://example.com', raw_content: THIN_TEXT }],
        failed_results: [],
      }),
      scraperServiceUrl: 'http://homeserv:5173/api/scraper/run',
      fetchFn: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, pages: [{ fields: { text: GOOD_RESIDENTIAL } }] }),
      } as any),
    });

    const result = await fetchPageText('https://example.com', {}, deps);
    expect(result.method).toBe('residential');
    expect(result.text).toBe(GOOD_RESIDENTIAL);
    expect(deps.fetchFn).toHaveBeenCalledOnce();
  });

  it('returns residential text when tavily results array is empty', async () => {
    const deps = makeDeps({
      tavilyExtract: vi.fn().mockResolvedValue({
        results: [],
        failed_results: [],
      }),
      scraperServiceUrl: 'http://homeserv:5173/api/scraper/run',
      fetchFn: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, pages: [{ fields: { text: GOOD_RESIDENTIAL } }] }),
      } as any),
    });

    const result = await fetchPageText('https://example.com', {}, deps);
    expect(result.method).toBe('residential');
  });
});

describe('fetchPageText — both thin/fail → none', () => {
  it('returns method=none when tavily thin AND no scraperServiceUrl', async () => {
    const deps = makeDeps({
      tavilyExtract: vi.fn().mockResolvedValue({
        results: [{ url: 'https://example.com', raw_content: THIN_TEXT }],
        failed_results: [],
      }),
      scraperServiceUrl: undefined,
    });

    const result = await fetchPageText('https://example.com', {}, deps);
    expect(result.method).toBe('none');
    expect(result.text).toBe('');
  });

  it('returns method=none when tavily throws AND no scraperServiceUrl', async () => {
    const deps = makeDeps({
      tavilyExtract: vi.fn().mockRejectedValue(new Error('Network error')),
      scraperServiceUrl: undefined,
    });

    const result = await fetchPageText('https://example.com', {}, deps);
    expect(result.method).toBe('none');
    expect(result.text).toBe('');
  });

  it('returns method=none when tavily thin AND residential also thin', async () => {
    const deps = makeDeps({
      tavilyExtract: vi.fn().mockResolvedValue({
        results: [{ url: 'https://example.com', raw_content: THIN_TEXT }],
        failed_results: [],
      }),
      scraperServiceUrl: 'http://homeserv:5173/api/scraper/run',
      fetchFn: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, pages: [{ fields: { text: 'x' } }] }),
      } as any),
    });

    const result = await fetchPageText('https://example.com', {}, deps);
    expect(result.method).toBe('none');
    expect(result.text).toBe('');
  });

  it('returns method=none when residential fetch throws', async () => {
    const deps = makeDeps({
      tavilyExtract: vi.fn().mockResolvedValue({
        results: [],
        failed_results: [],
      }),
      scraperServiceUrl: 'http://homeserv:5173/api/scraper/run',
      fetchFn: vi.fn().mockRejectedValue(new Error('timeout')),
    });

    const result = await fetchPageText('https://example.com', {}, deps);
    expect(result.method).toBe('none');
    expect(result.text).toBe('');
  });

  it('returns method=none when residential returns success:false', async () => {
    const deps = makeDeps({
      tavilyExtract: vi.fn().mockResolvedValue({ results: [], failed_results: [] }),
      scraperServiceUrl: 'http://homeserv:5173/api/scraper/run',
      fetchFn: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, pages: [], error: 'blocked' }),
      } as any),
    });

    const result = await fetchPageText('https://example.com', {}, deps);
    expect(result.method).toBe('none');
  });
});

describe('fetchPageText — residential skipped when no SCRAPER_SERVICE_URL', () => {
  it('does not call fetchFn even after tavily thin when scraperServiceUrl is undefined', async () => {
    const deps = makeDeps({
      tavilyExtract: vi.fn().mockResolvedValue({
        results: [{ url: 'https://example.com', raw_content: THIN_TEXT }],
        failed_results: [],
      }),
      scraperServiceUrl: undefined,
    });

    await fetchPageText('https://example.com', {}, deps);
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });
});

describe('fetchPageText — residential hard timeout (abort path)', () => {
  it('returns method=none gracefully when residential times out (AbortError swallowed)', async () => {
    const abortErr = new DOMException('The operation was aborted.', 'AbortError');
    const deps = makeDeps({
      tavilyExtract: vi.fn().mockResolvedValue({ results: [], failed_results: [] }),
      scraperServiceUrl: 'http://homeserv:5173/api/scraper/run',
      fetchFn: vi.fn().mockRejectedValue(abortErr),
    });

    // Should NOT throw — AbortError from the residential path must be swallowed
    const result = await fetchPageText('https://example.com', {}, deps);
    expect(result.method).toBe('none');
    expect(result.text).toBe('');
  });
});

describe('fetchPageText — function never throws', () => {
  it('does not throw even when all deps fail', async () => {
    const deps = makeDeps({
      tavilyExtract: vi.fn().mockRejectedValue(new Error('500')),
      scraperServiceUrl: 'http://homeserv:5173/api/scraper/run',
      fetchFn: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });

    await expect(fetchPageText('https://example.com', {}, deps)).resolves.not.toThrow();
  });
});
