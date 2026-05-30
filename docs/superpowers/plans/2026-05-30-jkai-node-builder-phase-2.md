# jkai-node-builder — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seven `node_builder_*` MCP tools to the site-tools registry so they are exposed via `/api/mcp` and callable by Hermes. Each tool is independently unit-tested. Ship a working tools layer — no skill invokes them yet (that's Phase 3).

**Architecture:** A single new file `src/lib/workflows/site-tools/tools/node-builder.ts` registers the seven tools via the existing `register()` pattern. The new file is imported by `src/lib/workflows/site-tools/registry.ts` alongside the other 22 domain modules. Once registered, the tools appear automatically in `tools/list` and become callable via `tools/call` against `/api/mcp` (auth via the existing `HERMES_BRIDGE_SECRET` bearer check in `src/lib/mcp/jsonrpc.ts`).

**Tech Stack:** SvelteKit, TypeScript, Vitest, `node:child_process` for git/npm shelling, the existing `writeNodeFiles` codegen from `src/lib/node-builder/codegen/`.

---

## The seven tools

| Tool | Mutating? | Args | Returns |
|---|---|---|---|
| `node_builder_check_clean` | No | (none) | `{ ok: true }` OR `{ ok: false, reason: string }` |
| `node_builder_list_existing` | No | (none) | `{ nodes: Array<{ type: string; description: string }> }` |
| `node_builder_write_files` | Yes | `{ spec: NodeSpec }` | `{ written: string[] }` |
| `node_builder_validate` | No | (none) | `{ ok: boolean; errors?: string }` |
| `node_builder_diff` | No | (none) | `{ stat: string; diff: string }` |
| `node_builder_abort` | Yes | (none) | `{ ok: true; revertedPaths: string[] }` |
| `node_builder_commit_and_deploy` | Yes | `{ commitMessage: string }` | `{ ok: boolean; deployUrl?: string; log: string }` |

## Codegen-touched path allowlist

The codegen writes/patches these paths inside `~/strange_rambling_svelte/` (verified by reading `src/lib/node-builder/codegen/write-files.ts`):

```
src/lib/workflows/nodes/<type>.def.ts            (new)
src/lib/workflows/nodes/<type>.ts                (new)
src/lib/canvas/nodes/panels/<Name>Panel.svelte   (new)
src/lib/canvas/nodes/panels/registry.ts          (patched)
src/lib/workflows/index.ts                       (patched)
```

Plus `package.json` / `package-lock.json` if codegen ever adds npm deps (future).

The sr-docs markdown is written to a separate repo (`~/sr-docs/content/internal/features/workflows/nodes/<type>.md`) and is OUT OF SCOPE for `commit_and_deploy` — that tool only commits + deploys this repo.

**Allowlist as a typed constant** (used by both `abort` and `commit_and_deploy`):

```typescript
export const NODE_BUILDER_PATH_ALLOWLIST = [
  'src/lib/workflows/nodes/',
  'src/lib/canvas/nodes/panels/',
  'src/lib/workflows/index.ts',
  'package.json',
  'package-lock.json',
] as const;
```

The allowlist matches by prefix (directory paths end with `/`; file paths are exact).

---

## File map

**Created:**
- `src/lib/workflows/site-tools/tools/node-builder.ts` — one file containing all 7 tool registrations
- `src/lib/workflows/site-tools/tools/node-builder-shared.ts` — internal helpers (path allowlist constant, `runGit()` wrapper, `runNpm()` wrapper) used by multiple tools
- `tests/lib/workflows/site-tools/node-builder.test.ts` — unit tests for all 7 tools

**Modified:**
- `src/lib/workflows/site-tools/registry.ts` — one new `import './tools/node-builder';` line

---

## Pre-flight

### Task 0: Confirm clean working tree on master + record test baseline

- [ ] **Step 1: Verify branch + working tree**

```bash
cd ~/strange_rambling_svelte
git status
git log --oneline -1
```

Expected: `On branch master`, `nothing to commit, working tree clean`, HEAD at `26fac8f` (Phase 1's last commit) or later.

- [ ] **Step 2: Snapshot test baseline**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run --reporter=dot 2>&1 | tail -5
```

Record the pass/fail counts. From Phase 1: 998/1000 passing, 2 pre-existing failures in `src/lib/mcp/meta-tool.test.ts` and `tests/lib/workflows/site-tools/promote-ephemeral-tool.test.ts`. Those should remain unchanged at the end.

---

## Task 1: Scaffold node-builder.ts with stub registrations + wire into registry

**Files:**
- Create: `src/lib/workflows/site-tools/tools/node-builder.ts`
- Create: `src/lib/workflows/site-tools/tools/node-builder-shared.ts`
- Modify: `src/lib/workflows/site-tools/registry.ts`

- [ ] **Step 1: Create the shared helpers module**

Create `src/lib/workflows/site-tools/tools/node-builder-shared.ts`:

```typescript
import { spawn } from 'node:child_process';

export const NODE_BUILDER_PATH_ALLOWLIST = [
  'src/lib/workflows/nodes/',
  'src/lib/canvas/nodes/panels/',
  'src/lib/workflows/index.ts',
  'package.json',
  'package-lock.json',
] as const;

/**
 * Returns true if `path` is within the codegen-managed allowlist.
 * Directory entries end with '/' and match by prefix; file entries match exactly.
 */
export function isPathAllowed(path: string): boolean {
  return NODE_BUILDER_PATH_ALLOWLIST.some((entry) =>
    entry.endsWith('/') ? path.startsWith(entry) : path === entry,
  );
}

export interface ProcessResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Run a command in the repo root and capture stdout/stderr.
 * Always uses `cwd = process.cwd()`. Never throws — returns a result object.
 */
export function runProcess(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, options.timeoutMs)
      : null;

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        stdout,
        stderr: timedOut ? `${stderr}\n(killed after ${options.timeoutMs}ms timeout)` : stderr,
        exitCode: code,
      });
    });
  });
}
```

- [ ] **Step 2: Create the stub registrations**

Create `src/lib/workflows/site-tools/tools/node-builder.ts`:

```typescript
import { register } from '../registry';

