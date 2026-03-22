import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const USER_AGENT =
	'Mozilla/5.0 (compatible; DeepDiveBot/1.0; +https://strangeramblings.com)';

const FETCH_TIMEOUT_MS = 15_000;

export interface LocalExtractResult {
	url: string;
	content: string;
	title: string | null;
}

/**
 * Fetch a URL and extract readable text content locally using Readability + JSDOM.
 * Returns null if the fetch fails or the page isn't extractable.
 */
export async function extractLocal(
	url: string,
	signal?: AbortSignal,
): Promise<LocalExtractResult | null> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		// Chain the external signal if provided
		if (signal) {
			signal.addEventListener('abort', () => controller.abort(), { once: true });
		}

		const res = await fetch(url, {
			headers: {
				'User-Agent': USER_AGENT,
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.5',
			},
			signal: controller.signal,
			redirect: 'follow',
		});

		clearTimeout(timeout);

		if (!res.ok) return null;

		const contentType = res.headers.get('content-type') ?? '';
		if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
			return null;
		}

		const html = await res.text();
		if (!html || html.length < 100) return null;

		const dom = new JSDOM(html, { url });
		const reader = new Readability(dom.window.document);
		const article = reader.parse();

		if (!article?.textContent || article.textContent.trim().length < 50) {
			return null;
		}

		return {
			url,
			content: article.textContent.trim(),
			title: article.title ?? null,
		};
	} catch (err: any) {
		if (err?.name === 'AbortError') throw err;
		return null;
	}
}
