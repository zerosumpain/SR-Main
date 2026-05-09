import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter({ out: 'build' }),
		// Disable SvelteKit's same-origin CSRF guard so WebDAV mount clients
		// (Finder, Explorer, davfs2) can PUT/MOVE/COPY. They send no Origin
		// header and frequently use text/plain content-type, both of which
		// trip the default check. Defense-in-depth still applies: Auth.js
		// session cookies are sameSite=lax (browser-level CSRF protection
		// on the rest of the site) and /dav/* requires Basic Auth against
		// webdav_credentials.
		csrf: { checkOrigin: false }
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;