const NOT_IMPLEMENTED = async () => ({
  success: false,
  error: 'not implemented yet — Phase 2 task pending',
});

register({
  name: 'node_builder_check_clean',
  description:
    'Pre-flight check before building a new workflow node. Confirms the repo working tree is clean, on master, and not in a merge state. Returns { ok: true } or { ok: false, reason }.',
  parameters: { type: 'object', properties: {} },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: NOT_IMPLEMENTED,
});

register({
  name: 'node_builder_list_existing',
  description:
    'Lists every registered workflow node type so the caller can decide whether an existing node covers a request before generating a new one.',
  parameters: { type: 'object', properties: {} },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: NOT_IMPLEMENTED,
});

register({
  name: 'node_builder_write_files',
  description:
    'Generates all files for a new workflow node from a NodeSpec JSON object. Writes the definition, executor, panel, registry patches, and sr-docs markdown via the node-builder codegen.',
  parameters: {
    type: 'object',
    properties: {
      spec: {
        type: 'object',
        description:
          'Complete NodeSpec — must conform to the TypeScript shape in src/lib/node-builder/spec/types.ts. Required fields: type, displayName, description, category, inputs, outputs, uiSchema, testCases.',
      },
    },
    required: ['spec'],
  },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: NOT_IMPLEMENTED,
});

register({
  name: 'node_builder_validate',
  description:
    'Runs `npm run build` and `npm run check` to verify the working tree builds and typechecks. Use after node_builder_write_files to confirm the generated node compiles cleanly.',
  parameters: { type: 'object', properties: {} },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: NOT_IMPLEMENTED,
});

register({
  name: 'node_builder_diff',
  description:
    'Returns the current `git diff --stat` summary AND full `git diff` against HEAD. Use to present the user with what node_builder_write_files produced before asking for commit approval.',
  parameters: { type: 'object', properties: {} },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: NOT_IMPLEMENTED,
});

register({
  name: 'node_builder_abort',
  description:
    'Reverts every codegen-managed path back to HEAD and removes any untracked files within the allowlist. Use when the user rejects a generated node or validation fails irrecoverably.',
  parameters: { type: 'object', properties: {} },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: NOT_IMPLEMENTED,
});

register({
  name: 'node_builder_commit_and_deploy',
  description:
    'GATED: commits codegen-managed paths with the supplied message, pushes to origin/master, runs scripts/deploy.sh, and verifies the deployed site responds. REFUSES if any staged file is outside the codegen path allowlist. Only call after explicit user approval in the current turn.',
  parameters: {
    type: 'object',
    properties: {
      commitMessage: {
        type: 'string',
        description: 'One-line conventional commit message (e.g. "feat(nodes): add apple_calendar node").',
      },
    },
    required: ['commitMessage'],
  },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: NOT_IMPLEMENTED,
});
```

- [ ] **Step 3: Wire the file into the registry**

Edit `src/lib/workflows/site-tools/registry.ts`. Add a new import line in the "Load all domain modules" block (alphabetical order suggests putting it near the bottom or grouping with other utility tools — match the existing convention):

```typescript
import './tools/node-builder';
```

- [ ] **Step 4: Verify the 7 tools appear in tools/list via curl**

Start the dev server in the background:
```bash
cd ~/strange_rambling_svelte
npm run dev &
sleep 8
```

Then check `tools/list`:
```bash
HERMES_BRIDGE_SECRET=$(grep -E '^HERMES_BRIDGE_SECRET=' .env | cut -d= -f2- | tr -d '"')
curl -sS http://localhost:5173/api/mcp -X POST \
  -H "Authorization: Bearer $HERMES_BRIDGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | python3 -m json.tool \
  | grep node_builder
```

Expected: 7 lines, one per tool name.

```bash
kill %1
wait 2>/dev/null
```

- [ ] **Step 5: Confirm the existing registry tests still pass**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/mcp/ tests/lib/workflows/site-tools/ --reporter=dot 2>&1 | tail -10
```

Expected: no new failures (the same 2 pre-existing failures remain).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/site-tools/tools/node-builder.ts \
        src/lib/workflows/site-tools/tools/node-builder-shared.ts \
        src/lib/workflows/site-tools/registry.ts
git commit -m "feat(node-builder): scaffold 7 MCP tool registrations (stubs)"
```

---

## Task 2: Implement `node_builder_check_clean` + tests

**Files:**
- Modify: `src/lib/workflows/site-tools/tools/node-builder.ts`
- Create: `tests/lib/workflows/site-tools/node-builder.test.ts`

The tool returns `{ ok: true }` if all three conditions are met:
1. Working tree is clean (`git status --porcelain` is empty)
2. Current branch is `master` (`git rev-parse --abbrev-ref HEAD` returns `master`)
3. Not in a merge state (`.git/MERGE_HEAD` does not exist)

Otherwise returns `{ ok: false, reason: <which check failed> }`.

- [ ] **Step 1: Write failing tests**

Create `tests/lib/workflows/site-tools/node-builder.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '$lib/workflows/site-tools/tools/node-builder-shared';

