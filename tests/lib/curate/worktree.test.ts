import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

// Test-only: override the sessions base so we don't pollute ~/.curate-sessions.
const TEST_BASE = path.join(os.tmpdir(), `curate-test-${Date.now()}`);
process.env.CURATE_SESSIONS_BASE_OVERRIDE = TEST_BASE;

afterEach(() => {
  // Ensure no test branches leak.
  try {
    const branches = execFileSync('git', ['branch', '--list', 'curate/test-*'], { cwd: process.cwd() })
      .toString().trim().split('\n').filter(Boolean).map((s) => s.trim().replace(/^\* /, ''));
    for (const b of branches) {
      try { execFileSync('git', ['worktree', 'remove', '--force', `${TEST_BASE}/${b.replace('curate/', '')}`], { cwd: process.cwd() }); } catch { /* ignore */ }
      try { execFileSync('git', ['branch', '-D', b], { cwd: process.cwd() }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try { fs.rmSync(TEST_BASE, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('per-session worktree', () => {
  it('creates a worktree at the expected path with a curate branch', async () => {
    const { createSessionWorktree } = await import('$lib/curate/worktree');
    const { dir, branch } = await createSessionWorktree({ sessionId: 'test-wt-1', skipNodeModulesLink: true });
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(true);
    expect(branch).toBe('curate/test-wt-1');
    // Confirm git knows about the worktree.
    const list = execFileSync('git', ['worktree', 'list', '--porcelain']).toString();
    expect(list).toContain(dir);
  });

  it('removeSessionWorktree tears it down', async () => {
    const { createSessionWorktree, removeSessionWorktree } = await import('$lib/curate/worktree');
    const { dir } = await createSessionWorktree({ sessionId: 'test-wt-2', skipNodeModulesLink: true });
    expect(fs.existsSync(dir)).toBe(true);
    await removeSessionWorktree({ sessionId: 'test-wt-2' });
    expect(fs.existsSync(dir)).toBe(false);
    const branches = execFileSync('git', ['branch', '--list', 'curate/test-wt-2']).toString().trim();
    expect(branches).toBe(''); // branch deleted
  });

  it('refuses to create when branch already exists', async () => {
    const { createSessionWorktree } = await import('$lib/curate/worktree');
    await createSessionWorktree({ sessionId: 'test-wt-3', skipNodeModulesLink: true });
    await expect(createSessionWorktree({ sessionId: 'test-wt-3', skipNodeModulesLink: true })).rejects.toThrow();
  });
});
