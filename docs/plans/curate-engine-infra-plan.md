# Curate Engine Infra (Plan B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the curate session lifecycle infrastructure — `curateSessions` Drizzle table + worktree manager + port allocator + per-session dev server lifecycle + stale-session reaper. After this plan, you can programmatically create a session, get a real worktree on a branch + a running SvelteKit dev server on a curate-allocated port, and tear it all down on demand. No discovery / codegen / orchestration yet — those are Plan B2 / B3.

**Architecture:** Eight focused modules under `src/lib/curate/`. The flow: a caller invokes `createCuratedSession({ targetType })` → session-lifecycle allocates a port → worktree manager creates `~/.curate-sessions/<sessionId>/` from `main` HEAD with hard-linked `node_modules` from a maintained template → dev-server module spawns `vite dev --port <port>` in that dir → session-store persists everything in `curateSessions`. `endCuratedSession(id)` reverses it. A reaper runs daily to prune abandoned sessions older than 14 days.

**Tech Stack:** SvelteKit 2 + Svelte 5, TypeScript, Drizzle ORM (Postgres 16), `node:child_process` for dev-server spawn, `node:fs` + `node:path` for worktree dirs, `git worktree` CLI invoked via `child_process`, vitest.

**Reference spec:** `docs/plans/curate-experience.md` §3 (lifecycle), §4.4 (curateSessions schema), §4.6 (worktree management).

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/lib/curate/session-store.ts` | Drizzle CRUD over `curateSessions`. `createSession`, `getSession`, `listActiveSessions`, `updateSession`, `markEnded`. |
| `src/lib/curate/port-allocator.ts` | In-memory + DB-backed allocator over the curate port pool (5180–5199). `allocatePort()`, `releasePort(port)`, `usedPorts()`. |
| `src/lib/curate/worktree.ts` | `createWorktree(sessionId, baseRef)` (creates `.curate-sessions/<sessionId>/` + branch + hard-links template's `node_modules`). `removeWorktree(sessionId)`. `templateWorktree.ensureFresh()`. |
| `src/lib/curate/dev-server.ts` | `spawnDevServer(cwd, port)` returns `{ pid, kill, healthCheck }`. `killDevServer(pid)`. Health check via `curl http://localhost:<port>/__data.json` or similar lightweight probe. |
| `src/lib/curate/session-lifecycle.ts` | High-level: `createCuratedSession({ targetType })` and `endCuratedSession(id)` orchestrate the above modules. The single public entry point for callers. |
| `src/lib/curate/reaper.ts` | `reapStaleSessions({ olderThanMs })` — finds sessions in non-terminal status older than the cutoff and runs `endCuratedSession` on each. Plus `startReaperCron()` to run daily. |
| `src/lib/curate/index.ts` | Barrel export. |
| `src/lib/curate/constants.ts` | `CURATE_PORT_MIN = 5180`, `CURATE_PORT_MAX = 5199`, `CURATE_SESSIONS_BASE = '~/.curate-sessions'` (resolved via `os.homedir()`), `STALE_TTL_MS = 14 * 24 * 60 * 60 * 1000`. |
| `tests/lib/curate/session-store.test.ts` | CRUD against the dev DB, test rows prefixed `'test-curate-'`. |
| `tests/lib/curate/port-allocator.test.ts` | Allocate/release/exhaust against a small fake pool. |
| `tests/lib/curate/worktree.test.ts` | Create + remove against a temp branch on the dev repo. Skips on machines that don't have git in `PATH` (always true here). |
| `tests/lib/curate/session-lifecycle.test.ts` | Mock `dev-server` module → exercise full create/end flow without spinning a real Vite server. |

### Files to modify

| File | Change |
|---|---|
| `src/lib/db/schema.ts` | Add `curateSessions` table. |
| `src/hooks.server.ts` | Add a one-line call to `startReaperCron()` so the daily prune runs in the SvelteKit server process. |

---

## Pre-flight

No env-var changes required. The integrations key from Plan A is already on prod.

- [ ] **Step 0: Branch setup**

The implementing agent should be operating from a git worktree on a `feature/curate-engine-infra` branch off `master`. The controller sets this up with `using-git-worktrees` skill before dispatching.

