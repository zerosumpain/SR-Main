import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			injectRegister: false,
			scope: '/jkai/',
			strategies: 'generateSW',
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
			},
			manifest: {
				id: '/jkai/',
				name: 'jkai',
				short_name: 'jkai',
				description: 'jkai chat hub',
				scope: '/jkai/',
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
			ignored: ['**/.claude/worktrees/**', '**/.svelte-kit/**', '**/node_modules/**'],
		},
	},
	test: {
		include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
		alias: {
			'$lib': fileURLToPath(new URL('./src/lib', import.meta.url)),
		},
	},
});
