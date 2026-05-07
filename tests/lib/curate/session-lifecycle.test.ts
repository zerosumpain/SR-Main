import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const TEST_BASE = path.join(os.tmpdir(), `curate-life-${Date.now()}`);
process.env.CURATE_SESSIONS_BASE_OVERRIDE = TEST_BASE;

afterEach(() => {
  // Clean up any test-life-* worktrees and branches that may have leaked.
  try {
    const branches = execFileSync('git', ['branch', '--list', 'curate/test-life-*'], { cwd: process.cwd() })
      .toString().trim().split('\n').filter(Boolean).map((s) => s.trim().replace(/^\* /, ''));
    for (const b of branches) {
      const sessionId = b.replace('curate/', '');
      const dir = path.join(TEST_BASE, sessionId);
      try { execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: process.cwd() }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try { fs.rmSync(TEST_BASE, { recursive: true, force: true }); } catch { /* ignore */ }
  // Prune stale worktree entries so branches can be deleted.
  try { execFileSync('git', ['worktree', 'prune'], { cwd: process.cwd() }); } catch { /* ignore */ }
  try {
    const branches = execFileSync('git', ['branch', '--list', 'curate/test-life-*'], { cwd: process.cwd() })
      .toString().trim().split('\n').filter(Boolean).map((s) => s.trim().replace(/^\* /, ''));
    for (const b of branches) {
      try { execFileSync('git', ['branch', '-D', b], { cwd: process.cwd() }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
});

beforeEach(async () => {
  const { db } = await import('$lib/db');
  const { curateSessions } = await import('$lib/db/schema');
  const { like } = await import('drizzle-orm');
  await db.delete(curateSessions).where(like(curateSessions.id, 'test-life-%'));
  vi.resetModules();
});

describe('session-lifecycle', () => {
  it('createCuratedSession provisions session row + worktree + port', async () => {
    // Mock dev-server module so we don't actually spawn vite.
    vi.doMock('$lib/curate/dev-server', () => ({
      spawnDevServer: () => ({
        pid: 99999, port: 5180, cwd: '/tmp', logFile: '/tmp/log',
        child: { kill: () => true, once: () => undefined },
        waitReady: async () => undefined,
        kill: async () => undefined,
      }),
      killDevServerByPid: async () => undefined,
    }));

    const { createCuratedSession } = await import('$lib/curate/session-lifecycle');
    const result = await createCuratedSession({
      sessionId: 'test-life-1',
      targetType: 'apple-calendar',
      skipNodeModulesLink: true,
    });
    expect(result.sessionId).toBe('test-life-1');
    expect(result.port).toBeGreaterThanOrEqual(5180);
    expect(result.worktreePath).toContain('test-life-1');

    const { getSession } = await import('$lib/curate/session-store');
    const session = await getSession('test-life-1');
    expect(session!.targetType).toBe('apple-calendar');
    expect(session!.devServerPort).toBe(result.port);
    expect(session!.devServerPid).toBe(99999);
    expect(session!.worktreePath).toBe(result.worktreePath);
    expect(session!.branchName).toBe('curate/test-life-1');
  });

  it('endCuratedSession releases everything', async () => {
    vi.doMock('$lib/curate/dev-server', () => ({
      spawnDevServer: () => ({
        pid: 88888, port: 5181, cwd: '/tmp', logFile: '/tmp/log',
        child: { kill: () => true, once: () => undefined },
        waitReady: async () => undefined,
        kill: async () => undefined,
      }),
      killDevServerByPid: async () => undefined,
    }));

    const { createCuratedSession, endCuratedSession } = await import('$lib/curate/session-lifecycle');
    await createCuratedSession({
      sessionId: 'test-life-2',
      targetType: 'foo',
      skipNodeModulesLink: true,
    });
    await endCuratedSession('test-life-2');

    const { getSession } = await import('$lib/curate/session-store');
    const session = await getSession('test-life-2');
    expect(session!.status).toBe('ended');
    expect(session!.devServerPort).toBeNull();
    expect(session!.endedAt).toBeTruthy();
  });
});
