// Who wrote a post. Lives here rather than in `$lib/db/schema` so the admin UI
// can import the vocabulary without pulling the whole Drizzle schema into the
// client bundle — no .svelte file imports the schema, and this shouldn't be the
// first.
//
// This is the load-bearing distinction for the voice system: only `human` posts
// may seed the Voice Card or supply exemplars. Feeding generated prose back into
// the corpus is model collapse in miniature — with a corpus this small, a
// handful of generated posts would outweigh the real ones inside a month.

export const BLOG_AUTHORSHIP = ['human', 'assisted', 'generated', 'unknown'] as const;
export type BlogAuthorship = (typeof BLOG_AUTHORSHIP)[number];

export function isBlogAuthorship(v: unknown): v is BlogAuthorship {
  return typeof v === 'string' && (BLOG_AUTHORSHIP as readonly string[]).includes(v);
}

/** The one class that feeds the Voice Card. */
export const CORPUS_AUTHORSHIP: BlogAuthorship = 'human';

/**
 * Below this, a post is a test row rather than prose and cannot teach a model
 * anything about voice. Authorship records *who wrote it* — the stubs really
 * are John's — so the length judgement belongs here rather than in the tag.
 *
 * 100 sits cleanly in the gap: the longest stub (`so-here-it-is`, 279 chars)
 * is ~47 words; the shortest real post (`brave-new-world`, 971 chars) is ~165.
 */
export const MIN_CORPUS_WORDS = 100;

export const AUTHORSHIP_HINT: Record<BlogAuthorship, string> = {
  human: 'Written by John. The only class that seeds the Voice Card.',
  assisted: 'Written with model help. Kept out of the corpus.',
  generated: 'Model-written. Must never re-enter the corpus.',
  unknown: 'Untagged — excluded by default rather than silently trusted.',
};
