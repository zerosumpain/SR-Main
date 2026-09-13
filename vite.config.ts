import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { routeManifest } from './vite-plugins/route-manifest.mjs';
import { sourceFootprint } from './vite-plugins/source-footprint.mjs';

export default defineConfig({
	plugins: [
		tailwindcss(),
		// Bakes the route inventory into the build for /admin/estate. Must run
		// at build time: `src/` is not deployed, so a runtime scan reads a stale
		// leftover tree on the VPS. See vite-plugins/route-manifest.mjs.
		routeManifest(),
		sourceFootprint(),
		sveltekit(),
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