---

## Phase 1 — Database schema

### Task 1: Add `curateSessions` table

**Files:**
- Modify: `src/lib/db/schema.ts` (append after `integrationOauthConfigs`)

- [ ] **Step 1: Add the table definition**

Append to `src/lib/db/schema.ts`:

```ts
// ── Curate sessions ─────────────────────────────────────────────────────

export const curateSessions = pgTable('curate_sessions', {
  id: text('id').primaryKey(), // uuid (caller-provided via crypto.randomUUID())
  // The proposed node `type` for this session. Becomes the branch suffix
  // and the eventual node identifier. May be 'pending' until discovery picks one.
  targetType: text('target_type').notNull(),
  status: text('status').notNull(),
  // ^ 'scoping' | 'discovering' | 'awaiting-approval' | 'generating'
  //   | 'live-testing' | 'awaiting-promotion' | 'promoting' | 'promoted'
  //   | 'aborted' | 'error' | 'ended'
  goal: text('goal'), // one-line outcome from scope phase
  proposal: jsonb('proposal').$type<Record<string, unknown>>(),
  nodeSpec: jsonb('node_spec').$type<Record<string, unknown>>(),
  worktreePath: text('worktree_path'),
  branchName: text('branch_name'),
  devServerPort: integer('dev_server_port'),
  devServerPid: integer('dev_server_pid'),
  iterationLog: jsonb('iteration_log').$type<unknown[]>().notNull().default([]),
  errorTrace: text('error_trace'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  promotedAt: timestamp('promoted_at'),
}, (t) => ({
  byStatus: index('curate_sessions_status_idx').on(t.status),
  byPort: uniqueIndex('curate_sessions_port_uniq').on(t.devServerPort),
}));

export type CurateSessionRow = typeof curateSessions.$inferSelect;
```

The `byPort` unique index is critical: it enforces "one session per port" at the DB level so the port allocator can't double-assign even under race conditions.

- [ ] **Step 2: Push schema**

```bash
npx drizzle-kit push
```

Expected: prompts for the new table; accept; sees `[✓] Changes applied`.

- [ ] **Step 3: Verify**

```bash
psql "$DATABASE_URL" -c '\d curate_sessions'
```

Expected: returns 16 columns including `dev_server_port` (integer, unique index), `iteration_log` (jsonb).

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(db): add curateSessions table"
```

---

## Phase 2 — Constants and port allocator

### Task 2: Constants module

**Files:**
- Create: `src/lib/curate/constants.ts`

- [ ] **Step 1: Implement**

```ts
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
```

- [ ] **Step 2: Verify**

```bash
npm run check 2>&1 | grep "src/lib/curate/constants" || echo "(no errors)"
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/curate/constants.ts
git commit -m "feat(curate): constants module"
```

### Task 3: Port allocator + tests

**Files:**
- Create: `src/lib/curate/port-allocator.ts`
- Test: `tests/lib/curate/port-allocator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/curate/port-allocator.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(async () => {
  const { db } = await import('$lib/db');
  const { curateSessions } = await import('$lib/db/schema');
  const { like } = await import('drizzle-orm');
  await db.delete(curateSessions).where(like(curateSessions.id, 'test-port-%'));
});

