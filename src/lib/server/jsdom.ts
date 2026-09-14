/**
 * One shared promise for jsdom.
 *
 * jsdom is CommonJS and `require()`s two pure-ESM `@asamuzakjp/*` packages,
 * which import the widely-shared `lru-cache`. When anything else is importing
 * `lru-cache` at the same moment, Node's loader lands the require on a
 * half-loaded module and asserts:
 *
 *   ERR_INTERNAL_ASSERTION: Cannot require() ES Module .../lru-cache/dist/esm/
 *   index.min.js because it is not yet fully loaded. This may be caused by a
 *   race condition if the module is simultaneously dynamically import()-ed.
 *
 * Same code, same versions, different interleaving — which is why it was
 * intermittent, and why it kills a `vite build` rather than a request. It has
 * been failing CI since 2026-09-04; on 2026-09-13 it took four Builds in twenty
 * minutes, one branch needing three attempts.
 *
 * It cannot be fixed by pinning: `@asamuzakjp/dom-selector` keeps `lru-cache`
 * in every published version, npm refuses an override against its declared
 * `^11.2.7` with ERESOLVE, and it fires on Node 22.22.3 and 22.23.2 alike.
 *
 * So the fix is to stop loading jsdom where the race happens. It was reachable
 * from `hooks.server.ts` three ways — through the Gmail bridge into chat's URL
 * extractor, through the heartbeat into the news sources, and through the
 * workflow node registry into the deepdive extractor — so every process start
 * loaded it, and so did prerendering during the build. Loading it on demand
 * costs the same once, at the first request that actually parses HTML, and
 * takes it off the build and startup paths entirely.
 *
 * The PROMISE is cached, not the module: several extractors can reach for it in
 * the same tick, and simultaneous `import()` of a settling graph is the very
 * failure this module exists to avoid.
 */
let pending: Promise<typeof import('jsdom')> | null = null;

export function loadJsdom(): Promise<typeof import('jsdom')> {
	return (pending ??= import('jsdom'));
}
