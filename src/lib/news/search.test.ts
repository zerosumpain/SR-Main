import { describe, it, expect } from 'vitest';
import { matchesNewsQuery, newsQueryTerms, searchNewsStories } from './search';
import { NEWS_SOURCE_DEFS } from '$lib/constants/news-sources';
import type { NewsStory } from './types';

function story(partial: Partial<NewsStory> & { title: string }): NewsStory {
  return {
    key: 'k', source: partial.source ?? 'hacker-news', sourceLabel: 'Hacker News', id: '1',
    title: partial.title, url: 'https://example.com/a', canonicalUrl: 'example.com/a',
    discussionUrl: 'https://example.com/d', domain: partial.domain ?? 'example.com',
    author: partial.author ?? null, publishedAt: '2026-09-15T09:00:00.000Z',
    score: 0, commentCount: 0, tags: partial.tags ?? [], summary: partial.summary ?? '',
    rank: 1, heat: 0, alsoOn: [],
  };
}

// The page used its own `.includes()` over a concatenated string, so these two
// cases behaved differently on the desk and in the tool. Now there is one rule.
describe('matchesNewsQuery — the desk and the tool share one definition', () => {
  it('matches a term that appears only in the summary, which the page could not see', () => {
    const s = story({ title: 'A quiet headline', summary: 'It concerns PostgreSQL indexes.' });
    expect(matchesNewsQuery(s, newsQueryTerms('postgresql'))).toBe(true);
  });

  it('does not match a short term inside an unrelated word', () => {
    const s = story({ title: 'The chain said nothing' });
    expect(matchesNewsQuery(s, newsQueryTerms('ai'))).toBe(false);
  });

  it('still finds AI inside OpenAI, which is the one exception', () => {
    expect(matchesNewsQuery(story({ title: 'OpenAI ships a thing' }), newsQueryTerms('ai'))).toBe(true);
  });

  it('requires EVERY term, not any', () => {
    const s = story({ title: 'Rust compiler news' });
    expect(matchesNewsQuery(s, newsQueryTerms('rust compiler'))).toBe(true);
    expect(matchesNewsQuery(s, newsQueryTerms('rust kubernetes'))).toBe(false);
  });

  it('treats an empty or filler-only query as matching everything', () => {
    const s = story({ title: 'Anything at all' });
    expect(matchesNewsQuery(s, newsQueryTerms(''))).toBe(true);
    expect(matchesNewsQuery(s, newsQueryTerms('latest news today'))).toBe(true);
  });

  it('matches on tags and domain as well as the title', () => {
    const s = story({ title: 'Untitled', tags: ['compilers'], domain: 'lwn.net' });
    expect(matchesNewsQuery(s, newsQueryTerms('compilers'))).toBe(true);
    expect(matchesNewsQuery(s, newsQueryTerms('lwn'))).toBe(true);
  });
});

describe('searchNewsStories — one lane of the desk', () => {
  const tech = NEWS_SOURCE_DEFS.find((d) => d.lane === 'tech')!.id;
  const pub = NEWS_SOURCE_DEFS.find((d) => d.lane === 'public')!.id;
  const wire = [
    story({ title: 'A compiler release', source: tech }),
    story({ title: 'A schools funding release', source: pub }),
    story({ title: 'A second compiler note', source: tech }),
  ];

  it('returns every lane when none is asked for', () => {
    expect(searchNewsStories(wire)).toHaveLength(3);
    expect(searchNewsStories(wire, { lane: 'all' })).toHaveLength(3);
  });

  it('keeps to the lane asked for, in the wire order', () => {
    expect(searchNewsStories(wire, { lane: 'public' }).map((m) => m.story.title)).toEqual(['A schools funding release']);
    expect(searchNewsStories(wire, { lane: 'tech' }).map((m) => m.story.title)).toEqual(['A compiler release', 'A second compiler note']);
  });

  it('applies the lane together with the query', () => {
    expect(searchNewsStories(wire, { lane: 'public', query: 'release' })).toHaveLength(1);
    expect(searchNewsStories(wire, { lane: 'public', query: 'compiler' })).toEqual([]);
  });

  it('finds nothing where the source and the lane disagree', () => {
    expect(searchNewsStories(wire, { source: tech, lane: 'public' })).toEqual([]);
  });
});
