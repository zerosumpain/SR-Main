// src/lib/constants/news-sources.ts
//
// The wired-in news sources, in the foundation layer so both the news module
// and anything that merely needs to KNOW what exists can read them.
//
// It lives here rather than in `$lib/news/types` because the daydream appetite
// scan states what the site can already reach, and a source list it cannot
// enumerate is a source list it will propose again — but `$lib/news` imports
// `$lib/daydream` (a story saved to the notebook), so reading it from there
// would close a `daydream <-> news` cycle.
//
// Adding a feed is a CODE change: a reader beside the two in
// `$lib/news/sources.ts`. That is the honest thing for the appetite pack to
// say, and it is why a news source goes down the /build lane rather than a
// registration.

export const NEWS_SOURCES = ['hacker-news', 'lobsters'] as const;
export type NewsSource = (typeof NEWS_SOURCES)[number];
