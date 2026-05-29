# jkai-node-builder — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demolish the `/jkai/curate` experience, rescue the codegen library to `src/lib/node-builder/`, drop the `curate_sessions` table, and end with a green build that has no references to curate left.

**Architecture:** Phase 1 of the broader jkai-node-builder migration (see spec at `docs/superpowers/specs/2026-05-29-jkai-node-builder-design.md` § Phased delivery). This phase ships nothing user-visible — it clears the runway. Subsequent phases add MCP tools (Phase 2), the Hermes skill (Phase 3), and yield wiring into canvas + general (Phase 4).

**Tech Stack:** SvelteKit, TypeScript, Drizzle ORM (PostgreSQL 16), Vitest. All work happens in `~/strange_rambling_svelte/` on `master`.

---

## File map

**Created:**
- `src/lib/node-builder/codegen/` (8 files — moved from `src/lib/curate/codegen/`)
- `src/lib/node-builder/spec/` (2 files — moved from `src/lib/curate/spec/`)
- `tests/lib/node-builder/codegen/` (8 files — moved from `tests/lib/curate/codegen/`)
- `tests/__fixtures__/node-builder-codegen/` (moved from `tests/__fixtures__/curate-codegen/`)
- One new Drizzle migration: `drizzle/<NNNN>_drop_curate_sessions.sql`

**Deleted (whole directories):**
- `src/routes/jkai/curate/`
- `src/routes/api/curate/`
- `src/routes/curate-preview/`
- `src/lib/curate/` (after moves complete)
- `tests/lib/curate/` (after codegen tests moved)
- `tests/__fixtures__/curate-codegen/` (after move)

**Modified:**
- `src/lib/node-builder/codegen/write-files.ts` (drop `worktreeDir` param)
- `tests/lib/node-builder/codegen/write-files.test.ts` (match new signature)
- `tests/__fixtures__/node-builder-codegen/apple-calendar.spec.ts` (fixture import paths)
- `src/hooks.server.ts` (remove `startReaperCron` import + call)
- `src/lib/components/PageHeader.svelte` (remove `/jkai/curate` nav entry)
- `src/lib/db/schema.ts` (remove `curateSessions` table; remove `'curate'` from `hermesSessions.kind` enum)

---

## Pre-flight

### Task 0: Confirm clean working tree on master

- [ ] **Step 1: Verify branch + working tree**

Run:
```bash
cd ~/strange_rambling_svelte
git status
git log --oneline -1
```

Expected: `On branch master`, `nothing to commit, working tree clean`, HEAD at `d8e9d95` (the spec commit) or later. If the working tree is dirty, stop and resolve before proceeding.

- [ ] **Step 2: Snapshot current test baseline**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run --reporter=dot 2>&1 | tail -5
```

Expected: tests pass (any pre-existing failures should be noted now so they don't get blamed on Phase 1). Record the pass count.

---

## Move the codegen library and its spec types

### Task 1: Move `src/lib/curate/codegen/` → `src/lib/node-builder/codegen/`

**Files:**
- Move: `src/lib/curate/codegen/{definition,docs,executor,index-patch,index,panel,registry-patch,write-files}.ts`
- Create: `src/lib/node-builder/codegen/` (target directory)

- [ ] **Step 1: Create target directory and move files via git**

Run:
```bash
cd ~/strange_rambling_svelte
mkdir -p src/lib/node-builder
git mv src/lib/curate/codegen src/lib/node-builder/codegen
```

Expected: 8 files renamed. `git status` shows 8 `R` (renamed) entries under `src/lib/node-builder/codegen/`.

- [ ] **Step 2: Verify imports inside the moved files still resolve**

The codegen files import from `../spec/types` and `../spec/validate`. After the move those imports still resolve because `spec/` will be moved next to it (Task 2). For now, run a typecheck — it will likely error until Task 2 lands:

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "(node-builder|curate)" | head -20
```

Expected: errors mentioning `../spec/types` not resolving from inside `src/lib/node-builder/codegen/`. That's fine — Task 2 fixes it. **Do not commit yet.**

### Task 2: Move `src/lib/curate/spec/` → `src/lib/node-builder/spec/`

**Files:**
- Move: `src/lib/curate/spec/{types,validate}.ts`

- [ ] **Step 1: Move spec directory via git**

Run:
```bash
cd ~/strange_rambling_svelte
git mv src/lib/curate/spec src/lib/node-builder/spec
```

Expected: 2 files renamed. `git status` shows both `spec/types.ts` and `spec/validate.ts` under the new location.

