import type { NewsSource, NewsStory } from './types';

const SEARCH_FILLER = new Set([
  'ars',
  'technica',
  'a',
  'about',
  'an',
  'any',
  'are',
  'article',
  'articles',
  'current',
  'find',
  'for',
  'from',
  'give',
  'hacker',
  'headline',
  'headlines',
  'in',
  'is',
  'latest',
  'lobsters',
  'me',
  'new',
  'news',
  'now',
  'of',
  'on',
  'please',
  'recent',
  'regarding',
  'related',
  'search',
  'show',
  'some',
  'story',
  'stories',
  'technical',
  'technology',
  'tech',
  'tell',
  'the',
  'today',
  'todays',
  'top',
  'update',
  'updates',
  'us',
  'what',
  'whats',
]);

export interface NewsSearchOptions {
  query?: string;
  source?: NewsSource | 'all';
  limit?: number;
}

export interface NewsSearchMatch {
  story: NewsStory;
  relevance: number;
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function words(value: string): string[] {
  return normalize(value).match(/[a-z0-9][a-z0-9+#.-]*/g) ?? [];
}

/**
 * Remove request vocabulary so "latest news about Rust" searches for Rust,
 * while a bare "latest news" still returns the current feed in its own order.
 */
export function newsQueryTerms(query: string): string[] {
  return [...new Set(words(query).filter((word) => word.length > 1 && !SEARCH_FILLER.has(word)))];
}

function termScore(term: string, story: NewsStory): number {
  const title = normalize(story.title);
  const titleWords = words(story.title);
  const tags = story.tags.flatMap(words);
  const summary = normalize(story.summary);
  const domain = normalize(story.domain);
  const author = normalize(story.author ?? '');
  let score = 0;

  if (titleWords.includes(term)) score += 12;
  else if (term.length >= 3 && title.includes(term)) score += 8;
  // "AI" should find OpenAI, while other two-letter fragments should not
  // turn into broad substring matches.
  else if (term === 'ai' && titleWords.some((word) => word === 'ai' || word.endsWith('ai'))) score += 8;

  if (tags.includes(term)) score += 7;
  else if (term.length >= 3 && tags.some((tag) => tag.includes(term))) score += 4;

  if (term.length >= 3 && summary.includes(term)) score += 3;
  if (term.length >= 3 && domain.includes(term)) score += 2;
  if (term.length >= 3 && author.includes(term)) score += 1;
  return score;
}

/** Rank a fetched news wire without changing its order for a generic request. */
export function searchNewsStories(
  stories: NewsStory[],
  options: NewsSearchOptions = {},
): NewsSearchMatch[] {
  const source = options.source ?? 'all';
  const limit = Math.max(1, Math.min(20, Math.trunc(options.limit ?? 8)));
  const terms = newsQueryTerms(options.query ?? '');
  const candidates = stories
    .map((story, index) => ({ story, index }))
    .filter(({ story }) => source === 'all' || story.source === source);

  if (terms.length === 0) {
    return candidates.slice(0, limit).map(({ story }) => ({ story, relevance: 0 }));
  }

  return candidates
    .map(({ story, index }) => ({
      story,
      index,
      relevance: terms.reduce((score, term) => score + termScore(term, story), 0),
    }))
    .filter(({ relevance }) => relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || a.index - b.index)
    .slice(0, limit)
    .map(({ story, relevance }) => ({ story, relevance }));
}
