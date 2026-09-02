import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const USER_AGENT =
	'Mozilla/5.0 (compatible; JkaiChatBot/1.0; +https://strangeramblings.com)';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB raw HTML cap
const MAX_TEXT_CHARS = 50_000; // ~12k tokens after extraction

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
export function readableTextFromHtml(html: string, url = 'https://example.invalid/'): string {
	if (!html) return '';
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

function isPrivateIP(ip: string): boolean {
	const v = isIP(ip);
	if (v === 4) {
		const parts = ip.split('.').map(Number);
		const [a, b] = parts;
		if (a === 10) return true;
		if (a === 127) return true;
		if (a === 0) return true;
		if (a === 169 && b === 254) return true; // link-local
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a >= 224) return true; // multicast / reserved
		return false;
	}
	if (v === 6) {
		const lower = ip.toLowerCase();
		if (lower === '::1' || lower === '::') return true;
		if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
		if (lower.startsWith('fe80')) return true; // link-local
		if (lower.startsWith('::ffff:')) {
			// IPv4-mapped — unwrap and re-check
			return isPrivateIP(lower.slice('::ffff:'.length));
		}
		return false;
	}
	return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
	const lower = hostname.toLowerCase();
	if (lower === 'localhost' || lower.endsWith('.localhost')) {
		throw { kind: 'blocked_host', message: `Refusing to fetch localhost (${hostname})` } satisfies UrlFetchError;
	}
	// .internal / .local / .lan / Tailscale magic-DNS are private namespaces
	if (/\.(internal|local|lan|home|intranet)$/i.test(lower) || lower.endsWith('.ts.net')) {
		throw { kind: 'blocked_host', message: `Refusing to fetch private namespace (${hostname})` } satisfies UrlFetchError;
	}
	// If it's already a literal IP, validate directly
	if (isIP(hostname)) {
		if (isPrivateIP(hostname)) {
			throw { kind: 'blocked_host', message: `Refusing to fetch private IP (${hostname})` } satisfies UrlFetchError;
		}
		return;
	}
	// Otherwise resolve and check every record
	let records: Array<{ address: string; family: number }>;
	try {
		records = await lookup(hostname, { all: true });
	} catch {
		throw { kind: 'invalid_url', message: `DNS lookup failed for ${hostname}` } satisfies UrlFetchError;
	}
	if (records.length === 0) {
		throw { kind: 'invalid_url', message: `No DNS records for ${hostname}` } satisfies UrlFetchError;
	}
	for (const { address } of records) {
		if (isPrivateIP(address)) {
			throw { kind: 'blocked_host', message: `${hostname} resolves to private IP ${address}` } satisfies UrlFetchError;
		}
	}
}

/**
 * Fetch a URL and extract its readable contents. Public-internet only — refuses
 * localhost, private IPs, and link-local hosts (SSRF guard). Throws a
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

	await assertPublicHost(parsed.hostname);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	let res: Response;
	try {
		res = await fetch(parsed.toString(), {
			headers: {
				'User-Agent': USER_AGENT,
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.5',
			},
			signal: controller.signal,
			redirect: 'follow',
		});
	} catch (err: any) {
		clearTimeout(timer);
		if (err?.name === 'AbortError') {
			throw { kind: 'timeout', message: `Fetch timed out after ${FETCH_TIMEOUT_MS}ms` } satisfies UrlFetchError;
		}
		throw { kind: 'network', message: err?.message ?? 'Network error' } satisfies UrlFetchError;
	}
	clearTimeout(timer);

	if (!res.ok) {
		throw {
			kind: 'http_error',
			status: res.status,
			message: `HTTP ${res.status} ${res.statusText}`,
		} satisfies UrlFetchError;
	}

	// After redirects, re-validate the final host (defence in depth against
	// open redirects landing on internal services).
	const finalUrl = res.url || parsed.toString();
	try {
		const finalParsed = new URL(finalUrl);
		if (finalParsed.hostname !== parsed.hostname) {
			await assertPublicHost(finalParsed.hostname);
		}
	} catch (err: any) {
		if (err?.kind) throw err;
	}

	const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
	const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml');
	const isPlainText = contentType.startsWith('text/') && !isHtml;

	if (!isHtml && !isPlainText) {
		throw {
			kind: 'unsupported_type',
			contentType,
			message: `Cannot extract content from ${contentType || 'unknown content type'}. Only HTML and plain text are supported.`,
		} satisfies UrlFetchError;
	}

	// Stream-cap the body so a hostile 1 GB page can't OOM the server.
	const reader = res.body?.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let truncated = false;
	if (reader) {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				total += value.byteLength;
				if (total > MAX_BYTES) {
					truncated = true;
					try {
						await reader.cancel();
					} catch {
						/* ignore */
					}
					break;
				}
				chunks.push(value);
			}
		}
	} else {
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.byteLength > MAX_BYTES) {
			truncated = true;
			chunks.push(buf.subarray(0, MAX_BYTES));
		} else {
			chunks.push(buf);
		}
	}
	const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');

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
			text = readableTextFromHtml(article.content ?? '', finalUrl);
			if (!text) text = normalizeExtractedText(article.textContent);
			if (article.title) title = article.title;
			if (article.excerpt?.trim()) excerpt = article.excerpt.trim();
		} else {
			// Fallback: strip scripts/styles, take body text
			doc.querySelectorAll('script, style, nav, footer, header, noscript').forEach((el) => el.remove());
			text = readableTextFromHtml(doc.body?.innerHTML ?? '', finalUrl);
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
