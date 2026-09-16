/**
 * Coverage that nothing runs reads exactly like coverage that does.
 *
 * Two things were quietly untrue:
 *
 *   - nightly.yml said it runs "the eight *.integration.test.ts files the merge
 *     gate has never once executed". There are 46. The number was right when it
 *     was written and nothing has re-counted since, so a class of test grew by
 *     5x with no one deciding that was fine.
 *
 *   - tests/e2e/ holds two Playwright specs and package.json has a `test:e2e`
 *     script, but NO workflow invokes it. The lane was written because
 *     render_chart shipped broken for months without anything noticing; it has
 *     since been in exactly the state it was created to end.
 *
 * These cases do not fix either. They make the numbers load-bearing, so the
 * next drift is a failed assertion rather than a stale comment.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Integration tests the merge gate never runs — they need a database, so they
 * are excluded there and run in the nightly, where each self-skips if its own
 * dependency is absent.
 *
 * RAISING THIS NUMBER IS A DECISION, not a formality: every file added here is
 * a file no pull request will ever execute.
 */
const INTEGRATION_FILES = 46;

function tracked(pattern: string): string[] {
	return execFileSync('git', ['ls-files', pattern], { cwd: ROOT, encoding: 'utf8' })
		.split('\n')
		.filter(Boolean);
}

describe('coverage census', () => {
	it(`has exactly ${INTEGRATION_FILES} integration test files`, () => {
		const found = tracked('*.integration.test.ts');
		expect(
			found.length,
			`Integration tests are excluded from the merge gate entirely. If this number ` +
				`went up, a pull request will never run the new file — decide that deliberately ` +
				`and update INTEGRATION_FILES.`
		).toBe(INTEGRATION_FILES);
	});

	it('does not let the nightly describe a count it no longer has', () => {
		const nightly = readFileSync(path.join(ROOT, '.github/workflows/nightly.yml'), 'utf8');
		const claim = /runs the (\w+|\d+) \*\.integration\.test\.ts files/.exec(nightly);
		expect(claim, 'the nightly no longer states how many integration files it runs').not.toBeNull();
		expect(claim![1]).toBe(String(INTEGRATION_FILES));
	});

	// Not "the lane must run" — wiring it needs a served app and seeded rows,
	// which is a real piece of work. This asserts only that the lane cannot
	// quietly grow while still being invoked by nothing.
	it('accounts for the Playwright lane, which no workflow invokes', () => {
		const specs = tracked('tests/e2e/*.spec.ts');
		expect(specs.length).toBe(2);

		const workflows = ['ci.yml', 'nightly.yml']
			.map((f) => readFileSync(path.join(ROOT, '.github/workflows', f), 'utf8'))
			.join('\n');
		const invoked = /test:e2e|playwright test/.test(workflows);

		// When someone wires it up, this flips and the case should become
		// "the lane runs in the nightly" instead. Until then the fact is here,
		// in a test, rather than implied by a script nobody calls.
		expect(
			invoked,
			'tests/e2e/ is now invoked by a workflow — good. Update this case to assert that instead.'
		).toBe(false);
	});
});