// Ensure registrations fire.
import '$lib/workflows/site-tools/tools/node-builder';
import { getTool } from '$lib/workflows/site-tools/registry';

/** Spin up a tmp git repo for tests. Returns the repo dir. */
async function makeTmpRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'nb-test-'));
  await runProcess('git', ['init', '-q', '-b', 'master'], {});
  // The above ran in process.cwd() which is wrong. Test must chdir first; see beforeEach.
  return dir;
}

describe('node_builder_check_clean', () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    repoDir = mkdtempSync(path.join(tmpdir(), 'nb-check-'));
    process.chdir(repoDir);
    // Initialise a git repo with a single commit on master.
    await runProcess('git', ['init', '-q', '-b', 'master'], {});
    await runProcess('git', ['config', 'user.email', 'test@test.invalid'], {});
    await runProcess('git', ['config', 'user.name', 'test'], {});
    writeFileSync(path.join(repoDir, 'a.txt'), 'hello', 'utf8');
    await runProcess('git', ['add', 'a.txt'], {});
    await runProcess('git', ['commit', '-q', '-m', 'init'], {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns ok:true when on master with clean tree and no merge in progress', async () => {
    const tool = getTool('node_builder_check_clean')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true });
  });

  it('returns ok:false when working tree is dirty', async () => {
    writeFileSync(path.join(repoDir, 'a.txt'), 'changed', 'utf8');
    const tool = getTool('node_builder_check_clean')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ ok: false, reason: expect.stringContaining('dirty') });
  });

  it('returns ok:false when on a non-master branch', async () => {
    await runProcess('git', ['checkout', '-q', '-b', 'feature/foo'], {});
    const tool = getTool('node_builder_check_clean')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ ok: false, reason: expect.stringContaining('branch') });
  });

  it('returns ok:false when a merge is in progress', async () => {
    mkdirSync(path.join(repoDir, '.git'), { recursive: true });
    writeFileSync(path.join(repoDir, '.git', 'MERGE_HEAD'), 'abc123', 'utf8');
    const tool = getTool('node_builder_check_clean')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ ok: false, reason: expect.stringContaining('merge') });
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/workflows/site-tools/node-builder.test.ts -t check_clean --reporter=verbose 2>&1 | tail -15
```

Expected: 4 FAILs, all because the handler still returns `{ success: false, error: 'not implemented yet…' }`.

- [ ] **Step 3: Implement the handler**

Replace the `NOT_IMPLEMENTED` handler for `node_builder_check_clean` in `src/lib/workflows/site-tools/tools/node-builder.ts`:

```typescript
import { existsSync } from 'node:fs';
import path from 'node:path';
import { runProcess } from './node-builder-shared';

