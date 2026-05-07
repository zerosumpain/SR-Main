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
