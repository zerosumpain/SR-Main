import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = () => readFileSync(join(process.cwd(), 'src/service-worker.ts'), 'utf8');
const viteSource = () => readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');

describe('JKAI service-worker navigation policy', () => {
	it('does not cache authenticated JKAI navigation responses', () => {
		const sw = source();
		const vite = viteSource();
		expect(sw).not.toContain("cacheName: 'jkai-navigation'");
		expect(sw).not.toMatch(/url\.pathname\.startsWith\(['"]\/jkai['"]\)/);
		expect(vite).toContain('navigateFallback: null');
	});

	it('purges the legacy navigation cache and claims open clients on activation', () => {
		const sw = source();
		expect(sw).toContain("self.caches.delete('jkai-navigation')");
		expect(sw).toContain('clientsClaim()');
	});

	it('scopes the capture worker to /capture, in the registration and the manifest', () => {
		const layout = readFileSync(join(process.cwd(), 'src/routes/capture/+layout.svelte'), 'utf8');
		expect(layout).toContain("register('/capture-sw.js', { scope: '/capture' })");

		const manifest = JSON.parse(
			readFileSync(join(process.cwd(), 'static/capture-manifest.json'), 'utf8'),
		) as { scope?: string };
		// Without an explicit scope the default is start_url minus its last
		// segment — i.e. the whole origin.
		expect(manifest.scope).toBe('/capture');
	});

	it('lets the capture worker delete only its own caches', () => {
		const sw = readFileSync(join(process.cwd(), 'static/capture-sw.js'), 'utf8');
		// It used to delete every cache in the origin on activate, including the
		// jkai PWA's immutable assets.
		expect(sw).toContain('k.startsWith(CACHE_PREFIX)');
		expect(sw).not.toMatch(/keys\.filter\(\(k\) => k !== CACHE_NAME\)/);
	});

	it('registers an absolute worker that covers the canonical JKAI start URL', () => {
		const vite = viteSource();
		expect(vite).toContain("scope: '/jkai'");
		expect(vite).not.toContain("scope: '/jkai/'");
		expect(vite).toContain("buildBase: '/'");
		expect(vite).toContain("start_url: '/jkai'");
	});

	it('content-addresses the worker URL so an edge cache cannot retain the previous release', () => {
		const vite = viteSource();
		expect(vite).toContain('filename: `jkai-sw-${jkaiBuildId}.js`');
	});
});

describe('local type-check memory parity', () => {
	it('uses the same 8 GB heap as the CI type-check gate', () => {
		const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		expect(pkg.scripts.check).toContain('NODE_OPTIONS=--max-old-space-size=8192');
		expect(pkg.scripts['gate:check:only']).toContain('NODE_OPTIONS=--max-old-space-size=8192');
	});
});