- [ ] **Step 2: Typecheck**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "(node-builder|curate)" | head -20
```

Expected: no errors from inside `node-builder/`. There WILL be errors from external callers of `$lib/curate/codegen` or `$lib/curate/spec` if any exist — the explore agent reported none, but verify. If errors appear from outside `src/lib/node-builder/`, list them and stop.

### Task 3: Move codegen tests and fixtures

**Files:**
- Move: `tests/lib/curate/codegen/{definition,docs,executor,index-patch,panel,registry-patch,validate,write-files}.test.ts`
- Move: `tests/__fixtures__/curate-codegen/`

- [ ] **Step 1: Move test directories**

Run:
```bash
cd ~/strange_rambling_svelte
mkdir -p tests/lib/node-builder
git mv tests/lib/curate/codegen tests/lib/node-builder/codegen
git mv tests/__fixtures__/curate-codegen tests/__fixtures__/node-builder-codegen
```

Expected: 8 test files renamed under `tests/lib/node-builder/codegen/`; fixture directory renamed.

- [ ] **Step 2: Fix fixture import path in moved tests**

The codegen tests likely reference the fixture path as a string literal like `tests/__fixtures__/curate-codegen/...`. Update those references with a single grep-and-edit. Run:

```bash
grep -rln "curate-codegen" tests/lib/node-builder/ tests/__fixtures__/node-builder-codegen/ 2>&1
```

For each file in the output, run an Edit replacing `curate-codegen` with `node-builder-codegen`.

- [ ] **Step 3: Fix import paths inside test files**

The tests import from `../../../src/lib/curate/codegen/*` (relative) or `$lib/curate/codegen/*` (alias). Update both forms. Run:

```bash
grep -rln "curate/codegen\|curate/spec" tests/lib/node-builder/codegen/ 2>&1
```

For each file, replace:
- `curate/codegen` → `node-builder/codegen`
- `curate/spec` → `node-builder/spec`

- [ ] **Step 4: Run the moved codegen tests**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/node-builder/ --reporter=dot 2>&1 | tail -10
```

Expected: all 8 codegen test files pass (the count should match what `tests/lib/curate/codegen/` previously passed).

- [ ] **Step 5: Commit the move**

Run:
```bash
git add -A src/lib/node-builder src/lib/curate tests/lib/node-builder tests/lib/curate tests/__fixtures__
git commit -m "refactor: move curate codegen + spec library to src/lib/node-builder/"
```

Expected: one commit. `git status` clean.

---

## Refactor `writeNodeFiles` to drop the `worktreeDir` param

### Task 4: Add failing test for new signature

**Files:**
- Test: `tests/lib/node-builder/codegen/write-files.test.ts`

The current signature is `writeNodeFiles(spec, worktreeDir, srDocsDir)`. The new signature is `writeNodeFiles(spec, srDocsDir)` — `worktreeDir` is replaced by `process.cwd()`.

- [ ] **Step 1: Read the current write-files test to see how `worktreeDir` is set up**

Run:
```bash
head -40 tests/lib/node-builder/codegen/write-files.test.ts
```

Identify the setup pattern (likely a tmp dir, files seeded via `fs.mkdirSync` + `fs.writeFileSync`, then passed as `worktreeDir`).

- [ ] **Step 2: Add a new test for the cwd-based signature**

Add this test inside the existing `describe` block in `tests/lib/node-builder/codegen/write-files.test.ts` (keep existing tests for now — they will be updated in Step 4):

```typescript
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

it('writes node files relative to process.cwd() when no worktreeDir is passed', async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'nb-cwd-'));
  const srDocsDir = mkdtempSync(path.join(tmpdir(), 'nb-srdocs-'));

  // Seed registry.ts and index.ts so the patch emitters have something to read.
  mkdirSync(path.join(repoRoot, 'src/lib/canvas/nodes/panels'), { recursive: true });
  writeFileSync(
    path.join(repoRoot, 'src/lib/canvas/nodes/panels/registry.ts'),
    readFileSync('tests/__fixtures__/node-builder-codegen/registry-base.ts.txt', 'utf8'),
    'utf8',
  );
  mkdirSync(path.join(repoRoot, 'src/lib/workflows'), { recursive: true });
  writeFileSync(
    path.join(repoRoot, 'src/lib/workflows/index.ts'),
    readFileSync('tests/__fixtures__/node-builder-codegen/index-base.ts.txt', 'utf8'),
    'utf8',
  );

  const originalCwd = process.cwd();
  process.chdir(repoRoot);
  try {
    const { written } = await writeNodeFiles(appleCalendarSpec, srDocsDir);
    expect(written).toContain('src/lib/workflows/nodes/apple-calendar.ts');
    expect(written).toContain('src/lib/workflows/nodes/apple-calendar.def.ts');
  } finally {
    process.chdir(originalCwd);
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(srDocsDir, { recursive: true, force: true });
  }
});
```

(Adjust the import of `appleCalendarSpec` to match how the existing test file imports the fixture spec.)

- [ ] **Step 3: Run the new test to verify it fails**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/node-builder/codegen/write-files.test.ts -t "process.cwd" --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL with a TypeScript error like "Expected 3 arguments, but got 2" — because the current signature still requires `worktreeDir`.

### Task 5: Refactor `writeNodeFiles` to drop `worktreeDir`

**Files:**
- Modify: `src/lib/node-builder/codegen/write-files.ts`

- [ ] **Step 1: Apply the signature change**

Edit `src/lib/node-builder/codegen/write-files.ts`. Replace the function signature and the `writeFile` calls so the base is always `process.cwd()`:

Replace:
```typescript
export async function writeNodeFiles(
  spec: NodeSpec,
  worktreeDir: string,
  srDocsDir: string,
): Promise<WriteResult> {
```

with:
```typescript
export async function writeNodeFiles(
  spec: NodeSpec,
  srDocsDir: string,
): Promise<WriteResult> {
  const worktreeDir = process.cwd();
```

Also update the JSDoc on `WriteResult.written` from "relative to worktreeDir" to "relative to process.cwd()".

- [ ] **Step 2: Run the new test**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/node-builder/codegen/write-files.test.ts -t "process.cwd" --reporter=verbose 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 3: Update existing write-files tests that pass `worktreeDir` explicitly**

Run:
```bash
grep -n "writeNodeFiles(" tests/lib/node-builder/codegen/write-files.test.ts
```

For each call that passes 3 args, restructure the test to use the `process.chdir(repoRoot)` pattern shown in Task 4 Step 2 (set cwd, call with 2 args, restore cwd in `finally`). Don't try to keep the old signature working — the function only has one signature now.

- [ ] **Step 4: Run the full write-files test file**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/node-builder/codegen/write-files.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: all tests in the file pass.

- [ ] **Step 5: Run the entire codegen test suite to confirm no other tests broke**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/node-builder/ --reporter=dot 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

Run:
```bash
git add src/lib/node-builder/codegen/write-files.ts tests/lib/node-builder/codegen/write-files.test.ts
git commit -m "refactor(node-builder): drop worktreeDir param from writeNodeFiles"
```

---

## Delete the curate experience

### Task 6: Delete `/jkai/curate` UI routes

**Files:**
- Delete: `src/routes/jkai/curate/` (recursive)

- [ ] **Step 1: Delete the route tree**

Run:
```bash
cd ~/strange_rambling_svelte
git rm -r src/routes/jkai/curate
```

Expected: 4 files deleted (`+page.server.ts`, `+page.svelte`, `[id]/+page.server.ts`, `[id]/+page.svelte`).

- [ ] **Step 2: Commit**

Run:
```bash
git commit -m "feat(curate): demolish /jkai/curate UI routes"
```

Build will still pass (the route deletion is self-contained); navigation entries pointing at `/jkai/curate` will be fixed in Task 10.

### Task 7: Delete `/api/curate/` endpoints

**Files:**
- Delete: `src/routes/api/curate/` (recursive)

- [ ] **Step 1: Delete the API tree**

Run:
```bash
cd ~/strange_rambling_svelte
git rm -r src/routes/api/curate
```

Expected: 7 files deleted (`sessions/+server.ts` plus the six `[id]/*/+server.ts` handlers).

- [ ] **Step 2: Commit**

Run:
```bash
git commit -m "feat(curate): demolish /api/curate endpoints"
```

### Task 8: Delete `/curate-preview/` route

**Files:**
- Delete: `src/routes/curate-preview/` (recursive)

This route was missed by the spec but uses `src/lib/curate/session-store.ts`, so it has to come out before we delete the runtime library.

- [ ] **Step 1: Confirm the route exists and what it contains**

Run:
```bash
ls -la src/routes/curate-preview/
find src/routes/curate-preview -type f
```

- [ ] **Step 2: Delete the route**

Run:
```bash
git rm -r src/routes/curate-preview
```

- [ ] **Step 3: Commit**

Run:
```bash
git commit -m "feat(curate): demolish /curate-preview route (used curate session-store)"
```

### Task 9: Delete the curate runtime library

**Files:**
- Delete: everything still inside `src/lib/curate/` (engine, discovery, prompts, session, worktree, etc.)

After Tasks 1-2, only the runtime files remain in `src/lib/curate/`. None of them are used by anything except each other and the routes we just deleted (the explore agent confirmed `hooks.server.ts` and `curate-preview` were the only external importers).

- [ ] **Step 1: Verify what's still in `src/lib/curate/`**

Run:
```bash
ls -la src/lib/curate/
find src/lib/curate -type f
```

Expected: only the runtime files (engine.ts, generate.ts, promote.ts, materialize.ts, dev-server.ts, port-allocator.ts, worktree.ts, session-store.ts, session-lifecycle.ts, reaper.ts, event-bus.ts, llm-client.ts, constants.ts, discovery/, prompts/) — no codegen/ or spec/.

- [ ] **Step 2: Delete the entire directory**

Run:
```bash
git rm -r src/lib/curate
```

Expected: ~22 files deleted (counts will vary depending on `discovery/` and `prompts/` contents). The `src/lib/curate/` directory should no longer exist.

- [ ] **Step 3: Don't commit yet**

The next task fixes the two dangling imports (`hooks.server.ts` and `PageHeader.svelte`). Commit them together with the runtime deletion so `master` is never in a broken state.

### Task 10: Fix dangling imports + navigation

**Files:**
- Modify: `src/hooks.server.ts` (line 74 — remove `startReaperCron` import; remove its invocation)
- Modify: `src/lib/components/PageHeader.svelte` (line 40 — remove `Curate` nav entry)

- [ ] **Step 1: Edit `src/hooks.server.ts` to remove the reaper import**

Run:
```bash
grep -n "reaper\|startReaperCron" src/hooks.server.ts
```

For each line returned, use Edit to remove it. The import line at ~74 and the function call (likely inside an `init()` or at module scope) both need to go. After editing, verify:

```bash
grep -n "reaper\|startReaperCron" src/hooks.server.ts
```

Expected: no matches.

- [ ] **Step 2: Edit `src/lib/components/PageHeader.svelte` to remove the Curate nav entry**

Run:
```bash
grep -n "curate\|Curate" src/lib/components/PageHeader.svelte
```

For each line returned, use Edit to remove the nav entry (likely a `{ href: '/jkai/curate', label: 'Curate' }` object in an array). After editing, verify:

```bash
grep -n "curate\|Curate" src/lib/components/PageHeader.svelte
```

Expected: no matches.

- [ ] **Step 3: Typecheck**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -20
```

