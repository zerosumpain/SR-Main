/**
 * The risk classifier decides whether a pull request may merge itself. `tier=low`
 * on an `agent/` branch is auto-merge eligible, so every way of reaching `low`
 * that should have been `high` is a way for an unattended build to land
 * unreviewed. These tests are weighted entirely toward "does it refuse to say
 * low when it should".
 *
 * Driven through a throwaway git repo rather than the real one: the script reads
 * its change set from `git diff` against a merge base, so an injected file list
 * would skip the part most likely to be wrong.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/classify-pr-risk.sh');
const RULES = path.join(ROOT, '.github/protected-paths.txt');

/**
 * Build a repo whose base commit contains `seed`, apply `mutate`, then classify
 * the result against the base. Returns the printed verdict.
 */
function classify(seed: string[], mutate: (git: (...a: string[]) => string, dir: string) => void) {
	const tmp = mkdtempSync(path.join(tmpdir(), 'pr-risk-'));
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: tmp, encoding: 'utf8', stdio: 'pipe' });
	const write = (p: string, body = 'x\n') => {
		mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true });
		writeFileSync(path.join(tmp, p), body);
	};
	try {
		git('init', '-q', '-b', 'main');
		git('config', 'user.email', 't@t');
		git('config', 'user.name', 'T');
		mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
		mkdirSync(path.join(tmp, '.github'), { recursive: true });
		copyFileSync(SCRIPT, path.join(tmp, 'scripts/classify-pr-risk.sh'));
		// The real rule file, so these cases cannot drift away from what ships.
		copyFileSync(RULES, path.join(tmp, '.github/protected-paths.txt'));
		for (const p of seed) write(p);
		git('add', '-A');
		git('commit', '-qm', 'base');

		mutate(git, tmp);
		git('add', '-A');
		git('commit', '-qm', 'change');

		return execFileSync('bash', [path.join(tmp, 'scripts/classify-pr-risk.sh'), 'HEAD^'], {
			cwd: tmp,
			encoding: 'utf8',
			env: { ...process.env, GITHUB_OUTPUT: '' },
		});
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

// The human-readable line says `tier=HIGH`; the $GITHUB_OUTPUT line says
// `tier=high`. Read the printed one and normalise, so these cases do not depend
// on which of the two the script happens to emit first.
const tierOf = (out: string) => (/tier=(\w+)/.exec(out)?.[1] ?? '').toLowerCase();

describe('PR risk classifier', () => {
	it('ordinary feature work is low', () => {
		const out = classify(['src/lib/ordinary.ts'], (_g, dir) =>
			writeFileSync(path.join(dir, 'src/lib/ordinary.ts'), 'changed\n')
		);
		expect(tierOf(out)).toBe('low');
	});

	it('touching a protected path is high', () => {
		const out = classify(['src/lib/auth.ts'], (_g, dir) =>
			writeFileSync(path.join(dir, 'src/lib/auth.ts'), 'changed\n')
		);
		expect(tierOf(out)).toBe('high');
	});

	// THE RENAME ESCAPE. `git diff --name-only` reports only a rename's
	// DESTINATION, so moving a protected file out from under its rule showed the
	// classifier nothing but an unremarkable new path. Worse than a one-off: the
	// rule then names a path that no longer exists, so the protection is gone for
	// every future PR too. --no-renames makes it a delete plus an add, and the
	// delete still carries the protected path.
	it('moving a protected file out from under its rule is high, not low', () => {
		const out = classify(['src/lib/auth.ts'], (git) =>
			git('mv', 'src/lib/auth.ts', 'src/lib/identity.ts')
		);
		expect(tierOf(out)).toBe('high');
		expect(out).toContain('src/lib/auth.ts');
	});

	it('deleting a protected file is high', () => {
		const out = classify(['src/lib/auth.ts'], (git) => git('rm', '-q', 'src/lib/auth.ts'));
		expect(tierOf(out)).toBe('high');
	});

	// Adding coverage is the behaviour we want and must stay cheap; only
	// modification and deletion can shrink it.
	it('adding a test stays low', () => {
		const out = classify(['src/lib/ordinary.ts'], (_g, dir) => {
			mkdirSync(path.join(dir, 'tests/lib'), { recursive: true });
			writeFileSync(path.join(dir, 'tests/lib/new.test.ts'), 'it("x", () => {});\n');
		});
		expect(tierOf(out)).toBe('low');
	});

	it('weakening an existing test is high', () => {
		const out = classify(['tests/lib/existing.test.ts'], (_g, dir) =>
			writeFileSync(path.join(dir, 'tests/lib/existing.test.ts'), 'it.skip("x", () => {});\n')
		);
		expect(tierOf(out)).toBe('high');
	});

	// Renaming a test is a modification with extra steps.
	it('renaming an existing test is high', () => {
		const out = classify(['tests/lib/existing.test.ts'], (git) =>
			git('mv', 'tests/lib/existing.test.ts', 'tests/lib/moved.test.ts')
		);
		expect(tierOf(out)).toBe('high');
	});
});
