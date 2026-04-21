import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export type Extracted = {
  text: string;
  title: string;
  byline: string | null;
};

export function extractArticle(html: string, url: string): Extracted {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    return {
      text: article?.textContent?.trim() ?? '',
      title: article?.title ?? '',
      byline: article?.byline ?? null,
    };
  } catch {
    return { text: '', title: '', byline: null };
  }
}