Expected: 0 errors. If there are residual errors referencing `$lib/curate` from anywhere else, address them — the explore agent reported none, but verify.

- [ ] **Step 4: Build**

Run:
```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 5: Commit (with the runtime deletion from Task 9)**

Run:
```bash
git add -A
git commit -m "feat(curate): delete runtime library; remove dangling imports + nav entry"
```

Expected: one commit containing the runtime library deletion AND the hooks.server.ts + PageHeader.svelte edits.

### Task 11: Delete curate engine/session/worktree tests

**Files:**
- Delete: `tests/lib/curate/` (all remaining files — the codegen/ subdir was already moved in Task 3)

- [ ] **Step 1: Confirm what's still in `tests/lib/curate/`**

Run:
```bash
ls -la tests/lib/curate/
find tests/lib/curate -type f
```

Expected: the 9 engine/session/worktree test files only (no `codegen/` subdir — that moved in Task 3).

- [ ] **Step 2: Delete the directory**

Run:
```bash
git rm -r tests/lib/curate
```

Expected: 9 test files deleted.

- [ ] **Step 3: Run the full test suite**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run --reporter=dot 2>&1 | tail -10
```

Expected: tests pass; pass count matches Task 0 Step 2 baseline minus the 9 engine/session/worktree files and minus any individual tests inside them.

