import { describe, it, expect, vi, beforeEach } from 'vitest';
import { news_fetch } from './news_fetch';

// Mock the platform module
vi.mock('$lib/platform', () => ({
  platform: {
    call: vi.fn(),
  },
}));

import { platform } from '$lib/platform';

const mockPlatformCall = platform.call as ReturnType<typeof vi.fn>;

describe('news_fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return articles on successful response', async () => {
    const mockResponse = {
      status: 'ok',
      totalResults: 2,
      articles: [
        {
          title: 'Test Article 1',
          description: 'Description 1',
          url: 'https://example.com/1',
          source: { name: 'Test Source' },
          publishedAt: '2025-01-01T00:00:00Z',
          urlToImage: 'https://example.com/img1.jpg',
          content: 'Content 1',
        },
        {
          title: 'Test Article 2',
          description: null,
          url: 'https://example.com/2',
          source: { name: 'Another Source' },
          publishedAt: '2025-01-02T00:00:00Z',
          urlToImage: null,
          content: null,
        },
      ],
    };

    mockPlatformCall.mockResolvedValue(mockResponse);

    const result = await news_fetch({ q: 'test', pageSize: 2 });

    expect(result.status).toBe('ok');
    expect(result.totalResults).toBe(2);
    expect(result.articles).toHaveLength(2);
    expect(result.articles[0].title).toBe('Test Article 1');
    expect(result.articles[0].source).toBe('Test Source');
    expect(result.articles[1].title).toBe('Test Article 2');
    expect(result.articles[1].source).toBe('Another Source');
    expect(result.articles[1].urlToImage).toBeNull();
  });

  it('should handle empty articles array', async () => {
    const mockResponse = {
      status: 'ok',
      totalResults: 0,
      articles: [],
    };

    mockPlatformCall.mockResolvedValue(mockResponse);

    const result = await news_fetch({ category: 'sports' });

    expect(result.status).toBe('ok');
    expect(result.totalResults).toBe(0);
    expect(result.articles).toEqual([]);
  });

  it('should handle API error response', async () => {
    const mockResponse = {
      status: 'error',
      message: 'Invalid API key',
    };

    mockPlatformCall.mockResolvedValue(mockResponse);

    const result = await news_fetch();

    expect(result.status).toBe('error');
    expect(result.error).toBe('Invalid API key');
    expect(result.articles).toEqual([]);
  });

  it('should handle platform call failure', async () => {
    mockPlatformCall.mockRejectedValue(new Error('Network error'));

    const result = await news_fetch({ sources: 'bbc-news' });

    expect(result.status).toBe('error');
    expect(result.error).toBe('Network error');
    expect(result.articles).toEqual([]);
  });

  it('should handle non-object response', async () => {
    mockPlatformCall.mockResolvedValue('not an object');

    const result = await news_fetch();

    expect(result.status).toBe('error');
    expect(result.error).toBe('Invalid response from NewsAPI');
  });

  it('should use top-headlines endpoint when no query is provided', async () => {
    mockPlatformCall.mockResolvedValue({ status: 'ok', totalResults: 0, articles: [] });

    await news_fetch({ country: 'us' });

    const callUrl = mockPlatformCall.mock.calls[0][1].url;
    expect(callUrl).toContain('/top-headlines?');
    expect(callUrl).toContain('country=us');
  });

  it('should use everything endpoint when query is provided', async () => {
    mockPlatformCall.mockResolvedValue({ status: 'ok', totalResults: 0, articles: [] });

    await news_fetch({ q: 'technology' });

    const callUrl = mockPlatformCall.mock.calls[0][1].url;
    expect(callUrl).toContain('/everything?');
    expect(callUrl).toContain('q=technology');
  });

  it('should pass all provided options as query parameters', async () => {
    mockPlatformCall.mockResolvedValue({ status: 'ok', totalResults: 0, articles: [] });

    await news_fetch({
      q: 'climate',
      category: 'science',
      sources: 'bbc-news,cnn',
      country: 'gb',
      pageSize: 5,
      page: 2,
    });

    const callUrl = mockPlatformCall.mock.calls[0][1].url;
    expect(callUrl).toContain('q=climate');
    expect(callUrl).toContain('category=science');
    expect(callUrl).toContain('sources=bbc-news%2Ccnn');
    expect(callUrl).toContain('country=gb');
    expect(callUrl).toContain('pageSize=5');
    expect(callUrl).toContain('page=2');
  });
});