// (replace the handler for node_builder_check_clean)
handler: async () => {
  const status = await runProcess('git', ['status', '--porcelain'], {});
  if (!status.ok) {
    return { success: false, error: `git status failed: ${status.stderr}` };
  }
  if (status.stdout.trim().length > 0) {
    return {
      success: true,
      data: { ok: false, reason: 'working tree is dirty' },
    };
  }

  const branch = await runProcess('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {});
  if (!branch.ok) {
    return { success: false, error: `git rev-parse failed: ${branch.stderr}` };
  }
  if (branch.stdout.trim() !== 'master') {
    return {
      success: true,
      data: {
        ok: false,
        reason: `on branch ${branch.stdout.trim()}, not master`,
      },
    };
  }

  if (existsSync(path.join(process.cwd(), '.git/MERGE_HEAD'))) {
    return {
      success: true,
      data: { ok: false, reason: 'merge in progress' },
    };
  }

  return { success: true, data: { ok: true } };
},
```

- [ ] **Step 4: Re-run the tests**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/workflows/site-tools/node-builder.test.ts -t check_clean --reporter=verbose 2>&1 | tail -15
```

Expected: 4 PASSes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/site-tools/tools/node-builder.ts \
        tests/lib/workflows/site-tools/node-builder.test.ts
git commit -m "feat(node-builder): implement node_builder_check_clean"
```

---

## Task 3: Implement `node_builder_list_existing` + tests

The tool enumerates registered workflow node types. The current source of truth for registered nodes is `src/lib/workflows/index.ts` (which the codegen patches). Read the file, parse the registry exports, and return `{ nodes: [{ type, description }] }`.

Inspect first to confirm the registry shape:

- [ ] **Step 1: Inspect the workflows index to confirm the export shape**

```bash
head -50 src/lib/workflows/index.ts
grep "registerWorkflowNode\|registry\|nodeTypes" src/lib/workflows/index.ts | head -10
```

The plan assumes there is either an exported `getAllNodeTypes()` function OR a `nodeRegistry` map. If neither exists in the form expected, fall back to scanning `src/lib/workflows/nodes/*.def.ts` for `displayName` / `description` exports. Decide based on what's actually there.

- [ ] **Step 2: Write the test**

Add to `tests/lib/workflows/site-tools/node-builder.test.ts` (in a new `describe` block):

```typescript
describe('node_builder_list_existing', () => {
  it('returns the registered workflow node types with type and description', async () => {
    const tool = getTool('node_builder_list_existing')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    const data = result.data as { nodes: Array<{ type: string; description: string }> };
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(data.nodes.length).toBeGreaterThan(5); // at least the built-ins
    for (const node of data.nodes) {
      expect(typeof node.type).toBe('string');
      expect(typeof node.description).toBe('string');
    }
  });

  it('includes a known built-in node like gmail-send', async () => {
    const tool = getTool('node_builder_list_existing')!;
    const result = await tool.handler({});
    const data = result.data as { nodes: Array<{ type: string }> };
    const types = data.nodes.map((n) => n.type);
    expect(types).toContain('gmail-send');
  });
});
```

- [ ] **Step 3: Run failing test**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/workflows/site-tools/node-builder.test.ts -t list_existing --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 4: Implement using whatever export the workflows index exposes**

Based on Step 1's findings, replace the `NOT_IMPLEMENTED` handler with a real implementation. Most likely shape (adjust to actual exports):

```typescript
handler: async () => {
  const mod = await import('$lib/workflows');
  // Adjust the next line to match what's actually exported. Common shapes:
  //   - mod.getAllNodeTypes(): NodeDef[]
  //   - mod.nodeRegistry: Record<string, NodeDef>
  //   - mod.defs: NodeDef[]
  const defs = typeof mod.getAllNodeTypes === 'function'
    ? mod.getAllNodeTypes()
    : Object.values(mod.nodeRegistry ?? {});
  const nodes = defs.map((d: any) => ({
    type: d.type,
    description: d.description ?? '',
  }));
  return { success: true, data: { nodes } };
},
```

- [ ] **Step 5: Run tests + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/workflows/site-tools/node-builder.test.ts -t list_existing --reporter=verbose 2>&1 | tail -15
git add src/lib/workflows/site-tools/tools/node-builder.ts tests/lib/workflows/site-tools/node-builder.test.ts
git commit -m "feat(node-builder): implement node_builder_list_existing"
```

---

## Task 4: Implement `node_builder_diff` + tests

`node_builder_diff` is purely read-only — `git diff --stat` and `git diff` against HEAD. Doing this before `write_files` and `abort` so the tests for those tools can sanity-check via diff.

- [ ] **Step 1: Write failing tests**

Append to `tests/lib/workflows/site-tools/node-builder.test.ts`:

```typescript
describe('node_builder_diff', () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    repoDir = mkdtempSync(path.join(tmpdir(), 'nb-diff-'));
    process.chdir(repoDir);
    await runProcess('git', ['init', '-q', '-b', 'master'], {});
    await runProcess('git', ['config', 'user.email', 'test@test.invalid'], {});
    await runProcess('git', ['config', 'user.name', 'test'], {});
    writeFileSync(path.join(repoDir, 'a.txt'), 'initial\n', 'utf8');
    await runProcess('git', ['add', 'a.txt'], {});
    await runProcess('git', ['commit', '-q', '-m', 'init'], {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns empty stat and diff when working tree is clean', async () => {
    const tool = getTool('node_builder_diff')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    const data = result.data as { stat: string; diff: string };
    expect(data.stat).toBe('');
    expect(data.diff).toBe('');
  });

  it('returns non-empty stat and diff when there are uncommitted changes', async () => {
    writeFileSync(path.join(repoDir, 'a.txt'), 'changed\n', 'utf8');
    const tool = getTool('node_builder_diff')!;
    const result = await tool.handler({});
    const data = result.data as { stat: string; diff: string };
    expect(data.stat).toContain('a.txt');
    expect(data.diff).toContain('changed');
  });

  it('includes untracked files in the diff/stat', async () => {
    writeFileSync(path.join(repoDir, 'b.txt'), 'new file\n', 'utf8');
    const tool = getTool('node_builder_diff')!;
    const result = await tool.handler({});
    const data = result.data as { stat: string; diff: string };
    expect(data.stat).toContain('b.txt');
  });
});
```

- [ ] **Step 2: Implement**

Replace the handler. `git diff --stat HEAD` and `git diff HEAD` together cover tracked changes. To include untracked files, run `git add -N <files>` first (intent-to-add) so they show up in the diff. Alternatively, use `git status --porcelain` to list untracked then `cat` each. The first approach is cleaner:

```typescript
handler: async () => {
  // Intent-to-add untracked files so they show in diff.
  const status = await runProcess('git', ['status', '--porcelain'], {});
  const untracked = status.stdout
    .split('\n')
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3));
  for (const f of untracked) {
    await runProcess('git', ['add', '-N', f], {});
  }

  const stat = await runProcess('git', ['diff', '--stat', 'HEAD'], {});
  const diff = await runProcess('git', ['diff', 'HEAD'], {});

  return {
    success: true,
    data: {
      stat: stat.stdout,
      diff: diff.stdout,
    },
  };
},
```

- [ ] **Step 3: Run tests + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/workflows/site-tools/node-builder.test.ts -t node_builder_diff --reporter=verbose 2>&1 | tail -15
git add src/lib/workflows/site-tools/tools/node-builder.ts tests/lib/workflows/site-tools/node-builder.test.ts
git commit -m "feat(node-builder): implement node_builder_diff"
```

---

## Task 5: Implement `node_builder_abort` + tests

Reverts every codegen-managed path back to HEAD and removes untracked files within the allowlist. Uses the `NODE_BUILDER_PATH_ALLOWLIST` constant from `node-builder-shared.ts`.

- [ ] **Step 1: Write failing tests**

Append to test file:

```typescript
describe('node_builder_abort', () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    repoDir = mkdtempSync(path.join(tmpdir(), 'nb-abort-'));
    process.chdir(repoDir);
    await runProcess('git', ['init', '-q', '-b', 'master'], {});
    await runProcess('git', ['config', 'user.email', 'test@test.invalid'], {});
    await runProcess('git', ['config', 'user.name', 'test'], {});

    // Seed an "index.ts" in src/lib/workflows so the allowlist hits a real file.
    mkdirSync(path.join(repoDir, 'src/lib/workflows'), { recursive: true });
    writeFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'export const initial = 1;\n', 'utf8');
    mkdirSync(path.join(repoDir, 'src/lib/canvas/nodes/panels'), { recursive: true });
    writeFileSync(path.join(repoDir, 'src/lib/canvas/nodes/panels/registry.ts'), 'export const reg = {};\n', 'utf8');
    writeFileSync(path.join(repoDir, 'package.json'), '{"name":"x"}\n', 'utf8');
    await runProcess('git', ['add', '-A'], {});
    await runProcess('git', ['commit', '-q', '-m', 'init'], {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('reverts modified allowlist files', async () => {
    writeFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'export const changed = 2;\n', 'utf8');
    const tool = getTool('node_builder_abort')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    const idx = require('node:fs').readFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'utf8');
    expect(idx).toBe('export const initial = 1;\n');
  });

  it('removes untracked allowlist files', async () => {
    mkdirSync(path.join(repoDir, 'src/lib/workflows/nodes'), { recursive: true });
    writeFileSync(path.join(repoDir, 'src/lib/workflows/nodes/new-node.ts'), 'export {};\n', 'utf8');
    const tool = getTool('node_builder_abort')!;
    await tool.handler({});
    expect(require('node:fs').existsSync(path.join(repoDir, 'src/lib/workflows/nodes/new-node.ts'))).toBe(false);
  });

  it('does NOT touch files outside the allowlist', async () => {
    mkdirSync(path.join(repoDir, 'unrelated'), { recursive: true });
    writeFileSync(path.join(repoDir, 'unrelated/x.txt'), 'untouched\n', 'utf8');
    const tool = getTool('node_builder_abort')!;
    await tool.handler({});
    expect(require('node:fs').existsSync(path.join(repoDir, 'unrelated/x.txt'))).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import { NODE_BUILDER_PATH_ALLOWLIST, runProcess } from './node-builder-shared';

handler: async () => {
  const revertedPaths: string[] = [];
  for (const entry of NODE_BUILDER_PATH_ALLOWLIST) {
    // Revert tracked modifications.
    const co = await runProcess('git', ['checkout', '--', entry], {});
    if (co.ok) revertedPaths.push(entry);
    // Remove untracked files within the allowlist entry.
    // -f forces deletion; -d includes directories; only operates on the given path.
    await runProcess('git', ['clean', '-fd', entry], {});
  }
  return { success: true, data: { ok: true, revertedPaths } };
},
```

- [ ] **Step 3: Run tests + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/workflows/site-tools/node-builder.test.ts -t node_builder_abort --reporter=verbose 2>&1 | tail -15
git add src/lib/workflows/site-tools/tools/node-builder.ts tests/lib/workflows/site-tools/node-builder.test.ts
git commit -m "feat(node-builder): implement node_builder_abort"
```

---

## Task 6: Implement `node_builder_write_files` + tests

Thin wrapper around `writeNodeFiles(spec, srDocsDir)` from `src/lib/node-builder/codegen/write-files.ts`. `srDocsDir` resolves to `~/sr-docs/` (the separate sr-docs repo).

- [ ] **Step 1: Decide the srDocsDir resolution strategy**

Pragmatic choice: read from env var `SR_DOCS_DIR`, default to `~/sr-docs`. In tests, override via env. If the directory doesn't exist, codegen will throw — that's a useful error to surface.

- [ ] **Step 2: Write failing tests**

Append:

```typescript
describe('node_builder_write_files', () => {
  let repoDir: string;
  let srDocsDir: string;
  let originalCwd: string;
  let originalSrDocs: string | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalSrDocs = process.env.SR_DOCS_DIR;
    repoDir = mkdtempSync(path.join(tmpdir(), 'nb-write-'));
    srDocsDir = mkdtempSync(path.join(tmpdir(), 'nb-srdocs-'));
    process.env.SR_DOCS_DIR = srDocsDir;
    process.chdir(repoDir);
    // Seed the registry + index that codegen patches.
    mkdirSync(path.join(repoDir, 'src/lib/canvas/nodes/panels'), { recursive: true });
    writeFileSync(
      path.join(repoDir, 'src/lib/canvas/nodes/panels/registry.ts'),
      require('node:fs').readFileSync(
        path.join(originalCwd, 'tests/__fixtures__/node-builder-codegen/registry-base.ts.txt'),
        'utf8',
      ),
      'utf8',
    );
    mkdirSync(path.join(repoDir, 'src/lib/workflows'), { recursive: true });
    writeFileSync(
      path.join(repoDir, 'src/lib/workflows/index.ts'),
      require('node:fs').readFileSync(
        path.join(originalCwd, 'tests/__fixtures__/node-builder-codegen/index-base.ts.txt'),
        'utf8',
      ),
      'utf8',
    );
  });

  afterEach(() => {
    if (originalSrDocs === undefined) delete process.env.SR_DOCS_DIR;
    else process.env.SR_DOCS_DIR = originalSrDocs;
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(srDocsDir, { recursive: true, force: true });
  });

  it('writes all expected files for a valid spec', async () => {
    const fixture = await import(path.join(originalCwd, 'tests/__fixtures__/node-builder-codegen/apple-calendar.spec.ts'));
    const spec = (fixture as { appleCalendarSpec: unknown }).appleCalendarSpec;
    const tool = getTool('node_builder_write_files')!;
    const result = await tool.handler({ spec });
    expect(result.success).toBe(true);
    const data = result.data as { written: string[] };
    expect(data.written).toContain('src/lib/workflows/nodes/apple-calendar.ts');
    expect(data.written).toContain('src/lib/workflows/nodes/apple-calendar.def.ts');
  });

  it('returns success:false when spec is missing required fields', async () => {
    const tool = getTool('node_builder_write_files')!;
    const result = await tool.handler({ spec: { type: 'incomplete' } });
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });
});
```

(The exact named export of the fixture spec depends on what it exports — `appleCalendarSpec` is a likely guess; adjust to match what `tests/__fixtures__/node-builder-codegen/apple-calendar.spec.ts` actually exports.)

- [ ] **Step 3: Implement**

```typescript
import { writeNodeFiles } from '$lib/node-builder/codegen/write-files';
import type { NodeSpec } from '$lib/node-builder/spec/types';
import os from 'node:os';
import path from 'node:path';

handler: async (args) => {
  const spec = args.spec as NodeSpec;
  const srDocsDir = process.env.SR_DOCS_DIR ?? path.join(os.homedir(), 'sr-docs');
  try {
    const { written } = await writeNodeFiles(spec, srDocsDir);
    return { success: true, data: { written } };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
},
```

- [ ] **Step 4: Run tests + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/workflows/site-tools/node-builder.test.ts -t node_builder_write_files --reporter=verbose 2>&1 | tail -15
git add src/lib/workflows/site-tools/tools/node-builder.ts tests/lib/workflows/site-tools/node-builder.test.ts
git commit -m "feat(node-builder): implement node_builder_write_files"
```

---

## Task 7: Implement `node_builder_validate` + tests

Runs `npm run build` then `npm run check`, captures stdout/stderr, returns `{ ok, errors? }`. Long-running (multi-minute on slow systems).

- [ ] **Step 1: Tests**

Append. Note: full validate runs are slow — for tests, mock the runProcess helper OR write a single integration-style test that runs ONLY against a tiny isolated repo (skipping the actual `npm` commands). Easier: write a unit test that asserts the handler shells out to the right commands by intercepting `spawn`. Use `vi.mock` on the shared module:

```typescript
import { vi } from 'vitest';

vi.mock('$lib/workflows/site-tools/tools/node-builder-shared', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('$lib/workflows/site-tools/tools/node-builder-shared');
  return {
    ...actual,
    runProcess: vi.fn(),
  };
});

describe('node_builder_validate', () => {
  it('runs npm build and npm check, returns ok when both succeed', async () => {
    const { runProcess } = await import('$lib/workflows/site-tools/tools/node-builder-shared');
    const mock = runProcess as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({ ok: true, stdout: 'build ok', stderr: '', exitCode: 0 });
    mock.mockResolvedValueOnce({ ok: true, stdout: 'check ok', stderr: '', exitCode: 0 });

    const tool = getTool('node_builder_validate')!;
    const result = await tool.handler({});

    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[0][1]).toContain('build');
    expect(mock.mock.calls[1][1]).toContain('check');
    expect(result.data).toEqual({ ok: true });
  });

  it('returns ok:false with errors when build fails', async () => {
    const { runProcess } = await import('$lib/workflows/site-tools/tools/node-builder-shared');
    const mock = runProcess as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({ ok: false, stdout: '', stderr: 'TypeError: foo', exitCode: 1 });

    const tool = getTool('node_builder_validate')!;
    const result = await tool.handler({});

    const data = result.data as { ok: boolean; errors?: string };
    expect(data.ok).toBe(false);
    expect(data.errors).toContain('TypeError: foo');
  });
});
```

- [ ] **Step 2: Implement**

```typescript
handler: async () => {
  // Build first — if it fails, no point typechecking.
  const build = await runProcess('npm', ['run', 'build'], { timeoutMs: 5 * 60_000 });
  if (!build.ok) {
    return {
      success: true,
      data: {
        ok: false,
        errors: `npm run build failed:\n${build.stderr || build.stdout}`,
      },
    };
  }
  const check = await runProcess(
    'npm',
    ['run', 'check'],
    {
      env: { NODE_OPTIONS: '--max-old-space-size=8192' },
      timeoutMs: 5 * 60_000,
    },
  );
  if (!check.ok) {
    return {
      success: true,
      data: {
        ok: false,
        errors: `npm run check failed:\n${check.stderr || check.stdout}`,
      },
    };
  }
  return { success: true, data: { ok: true } };
},
```

- [ ] **Step 3: Run tests + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/workflows/site-tools/node-builder.test.ts -t node_builder_validate --reporter=verbose 2>&1 | tail -15
git add src/lib/workflows/site-tools/tools/node-builder.ts tests/lib/workflows/site-tools/node-builder.test.ts
git commit -m "feat(node-builder): implement node_builder_validate"
```

---

## Task 8: Implement `node_builder_commit_and_deploy` + tests

The gated tool. Steps:
1. Inspect `git status --porcelain` — every changed path must be inside `NODE_BUILDER_PATH_ALLOWLIST`. If any file is outside, refuse with a specific error listing the offending paths.
2. `git add <each allowlist path that has changes>`
3. `git commit -m <commitMessage>`
4. `git push origin master`
5. Run `~/strange_rambling_svelte/scripts/deploy.sh`
6. Curl `https://strangeramblings.com` for a 200
7. Return `{ ok, deployUrl: 'https://strangeramblings.com', log }`

- [ ] **Step 1: Write failing tests (multiple scenarios)**

Append. Mock both `runProcess` and the deploy-script + curl steps. Test specifically:
1. Happy path
2. Refusal when out-of-allowlist file is staged
3. Refusal when working tree is clean (nothing to commit)
4. Bubbles up deploy-script failure

```typescript
describe('node_builder_commit_and_deploy', () => {
  let originalCwd: string;
  let repoDir: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    repoDir = mkdtempSync(path.join(tmpdir(), 'nb-cad-'));
    process.chdir(repoDir);
    await runProcess('git', ['init', '-q', '-b', 'master'], {});
    await runProcess('git', ['config', 'user.email', 'test@test.invalid'], {});
    await runProcess('git', ['config', 'user.name', 'test'], {});
    mkdirSync(path.join(repoDir, 'src/lib/workflows'), { recursive: true });
    writeFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'export {};\n', 'utf8');
    await runProcess('git', ['add', '-A'], {});
    await runProcess('git', ['commit', '-q', '-m', 'init'], {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('refuses if any changed file is outside the allowlist', async () => {
    writeFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'export const a = 1;\n', 'utf8');
    writeFileSync(path.join(repoDir, 'src/unrelated.ts'), 'export {};\n', 'utf8');
    const tool = getTool('node_builder_commit_and_deploy')!;
    const result = await tool.handler({ commitMessage: 'feat: x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('src/unrelated.ts');
  });

  it('refuses if the working tree has nothing to commit', async () => {
    const tool = getTool('node_builder_commit_and_deploy')!;
    const result = await tool.handler({ commitMessage: 'feat: x' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nothing|clean/i);
  });

  // Happy path + deploy failure: gate the deploy step behind an env var so tests
  // can mock it. Use NODE_BUILDER_DEPLOY_CMD (default: scripts/deploy.sh).
  it('happy path: stages allowlist files, commits, push+deploy invoked, returns ok', async () => {
    writeFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'export const a = 1;\n', 'utf8');
    // Stub deploy + push so they don't actually run.
    const stub = path.join(repoDir, 'fake-deploy.sh');
    writeFileSync(stub, '#!/bin/sh\necho "deploy ok"\n', 'utf8');
    require('node:fs').chmodSync(stub, 0o755);
    process.env.NODE_BUILDER_DEPLOY_CMD = stub;
    process.env.NODE_BUILDER_SKIP_PUSH = '1';
    process.env.NODE_BUILDER_VERIFY_URL = '';  // skip live-curl
    try {
      const tool = getTool('node_builder_commit_and_deploy')!;
      const result = await tool.handler({ commitMessage: 'feat(test): a' });
      expect(result.success).toBe(true);
      const data = result.data as { ok: boolean; log: string };
      expect(data.ok).toBe(true);
      expect(data.log).toContain('deploy ok');
      // Confirm the commit landed.
      const log = await runProcess('git', ['log', '--oneline', '-1'], {});
      expect(log.stdout).toContain('feat(test): a');
    } finally {
      delete process.env.NODE_BUILDER_DEPLOY_CMD;
      delete process.env.NODE_BUILDER_SKIP_PUSH;
      delete process.env.NODE_BUILDER_VERIFY_URL;
    }
  });

  it('bubbles up deploy-script failure', async () => {
    writeFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'export const a = 1;\n', 'utf8');
    const stub = path.join(repoDir, 'fake-deploy-fail.sh');
    writeFileSync(stub, '#!/bin/sh\necho "deploy broke" >&2\nexit 2\n', 'utf8');
    require('node:fs').chmodSync(stub, 0o755);
    process.env.NODE_BUILDER_DEPLOY_CMD = stub;
    process.env.NODE_BUILDER_SKIP_PUSH = '1';
    process.env.NODE_BUILDER_VERIFY_URL = '';
    try {
      const tool = getTool('node_builder_commit_and_deploy')!;
      const result = await tool.handler({ commitMessage: 'feat(test): b' });
      expect(result.success).toBe(true);
      const data = result.data as { ok: boolean; log: string };
      expect(data.ok).toBe(false);
      expect(data.log).toMatch(/deploy.*broke|exit 2/i);
    } finally {
      delete process.env.NODE_BUILDER_DEPLOY_CMD;
      delete process.env.NODE_BUILDER_SKIP_PUSH;
      delete process.env.NODE_BUILDER_VERIFY_URL;
    }
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import { isPathAllowed, NODE_BUILDER_PATH_ALLOWLIST, runProcess } from './node-builder-shared';

handler: async (args) => {
  const commitMessage = args.commitMessage as string;
  if (typeof commitMessage !== 'string' || commitMessage.trim().length === 0) {
    return { success: false, error: 'commitMessage is required and must be a non-empty string' };
  }

  // 1. Inspect changes.
  const status = await runProcess('git', ['status', '--porcelain'], {});
  if (!status.ok) return { success: false, error: `git status failed: ${status.stderr}` };

  const changedPaths = status.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3));

  if (changedPaths.length === 0) {
    return { success: false, error: 'nothing to commit — working tree is clean' };
  }

  // 2. Enforce allowlist.
  const offenders = changedPaths.filter((p) => !isPathAllowed(p));
  if (offenders.length > 0) {
    return {
      success: false,
      error: `refusing to commit — these paths are outside the node-builder allowlist: ${offenders.join(', ')}`,
    };
  }

  // 3. Stage the already-validated changed paths. (Don't stage the whole
  //    allowlist — some entries may not exist in the tree and `git add` errors.)
  const stage = await runProcess('git', ['add', ...changedPaths], {});
  if (!stage.ok) return { success: false, error: `git add failed: ${stage.stderr}` };

  // 4. Commit.
  const commit = await runProcess('git', ['commit', '-m', commitMessage], {});
  if (!commit.ok) return { success: false, error: `git commit failed: ${commit.stderr || commit.stdout}` };
  let log = commit.stdout;

  // 5. Push (unless test stubbed).
  if (process.env.NODE_BUILDER_SKIP_PUSH !== '1') {
    const push = await runProcess('git', ['push', 'origin', 'master'], { timeoutMs: 60_000 });
    log += `\n${push.stdout}\n${push.stderr}`;
    if (!push.ok) return { success: true, data: { ok: false, log: `${log}\npush failed` } };
  }

  // 6. Deploy.
  const deployCmd = process.env.NODE_BUILDER_DEPLOY_CMD ?? './scripts/deploy.sh';
  const deploy = await runProcess(deployCmd, [], { timeoutMs: 5 * 60_000 });
  log += `\n${deploy.stdout}\n${deploy.stderr}`;
  if (!deploy.ok) return { success: true, data: { ok: false, log } };

  // 7. Live verification.
  const verifyUrl = process.env.NODE_BUILDER_VERIFY_URL ?? 'https://strangeramblings.com';
  if (verifyUrl) {
    const curl = await runProcess('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', verifyUrl], {
      timeoutMs: 30_000,
    });
    log += `\nverify ${verifyUrl} → ${curl.stdout}`;
    if (curl.stdout.trim() !== '200') {
      return { success: true, data: { ok: false, deployUrl: verifyUrl, log } };
    }
  }

  return {
    success: true,
    data: {
      ok: true,
      deployUrl: verifyUrl || undefined,
      log,
    },
  };
},
```

- [ ] **Step 3: Run tests**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/workflows/site-tools/node-builder.test.ts -t commit_and_deploy --reporter=verbose 2>&1 | tail -25
```

Expected: all 4 commit_and_deploy tests pass.

- [ ] **Step 4: Run the entire node-builder test file once more**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/workflows/site-tools/node-builder.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: every test passes. Approx 20 tests total across the 7 tools.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/site-tools/tools/node-builder.ts tests/lib/workflows/site-tools/node-builder.test.ts
git commit -m "feat(node-builder): implement node_builder_commit_and_deploy with path-allowlist gate"
```

---

## Task 9: End-to-end smoke via curl against /api/mcp

- [ ] **Step 1: Start dev server**

```bash
cd ~/strange_rambling_svelte
npm run dev &
sleep 8
```

- [ ] **Step 2: Verify all 7 tools list correctly**

```bash
HERMES_BRIDGE_SECRET=$(grep -E '^HERMES_BRIDGE_SECRET=' .env | cut -d= -f2- | tr -d '"')
curl -sS http://localhost:5173/api/mcp -X POST \
  -H "Authorization: Bearer $HERMES_BRIDGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | python3 -c "import json, sys; d = json.load(sys.stdin); print('\n'.join(sorted(t['name'] for t in d['result']['tools'] if t['name'].startswith('node_builder_'))))"
```

Expected: 7 tool names, one per line, alphabetical.

- [ ] **Step 3: Call `node_builder_check_clean` via MCP**

```bash
curl -sS http://localhost:5173/api/mcp -X POST \
  -H "Authorization: Bearer $HERMES_BRIDGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"node_builder_check_clean","arguments":{}}}' \
  | python3 -m json.tool | tail -20
```

Expected: a JSON-RPC response with `result.content` containing `{ ok: true }` (assuming the working tree is currently clean — verify with `git status` if not).

- [ ] **Step 4: Call `node_builder_list_existing` via MCP**

```bash
curl -sS http://localhost:5173/api/mcp -X POST \
  -H "Authorization: Bearer $HERMES_BRIDGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"node_builder_list_existing","arguments":{}}}' \
  | python3 -m json.tool | head -40
```

Expected: a `result` payload containing `data.nodes` with at least 10 entries.

- [ ] **Step 5: Tear down dev server**

```bash
kill %1
wait 2>/dev/null
```

- [ ] **Step 6: No new commit for Task 9 — purely verification.**

---

## Task 10: Final whole-repo check + push

- [ ] **Step 1: Full test suite**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run --reporter=dot 2>&1 | tail -5
```

Expected: ~20 new tests added (Phase 2's node-builder.test.ts), still only the 2 pre-existing failures from baseline.

- [ ] **Step 2: Full typecheck**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -3
```

Expected: 0 errors.

- [ ] **Step 3: Push**

```bash
git push origin master
```

Phase 2 is complete. The 7 MCP tools are live and reachable from any MCP client with a valid bearer token. Phase 3 (`jkai-node-builder` SKILL.md) is the next plan to write.
