import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * jsdom must never go back onto the static import graph.
 *
 * It is CommonJS and `require()`s two pure-ESM `@asamuzakjp` packages that
 * import the widely-shared `lru-cache`; when anything else imports `lru-cache`
 * in the same tick, Node's loader asserts and the BUILD dies:
 *
 *   ERR_INTERNAL_ASSERTION: Cannot require() ES Module .../lru-cache ...
 *   because it is not yet fully loaded.
 *
 * That failed CI from 2026-09-04 until SR-Main #879 took jsdom off the startup
 * graph, at its worst four Builds in twenty minutes. Nothing fails when a
 * static import comes back — it just becomes intermittent again, weeks later,
 * and reads as whichever diff was unlucky. So it is asserted rather than
 * remembered.
 *
 * Reach jsdom through `loadJsdom()` in `$lib/server/jsdom`, which caches the
 * promise. A dynamic `import()` elsewhere would also be correct, but there is
 * no reason to have two of them.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOADER = path.join(SRC, 'lib/server/jsdom.ts');

function walk(dir: string, out: string[] = []): string[] {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (/\.(ts|svelte)$/.test(e.name)) out.push(p);
	}
	return out;
}

describe('jsdom stays off the static import graph', () => {
	const files = walk(SRC).filter((f) => f !== LOADER && !f.endsWith('jsdom.test.ts'));

	it('has files to check', () => {
		expect(files.length).toBeGreaterThan(2000);
	});

	it('nothing imports jsdom statically', () => {
		const offenders = files.filter((f) => {
			const src = fs.readFileSync(f, 'utf8');
			// `import ... from 'jsdom'` / `require('jsdom')`, but not `import('jsdom')`
			// and not a type-only import, which is erased at build.
			return (
				/^[ \t]*import\s+(?!type\b)[\s\S]*?from\s*['"]jsdom['"]/m.test(src) ||
				/\brequire\(\s*['"]jsdom['"]\s*\)/.test(src)
			);
		});
		expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
	});

	it('the loader caches the promise, not the module', () => {
		// Concurrent import() of a settling graph is the very failure this
		// module exists to avoid, so callers must share one in-flight load.
		const src = fs.readFileSync(LOADER, 'utf8');
		expect(src).toMatch(/pending\s*\?\?=\s*import\(\s*['"]jsdom['"]\s*\)/);
	});
});
