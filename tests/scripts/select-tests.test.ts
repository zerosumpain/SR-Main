/**
 * The test selector decides which tests run at gate level L2. Its failure mode
 * is asymmetric: selecting too many costs time, selecting too few lets a
 * regression through while the gate still reports success. So these tests are
 * weighted almost entirely toward "does it refuse to narrow when it should".
 *
 * The always-run drift test at the bottom is the one that keeps the whole thing
 * honest over time: a new filesystem-coupled test cannot be added without
 * landing in the list too, because this fails if the two disagree.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SELECTOR = path.join(ROOT, 'scripts/select-tests.mjs');

function select(files: string[]): { mode: string; reason: string; files: string[] } {
	const out = execFileSync('node', [SELECTOR], {
		cwd: ROOT,
		env: { ...process.env, SELECT_TESTS_FILES: files.join('\n') },
		encoding: 'utf8',
	});
	const lines = out.split('\n').filter(Boolean);
	return {
		mode: lines[0]?.replace('mode=', '') ?? '',
		reason: lines[1]?.replace('reason=', '') ?? '',
		files: lines.slice(2),
	};
}

describe('test selector', () => {
	it('narrows to a subset for an ordinary leaf module', () => {
		const r = select(['src/lib/jkai/tool-trace.ts']);
		expect(r.mode).toBe('selected');
		expect(r.files.length).toBeGreaterThan(0);
		expect(r.files.length).toBeLessThan(200);
		expect(r.files).toContain('src/lib/jkai/tool-trace.test.ts');
	});

	// The whole reason this selector is trustworthy. vitest's resolver drops
	// mocked modules from the dependency graph, so 127 test files here are
	// coupled to modules they never import. $lib/db alone is mocked by 75.
	it('follows vi.mock() as an edge, not just imports', () => {
		const r = select(['src/lib/db/index.ts']);
		expect(r.mode).toBe('selected');
		// A pure import graph would miss the mockers entirely and return a handful.
		expect(r.files.length).toBeGreaterThan(100);
	});

	it('includes a changed test file itself', () => {
		const r = select(['src/lib/jkai/tool-trace.test.ts']);
		expect(r.files).toContain('src/lib/jkai/tool-trace.test.ts');
	});

	it('always includes the always-run list', () => {
		const always = readFileSync(path.join(ROOT, 'tests/always-run.txt'), 'utf8')
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith('#'));
		const r = select(['src/lib/jkai/tool-trace.ts']);
		for (const f of always) expect(r.files).toContain(f);
	});

	it('never selects integration tests — those are the nightly’s job', () => {
		const r = select(['src/lib/db/index.ts']);
		expect(r.files.some((f) => f.includes('.integration.test.ts'))).toBe(false);
	});

	describe('fails closed', () => {
		it('on a path outside the modelled source universe', () => {
			expect(select(['brand-new-thing/x.ts']).mode).toBe('full');
			expect(select(['README.md']).mode).toBe('full');
		});

		it('on a file extension it does not model', () => {
			expect(select(['src/lib/shaders/fog.vert.glsl']).mode).toBe('full');
		});

		it('on an empty change set', () => {
			expect(select([]).mode).toBe('full');
		});

		// Always prints a usable answer and exits 0 — callers read the mode, never
		// the status, so a non-zero exit here would fail the gate for the wrong
		// reason while a silent empty output would be read as "nothing to run".
		it('always emits a mode and exits 0', () => {
			const r = select(['does/not/exist.ts']);
			expect(['full', 'selected']).toContain(r.mode);
			expect(r.reason).toBeTruthy();
		});
	});
});

describe('always-run list', () => {
	// This is the guard that stops the list going stale. If someone adds a test
	// that reads a source file off disk, the import graph cannot see that
	// coupling — and without this it would be silently deselected forever.
	it('matches what is actually filesystem-coupled in the suite', () => {
		const listed = readFileSync(path.join(ROOT, 'tests/always-run.txt'), 'utf8')
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith('#'))
			.sort();

		const found = execFileSync(
			'bash',
			[
				'-c',
				`grep -rlE "readFileSync|readdirSync|readFile\\(|execSync|execFileSync|spawnSync|statSync|existsSync|globSync" --include=*.test.ts src tests packages | grep -v '.integration.test.ts' | sort`,
			],
			{ cwd: ROOT, encoding: 'utf8' }
		)
			.split('\n')
			.filter(Boolean)
			.sort();

		expect(listed).toEqual(found);
	});
});
