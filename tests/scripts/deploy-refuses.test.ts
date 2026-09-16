/**
 * scripts/deploy.sh is a refusal, not a deploy. Running it by hand cost 33 hours
 * of downtime and a public /admin exposure in 2026, and the guard added
 * afterwards was fail-open: it could not distinguish "build/ is not a symlink"
 * from "ssh could not reach the VPS", so it waved the rsync through in exactly
 * the situation where someone reaches for a manual deploy.
 *
 * These tests exist so the file cannot quietly grow the capability back.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/deploy.sh');
const source = readFileSync(SCRIPT, 'utf8');

/**
 * The parts of the file bash would actually execute. Both the header comment
 * and the refusal heredoc legitimately name rsync, ssh and systemctl — the
 * first explaining the incident, the second telling the operator how to roll
 * back by hand. Neither runs.
 */
function executablePart(): string {
	return source
		.replace(/<<'REFUSE'[\s\S]*?^REFUSE$/m, '')
		.split('\n')
		.filter((line) => !/^\s*#/.test(line))
		.join('\n');
}

describe('scripts/deploy.sh', () => {
	it('exits non-zero without being asked anything', () => {
		let code = 0;
		try {
			execFileSync('bash', [SCRIPT], { cwd: ROOT, stdio: 'pipe' });
		} catch (err) {
			code = (err as { status: number }).status;
		}
		expect(code).toBe(1);
	});

	it('names the supported path in its refusal', () => {
		let stderr = '';
		try {
			execFileSync('bash', [SCRIPT], { cwd: ROOT, stdio: 'pipe' });
		} catch (err) {
			stderr = String((err as { stderr: Buffer }).stderr);
		}
		expect(stderr).toContain('REFUSING TO RUN');
		expect(stderr).toContain('merging to master');
	});

	// The specific capabilities that made it dangerous. Not a style rule: each
	// of these is a mechanism from the incident.
	it.each([
		['rsync', /\brsync\b/],
		['a remote shell', /\bssh\b/],
		['a service restart', /systemctl\s+restart/],
		['an environment write', />\s*\.env|>>\s*\.env/],
	])('contains no %s', (_label, pattern) => {
		expect(executablePart()).not.toMatch(pattern);
	});

	// A refusal that can be reached conditionally is not a refusal.
	it('refuses unconditionally, with no branch guarding the exit', () => {
		expect(executablePart()).not.toMatch(/^\s*(if|case|while)\b/m);
	});
});
