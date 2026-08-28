/**
 * The boundary linter's failure mode is silent: a broken extraction reports a
 * clean tree, and every rule quietly stops existing. MIN_EDGES catches total
 * failure, but not the partial kind — a regex that still matches `.ts` and
 * stops matching `.svelte` would keep the count plausible while going blind to
 * a fifth of the repo. That is not hypothetical: it is exactly what
 * dependency-cruiser does, and why this script exists instead of it.
 *
 * So these tests are weighted toward "does it still SEE the violation",
 * per file type and per specifier form, rather than toward the layer table.
 *
 * The script is driven through SR_BOUNDARIES_ROOT against a fixture tree rather
 * than the real src/, the same way gate-level.test.ts uses GATE_LEVEL_FILES —
 * the cases stay readable and do not drift as src/lib changes. Fixture mode
 * also empties the baselines, so each test asserts the RULE rather than this
 * repo's current debt.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/check-module-boundaries.mjs');

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Run the linter over a synthetic { 'src/lib/db/index.ts': "…" } tree. */
function check(tree: Record<string, string>): { code: number; out: string } {
	const dir = mkdtempSync(path.join(tmpdir(), 'boundaries-'));
	dirs.push(dir);
	for (const [file, content] of Object.entries(tree)) {
		mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
		writeFileSync(path.join(dir, file), content);
	}
	try {
		// stdio must be explicit: execFileSync echoes the child's stderr to the
		// parent by default, and every failing case here writes a full violation
		// report to it — 15 tests' worth of noise around a passing run.
		const out = execFileSync('node', [SCRIPT], {
			env: { ...process.env, SR_BOUNDARIES_ROOT: dir },
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { code: 0, out };
	} catch (e) {
		const err = e as { status: number; stdout: string; stderr: string };
		return { code: err.status, out: `${err.stdout}${err.stderr}` };
	}
}

describe('module boundary linter', () => {
	describe('sees the import at all', () => {
		it('catches an upward import in a .ts file', () => {
			const r = check({ 'src/lib/db/index.ts': "import '$lib/workflows/registry';" });
			expect(r.code).toBe(1);
			expect(r.out).toContain('db -> workflows');
		});

		// THE regression this file exists for. dependency-cruiser v18 resolves
		// $lib correctly and still extracts ZERO dependencies from a .svelte
		// file — measured 2026-08-27: 47 components, 0 deps. If this test goes
		// green while the .ts one above stays green, the extraction has grown
		// the same blind spot and the linter is decoration for every component
		// in the repo.
		it('catches an upward import in a .svelte file', () => {
			const r = check({
				'src/lib/db/Widget.svelte': "<script lang=\"ts\">\n\timport x from '$lib/workflows/registry';\n</script>\n",
			});
			expect(r.code).toBe(1);
			expect(r.out).toContain('db -> workflows');
		});

		// A $lib-only regex is blind to this, so the rule would be one `../`
		// away from being optional.
		it('catches a RELATIVE import that escapes the module', () => {
			const r = check({ 'src/lib/db/index.ts': "import '../workflows/registry';" });
			expect(r.code).toBe(1);
			expect(r.out).toContain('db -> workflows');
		});

		it('catches a re-export across the boundary', () => {
			const r = check({ 'src/lib/db/index.ts': "export * from '$lib/workflows/registry';" });
			expect(r.code).toBe(1);
			expect(r.out).toContain('db -> workflows');
		});

		it('catches a dynamic import', () => {
			const r = check({ 'src/lib/db/index.ts': "await import('$lib/workflows/registry');" });
			expect(r.code).toBe(1);
			expect(r.out).toContain('db -> workflows');
		});
	});

	describe('does not invent violations', () => {
		it('allows importing DOWN a layer', () => {
			expect(check({ 'src/lib/workflows/a.ts': "import '$lib/db';" }).code).toBe(0);
		});

		it('allows importing WITHIN a layer', () => {
			expect(check({ 'src/lib/workflows/a.ts': "import '$lib/health/x';" }).code).toBe(0);
		});

		it('allows a route to import anything in src/lib', () => {
			expect(check({ 'src/routes/jkai/+page.svelte': "<script>import '$lib/db';</script>" }).code).toBe(0);
		});

		// A commented-out import is not a dependency, and failing the gate over
		// a line that never executes would teach people to distrust it.
		it('ignores a commented-out import', () => {
			const r = check({
				'src/lib/db/index.ts': "// import '$lib/workflows/registry';\n/* import '$lib/jkai/x'; */\n",
			});
			expect(r.code).toBe(0);
		});

		// SvelteKit generates ./$types next to every route file. Reading it as a
		// sibling route made every +page.server.ts in the repo a violation.
		it('ignores SvelteKit $types', () => {
			expect(check({ 'src/routes/blog/+page.server.ts': "import type { X } from './$types';" }).code).toBe(0);
		});
	});

	describe('the rules themselves', () => {
		it('stops the platform layer reaching up into a domain module', () => {
			const r = check({ 'src/lib/server/a.ts': "import '$lib/jkai/x';" });
			expect(r.code).toBe(1);
			expect(r.out).toContain('platform may not import domain');
		});

		it('stops a feature module importing the UI layer', () => {
			const r = check({ 'src/lib/health/a.ts': "import '$lib/components/Button.svelte';" });
			expect(r.code).toBe(1);
			expect(r.out).toContain('domain may not import ui');
		});

		it('stops one route importing another route', () => {
			const r = check({ 'src/routes/api/x/+server.ts': "import '../../projects/y/lib/router';" });
			expect(r.code).toBe(1);
			expect(r.out).toContain('may not import another route');
		});

		it('stops two modules importing each other', () => {
			const r = check({
				'src/lib/health/a.ts': "import '$lib/blog/x';",
				'src/lib/blog/b.ts': "import '$lib/health/y';",
			});
			expect(r.code).toBe(1);
			expect(r.out).toContain('blog <-> health');
		});

		// An unlisted module defaults to `domain`: free to use the platform,
		// blocked from reaching up into the UI. A new module must not arrive
		// exempt from the rules.
		it('defaults an unknown module to the domain layer', () => {
			expect(check({ 'src/lib/brand-new/a.ts': "import '$lib/db';" }).code).toBe(0);
			const r = check({ 'src/lib/brand-new/a.ts': "import '$lib/components/B.svelte';" });
			expect(r.code).toBe(1);
			expect(r.out).toContain('domain may not import ui');
		});
	});
});
