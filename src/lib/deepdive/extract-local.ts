import { Readability } from '@mozilla/readability';
import { loadJsdom } from '$lib/server/jsdom';
import { guardedPublicFetch } from '$lib/server/safe-fetch';

const USER_AGENT =
	'Mozilla/5.0 (compatible; DeepDiveBot/1.0; +https://strangeramblings.com)';

const FETCH_TIMEOUT_MS = 15_000;

export interface LocalExtractResult {
	url: string;
	content: string;
	title: string | null;
}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const isHtmlType = (contentType: string) =>
	contentType.includes('text/html') || contentType.includes('application/xhtml');

function abortError(): Error {
	const err = new Error('The operation was aborted.');
	err.name = 'AbortError';
	return err;
}

/**
 * Fetch a URL and extract readable text content locally using Readability + JSDOM.
 * Returns null if the fetch fails or the page isn't extractable.
 *
 * The URLs come from search results, so the fetch goes through
 * `guardedPublicFetch`: private, loopback and metadata addresses are refused on
 * every redirect hop, the socket is pinned to the validated address, and the
 * body is capped. A caller's abort still surfaces as an AbortError.
 */
export async function extractLocal(
	url: string,
	signal?: AbortSignal,
): Promise<LocalExtractResult | null> {
	if (signal?.aborted) throw abortError();
	let onAbort: (() => void) | undefined;
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(abortError());
		signal?.addEventListener('abort', onAbort, { once: true });
	});
	try {
		const res = await Promise.race([
			guardedPublicFetch(url, {
				headers: {
					'User-Agent': USER_AGENT,
					Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'Accept-Language': 'en-US,en;q=0.5',
				},
				timeoutMs: FETCH_TIMEOUT_MS,
				maxBytes: MAX_BYTES,
				maxRedirects: MAX_REDIRECTS,
				readBody: (status, headers) =>
					status >= 200 && status <= 299 && isHtmlType(headers.get('content-type') ?? ''),
			}),
			aborted,
		]);

		if (!res.ok || !isHtmlType(res.headers.get('content-type') ?? '')) return null;

		const html = new TextDecoder().decode(res.body);
		return await readableFromHtml(html, res.finalUrl || url);
	} catch (err: any) {
		if (err?.name === 'AbortError' && signal?.aborted) throw err;
		return null;
	} finally {
		if (onAbort) signal?.removeEventListener('abort', onAbort);
	}
}

/**
 * The Readability half, over HTML you already hold.
 *
 * Split out because callers keep arriving with the bytes in hand. The /drive
 * archiver downloads a page to decide whether it is a document, and then used
 * to hand the URL to `fetchPageText` — which tries **Tavily Extract first**, so
 * archiving a page the site had already fetched cost a Tavily credit to fetch
 * it a second time. Parsing what we have costs nothing.
 *
 * Returns null rather than throwing on anything unparseable, so a caller can
 * fall back to the paid routes only when it genuinely needs them.
 */
export async function readableFromHtml(html: string, url: string): Promise<LocalExtractResult | null> {
	if (!html || html.length < 100) return null;
	try {
		const { JSDOM } = await loadJsdom();
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
	} catch {
		return null;
	}
}
