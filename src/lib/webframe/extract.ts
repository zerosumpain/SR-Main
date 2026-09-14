import { Readability } from '@mozilla/readability';
import { loadJsdom } from '$lib/server/jsdom';

export type Extracted = {
  text: string;
  title: string;
  byline: string | null;
};

export async function extractArticle(html: string, url: string): Promise<Extracted> {
  try {
    const { JSDOM } = await loadJsdom();
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
