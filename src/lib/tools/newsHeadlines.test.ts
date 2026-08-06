import { describe, it, expect, vi } from 'vitest';
import { newsHeadlines } from './newsHeadlines';

describe('newsHeadlines', () => {
  const mockPlatform = {
    call: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return headlines on successful API call', async () => {
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
          urlToImage: null,
        },
        {
          title: 'Test Article 2',
          description: 'Description 2',
          url: 'https://example.com/2',
          source: { name: 'Another Source' },
          publishedAt: '2025-01-02T00:00:00Z',
          urlToImage: 'https://example.com/img.jpg',
        },
      ],
    };

    mockPlatform.call.mockResolvedValue(mockResponse);

    const result = await newsHeadlines(mockPlatform, { category: 'technology', pageSize: 2 });

    expect(result.headlines).toHaveLength(2);
    expect(result.totalResults).toBe(2);
    expect(result.headlines[0].title).toBe('Test Article 1');
    expect(mockPlatform.call).toHaveBeenCalledWith('api_call', {
      api: 'newsapi',
      url: expect.stringContaining('category=technology'),
      method: 'GET',
    });
  });

  it('should throw on API error status', async () => {
    mockPlatform.call.mockResolvedValue({ status: 'error', message: 'API key invalid' });

    await expect(newsHeadlines(mockPlatform, {})).rejects.toThrow('NewsAPI error: error');
  });

  it('should throw on non-object response', async () => {
    mockPlatform.call.mockResolvedValue('invalid');

    await expect(newsHeadlines(mockPlatform, {})).rejects.toThrow('Invalid response from NewsAPI');
  });

  it('should throw on platform call failure', async () => {
    mockPlatform.call.mockRejectedValue(new Error('Network error'));

    await expect(newsHeadlines(mockPlatform, {})).rejects.toThrow('Failed to fetch news headlines: Network error');
  });

  it('should pass query parameters correctly', async () => {
    mockPlatform.call.mockResolvedValue({ status: 'ok', totalResults: 0, articles: [] });

    await newsHeadlines(mockPlatform, {
      source: 'bbc-news',
      country: 'gb',
      q: 'election',
      pageSize: 5,
      page: 2,
    });

    const calledUrl = mockPlatform.call.mock.calls[0][1].url;
    expect(calledUrl).toContain('sources=bbc-news');
    expect(calledUrl).toContain('country=gb');
    expect(calledUrl).toContain('q=election');
    expect(calledUrl).toContain('pageSize=5');
    expect(calledUrl).toContain('page=2');
  });
});
