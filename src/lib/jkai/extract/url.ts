import { Readability } from '@mozilla/readability';
import { loadJsdom } from '$lib/server/jsdom';
import { guardedPublicFetch, type GuardedFetchResult } from '$lib/server/safe-fetch';
import { STATUS_CODES } from 'node:http';

const USER_AGENT =
	'Mozilla/5.0 (compatible; JkaiChatBot/1.0; +https://strangeramblings.com)';

// The whole download, not just the headers: guardedPublicFetch times the body
// too, so this is the old 10 s header wait plus room for a slow page to finish.
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB raw HTML cap
const MAX_TEXT_CHARS = 50_000; // ~12k tokens after extraction
// Every hop is re-validated and re-pinned by guardedPublicFetch. Plain fetch()
// followed up to 20; real pages (http→https→www→locale, a shortener or two)
// settle well inside this.
const MAX_REDIRECTS = 5;

export interface UrlFetchResult {
	url: string;
	finalUrl: string;
	title: string | null;
	excerpt: string | null;
	content: string;
	truncated: boolean;
	contentType: string;
}

export type UrlFetchError =
	| { kind: 'invalid_url'; message: string }
	| { kind: 'blocked_host'; message: string }
	| { kind: 'timeout'; message: string }
	| { kind: 'http_error'; status: number; message: string }
	| { kind: 'unsupported_type'; contentType: string; message: string }
	| { kind: 'too_large'; message: string }
	| { kind: 'extract_failed'; message: string }
	| { kind: 'network'; message: string };

