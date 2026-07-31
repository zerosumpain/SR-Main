import { platform } from '$lib/platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NewsArticle {
  title: string;
  description: string | null;
  url: string;
  source: string;
  publishedAt: string;
  urlToImage: string | null;
  content: string | null;
}

export interface NewsFetchOptions {
  /** Search keyword(s) */
  q?: string;
  /** Category: business, entertainment, general, health, science, sports, technology */
  category?: string;
  /** Comma-separated source IDs (e.g. 'bbc-news,cnn') */
  sources?: string;
  /** Country code (ISO 3166-1 alpha-2, e.g. 'gb', 'us') */
  country?: string;
  /** Max results (default 10, max 100) */
  pageSize?: number;
  /** Page number for pagination */
  page?: number;
}

export interface NewsFetchResult {
  articles: NewsArticle[];
  totalResults: number;
  status: 'ok' | 'error';
  error?: string;
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

/**
 * Fetch structured news headlines/articles from the registered NewsAPI.
 * Uses the platform's api_call to keep the API key secret.
 */
export async function news_fetch(options: NewsFetchOptions = {}): Promise<NewsFetchResult> {
  const params = new URLSearchParams();
  if (options.q) params.set('q', options.q);
  if (options.category) params.set('category', options.category);
  if (options.sources) params.set('sources', options.sources);
  if (options.country) params.set('country', options.country);
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  if (options.page) params.set('page', String(options.page));

  // Default to top headlines endpoint; fallback to everything if query is provided
  const endpoint = options.q ? 'everything' : 'top-headlines';
  const url = `https://newsapi.org/v2/${endpoint}?${params.toString()}`;

  try {
    const response = await platform.call('api_call', {
      api: 'NewsAPI',
      url,
      method: 'GET',
    });

    if (!response || typeof response !== 'object') {
      return { articles: [], totalResults: 0, status: 'error', error: 'Invalid response from NewsAPI' };
    }

    const data = response as any;

    if (data.status === 'error') {
      return {
        articles: [],
        totalResults: 0,
        status: 'error',
        error: data.message || 'NewsAPI returned an error',
      };
    }

    const articles: NewsArticle[] = (data.articles || []).map((a: any) => ({
      title: a.title ?? '',
      description: a.description ?? null,
      url: a.url ?? '',
      source: a.source?.name ?? 'Unknown',
      publishedAt: a.publishedAt ?? '',
      urlToImage: a.urlToImage ?? null,
      content: a.content ?? null,
    }));

    return {
      articles,
      totalResults: data.totalResults ?? articles.length,
      status: 'ok',
    };
  } catch (err: any) {
    return {
      articles: [],
      totalResults: 0,
      status: 'error',
      error: err.message || 'Unknown error fetching news',
    };
  }
}