- [ ] **Step 4: Commit**

Run:
```bash
git commit -m "test(curate): remove engine/session/worktree tests"
```

---

## Drop the `curate_sessions` table

### Task 12: Remove curate from the Drizzle schema

**Files:**
- Modify: `src/lib/db/schema.ts:1566-1591` (remove `curateSessions` table)
- Modify: `src/lib/db/schema.ts:1598` (remove `'curate'` from `hermesSessions.kind` enum)

- [ ] **Step 1: Remove the `curateSessions` table declaration**

Edit `src/lib/db/schema.ts` and delete the entire `curateSessions` table block (the 26-line declaration around lines 1566-1591). Confirm with:

```bash
grep -n "curateSessions\|curate_sessions" src/lib/db/schema.ts
```

Expected: no matches.

- [ ] **Step 2: Remove `'curate'` from the `hermesSessions.kind` enum**

Edit `src/lib/db/schema.ts` around line 1598. The current enum reads:
```typescript
kind: text('kind', { enum: ['build', 'canvas_chat', 'curate', 'manual'] })
```

Change to:
```typescript
kind: text('kind', { enum: ['build', 'canvas_chat', 'manual'] })
```

Confirm with:
```bash
grep -n "kind:.*build.*canvas_chat" src/lib/db/schema.ts
```