describe('port-allocator', () => {
  it('allocates the lowest free port in range', async () => {
    const { allocatePort } = await import('$lib/curate/port-allocator');
    const p = await allocatePort('test-port-1');
    expect(p).toBeGreaterThanOrEqual(5180);
    expect(p).toBeLessThanOrEqual(5199);
  });

  it('does not double-assign ports across sessions', async () => {
    const { allocatePort } = await import('$lib/curate/port-allocator');
    const a = await allocatePort('test-port-2a');
    const b = await allocatePort('test-port-2b');
    expect(a).not.toBe(b);
  });

  it('exhausts the pool with a clear error', async () => {
    const { allocatePort } = await import('$lib/curate/port-allocator');
    const ids: string[] = [];
    try {
      for (let i = 0; i < 25; i++) {
        const id = `test-port-3-${i}`;
        ids.push(id);
        await allocatePort(id);
      }
      // Should not reach here.
      expect.unreachable('Pool should have been exhausted');
    } catch (err) {
      expect((err as Error).message).toMatch(/no free curate ports/i);
    }
  });

  it('frees a port when releasePort is called', async () => {
    const { allocatePort, releasePort } = await import('$lib/curate/port-allocator');
    const p = await allocatePort('test-port-4');
    await releasePort('test-port-4');
    // Should be reusable now (might be assigned to next session).
    const p2 = await allocatePort('test-port-4-again');
    expect(p2).toBe(p);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- tests/lib/curate/port-allocator.test.ts
```

Expected: module-not-found errors.

- [ ] **Step 3: Implement**

Create `src/lib/curate/port-allocator.ts`:

```ts
import { db } from '$lib/db';
import { curateSessions } from '$lib/db/schema';
import { eq, isNotNull } from 'drizzle-orm';
import { CURATE_PORT_MIN, CURATE_PORT_MAX } from './constants';

/**
 * Allocates a free curate port to the given session id.
 *
 * Strategy: pick the lowest port in [MIN, MAX] not currently held by any
 * session row. The DB unique index on dev_server_port prevents a race
 * where two callers grab the same port between read and write.
 */
export async function allocatePort(sessionId: string): Promise<number> {
  const used = await db
    .select({ port: curateSessions.devServerPort })
    .from(curateSessions)
    .where(isNotNull(curateSessions.devServerPort));
  const inUse = new Set(used.map((r) => r.port).filter((p): p is number => p !== null));
  for (let port = CURATE_PORT_MIN; port <= CURATE_PORT_MAX; port++) {
    if (inUse.has(port)) continue;
    try {
      // Caller is expected to have a curateSessions row for this id.
      // For unit tests where no row exists yet, insert a minimal one.
      const existing = await db
        .select({ id: curateSessions.id })
        .from(curateSessions)
        .where(eq(curateSessions.id, sessionId))
        .limit(1);
      if (existing.length === 0) {
        const now = new Date();
        await db.insert(curateSessions).values({
          id: sessionId,
          targetType: 'pending',
          status: 'scoping',
          devServerPort: port,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await db
          .update(curateSessions)
          .set({ devServerPort: port, updatedAt: new Date() })
          .where(eq(curateSessions.id, sessionId));
      }
      return port;
    } catch (err) {
      // Unique-index violation: race lost; try next port.
      if (String(err).includes('curate_sessions_port_uniq')) continue;
      throw err;
    }
  }
  throw new Error(`No free curate ports in range ${CURATE_PORT_MIN}-${CURATE_PORT_MAX}`);
}

export async function releasePort(sessionId: string): Promise<void> {
  await db
    .update(curateSessions)
    .set({ devServerPort: null, updatedAt: new Date() })
    .where(eq(curateSessions.id, sessionId));
}

export async function usedPorts(): Promise<number[]> {
  const rows = await db
    .select({ port: curateSessions.devServerPort })
    .from(curateSessions)
    .where(isNotNull(curateSessions.devServerPort));
  return rows.map((r) => r.port).filter((p): p is number => p !== null);
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- tests/lib/curate/port-allocator.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/curate/port-allocator.ts tests/lib/curate/port-allocator.test.ts
git commit -m "feat(curate): port allocator over 5180-5199 pool"
```

---

## Phase 3 — Session store

### Task 4: Session store + tests

**Files:**
- Create: `src/lib/curate/session-store.ts`
- Test: `tests/lib/curate/session-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(async () => {
  const { db } = await import('$lib/db');
  const { curateSessions } = await import('$lib/db/schema');
  const { like } = await import('drizzle-orm');
  await db.delete(curateSessions).where(like(curateSessions.id, 'test-store-%'));
});

describe('session-store', () => {
  it('creates and retrieves a session', async () => {
    const { createSession, getSession } = await import('$lib/curate/session-store');
    const id = 'test-store-1';
    await createSession({ id, targetType: 'apple-calendar' });
    const got = await getSession(id);
    expect(got).not.toBeNull();
    expect(got!.targetType).toBe('apple-calendar');
    expect(got!.status).toBe('scoping');
  });

  it('listActiveSessions excludes terminal-status rows', async () => {
    const { createSession, updateSession, listActiveSessions } = await import('$lib/curate/session-store');
    await createSession({ id: 'test-store-2a', targetType: 'a' });
    await createSession({ id: 'test-store-2b', targetType: 'b' });
    await updateSession('test-store-2b', { status: 'promoted', promotedAt: new Date() });
    const active = await listActiveSessions();
    const ids = active.map((s) => s.id);
    expect(ids).toContain('test-store-2a');
    expect(ids).not.toContain('test-store-2b');
  });

  it('updateSession patches fields', async () => {
    const { createSession, updateSession, getSession } = await import('$lib/curate/session-store');
    await createSession({ id: 'test-store-3', targetType: 'x' });
    await updateSession('test-store-3', {
      status: 'discovering',
      goal: 'Connect to Apple Calendar',
    });
    const got = await getSession('test-store-3');
    expect(got!.status).toBe('discovering');
    expect(got!.goal).toBe('Connect to Apple Calendar');
  });

  it('markEnded sets status=ended + endedAt', async () => {
    const { createSession, markEnded, getSession } = await import('$lib/curate/session-store');
    await createSession({ id: 'test-store-4', targetType: 'x' });
    await markEnded('test-store-4');
    const got = await getSession('test-store-4');
    expect(got!.status).toBe('ended');
    expect(got!.endedAt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- tests/lib/curate/session-store.test.ts
```

- [ ] **Step 3: Implement**

```ts
import { db } from '$lib/db';
import { curateSessions } from '$lib/db/schema';
import { eq, notInArray } from 'drizzle-orm';
import type { CurateSessionRow } from '$lib/db/schema';

const TERMINAL_STATUSES = ['promoted', 'aborted', 'ended'] as const;

interface CreateInput {
  id: string;
  targetType: string;
  goal?: string;
}

export async function createSession(input: CreateInput): Promise<void> {
  const now = new Date();
  await db
    .insert(curateSessions)
    .values({
      id: input.id,
      targetType: input.targetType,
      status: 'scoping',
      goal: input.goal ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: curateSessions.id });
}

export async function getSession(id: string): Promise<CurateSessionRow | null> {
  const rows = await db
    .select()
    .from(curateSessions)
    .where(eq(curateSessions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listActiveSessions(): Promise<CurateSessionRow[]> {
  return db
    .select()
    .from(curateSessions)
    .where(notInArray(curateSessions.status, TERMINAL_STATUSES as unknown as string[]));
}

interface UpdateInput {
  status?: string;
  targetType?: string;
  goal?: string;
  proposal?: Record<string, unknown>;
  nodeSpec?: Record<string, unknown>;
  worktreePath?: string | null;
  branchName?: string | null;
  devServerPort?: number | null;
  devServerPid?: number | null;
  iterationLog?: unknown[];
  errorTrace?: string | null;
  endedAt?: Date | null;
  promotedAt?: Date | null;
}

export async function updateSession(id: string, patch: UpdateInput): Promise<void> {
  await db
    .update(curateSessions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(curateSessions.id, id));
}

export async function markEnded(id: string): Promise<void> {
  await updateSession(id, { status: 'ended', endedAt: new Date() });
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- tests/lib/curate/session-store.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/curate/session-store.ts tests/lib/curate/session-store.test.ts
git commit -m "feat(curate): session store CRUD"
```

---

## Phase 4 — Worktree manager

### Task 5: Template worktree maintenance

**Files:**
- Create: `src/lib/curate/worktree.ts` (template-worktree portion only in this task; full worktree creation in Task 6)

- [ ] **Step 1: Implement template-worktree maintenance**

```ts
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
```

- [ ] **Step 2: Verify**

```bash
npm run check 2>&1 | grep "src/lib/curate/worktree" || echo "(no errors)"
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/curate/worktree.ts
git commit -m "feat(curate): template worktree maintenance"
```

### Task 6: Per-session worktree create + remove + tests

**Files:**
- Modify: `src/lib/curate/worktree.ts` (append)
- Test: `tests/lib/curate/worktree.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- tests/lib/curate/worktree.test.ts
```

- [ ] **Step 3: Append to `src/lib/curate/worktree.ts`**

```ts
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
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- tests/lib/curate/worktree.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/curate/worktree.ts tests/lib/curate/worktree.test.ts
git commit -m "feat(curate): per-session worktree create + remove"
```

---

## Phase 5 — Dev server lifecycle

### Task 7: Dev server spawn / kill / health

**Files:**
- Create: `src/lib/curate/dev-server.ts`

- [ ] **Step 1: Implement**

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface SpawnOpts {
  cwd: string;
  port: number;
  /** Optional: per-session log file. Defaults to <cwd>/.curate-devserver.log */
  logFile?: string;
}

export interface DevServerHandle {
  pid: number;
  port: number;
  cwd: string;
  logFile: string;
  child: ChildProcess;
  /** Wait for the dev server to start serving (polls /). Throws on timeout. */
  waitReady: (timeoutMs?: number) => Promise<void>;
  /** Send SIGTERM, then SIGKILL after a grace period. */
  kill: () => Promise<void>;
}

export function spawnDevServer(opts: SpawnOpts): DevServerHandle {
  const logFile = opts.logFile ?? path.join(opts.cwd, '.curate-devserver.log');
  const fd = fs.openSync(logFile, 'a');
  const child = spawn('npm', ['run', 'dev', '--', '--port', String(opts.port)], {
    cwd: opts.cwd,
    stdio: ['ignore', fd, fd],
    detached: false,
    env: { ...process.env, NODE_ENV: 'development' },
  });
  if (!child.pid) {
    fs.closeSync(fd);
    throw new Error('Failed to spawn dev server (no PID)');
  }

  return {
    pid: child.pid,
    port: opts.port,
    cwd: opts.cwd,
    logFile,
    child,
    async waitReady(timeoutMs = 60_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`http://localhost:${opts.port}/`, { redirect: 'manual' });
          // 200 or any 3xx redirect both indicate server is alive.
          if (res.status >= 200 && res.status < 500) return;
        } catch { /* not ready */ }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`Dev server on port ${opts.port} did not become ready within ${timeoutMs}ms`);
    },
    async kill(): Promise<void> {
      child.kill('SIGTERM');
      const exited = await new Promise<boolean>((resolve) => {
        let done = false;
        child.once('exit', () => { done = true; resolve(true); });
        setTimeout(() => { if (!done) resolve(false); }, 5_000);
      });
      if (!exited) child.kill('SIGKILL');
    },
  };
}

/** Best-effort kill by PID (e.g. recovering after a server-process crash). */
export async function killDevServerByPid(pid: number): Promise<void> {
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  await new Promise((r) => setTimeout(r, 5_000));
  try { process.kill(pid, 0); /* still alive */ process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
```

- [ ] **Step 2: Verify TS**

```bash
npm run check 2>&1 | grep "src/lib/curate/dev-server" || echo "(no errors)"
```

No tests for this module — exercising it fully requires a real dev server which is too slow for unit tests. It gets exercised end-to-end in the lifecycle smoke test.

- [ ] **Step 3: Commit**

```bash
git add src/lib/curate/dev-server.ts
git commit -m "feat(curate): dev server spawn/kill/health"
```

---

## Phase 6 — Session lifecycle (the public entry point)

### Task 8: `createCuratedSession` and `endCuratedSession` + tests

**Files:**
- Create: `src/lib/curate/session-lifecycle.ts`
- Test: `tests/lib/curate/session-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

const TEST_BASE = path.join(os.tmpdir(), `curate-life-${Date.now()}`);
process.env.CURATE_SESSIONS_BASE_OVERRIDE = TEST_BASE;

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
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- tests/lib/curate/session-lifecycle.test.ts
```

- [ ] **Step 3: Implement**

```ts
import { createSession, getSession, updateSession, markEnded } from './session-store';
import { allocatePort, releasePort } from './port-allocator';
import { createSessionWorktree, removeSessionWorktree } from './worktree';
import { spawnDevServer, killDevServerByPid } from './dev-server';

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
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- tests/lib/curate/session-lifecycle.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/curate/session-lifecycle.ts tests/lib/curate/session-lifecycle.test.ts
git commit -m "feat(curate): session lifecycle (create/end)"
```

---

## Phase 7 — Reaper

### Task 9: Stale-session reaper + cron startup

**Files:**
- Create: `src/lib/curate/reaper.ts`
- Modify: `src/hooks.server.ts` (add startReaperCron call)

- [ ] **Step 1: Implement reaper**

Create `src/lib/curate/reaper.ts`:

```ts
import { db } from '$lib/db';
import { curateSessions } from '$lib/db/schema';
import { and, lt, notInArray } from 'drizzle-orm';
import { endCuratedSession } from './session-lifecycle';
import { STALE_TTL_MS } from './constants';

const TERMINAL_STATUSES = ['promoted', 'aborted', 'ended'];

/**
 * Runs once. Finds sessions in non-terminal status whose createdAt is older
 * than `olderThanMs` (default 14 days) and ends them.
 *
 * Returns the count of sessions reaped.
 */
export async function reapStaleSessions({
  olderThanMs = STALE_TTL_MS,
}: { olderThanMs?: number } = {}): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await db
    .select({ id: curateSessions.id })
    .from(curateSessions)
    .where(
      and(
        lt(curateSessions.createdAt, cutoff),
        notInArray(curateSessions.status, TERMINAL_STATUSES),
      ),
    );

  let reaped = 0;
  for (const row of stale) {
    try {
      await endCuratedSession(row.id);
      reaped++;
    } catch (err) {
      // Don't let one bad session block the whole reap.
      console.error(`[curate-reaper] failed to end ${row.id}:`, err);
    }
  }
  return reaped;
}

let cronStarted = false;

/** Start the daily reaper. Idempotent — second call is a no-op. */
export function startReaperCron(): void {
  if (cronStarted) return;
  cronStarted = true;
  const HOURS = 24 * 60 * 60 * 1000;
  // Run immediately on boot, then every 24h.
  reapStaleSessions().catch((err) => console.error('[curate-reaper] initial run failed:', err));
  setInterval(() => {
    reapStaleSessions().catch((err) => console.error('[curate-reaper] periodic run failed:', err));
  }, HOURS);
}
```

- [ ] **Step 2: Wire into `src/hooks.server.ts`**

Read the file first to find a good insertion point — the existing pattern is to place service-startup calls near other `[*-bridge]`/`[scheduler]` registrations. Insert this block:

```ts
import { startReaperCron } from '$lib/curate/reaper';

// Start the curate session reaper (daily prune of stale sessions).
startReaperCron();
```

- [ ] **Step 3: Verify**

```bash
npm run check 2>&1 | grep -E "src/lib/curate/reaper|src/hooks.server" || echo "(no errors)"
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/curate/reaper.ts src/hooks.server.ts
git commit -m "feat(curate): stale-session reaper + daily cron"
```

---

## Phase 8 — Index barrel + smoke test

### Task 10: Index barrel

**Files:**
- Create: `src/lib/curate/index.ts`

- [ ] **Step 1: Write the barrel**

```ts
export * from './constants';
export * from './session-store';
export * from './port-allocator';
export * from './worktree';
export * from './dev-server';
export * from './session-lifecycle';
export * from './reaper';
```

- [ ] **Step 2: Verify**

```bash
npm run check 2>&1 | grep "src/lib/curate/index" || echo "(no errors)"
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/curate/index.ts
git commit -m "feat(curate): index barrel"
```

### Task 11: Manual smoke test

This step exercises the real dev-server spawn. It's slow (~1 minute) so it lives outside the automated suite.

- [ ] **Step 1: Write the smoke script**

Create `scripts/curate-smoke.ts` (commit-tracked):

```ts
/**
 * Manual smoke test for Plan B1: provision a session, verify the dev server
 * comes up on its allocated port, then tear it all down.
 *
 * Run with: npx tsx scripts/curate-smoke.ts
 */
import { createCuratedSession, endCuratedSession } from '../src/lib/curate/session-lifecycle';

async function main() {
  const sessionId = `smoke-${Date.now()}`;
  console.log(`[smoke] creating session ${sessionId}…`);
  const created = await createCuratedSession({
    sessionId,
    targetType: 'smoke-test',
  });
  console.log(`[smoke] session up:`, created);

  console.log(`[smoke] curl http://localhost:${created.port}/ …`);
  const res = await fetch(`http://localhost:${created.port}/`);
  console.log(`[smoke] HTTP ${res.status}`);
  if (res.status >= 500) {
    console.error('[smoke] dev server returned 5xx — abort');
    process.exit(1);
  }

  console.log(`[smoke] ending session…`);
  await endCuratedSession(sessionId);
  console.log(`[smoke] done.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run the smoke**

```bash
npx tsx scripts/curate-smoke.ts
```

Expected: session creates, curl returns 200/3xx, session ends cleanly. ~1-2 minutes including the worktree node_modules hard-link.

If it fails, stop and report — don't push through.

- [ ] **Step 3: Verify cleanup**

```bash
git worktree list
psql "$DATABASE_URL" -c 'SELECT id, status, dev_server_port FROM curate_sessions WHERE id LIKE \'smoke-%\';'
```

The smoke session row should show `status='ended'`, `dev_server_port=NULL`. No worktree at `~/.curate-sessions/smoke-*/`.

- [ ] **Step 4: Commit**

```bash
git add scripts/curate-smoke.ts
git commit -m "test(curate): manual smoke script for B1 lifecycle"
```

---

## Phase 9 — Final verification

### Task 12: Full sweep

- [ ] **Step 1: Run all curate tests**

```bash
npm test -- tests/lib/curate/
```

Expected: all tests across 4 files pass (port-allocator, session-store, worktree, session-lifecycle).

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "src/lib/curate|tests/lib/curate" | head -20
```

Expected: zero errors in curate paths.

- [ ] **Step 3: Confirm no regression on the broader suite**

```bash
npm test 2>&1 | tail -5
```

Compare to pre-B1 baseline (12 pre-existing failures / 6 files from Plan A's baseline). The count must not have grown.

- [ ] **Step 4: No-op commit (if any small fix-ups happened)**

If everything's clean, no commit needed. Otherwise commit a `chore(curate): post-smoke cleanup` with the diff.

---

## Self-Review Checklist

- [ ] All 12 tasks committed individually
- [ ] `npm test -- tests/lib/curate/` clean
- [ ] `npx tsc --noEmit --skipLibCheck` clean for curate paths
- [ ] `scripts/curate-smoke.ts` ran end-to-end successfully
- [ ] Pre-existing test baseline unchanged
- [ ] No `console.log` in committed code (allow `console.error` in the reaper)
- [ ] Hooks.server.ts now calls `startReaperCron()`
- [ ] Branch is `feature/curate-engine-infra` (or whatever the controller chose)

---

## Out of scope for B1 — handled in B2/B3/B4

- Canonical node spec types
- `uiSchema` declarative type + Svelte panel codegen
- Definition / executor / sr-docs file emitters
- Discovery toolkit
- Phase state machine
- Generate / Live-test / Promote pipelines
- `/jkai/curate` UI routes
- Apple Calendar end-to-end run

---

## Notes for the executing agent

- **Where you run:** dev box (homeserv). The `git worktree add` and `npm install` commands are local. The reaper cron runs in the SvelteKit server process.
- **Tests pollute the dev DB:** all tests clean up by `like 'test-*-%'` prefix. Fine for solo dev. If a test fails mid-run leaving rows, the next `beforeEach` cleans them.
- **`process.env.CURATE_SESSIONS_BASE_OVERRIDE`** is the test-only escape hatch. Production never sets it.
- **`cp -al` is Linux-only.** This codebase runs on Linux (homeserv + Hetzner VPS). Don't bother with cross-platform fallbacks.
- **The reaper's daily cron is in-process** — same model as the existing `[scheduler]` registrations in `hooks.server.ts`. Survives across requests but resets on service restart (which is fine — the next boot's first run catches anything missed).
- **Smoke test is a real dev server.** It will appear in `lsof -i :518x` while running. The script ends it cleanly.
