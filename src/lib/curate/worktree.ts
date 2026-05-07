import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { CURATE_SESSIONS_BASE, CURATE_TEMPLATE_WORKTREE } from './constants';

const execFileAsync = promisify(execFile);

/** Resolve the project root by walking up from process.cwd() until package.json. */
function projectRoot(): string {
  let dir = process.cwd();
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Could not find project root');
}

/**
 * Ensures a "warm" template worktree exists at CURATE_TEMPLATE_WORKTREE
 * with up-to-date node_modules. New sessions hard-link node_modules from
 * here to avoid 30-120s cold installs.
 *
 * Returns true if a refresh was performed, false if the existing template
 * was already up-to-date.
 */
export async function ensureTemplateWorktree(): Promise<boolean> {
  const repo = projectRoot();
  fs.mkdirSync(CURATE_SESSIONS_BASE, { recursive: true });

  const exists = fs.existsSync(CURATE_TEMPLATE_WORKTREE);
  if (!exists) {
    // First-time creation. Use detached worktree (no branch — we just want
    // a checked-out copy at HEAD).
    await execFileAsync('git', [
      'worktree', 'add', '--detach', CURATE_TEMPLATE_WORKTREE, 'HEAD',
    ], { cwd: repo });
    await execFileAsync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: CURATE_TEMPLATE_WORKTREE,
      timeout: 10 * 60 * 1000, // 10 min
    });
    return true;
  }

  // Existing template — check if package-lock.json on main has moved past
  // the template's. If so, refresh.
  const repoLock = fs.readFileSync(path.join(repo, 'package-lock.json'), 'utf8');
  const tplLockPath = path.join(CURATE_TEMPLATE_WORKTREE, 'package-lock.json');
  let tplLock = '';
  try { tplLock = fs.readFileSync(tplLockPath, 'utf8'); } catch { /* missing */ }
  if (repoLock === tplLock) return false;

  // Reset the template to current HEAD and reinstall.
  await execFileAsync('git', ['reset', '--hard', 'HEAD'], { cwd: CURATE_TEMPLATE_WORKTREE });
  await execFileAsync('git', ['fetch', 'origin', '--quiet'], { cwd: CURATE_TEMPLATE_WORKTREE }).catch(() => undefined);
  await execFileAsync('git', ['checkout', '--quiet', '--detach', 'master'], { cwd: CURATE_TEMPLATE_WORKTREE });
  await execFileAsync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: CURATE_TEMPLATE_WORKTREE,
    timeout: 10 * 60 * 1000,
  });
  return true;
}

// ── Per-session worktree ────────────────────────────────────────────────

import { CURATE_BRANCH_PREFIX } from './constants';

function sessionsBase(): string {
  return process.env.CURATE_SESSIONS_BASE_OVERRIDE || CURATE_SESSIONS_BASE;
}

interface CreateOpts {
  sessionId: string;
  /** Set to true in tests to avoid the (slow) node_modules hard-link step. */
  skipNodeModulesLink?: boolean;
  /** Base ref to branch from. Defaults to 'master' (the default branch). */
  baseRef?: string;
}

export async function createSessionWorktree(opts: CreateOpts): Promise<{ dir: string; branch: string }> {
  const repo = projectRoot();
  const baseRef = opts.baseRef ?? 'master';
  const branch = `${CURATE_BRANCH_PREFIX}${opts.sessionId}`;
  const dir = path.join(sessionsBase(), opts.sessionId);
  fs.mkdirSync(sessionsBase(), { recursive: true });

  // 1. Refuse if branch already exists.
  const existing = await execFileAsync('git', ['branch', '--list', branch], { cwd: repo });
  if (existing.stdout.trim() !== '') {
    throw new Error(`Branch ${branch} already exists`);
  }

  // 2. Create worktree on a new branch off the base ref.
  await execFileAsync('git', ['worktree', 'add', dir, '-b', branch, baseRef], { cwd: repo });

  // 3. Hard-link node_modules from the template (skip in tests).
  if (!opts.skipNodeModulesLink) {
    await ensureTemplateWorktree();
    const tplNm = path.join(CURATE_TEMPLATE_WORKTREE, 'node_modules');
    const dstNm = path.join(dir, 'node_modules');
    if (fs.existsSync(tplNm) && !fs.existsSync(dstNm)) {
      // cp -al on Linux: hard-link recursively.
      await execFileAsync('cp', ['-al', tplNm, dstNm]);
    }
  }

  return { dir, branch };
}

interface RemoveOpts {
  sessionId: string;
  /** Pass true if the branch has unmerged commits and you want to delete anyway. */
  force?: boolean;
}

export async function removeSessionWorktree(opts: RemoveOpts): Promise<void> {
  const repo = projectRoot();
  const branch = `${CURATE_BRANCH_PREFIX}${opts.sessionId}`;
  const dir = path.join(sessionsBase(), opts.sessionId);

  // git worktree remove handles directory cleanup (including --force for
  // dirty trees). We then drop the branch.
  if (fs.existsSync(dir)) {
    await execFileAsync('git', ['worktree', 'remove', '--force', dir], { cwd: repo });
  }
  // Branch may exist even if dir is gone (e.g. partial cleanup).
  await execFileAsync('git', ['branch', '-D', branch], { cwd: repo }).catch(() => undefined);
}
