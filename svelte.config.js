import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Csp.CspDirectives} */
const cspDirectives = {
	'default-src': ['self'],
	'base-uri': ['self'],
	'object-src': ['none'],
	'frame-ancestors': ['self'],
	'form-action': ['self'],
	// 'wasm-unsafe-eval' lets a page compile WebAssembly (Biscuit Tower's
	// physics on the TV, Rapier 2D) and nothing else — JavaScript eval stays shut.
	'script-src': ['self', 'wasm-unsafe-eval', 'https://static.cloudflareinsights.com', 'https://js-cdn.music.apple.com', 'https://analytics.strangeramblings.com',
		// A local stack's own Umami (plain http on the tailnet); unset in production.
		...(process.env.UMAMI_DEV_ORIGIN ? [process.env.UMAMI_DEV_ORIGIN] : [])],
	'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
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
};

/**
 * The enforced policy's `connect-src` admits any https:/wss: host, which lets
 * injected script post data anywhere. This is the tight list the site's own
 * pages actually connect to, sent REPORT-ONLY first: a host missing from it is
 * logged by /api/csp-report instead of breaking a feature, and the list is
 * enforced once production has been quiet for a while.
 *
 *  - analytics + Cloudflare's beacon: Umami and Web Analytics
 *  - Mapbox GL: styles, tiles and telemetry for the trip/day/places maps
 *  - Apple: MusicKit's API, playback and artwork/audio CDN, and Sign in with Apple
 */
const cspReportOnly = {
	...cspDirectives,
	'connect-src': ['self', 'blob:',
		'https://analytics.strangeramblings.com',
		'https://cloudflareinsights.com', 'https://static.cloudflareinsights.com',
		'https://api.mapbox.com', 'https://events.mapbox.com', 'https://*.tiles.mapbox.com',
		'https://*.apple.com', 'https://*.mzstatic.com',
		...(process.env.UMAMI_DEV_ORIGIN ? [process.env.UMAMI_DEV_ORIGIN] : [])],
	'report-uri': ['/api/csp-report']
};

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
			directives: cspDirectives,
			reportOnly: cspReportOnly
		},
		serviceWorker: { register: false }
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;
