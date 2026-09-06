import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter({ out: 'build' }),
		// Keep SvelteKit's default same-origin form protection enabled. WebDAV
		// carries Basic auth and is handled explicitly in hooks.server.ts; it is
		// not a reason to turn browser CSRF protection off for every route.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'base-uri': ['self'],
				'object-src': ['none'],
				'frame-ancestors': ['self'],
				'form-action': ['self'],
				'script-src': ['self', 'https://unpkg.com', 'https://static.cloudflareinsights.com', 'https://js-cdn.music.apple.com'],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com', 'https://unpkg.com'],
				'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
				'img-src': ['self', 'data:', 'blob:', 'https:'],
				'media-src': ['self', 'data:', 'blob:', 'https:'],
				// Mapbox fetches the offline tile blobs held in this browser’s IndexedDB.
				'connect-src': ['self', 'blob:', 'https:', 'wss:'],
				'worker-src': ['self', 'blob:'],
				'manifest-src': ['self'],
				'frame-src': [
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
