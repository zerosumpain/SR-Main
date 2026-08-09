/**
 * The gate-level classifier decides how much of the gate runs. Its failure mode
 * is asymmetric: classifying too HIGH costs time, classifying too LOW skips
 * checks while still reporting success. So these tests are weighted almost
 * entirely toward "does it refuse to lower the level when it should".
 *
 * The script is deliberately driven through GATE_LEVEL_FILES here rather than
 * real git history, so the cases stay readable and do not drift as the repo
 * changes.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/gate-level.sh');

function level(files: string[], tier: 'low' | 'high' = 'low'): string {
	const out = execFileSync('bash', [SCRIPT], {
		cwd: ROOT,
		env: { ...process.env, GATE_LEVEL_FILES: files.join('\n'), GATE_LEVEL_TIER: tier },
		encoding: 'utf8',
	});
	return /^level=(\S+)/m.exec(out)?.[1] ?? '';
}

describe('gate-level classifier', () => {
	describe('lowers to L1 only for genuine documentation', () => {
		it('root markdown and docs/ qualify', () => {
			expect(level(['README.md', 'CLAUDE.md'])).toBe('L1');
			expect(level(['docs/a/b.md'])).toBe('L1');
		});

		// The specific escape the design named: these are read at runtime by the
		// prompts loader, covered by a test, and shipped to the VPS. Treating
		// them as documentation would deploy a prompt change unchecked.
		it('data/prompts/*.md is not documentation', () => {
			expect(level(['data/prompts/morning.md'])).not.toBe('L1');
		});

		it('markdown nested inside source is not documentation', () => {
			expect(level(['src/lib/README.md'])).not.toBe('L1');
		});
	});

	describe('wide triggers force the full gate', () => {
		const wide = [
			'package.json',
			'package-lock.json',
			'vite.config.ts',
			'svelte.config.js',
			'tsconfig.json',
			'drizzle.config.ts',
			'src/app.d.ts',
			'src/app.html',
			'src/hooks.server.ts',
			'src/lib/db/schema.ts',
			'src/lib/types/anything.d.ts',
			'.github/workflows/ci.yml',
			'scripts/deploy.sh',
		];
		it.each(wide)('%s forces L3', (f) => {
			expect(level(['src/lib/ordinary.ts', f])).toBe('L3');
		});
	});

	describe('deny by default', () => {
		it('an unrecognised top-level directory forces L3', () => {
			expect(level(['brand-new-thing/x.ts'])).toBe('L3');
		});
		it('an unrecognised root file forces L3', () => {
			expect(level(['Dockerfile'])).toBe('L3');
		});
	});

	// The trust axis gates the blast-radius axis and never the reverse. This is
	// what confines everything L2 skips to changes already judged low-risk —
	// never auth, server lib, hooks, schema or the deploy path.
	it('a high risk tier overrides an otherwise-ordinary change', () => {
		expect(level(['src/lib/ordinary.ts'], 'low')).toBe('L2');
		expect(level(['src/lib/ordinary.ts'], 'high')).toBe('L3');
	});

	it('ordinary source reaches L2', () => {
		expect(level(['src/lib/jkai/tool-trace.ts', 'tests/lib/foo.test.ts'])).toBe('L2');
	});

	describe('fails closed', () => {
		it('an unresolvable base ref yields L3, not an empty level', () => {
			const out = execFileSync('bash', [SCRIPT, 'refs/heads/does-not-exist'], {
				cwd: ROOT,
				encoding: 'utf8',
			});
			expect(/^level=(\S+)/m.exec(out)?.[1]).toBe('L3');
		});

		// Callers read `level`, never the exit status — a non-zero exit here
		// would fail the gate for the wrong reason.
		it('always exits 0, even when it cannot classify', () => {
			expect(() =>
				execFileSync('bash', [SCRIPT, 'refs/heads/does-not-exist'], { cwd: ROOT, stdio: 'ignore' })
			).not.toThrow();
		});
	});
});