Expected: the new line shows up; no `'curate'` value remains.

- [ ] **Step 3: Typecheck**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "(curate|hermesSession)" | head
```

Expected: 0 errors. If anything else in the codebase references `curateSessions` or the `'curate'` kind value, address those references.

### Task 13: Drop the `curate_sessions` table via migration

**Files:**
- Create: `drizzle/<NNNN>_drop_curate_sessions.sql` (NNNN auto-assigned by drizzle-kit)

The project uses `npx drizzle-kit push` per CLAUDE.md. For an additive schema change `push` is fine; for a table drop we want an explicit migration we can review.

- [ ] **Step 1: Generate the migration**

Run:
```bash
cd ~/strange_rambling_svelte
npx drizzle-kit generate
```

Expected: drizzle-kit creates a new `drizzle/<NNNN>_*.sql` file containing `DROP TABLE IF EXISTS "curate_sessions";` (and possibly `ALTER TYPE` if the kind enum was modelled as a PG enum — though the schema uses `text` with TS-level union, so the enum change is type-level only).

- [ ] **Step 2: Inspect the generated migration**

Run:
```bash
ls -1t drizzle/*.sql | head -1 | xargs cat
```

Expected: the migration drops `curate_sessions`. If it tries to drop or alter anything else, stop and investigate — the migration should be limited to this one change.

- [ ] **Step 3: Apply the migration locally**

Run:
```bash
npx drizzle-kit push
```

Then verify the table is gone. Read the DB URL from `.env` or `drizzle.config.ts` and use it via `psql`:

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
psql "$DATABASE_URL" -c "\d curate_sessions" 2>&1 | head -3
```

Expected: `Did not find any relation named "curate_sessions"`.

- [ ] **Step 4: Sanity-check the app still boots**

Run:
```bash
npm run dev &
sleep 8
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:5173/jkai
kill %1
```

Expected: `200`. If 5xx, check the dev server output for errors.

- [ ] **Step 5: Commit**

Run:
```bash
git add drizzle/ src/lib/db/schema.ts
git commit -m "feat(curate): drop curate_sessions table; remove 'curate' from hermesSessions.kind"
```

---

## Final verification

### Task 14: Whole-repo green check

- [ ] **Step 1: Search for any lingering "curate" references**

Run:
```bash
grep -rn "curate\|Curate" src/ tests/ data/prompts/ 2>&1 | grep -v node_modules | grep -v ".svelte-kit"
```

Expected: 0 matches. (`hermes-jkai` mentions in commits or `docs/` are fine — only `src/`, `tests/`, and `data/prompts/` need to be clean.)

If any match comes back, decide whether to remove it as part of this plan or note it as out-of-scope follow-up.

- [ ] **Step 2: Full typecheck**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 3: Full test suite**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run --reporter=dot 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Full build**

Run:
```bash
rm -rf .svelte-kit/output
npm run build 2>&1 | tail -20
```

Expected: build succeeds. (Per CLAUDE.md: "If a build fails, suspect stale `.svelte-kit/output` first" — we pre-emptively clean it.)

- [ ] **Step 5: Verify the codegen still works end-to-end**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/node-builder/codegen/ --reporter=verbose 2>&1 | tail -20
```

Expected: every codegen test (including the Apple Calendar golden) passes.

### Task 15: Push to origin

- [ ] **Step 1: Confirm log + push**

Run:
```bash
git log --oneline master ^origin/master
git push origin master
```

Expected: Phase 1 commits (Tasks 3, 5, 7, 8, 10, 11, 13) push cleanly. No deploy script run — Phase 1 ships nothing user-visible and the next phase is mid-stream work.

Phase 1 is complete. The repo is clean of `/jkai/curate`, the codegen library lives at `src/lib/node-builder/`, and the runway is clear for Phase 2 (MCP tools).
