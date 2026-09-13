import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const viteSource = () => readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');

describe('JKAI service-worker navigation policy', () => {
	it('does not cache authenticated JKAI navigation responses', () => {
		expect(viteSource()).toContain('navigateFallback: null');
	});

	it('has no root-scoped service worker at all', () => {
		// These two cases used to assert that src/service-worker.ts did not cache
		// /jkai navigations and purged its legacy cache on activate. That file was
		// the pre-vite-plugin-pwa worker; nothing registered it, SvelteKit built it
		// anyway, and it shipped 25 KB of root-scoped worker referencing a
		// __WB_MANIFEST nothing injects. Deleting it is the stronger version of
		// what those cases were protecting — a worker that does not exist cannot
		// serve a stale authenticated page — so the assertion is now its absence.
		//
		// A root-scoped worker is also no longer just a jkai concern: the site is
		// being split across several applications on one origin, and anything
		// registered at "/" controls all of them.
		expect(existsSync(join(process.cwd(), 'src/service-worker.ts'))).toBe(false);
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
		expect(sw).toContain("k.startsWith(CACHE_PREFIX)");
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
