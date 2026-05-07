import os from 'node:os';
import { createSession, getSession, updateSession, markEnded } from './session-store';
import { allocatePort, releasePort } from './port-allocator';
import { createSessionWorktree, removeSessionWorktree } from './worktree';
import { spawnDevServer, killDevServerByPid } from './dev-server';

const HOMESERV_HOSTNAMES = ['homeserv'];

function isOnHomeserv(): boolean {
  return HOMESERV_HOSTNAMES.includes(os.hostname());
}

/**
 * Curate requires a full git checkout (worktrees + branches) and a free
 * port range for per-session dev servers. The production VPS is a stripped
 * deploy without `.git` — curate cannot run there. Use the homeserv
 * instance instead: http://homeserv:5173/jkai/curate.
 */
function assertHomeserv(): void {
  if (process.env.CURATE_ALLOW_NON_HOMESERV) return;
  if (!isOnHomeserv()) {
    throw new Error(
      `Curate runs on homeserv only (current host '${os.hostname()}'). ` +
      `It needs a full git checkout for worktrees + branches, which the prod VPS does not have. ` +
      `Visit http://homeserv:5173/jkai/curate from the local network instead. ` +
      `(Override with CURATE_ALLOW_NON_HOMESERV=1 if you really mean to.)`,
    );
  }
}

interface CreateOpts {
  sessionId: string;
  targetType: string;
  goal?: string;
  /** Test-only: skip the (slow) node_modules hard-link step. */
  skipNodeModulesLink?: boolean;
  /** Test-only: skip the actual dev server spawn (mocking covers this). */
  skipDevServer?: boolean;
}

export interface CreatedSession {
  sessionId: string;
  port: number;
  worktreePath: string;
  branchName: string;
  pid: number | null;
}

export async function createCuratedSession(opts: CreateOpts): Promise<CreatedSession> {
  assertHomeserv();

  // 1. Insert the session row first (id reserved).
  await createSession({
    id: opts.sessionId,
    targetType: opts.targetType,
    goal: opts.goal,
  });

  try {
    // 2. Allocate a port — also writes devServerPort onto the row.
    const port = await allocatePort(opts.sessionId);

    // 3. Create the worktree.
    const { dir, branch } = await createSessionWorktree({
      sessionId: opts.sessionId,
      skipNodeModulesLink: opts.skipNodeModulesLink,
    });

    // 4. Spawn dev server.
    const handle = opts.skipDevServer
      ? null
      : spawnDevServer({ cwd: dir, port });
    if (handle) {
      await handle.waitReady().catch(async (err) => {
        // If the server didn't start, kill the partial spawn before bailing.
        await handle.kill().catch(() => undefined);
        throw err;
      });
    }

    // 5. Persist worktree + pid on the session row.
    await updateSession(opts.sessionId, {
      worktreePath: dir,
      branchName: branch,
      devServerPid: handle?.pid ?? null,
    });

    return {
      sessionId: opts.sessionId,
      port,
      worktreePath: dir,
      branchName: branch,
      pid: handle?.pid ?? null,
    };
  } catch (err) {
    // Best-effort cleanup of partial state.
    await endCuratedSession(opts.sessionId).catch(() => undefined);
    throw err;
  }
}

export async function endCuratedSession(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;

  // 1. Kill dev server (best-effort).
  if (session.devServerPid) {
    await killDevServerByPid(session.devServerPid).catch(() => undefined);
  }

  // 2. Remove worktree + branch (best-effort — may already be gone).
  await removeSessionWorktree({ sessionId }).catch(() => undefined);

  // 3. Release port.
  await releasePort(sessionId);

  // 4. Mark session ended.
  await markEnded(sessionId);
}
