import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter({ out: 'build' }),
		// Keep SvelteKit's default same-origin form protection enabled.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'base-uri': ['self'],
				'object-src': ['none'],
				'frame-ancestors': ['self'],
				'form-action': ['self'],
				// 'wasm-unsafe-eval' lets a page compile WebAssembly (Biscuit Tower's
				// physics on the TV, Rapier 2D) and nothing else — JavaScript eval stays shut.
				'script-src': ['self', 'wasm-unsafe-eval', 'https://unpkg.com', 'https://static.cloudflareinsights.com', 'https://js-cdn.music.apple.com', 'https://analytics.strangeramblings.com',
					// A local stack's own Umami (plain http on the tailnet); unset in production.
					...(process.env.UMAMI_DEV_ORIGIN ? [process.env.UMAMI_DEV_ORIGIN] : [])],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com', 'https://unpkg.com'],
				'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
				'img-src': ['self', 'data:', 'blob:', 'https:'],
				'media-src': ['self', 'data:', 'blob:', 'https:'],
				// Browser workers may fetch cached assets held in IndexedDB.
				'connect-src': ['self', 'blob:', 'https:', 'wss:', ...(process.env.UMAMI_DEV_ORIGIN ? [process.env.UMAMI_DEV_ORIGIN] : [])],
				'worker-src': ['self', 'blob:'],
				'manifest-src': ['self'],
				'frame-src': [...Array.from({ length: 8 }, (_, i) => `https://preview-${5281 + i}.strangeramblings.com`),
					...(process.env.BUILDER_WORKSPACE_BROKER_URL ? Array.from({ length: 8 }, (_, i) => `http://127.0.0.1:${5281 + i}`) : []),
					'self',
					'https://vnc.strangeramblings.com',
					'https://www.youtube.com',
					'https://www.youtube-nocookie.com',
					'https://player.vimeo.com'
				]
			}
		},
		serviceWorker: { register: false }
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;
