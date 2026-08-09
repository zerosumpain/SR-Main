import adapter from '@sveltejs/adapter-node';

// The gate builds only to PROVE the tree bundles — it deletes the output and
// never ships it. Measured on a real run, the adapter-node pass that packages
// the runnable server bundle is ~93s of the ~203s build (bundling finishes at
// 18:25:45, the step ends at 18:27:18) and produces nothing the gate reads.
//
// Everything the gate build actually exists to catch happens BEFORE adapt():
// SvelteKit's client/server boundary check, module resolution and the Rollup
// bundle all run while building the client environment. So the gate can skip
// the packaging and keep the signal.
//
// SR_GATE_STUB_ADAPTER is set on the gate job's Build step ONLY. It must never
// be set on the VPS — the deploy build has to emit a real server bundle, and a
// stubbed one would deploy an empty build directory. adapt() is a no-op rather
// than a partial implementation on purpose: a half-written bundle that looks
// plausible is worse than none.
const stubAdapter = () => ({
	name: 'gate-stub-adapter',
	async adapt(builder) {
		builder.log.warn(
			'gate-stub-adapter: SR_GATE_STUB_ADAPTER=1, packaging skipped. ' +
				'The bundle was still built and checked; only the server package was not written.'
		);
	}
});

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter:
			process.env.SR_GATE_STUB_ADAPTER === '1' ? stubAdapter() : adapter({ out: 'build' }),
		// Disable SvelteKit's same-origin CSRF guard so WebDAV mount clients
		// (Finder, Explorer, davfs2) can PUT/MOVE/COPY. They send no Origin
		// header and frequently use text/plain content-type, both of which
		// trip the default check. Defense-in-depth still applies: Auth.js
		// session cookies are sameSite=lax (browser-level CSRF protection
		// on the rest of the site) and /dav/* requires Basic Auth against
		// webdav_credentials.
		csrf: { checkOrigin: false },
		serviceWorker: { register: false }
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;