const URL_REGEX = /\bhttps?:\/\/[^\s<>"')\]}]+/gi;

const BLOCK_SELECTOR = [
	'address',
	'article',
	'aside',
	'blockquote',
	'dd',
	'div',
	'dl',
	'dt',
	'figcaption',
	'figure',
	'footer',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'hr',
	'li',
	'main',
	'ol',
	'p',
	'pre',
	'section',
	'table',
	'tbody',
	'td',
	'tfoot',
	'th',
	'thead',
	'tr',
	'ul',
].join(',');

/** Normalise extracted prose without flattening its paragraph structure. */
export function normalizeExtractedText(text: string): string {
	return text
		.replace(/\r\n?/g, '\n')
		.replace(/[\u00a0\u2007\u202f]/g, ' ')
		.replace(/[\u200b-\u200d\ufeff]/g, '')
		.replace(/[\t\f\v ]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Convert an HTML fragment to readable text while retaining semantic breaks.
 * `textContent` alone joins adjacent block elements ("2026Model cards"),
 * which made otherwise successful Readability extractions hard to read.
 */
export async function readableTextFromHtml(html: string, url = 'https://example.invalid/'): Promise<string> {
	if (!html) return '';
	const { JSDOM } = await loadJsdom();
	const dom = new JSDOM(`<body>${html}</body>`, { url });
	const doc = dom.window.document;
	doc
		.querySelectorAll('script, style, template, noscript, svg, canvas, iframe')
		.forEach((element) => element.remove());
	doc.querySelectorAll('br').forEach((element) => element.replaceWith('\n'));
	doc.querySelectorAll('li').forEach((element) => element.prepend('• '));
	doc.querySelectorAll(BLOCK_SELECTOR).forEach((element) => {
		element.prepend('\n');
		element.append('\n');
	});
	return normalizeExtractedText(doc.body?.textContent ?? '');
}

/**
 * Extract up to `max` URLs from a free-form text blob (e.g. a chat message).
 * De-duplicated, order-preserving. Trailing punctuation that's clearly not
 * part of the URL is stripped.
 */
export function extractUrlsFromText(text: string, max = 3): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const matches = text.match(URL_REGEX) ?? [];
	for (const raw of matches) {
		const cleaned = raw.replace(/[.,;:!?)\]}>"']+$/, '');
		if (!seen.has(cleaned)) {
			seen.add(cleaned);
			out.push(cleaned);
			if (out.length >= max) break;
		}
	}
	return out;
}

function contentKind(contentType: string): { isHtml: boolean; isPlainText: boolean } {
	const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml');
	return { isHtml, isPlainText: contentType.startsWith('text/') && !isHtml };
}

/**
 * Map a guardedPublicFetch failure onto the `UrlFetchError` shapes callers
 * already render. The guard reports refusals as `Error('ssrf_blocked: …')`;
 * a DNS failure was always `invalid_url` here, so it stays that.
 */
function toUrlFetchError(err: unknown): UrlFetchError {
	if (isUrlFetchError(err)) return err;
	const e = err as { name?: string; message?: string } | null;
	if (e?.name === 'AbortError' || e?.name === 'TimeoutError') {
		return { kind: 'timeout', message: `Fetch timed out after ${FETCH_TIMEOUT_MS}ms` };
	}
	const message = e?.message ?? 'Network error';
	if (message.startsWith('ssrf_blocked:')) {
		const reason = message.slice('ssrf_blocked:'.length).trim();
		const text = reason.charAt(0).toUpperCase() + reason.slice(1);
		if (/^(dns lookup failed|no dns records)/i.test(reason)) return { kind: 'invalid_url', message: text };
		return { kind: 'blocked_host', message: text };
	}
	return { kind: 'network', message };
}

/**
 * Fetch a URL and extract its readable contents. Public-internet only — refuses
 * localhost, private / link-local / CGNAT (Tailscale) addresses on every
 * redirect hop, via `$lib/server/safe-fetch` (SSRF guard). Throws a
 * `UrlFetchError`-shaped object on failure so callers can render specific
 * messages.
 */
export async function fetchUrlContent(rawUrl: string): Promise<UrlFetchResult> {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw { kind: 'invalid_url', message: `Not a valid URL: ${rawUrl}` } satisfies UrlFetchError;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw {
			kind: 'invalid_url',
			message: `Only http/https URLs are supported (got ${parsed.protocol})`,
		} satisfies UrlFetchError;
	}

	// SSRF: guardedPublicFetch refuses private / loopback / link-local / CGNAT
	// hosts, pins the socket to the address it validated (no DNS-rebind window),
	// and re-validates every redirect hop BEFORE requesting it — plain
	// `redirect: 'follow'` fetched intermediate hops blind and checked only the
	// final host. The body is stream-capped at MAX_BYTES so a hostile 1 GB page
	// can't OOM the server, and skipped entirely for an error status or a type
	// we would refuse anyway.
	let res: GuardedFetchResult;
	try {
		res = await guardedPublicFetch(parsed.toString(), {
			headers: {
				'User-Agent': USER_AGENT,
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.5',
			},
			timeoutMs: FETCH_TIMEOUT_MS,
			maxBytes: MAX_BYTES,
			maxRedirects: MAX_REDIRECTS,
			readBody: (status, headers) => {
				if (status < 200 || status > 299) return false;
				const { isHtml, isPlainText } = contentKind((headers.get('content-type') ?? '').toLowerCase());
				return isHtml || isPlainText;
			},
		});
	} catch (err) {
		throw toUrlFetchError(err);
	}

	if (!res.ok) {
		throw {
			kind: 'http_error',
			status: res.status,
			message: `HTTP ${res.status} ${STATUS_CODES[res.status] ?? ''}`.trimEnd(),
		} satisfies UrlFetchError;
	}

	const finalUrl = res.finalUrl;
	const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
	const { isHtml, isPlainText } = contentKind(contentType);

	if (!isHtml && !isPlainText) {
		throw {
			kind: 'unsupported_type',
			contentType,
			message: `Cannot extract content from ${contentType || 'unknown content type'}. Only HTML and plain text are supported.`,
		} satisfies UrlFetchError;
	}

	const truncated = res.truncated;
	const body = Buffer.from(res.body).toString('utf8');

	if (isPlainText) {
		const trimmed = body.trim();
		if (!trimmed) {
			throw { kind: 'extract_failed', message: 'Page contained no readable text' } satisfies UrlFetchError;
		}
		const out = trimmed.length > MAX_TEXT_CHARS ? trimmed.slice(0, MAX_TEXT_CHARS) : trimmed;
		return {
			url: rawUrl,
			finalUrl,
			title: null,
			excerpt: null,
			content: out,
			truncated: truncated || trimmed.length > MAX_TEXT_CHARS,
			contentType,
		};
	}

	// HTML: try Readability first, fall back to a stripped-text dump.
	let title: string | null = null;
	let excerpt: string | null = null;
	let text = '';
	try {
		const { JSDOM } = await loadJsdom();
		const dom = new JSDOM(body, { url: finalUrl });
		const doc = dom.window.document;
		title = doc.querySelector('title')?.textContent?.trim() ?? null;
		excerpt =
			doc.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ||
			doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ||
			null;
		const reader = new Readability(doc);
		const article = reader.parse();
		if (article?.textContent && article.textContent.trim().length >= 50) {
			text = await readableTextFromHtml(article.content ?? '', finalUrl);
			if (!text) text = normalizeExtractedText(article.textContent);
			if (article.title) title = article.title;
			if (article.excerpt?.trim()) excerpt = article.excerpt.trim();
		} else {
			// Fallback: strip scripts/styles, take body text
			doc.querySelectorAll('script, style, nav, footer, header, noscript').forEach((el) => el.remove());
			text = await readableTextFromHtml(doc.body?.innerHTML ?? '', finalUrl);
		}
	} catch (err: any) {
		throw {
			kind: 'extract_failed',
			message: `HTML parse failed: ${err?.message ?? 'unknown'}`,
		} satisfies UrlFetchError;
	}

	if (!text) {
		throw { kind: 'extract_failed', message: 'Page contained no readable text' } satisfies UrlFetchError;
	}

	const out = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
	return {
		url: rawUrl,
		finalUrl,
		title,
		excerpt: excerpt ? normalizeExtractedText(excerpt).slice(0, 800) : null,
		content: out,
		truncated: truncated || text.length > MAX_TEXT_CHARS,
		contentType,
	};
}

export function isUrlFetchError(err: unknown): err is UrlFetchError {
	return (
		typeof err === 'object' &&
		err !== null &&
		'kind' in err &&
		typeof (err as { kind: unknown }).kind === 'string'
	);
}
