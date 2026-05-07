import os from 'node:os';
import path from 'node:path';

export const CURATE_PORT_MIN = 5180;
export const CURATE_PORT_MAX = 5199;
export const CURATE_PORT_RANGE = CURATE_PORT_MAX - CURATE_PORT_MIN + 1;

/** All session worktrees live under here. */
export const CURATE_SESSIONS_BASE = path.join(os.homedir(), '.curate-sessions');

/** The "warm" worktree with pre-installed node_modules — refreshed on
 * package.json changes. New sessions hard-link node_modules from here. */
export const CURATE_TEMPLATE_WORKTREE = path.join(CURATE_SESSIONS_BASE, '.template');

/** Sessions in non-terminal status older than this get reaped. */
export const STALE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Branch prefix for curate sessions. */
export const CURATE_BRANCH_PREFIX = 'curate/';
