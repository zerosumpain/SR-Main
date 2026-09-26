// SSRF behaviour of fetchUrlContent — the path behind the `fetch_url` chat
// tool and the pre-fetch of every URL a user pastes into chat.
//
// A real local HTTP server plays the "public" site. DNS is mocked so
// `public.example.test` resolves to a public-looking TEST-NET address
// (203.0.113.10) — the SSRF guard sees and pins a public IP — and undici's
// Agent is wrapped so a connection to that pinned address lands on 127.0.0.1.
// Everything between (validation, pinning, per-hop redirect checks) is the
// production code path.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { lookup } from 'node:dns/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

const PUBLIC_TEST_IP = '203.0.113.10';

vi.mock('undici', async (importOriginal) => {
	const actual = await importOriginal<typeof import('undici')>();
	type LookupFn = (hostname: string, options: unknown, callback: (...args: unknown[]) => void) => void;
	const toLocal = (address: unknown) => (address === PUBLIC_TEST_IP ? '127.0.0.1' : address);
	class LoopbackForTestNetAgent extends actual.Agent {
		constructor(opts?: ConstructorParameters<typeof actual.Agent>[0]) {
			const connect = (opts?.connect ?? {}) as { lookup?: LookupFn };
			const pinned = connect.lookup;
			super({
				...opts,
				connect: {
					...connect,
					lookup: pinned
						? (hostname: string, options: unknown, callback: (...args: unknown[]) => void) =>
								pinned(hostname, options, (err: unknown, address: unknown, family: unknown) => {
									if (Array.isArray(address)) {
										callback(
											err,
											address.map((a: { address: string; family: number }) => ({ ...a, address: toLocal(a.address) })),
										);
									} else {
										callback(err, toLocal(address), family);
									}
								})
						: undefined,
				} as never,
			});
		}
	}
	return { ...actual, Agent: LoopbackForTestNetAgent };
});

const { fetchUrlContent } = await import('./url');
const mockLookup = vi.mocked(lookup);

let server: Server;
let port = 0;
const hits = new Map<string, number>();
const hitCount = (path: string) => hits.get(path) ?? 0;

const ARTICLE_HTML = `<!doctype html><html><head><title>A public article</title>
<meta name="description" content="About the public article."></head>
<body><article><h1>A public article</h1>
<p>This paragraph is long enough for Readability to treat the page as an article worth extracting.</p>
<p>A second paragraph keeps the extraction honest and well over the fifty character minimum.</p>
</article></body></html>`;

beforeAll(async () => {
	server = createServer((req, res) => {
		const path = new URL(req.url ?? '/', 'http://x').pathname;
		hits.set(path, hitCount(path) + 1);
		if (path === '/article') {
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
			res.end(ARTICLE_HTML);
		} else if (path === '/to-loopback') {
			res.writeHead(302, { location: `http://127.0.0.1:${port}/hit` });
			res.end();
		} else if (path === '/to-public') {
			res.writeHead(302, { location: `http://public.example.test:${port}/article` });
			res.end();
		} else if (path === '/pdf') {
			res.writeHead(200, { 'content-type': 'application/pdf' });
			res.end(Buffer.alloc(64 * 1024));
		} else if (path === '/missing') {
			res.writeHead(404, { 'content-type': 'text/html' });
			res.end('<p>nope</p>');
		} else {
			// /hit — the internal target. Any request here is an SSRF.
			res.writeHead(200, { 'content-type': 'text/plain' });
			res.end('internal secret');
		}
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
	hits.clear();
	mockLookup.mockReset();
	mockLookup.mockImplementation((async (host: string) => {
		if (host === 'public.example.test') return [{ address: PUBLIC_TEST_IP, family: 4 }];
		if (host === 'cgnat.example.test') return [{ address: '100.64.0.5', family: 4 }];
		throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
	}) as never);
});

async function failure(url: string): Promise<{ kind: string; message: string }> {
	try {
		await fetchUrlContent(url);
	} catch (err) {
		return err as { kind: string; message: string };
	}
	throw new Error(`expected ${url} to be refused`);
}

describe('fetchUrlContent SSRF guard', () => {
	it('does not follow a redirect from a public page to loopback', async () => {
		const err = await failure(`http://public.example.test:${port}/to-loopback`);
		expect(err.kind).toBe('blocked_host');
		expect(hitCount('/to-loopback')).toBe(1); // the public hop really was fetched
		expect(hitCount('/hit')).toBe(0); // the internal hop never was
	});

	it('refuses a literal Tailscale / CGNAT address', async () => {
		const err = await failure('http://100.100.1.1/');
		expect(err.kind).toBe('blocked_host');
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it('refuses a hostname that resolves into 100.64.0.0/10', async () => {
		const err = await failure('http://cgnat.example.test/');
		expect(err.kind).toBe('blocked_host');
		expect(err.message).toMatch(/100\.64\.0\.5/);
	});

	it('refuses an IPv4-mapped IPv6 loopback literal', async () => {
		expect((await failure('http://[::ffff:7f00:1]/')).kind).toBe('blocked_host');
		expect((await failure(`http://[::ffff:127.0.0.1]:${port}/hit`)).kind).toBe('blocked_host');
		expect(hitCount('/hit')).toBe(0);
	});

	it('extracts a normal public page', async () => {
		const result = await fetchUrlContent(`http://public.example.test:${port}/article`);
		expect(result.title).toBe('A public article');
		expect(result.content).toContain('long enough for Readability');
		expect(result.finalUrl).toBe(`http://public.example.test:${port}/article`);
		expect(result.contentType).toContain('text/html');
		expect(result.truncated).toBe(false);
	});

	it('follows a redirect between public hosts and reports the final URL', async () => {
		const result = await fetchUrlContent(`http://public.example.test:${port}/to-public`);
		expect(result.finalUrl).toBe(`http://public.example.test:${port}/article`);
		expect(result.content).toContain('long enough for Readability');
	});

	it('keeps the existing error shapes for HTTP errors, types and DNS failures', async () => {
		const missing = await failure(`http://public.example.test:${port}/missing`);
		expect(missing).toMatchObject({ kind: 'http_error', status: 404, message: 'HTTP 404 Not Found' });

		const pdf = await failure(`http://public.example.test:${port}/pdf`);
		expect(pdf).toMatchObject({ kind: 'unsupported_type', contentType: 'application/pdf' });

		expect((await failure('http://nowhere.example.test/')).kind).toBe('invalid_url');
		expect((await failure('ftp://public.example.test/')).kind).toBe('invalid_url');
		expect((await failure('http://localhost/')).kind).toBe('blocked_host');
	});
});
