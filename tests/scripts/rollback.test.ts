/**
 * scripts/rollback.sh is the reason it is safe to close the direct-push escape
 * hatch on master. Before it, recovery from "deployed cleanly and it is wrong"
 * was a ten-minute revert PR or a force push — the very thing the branch ruleset
 * exists to stop.
 *
 * Driven against a fixture VPS_DIR. The steps that would actually move
 * production — the symlink flip, systemctl, the public verification — are past
 * the refusals these cases exercise, so nothing here touches a real service.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/rollback.sh');

/** A VPS_DIR with the given releases, the first of which is live. */
function fixture(shas: string[]) {
	const dir = mkdtempSync(path.join(tmpdir(), 'rollback-'));
	for (const sha of shas) {
		const rel = path.join(dir, 'releases', sha);
		mkdirSync(rel, { recursive: true });
		writeFileSync(path.join(rel, 'handler.js'), 'export {};\n');
		writeFileSync(path.join(rel, '.deploy-sha'), `sha=${sha}\nbuilt_at=2026-09-16T00:00:00Z\n`);
	}
	if (shas.length) symlinkSync(path.join('releases', shas[0]), path.join(dir, 'build'));
	return dir;
}

function run(dir: string, args: string[]) {
	try {
		const stdout = execFileSync('bash', [SCRIPT, ...args], {
			env: { ...process.env, VPS_DIR: dir },
			encoding: 'utf8',
			stdio: 'pipe',
		});
		return { code: 0, out: stdout };
	} catch (err) {
		const e = err as { status: number; stdout: Buffer; stderr: Buffer };
		return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
	}
}

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('scripts/rollback.sh', () => {
	it('lists what is available, marking the live one', () => {
		const dir = fixture([A, B]);
		try {
			const r = run(dir, ['--list']);
			expect(r.code).toBe(0);
			expect(r.out).toContain(A.slice(0, 12));
			expect(r.out).toContain(B.slice(0, 12));
			expect(r.out).toMatch(/<- LIVE/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('refuses a sha with no release directory, and says what there is', () => {
		const dir = fixture([A, B]);
		try {
			const r = run(dir, ['c'.repeat(40)]);
			expect(r.code).toBe(1);
			expect(r.out).toContain('No release directory');
			expect(r.out).toContain(A.slice(0, 12));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// An operator pastes what they have — from /releases, or a WhatsApp alert.
	it('resolves a short sha', () => {
		const dir = fixture([A, B]);
		try {
			// Reaching the dry-run banner is proof it got past resolution; an
			// unresolved sha exits well before that.
			const r = run(dir, [B.slice(0, 8), '--dry-run']);
			expect(r.out).not.toContain('No release directory');
			expect(r.out).toContain('Rolling back');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('refuses to roll back to what is already serving', () => {
		const dir = fixture([A, B]);
		try {
			const r = run(dir, [A]);
			expect(r.code).toBe(1);
			expect(r.out).toContain('Already serving');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('refuses a directory that is not a runnable release', () => {
		const dir = fixture([A, B]);
		try {
			rmSync(path.join(dir, 'releases', B, 'handler.js'));
			const r = run(dir, [B]);
			expect(r.code).toBe(1);
			expect(r.out).toContain('not a runnable release');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// It moves the web code and nothing else, and an operator who assumes
	// otherwise will not find out until the schema bites them.
	it('says plainly what it does not roll back', () => {
		const dir = fixture([A, B]);
		try {
			const r = run(dir, [B, '--dry-run']);
			expect(r.out).toContain('WEB CODE ONLY');
			expect(r.out).toMatch(/Not the database schema/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// An operator wants to see what would happen before moving production.
	//
	// "Nothing has been changed" has to be literally true. An earlier version
	// recorded previous.sha ABOVE the dry-run check, and a dry-run against
	// production overwrote it with the currently-live sha — which is exactly the
	// value that makes ci-release.sh's re-run detection believe there is nothing
	// to go back to. Caught by running it against the real box.
	it('--dry-run changes nothing and says so', () => {
		const dir = fixture([A, B]);
		try {
			const r = run(dir, [B, '--dry-run']);
			expect(r.code).toBe(0);
			expect(r.out).toContain('Nothing has been changed');
			expect(readlinkSync(path.join(dir, 'build'))).toContain(A);
			// Not one byte of deploy state.
			expect(existsSync(path.join(dir, '.deploy-state/previous.sha'))).toBe(false);
			expect(existsSync(path.join(dir, '.deploy-state/live.sha'))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// The old guard was `pgrep -f ci-release.sh`, which matched any command line
	// that merely MENTIONED the script — including, during this suite's own run,
	// a shell whose history contained the name. A lock has to say what is true.
	it('refuses while a release genuinely holds the lock', () => {
		const dir = fixture([A, B]);
		try {
			mkdirSync(path.join(dir, '.deploy-state'), { recursive: true });
			// This process is alive by definition.
			writeFileSync(path.join(dir, '.deploy-state/release.pid'), `${process.pid}\n`);
			const r = run(dir, [B, '--dry-run']);
			expect(r.code).toBe(1);
			expect(r.out).toContain('release is in flight');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('ignores a stale lock left by a killed release', () => {
		const dir = fixture([A, B]);
		try {
			mkdirSync(path.join(dir, '.deploy-state'), { recursive: true });
			// A pid that cannot be running: max_pid + 1.
			writeFileSync(path.join(dir, '.deploy-state/release.pid'), '4194305\n');
			const r = run(dir, [B, '--dry-run']);
			expect(r.code).toBe(0);
			expect(r.out).toContain('stale release lock');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('takes no arguments as a usage error, not an action', () => {
		const dir = fixture([A]);
		try {
			expect(run(dir, []).code).toBe(2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
