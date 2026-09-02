import { fetchUrlContent, isUrlFetchError } from '$lib/jkai/extract/url';
import { getNewsStory } from './sources';
import type { NewsArticle, NewsSource } from './types';

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { value: NewsArticle; expiresAt: number }>();

function clipSummary(text: string, limit = 520): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const clipped = clean.slice(0, limit - 1).replace(/\s+\S*$/, '').trim();
  return `${clipped || clean.slice(0, limit - 1)}…`;
}

function isDateline(block: string): boolean {
  return (
    /^(published|updated|last updated)\b/i.test(block) ||
    /^[a-z]{3,9}\s+\d{1,2},?\s+\d{4}(?:\s*[|·—–-].*)?$/i.test(block) ||
    /^\d{1,2}\s+[a-z]{3,9}\s+\d{4}(?:\s*[|·—–-].*)?$/i.test(block)
  );
}

/** Drop publisher chrome that Readability sometimes leaves ahead of the prose. */
export function cleanNewsArticleText(text: string, title: string): string {
  const titleKey = title.replace(/\s+/g, ' ').trim().toLowerCase();
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  while (blocks.length) {
    const first = blocks[0];
    if (first.toLowerCase() === titleKey || isDateline(first)) blocks.shift();
    else break;
  }
  return blocks.join('\n\n');
}

/** Choose substantive opening paragraphs without an LLM or invented wording. */
export function summarizeArticleText(
  title: string,
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    const cleaned = cleanNewsArticleText(candidate ?? '', title);
    const blocks = cleaned
      .split(/\n{2,}/)
      .map((block) => block.replace(/\s+/g, ' ').trim())
      .filter((block) => block.length >= 55 && !isDateline(block));
    if (!blocks.length) {
      if (cleaned.length >= 40) return clipSummary(cleaned);
      continue;
    }

    const picked: string[] = [];
    let length = 0;
    for (const block of blocks) {
      picked.push(block);
      length += block.length;
      if (length >= 180 || picked.length === 2) break;
    }
    const summary = clipSummary(picked.join(' '));
    if (summary.length >= 40) return summary;
  }
  return '';
}

function friendlyFailure(err: unknown): string {
  if (isUrlFetchError(err)) {
    if (err.kind === 'unsupported_type') return 'This format is best read at the original source.';
    if (err.kind === 'timeout') return 'The publisher took too long to answer.';
    if (err.kind === 'blocked_host') return 'This address cannot be opened safely inside the reader.';
    if (err.kind === 'http_error') return `The publisher returned ${err.status}.`;
    return 'The publisher did not expose a readable version of this page.';
  }
  return 'The publisher did not expose a readable version of this page.';
}

export async function readNewsStory(
  source: NewsSource,
  id: string,
  opts: { force?: boolean } = {},
): Promise<NewsArticle> {
  const key = `${source}:${id}`;
  const existing = cache.get(key);
  if (!opts.force && existing && existing.expiresAt > Date.now()) return existing.value;

  const story = await getNewsStory(source, id);
  let article: NewsArticle;

  if (story.url === story.discussionUrl && story.summary) {
    article = {
      story,
      content: story.summary,
      summary: summarizeArticleText(story.title, story.summary),
      contentTitle: story.title,
      finalUrl: story.discussionUrl,
      mode: 'submission',
      truncated: false,
      message: null,
    };
  } else if (story.url === story.discussionUrl) {
    article = {
      story,
      content: '',
      summary: '',
      contentTitle: story.title,
      finalUrl: story.discussionUrl,
      mode: 'external',
      truncated: false,
      message: 'This submission has no separate article. Continue at the community discussion.',
    };
  } else {
    try {
      const extracted = await fetchUrlContent(story.url);
      const content = cleanNewsArticleText(extracted.content, story.title);
      article = {
        story,
        content,
        summary: summarizeArticleText(story.title, story.summary, content, extracted.excerpt),
        contentTitle: extracted.title,
        finalUrl: extracted.finalUrl,
        mode: 'article',
        truncated: extracted.truncated,
        message: extracted.truncated ? 'The long article has been trimmed in this reading view.' : null,
      };
    } catch (err) {
      article = {
        story,
        content: story.summary,
        summary: summarizeArticleText(story.title, story.summary),
        contentTitle: story.title,
        finalUrl: story.url,
        mode: story.summary ? 'submission' : 'external',
        truncated: false,
        message: friendlyFailure(err),
      };
    }
  }

  cache.set(key, { value: article, expiresAt: Date.now() + CACHE_TTL_MS });
  return article;
}
