import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import tailwindcss from '@tailwindcss/vite';
import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { routeManifest } from './vite-plugins/route-manifest.mjs';

function readBuildId(): string {
	const supplied = process.env.JKAI_BUILD_ID?.trim();
	if (supplied) return supplied;
	try {
		// A tree identifies the browser bundle's actual source. Unlike a commit
		// SHA, it survives CI's verified-candidate promotion, where the PR and
		// squash-merge commits deliberately share content but not commit IDs.
		return execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
	} catch {
		return 'development';
	}
}

const jkaiBuildId = readBuildId();

export default defineConfig({
	define: {
		__JKAI_BUILD_ID__: JSON.stringify(jkaiBuildId),
	},
	plugins: [
		tailwindcss(),
		// Bakes the route inventory into the build for /admin/estate. Must run
		// at build time: `src/` is not deployed, so a runtime scan reads a stale
		// leftover tree on the VPS. See vite-plugins/route-manifest.mjs.
		routeManifest(),
		sveltekit(),
		SvelteKitPWA({
			// Long-lived chat sessions may contain unsent text. Download updates in
			// the background, then let the user choose the safe moment to reload.
			registerType: 'prompt',
			injectRegister: false,
			// Cloudflare gives unversioned static files a four-hour browser/edge TTL.
			// Key the worker URL by the release tree so a new client never registers
			// stale worker bytes from the previous release's /sw.js cache entry.
			filename: `jkai-sw-${jkaiBuildId}.js`,
			// SvelteKit canonicalises /jkai/ to /jkai. A trailing slash here leaves
			// the installed app's start page outside the worker's control.
			scope: '/jkai',
			// SvelteKit builds with a relative asset base. Service-worker URLs are
			// resolved against the PAGE, not the importing chunk, so force /sw.js;
			// otherwise nested routes try /jkai/.../sw.js.
			buildBase: '/',
			strategies: 'generateSW',
			workbox: {
				// Precache only the install metadata. Previously this glob captured the
				// whole site (including canvas/editor chunks) even though this worker can
				// only control /jkai, producing an 8+ MiB compressed first-install cache.
				// Immutable JKAI assets are cached as they are actually used instead.
				// Paths are relative to .svelte-kit/output, not its client child. The
				// explicit prefix map also prevents the SvelteKit wrapper from appending
				// its broad client/** and prerendered/** defaults.
				globPatterns: ['client/jkai-pwa/*.png'],
				modifyURLPrefix: { 'client/': '/' },
				cleanupOutdatedCaches: true,
				runtimeCaching: [
					{
						urlPattern: ({ url }) =>
							url.origin === self.location.origin && url.pathname.startsWith('/_app/immutable/'),
						handler: 'CacheFirst',
						options: {
							cacheName: 'jkai-immutable-assets',
							cacheableResponse: { statuses: [0, 200] },
							expiration: {
								maxEntries: 200,
								maxAgeSeconds: 30 * 24 * 60 * 60,
							},
						},
					},
				],
				// JKAI is an authenticated live view. Never answer one of its
				// navigations with the precached public-site fallback.
				navigateFallback: null,
				// Once the user accepts an update, make the activated worker control
				// the open page so controllerchange can complete the reload handshake.
				clientsClaim: true,
			},
			manifest: {
				id: '/jkai/',
				name: 'jkai',
				short_name: 'jkai',
				description: 'jkai chat hub',
				scope: '/jkai',
				start_url: '/jkai',
				display: 'standalone',
				theme_color: '#0a0a0a',
				background_color: '#f4ede4',
				orientation: 'portrait',
				icons: [
					{ src: '/jkai-pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/jkai-pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
					{ src: '/jkai-pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
				],
			},
		}),
	],
	server: {
		allowedHosts: ['homeserv.tail668b8c.ts.net', 'homeserv'],
		watch: {
			// `.worktrees/` too: thirty-odd worktrees with their own node_modules and
			// build output live under the repo, and watching them exhausted
			// fs.inotify.max_user_watches (ENOSPC) before the dev server served a page.
			// The build ignore is ANCHORED: `**/build/**` also matched the real route
			// directory src/routes/projects/policy-engine/build/ and froze its HMR.
			ignored: [
				'**/.claude/worktrees/**',
				'**/.worktrees/**',
				'**/.svelte-kit/**',
				'**/node_modules/**',
				`${fileURLToPath(new URL('./build', import.meta.url))}/**`,
			],
		},
	},
	test: {
		// packages/ is included so sidecar code (jkai-codex-bridge, …) is covered
		// by the same merge gate as the app — a test that only runs when someone
		// remembers to point vitest at it is not a gate.
		include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
		// Many tests pull heavy module graphs in via dynamic `await import()`.
		// Across the whole suite that is ~150s of module loading, so the 5s
		// default makes any import-bound test a load-dependent flake (it passes
		// in isolation, times out under a full parallel run). A real failure
		// still fails — just later. Raised so the merge gate is deterministic.
		testTimeout: 20000,
		hookTimeout: 20000,
		alias: {
			'$lib': fileURLToPath(new URL('./src/lib', import.meta.url)),
		},
	},
});
