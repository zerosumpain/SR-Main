import type { PlatformCall } from '$lib/types/platform';

interface NewsHeadlinesParams {
  category?: string;
  source?: string;
  country?: string;
  q?: string;
  pageSize?: number;
  page?: number;
}

interface Article {
  title: string;
  description: string | null;
  url: string;
  source: { name: string };
  publishedAt: string;
  urlToImage: string | null;
}

interface NewsApiResponse {
  status: string;
  totalResults: number;
  articles: Article[];
}

/**
 * Fetch structured news headlines and articles from NewsAPI.
 * Requires the 'newsapi' API to be registered via api_register with a secret handle 'newsapi'.
 */
export async function newsHeadlines(
  platform: { call: PlatformCall },
  params: NewsHeadlinesParams = {}
): Promise<{ headlines: Article[]; totalResults: number }> {
  const { category, source, country, q, pageSize = 10, page = 1 } = params;

  // Build query parameters
  const queryParams = new URLSearchParams();
  if (category) queryParams.set('category', category);
  if (source) queryParams.set('sources', source);
  if (country) queryParams.set('country', country);
  if (q) queryParams.set('q', q);
  queryParams.set('pageSize', String(pageSize));
  queryParams.set('page', String(page));

  const url = `https://newsapi.org/v2/top-headlines?${queryParams.toString()}`;

  try {
    const response = await platform.call('api_call', {
      api: 'newsapi',
      url,
      method: 'GET',
    });

    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response from NewsAPI');
    }

    const data = response as NewsApiResponse;

    if (data.status !== 'ok') {
      throw new Error(`NewsAPI error: ${data.status}`);
    }

    return {
      headlines: data.articles,
      totalResults: data.totalResults,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to fetch news headlines: ${message}`);
  }
}
