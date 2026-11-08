import type * as Registry from './registry';

/**
 * One shared promise for the tool catalogue.
 *
 * `./registry` imports all 52 tool modules for their `register()` side effects,
 * so it is loaded on demand rather than statically — that is what keeps it off
 * the static import graph of everything that assembles a prompt or runs a tool.
 *
 * It must be loaded ONCE, though, not once per caller. Several call sites can
 * reach for it in the same tick (a turn resolves toolset definitions, checks
 * whether a tool is destructive and then executes it), and Node will fail a
 * build outright on simultaneous `import()` of a module graph that is still
 * settling:
 *
 *   ERR_INTERNAL_ASSERTION: Cannot require() ES Module .../lru-cache ...
 *   because it is not yet fully loaded. This may be caused by a race condition
 *   if the module is simultaneously dynamically import()-ed via Promise.all().
 *
 * Caching the promise — not the module — means concurrent callers await the same
 * in-flight load, which is both the fix and the cheaper thing to do.
 */
let pending: Promise<typeof Registry> | null = null;

export function loadToolRegistry(): Promise<typeof Registry> {
	return (pending ??= import('./registry'));
}
