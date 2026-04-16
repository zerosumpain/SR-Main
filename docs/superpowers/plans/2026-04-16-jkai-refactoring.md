# JKai Chat Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the JKai chat system to improve maintainability, reduce duplication, and increase reliability — covering 11 issues from the code review.

**Architecture:** Extract focused modules from the 1221-line orchestrator god class and 342-line chat endpoint. Register HA tools through the existing tool registry instead of hardcoded switch blocks. Deduplicate shared queries. Add DB persistence for the in-memory job store and follow-up queue. Fix silent error swallowing and cache LLM clients.

**Tech Stack:** SvelteKit, Drizzle ORM (PostgreSQL), Vitest, OpenAI SDK (Z.AI compatible)

---

## File Structure

### New files to create:
- `src/lib/jkai/planner.ts` — Planning debate + re-planning logic extracted from orchestrator
- `src/lib/jkai/executor.ts` — Iteration execution loop extracted from orchestrator
- `src/lib/jkai/test-runner.ts` — Test detection + running extracted from orchestrator
- `src/lib/jkai/llm-client.ts` — Cached LLM client factory
- `src/lib/jkai/queries.ts` — Shared conversation list query
- `src/lib/workflows/chat/job-store.ts` — Job queue lifecycle (in-memory, refactored from chat endpoint)
- `src/lib/workflows/chat/conversation-history.ts` — Shared conversation history loading
- `src/lib/workflows/site-tools/tools/home-assistant.ts` — HA tools registered via the standard registry
- `tests/lib/jkai/llm-client.test.ts` — Tests for cached LLM client
- `tests/lib/jkai/queries.test.ts` — Tests for shared query
- `tests/lib/jkai/test-runner.test.ts` — Tests for test runner extraction
- `tests/lib/jkai/orchestrator-helpers.test.ts` — Tests for failOrphanedIterations
- `tests/lib/workflows/chat/job-store.test.ts` — Tests for job store
- `tests/lib/workflows/chat/conversation-history.test.ts` — Tests for history loading
- `tests/lib/workflows/site-tools/tools/home-assistant.test.ts` — Tests for HA tool registration

### Files to modify:
- `src/lib/jkai/orchestrator.ts` — Slim down to coordinator that imports planner, executor, test-runner
- `src/lib/workflows/chat/general-chat.ts` — Remove HA switch block, use registry; add logging to catch blocks
- `src/routes/api/workflows/orchestrator/chat/+server.ts` — Use job-store and conversation-history modules
- `src/routes/jkai/+page.server.ts` — Use shared query from queries.ts
- `src/routes/api/jkai/conversations/+server.ts` — Use shared query from queries.ts
- `src/lib/workflows/site-tools/registry.ts` — Import new HA tool module, remove synthetic manifest entry
- `src/lib/workflows/site-tools/llm-tools.ts` — Remove HA special-casing if any remains
- `src/lib/workflows/chat/followup-queue.ts` — Add logging for persistence awareness (actual DB persistence is medium priority, deferred to a later task set)

---

## Task Dependency Order

Tasks 1-6 are **HIGH priority** (orchestrator split + deduplication).
Tasks 7-8 are **MEDIUM priority** (HA registry + conversation query).
Tasks 9-11 are **LOW priority** (caching, logging, polling).

Each task is independently committable and testable.

---

### Task 1: Extract LLM Client Cache (`llm-client.ts`)

**Files:**
- Create: `src/lib/jkai/llm-client.ts`
- Create: `tests/lib/jkai/llm-client.test.ts`
- Modify: `src/lib/jkai/orchestrator.ts:67-76` (replace `getLLMClient`)

This extracts the `getLLMClient()` function from orchestrator.ts into its own module with a simple TTL cache. Currently a new OpenAI instance + `loadKeys()` call happens every time.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/jkai/llm-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock loadKeys before importing the module under test
vi.mock('$lib/deepdive/keys', () => ({
  loadKeys: vi.fn(() => ({
    zaiApiKey: 'test-key-123',
    zaiBaseUrl: 'https://test.api.z.ai/v4/',
    zaiModel: 'test-model',
  })),
}));

// Mock OpenAI constructor
vi.mock('openai', () => ({
  default: class MockOpenAI {
    apiKey: string;
    baseURL: string;
    constructor(opts: { apiKey: string; baseURL: string }) {
      this.apiKey = opts.apiKey;
      this.baseURL = opts.baseURL;
    }
  },
}));

import { getLLMClient, clearLLMClientCache } from '$lib/jkai/llm-client';
import { loadKeys } from '$lib/deepdive/keys';

describe('getLLMClient', () => {
  beforeEach(() => {
    clearLLMClientCache();
    vi.clearAllMocks();
  });

  it('returns a client and model', () => {
    const { client, model } = getLLMClient();
    expect(client).toBeDefined();
    expect(model).toBe('test-model');
  });

  it('caches the client on repeated calls', () => {
    const first = getLLMClient();
    const second = getLLMClient();
    expect(first.client).toBe(second.client);
    expect(loadKeys).toHaveBeenCalledTimes(1);
  });

  it('throws when no API key configured', () => {
    vi.mocked(loadKeys).mockReturnValueOnce({
      zaiApiKey: '',
      zaiBaseUrl: '',
      zaiModel: '',
    } as any);
    clearLLMClientCache();
    expect(() => getLLMClient()).toThrow('Z.AI API key not configured');
  });

  it('refreshes after clearLLMClientCache', () => {
    getLLMClient();
    clearLLMClientCache();
    getLLMClient();
    expect(loadKeys).toHaveBeenCalledTimes(2);
  });

  it('defaults model to glm-4-plus when not set', () => {
    vi.mocked(loadKeys).mockReturnValueOnce({
      zaiApiKey: 'key',
      zaiBaseUrl: '',
      zaiModel: '',
    } as any);
    clearLLMClientCache();
    const { model } = getLLMClient();
    expect(model).toBe('glm-4-plus');
  });

  it('defaults baseURL when not set', () => {
    vi.mocked(loadKeys).mockReturnValueOnce({
      zaiApiKey: 'key',
      zaiBaseUrl: '',
      zaiModel: 'x',
    } as any);
    clearLLMClientCache();
    const { client } = getLLMClient();
    expect((client as any).baseURL).toBe('https://api.z.ai/api/coding/paas/v4/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/jkai/llm-client.test.ts`
Expected: FAIL — module `$lib/jkai/llm-client` does not exist

- [ ] **Step 3: Write the implementation**

Create `src/lib/jkai/llm-client.ts`:

```typescript
import OpenAI from 'openai';
import { loadKeys } from '$lib/deepdive/keys';

const DEFAULT_BASE_URL = 'https://api.z.ai/api/coding/paas/v4/';
const DEFAULT_MODEL = 'glm-4-plus';

let cached: { client: OpenAI; model: string } | null = null;

export function getLLMClient(): { client: OpenAI; model: string } {
  if (cached) return cached;

  const keys = loadKeys();
  if (!keys.zaiApiKey) throw new Error('Z.AI API key not configured');

  const client = new OpenAI({
    apiKey: keys.zaiApiKey,
    baseURL: keys.zaiBaseUrl || DEFAULT_BASE_URL,
  });
  const model = keys.zaiModel || DEFAULT_MODEL;

  cached = { client, model };
  return cached;
}

export function clearLLMClientCache(): void {
  cached = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/jkai/llm-client.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Update orchestrator.ts to use the new module**

In `src/lib/jkai/orchestrator.ts`, replace the local `getLLMClient` function (lines 65-76) and its `OpenAI`/`loadKeys` imports:

Remove:
```typescript
import OpenAI from 'openai';
import { loadKeys } from '$lib/deepdive/keys';
```
and the `getLLMClient` function definition (lines 67-76).

Add import:
```typescript
import { getLLMClient } from './llm-client';
```

- [ ] **Step 6: Verify the build still passes**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/jkai/llm-client.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/jkai/llm-client.ts tests/lib/jkai/llm-client.test.ts src/lib/jkai/orchestrator.ts
git commit -m "refactor: extract cached LLM client from orchestrator"
```

---

### Task 2: Extract `failOrphanedIterations` Helper

**Files:**
- Modify: `src/lib/jkai/orchestrator.ts`
- Create: `tests/lib/jkai/orchestrator-helpers.test.ts`

The pattern `db.update(jkaiIterations).set({ status: 'failed' }).where(and(eq(buildId), eq(status, 'running')))` appears 4 times in the orchestrator. Extract it.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/jkai/orchestrator-helpers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We'll test that failOrphanedIterations calls db.update with the right args.
// Since the helper uses Drizzle directly, we mock the db module.

const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  }),
});

vi.mock('$lib/db', () => ({
  db: {
    update: (...args: any[]) => mockUpdate(...args),
  },
}));

vi.mock('$lib/db/schema', () => ({
  jkaiIterations: { buildId: 'buildId', status: 'status' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: any, b: any) => ({ _eq: [a, b] }),
  and: (...args: any[]) => ({ _and: args }),
}));

import { failOrphanedIterations } from '$lib/jkai/orchestrator-helpers';

describe('failOrphanedIterations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls db.update on jkaiIterations', async () => {
    await failOrphanedIterations('build-123');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('sets status to failed', async () => {
    await failOrphanedIterations('build-123');
    const setCall = mockUpdate.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith({ status: 'failed' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/jkai/orchestrator-helpers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/lib/jkai/orchestrator-helpers.ts`:

```typescript
import { db } from '$lib/db';
import { jkaiIterations } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Mark any running iterations for the given build as failed.
 * Used during pause, resume, continue, and startup recovery to
 * clean up iterations that were interrupted mid-flight.
 */
export async function failOrphanedIterations(buildId: string): Promise<void> {
  await db
    .update(jkaiIterations)
    .set({ status: 'failed' })
    .where(
      and(
        eq(jkaiIterations.buildId, buildId),
        eq(jkaiIterations.status, 'running'),
      ),
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/jkai/orchestrator-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Replace all 4 duplicates in orchestrator.ts**

In `src/lib/jkai/orchestrator.ts`, add the import:

```typescript
import { failOrphanedIterations } from './orchestrator-helpers';
```

Then replace each of the 4 occurrences of:
```typescript
await db
  .update(jkaiIterations)
  .set({ status: 'failed' })
  .where(
    and(
      eq(jkaiIterations.buildId, buildId),
      eq(jkaiIterations.status, 'running'),
    ),
  );
```

with:
```typescript
await failOrphanedIterations(buildId);
```

These occur in: `pauseBuild`, `resumeBuild`, `continueBuild`, and `recoverOnStartup`.

- [ ] **Step 6: Verify no regressions**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/jkai/orchestrator-helpers.ts tests/lib/jkai/orchestrator-helpers.test.ts src/lib/jkai/orchestrator.ts
git commit -m "refactor: extract failOrphanedIterations to eliminate 4x duplication"
```

---

### Task 3: Extract Test Runner from Orchestrator

**Files:**
- Create: `src/lib/jkai/test-runner.ts`
- Create: `tests/lib/jkai/test-runner.test.ts`
- Modify: `src/lib/jkai/orchestrator.ts` (remove `runTests` method, import from test-runner)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/jkai/test-runner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecInSandbox = vi.fn();
const mockEmitLog = vi.fn();

vi.mock('$lib/jkai/sandbox', () => ({
  execInSandbox: (...args: any[]) => mockExecInSandbox(...args),
}));

// We need to mock emitLog — it lives in orchestrator.ts currently but we'll
// accept it as a callback parameter to keep test-runner independent.

import { runTests } from '$lib/jkai/test-runner';

describe('runTests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns passed=true with no tests when no test files exist', async () => {
    // test -f run.sh → NO
    mockExecInSandbox.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 });
    // find test files → none
    mockExecInSandbox.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });

    const result = await runTests('build-1', '/home/jkai/workspace/build-1/dev');
    expect(result.passed).toBe(true);
    expect(result.testCount).toBe(0);
    expect(result.output).toBe('No tests found');
  });

  it('detects pytest results', async () => {
    // test -f run.sh → YES
    mockExecInSandbox.mockResolvedValueOnce({ stdout: 'YES', stderr: '', exitCode: 0 });
    // run tests
    mockExecInSandbox.mockResolvedValueOnce({
      stdout: '3 passed, 1 failed',
      stderr: '',
      exitCode: 1,
    });

    const result = await runTests('build-1', '/home/jkai/workspace/build-1/dev');
    expect(result.passed).toBe(false);
    expect(result.testCount).toBe(4);
    expect(result.failCount).toBe(1);
  });

  it('detects node:test results', async () => {
    mockExecInSandbox.mockResolvedValueOnce({ stdout: 'YES', stderr: '', exitCode: 0 });
    mockExecInSandbox.mockResolvedValueOnce({
      stdout: '# tests 5\n# pass 5\n# fail 0',
      stderr: '',
      exitCode: 0,
    });

    const result = await runTests('build-1', '/home/jkai/workspace/build-1/dev');
    expect(result.passed).toBe(true);
    expect(result.testCount).toBe(5);
    expect(result.failCount).toBe(0);
  });

  it('auto-creates run.sh for pytest when no runner exists', async () => {
    // No run.sh
    mockExecInSandbox.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 });
    // find any test files → yes
    mockExecInSandbox.mockResolvedValueOnce({ stdout: 'tests/test_main.py', stderr: '', exitCode: 0 });
    // find pytest files → yes
    mockExecInSandbox.mockResolvedValueOnce({ stdout: 'tests/test_main.py', stderr: '', exitCode: 0 });
    // find node test files → no
    mockExecInSandbox.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    // create run.sh
    mockExecInSandbox.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    // run tests
    mockExecInSandbox.mockResolvedValueOnce({ stdout: '2 passed', stderr: '', exitCode: 0 });

    const result = await runTests('build-1', '/home/jkai/workspace/build-1/dev');
    expect(result.passed).toBe(true);
    expect(result.testCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/jkai/test-runner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/lib/jkai/test-runner.ts`:

```typescript
import { execInSandbox } from './sandbox';

// Strip null bytes and other control chars that break Postgres text columns
function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

export interface TestRunResult {
  passed: boolean;
  output: string;
  testCount: number;
  failCount: number;
}

export async function runTests(buildId: string, workdir: string): Promise<TestRunResult> {
  // Check if tests/run.sh exists
  const hasRunner = await execInSandbox(`test -f ${workdir}/tests/run.sh && echo YES`, 5000);
  if (hasRunner.stdout.trim() !== 'YES') {
    // Check for any test files
    const hasTests = await execInSandbox(
      `find ${workdir}/tests -name "test_*.py" -o -name "*.test.js" -o -name "*.test.ts" 2>/dev/null | head -1`,
      5000,
    );
    if (!hasTests.stdout.trim()) {
      return { passed: true, output: 'No tests found', testCount: 0, failCount: 0 };
    }
    // Auto-detect test runner
    const hasPytest = await execInSandbox(`find ${workdir}/tests -name "test_*.py" | head -1`, 5000);
    const hasNodeTest = await execInSandbox(`find ${workdir}/tests -name "*.test.js" -o -name "*.test.ts" | head -1`, 5000);

    if (hasPytest.stdout.trim()) {
      await execInSandbox(`echo 'cd ${workdir} && python3 -m pytest tests/ -v --tb=short 2>&1' > ${workdir}/tests/run.sh`, 5000);
    } else if (hasNodeTest.stdout.trim()) {
      await execInSandbox(`echo 'cd ${workdir} && node --test tests/ 2>&1' > ${workdir}/tests/run.sh`, 5000);
    }
  }

  // Run tests
  const result = await execInSandbox(`bash ${workdir}/tests/run.sh 2>&1`, 120000);
  const output = sanitize((result.stdout + '\n' + result.stderr).trim());

  // Parse results — look for common test output patterns
  let testCount = 0;
  let failCount = 0;

  // pytest pattern: "X passed, Y failed"
  const pytestMatch = output.match(/(\d+) passed/);
  const pytestFail = output.match(/(\d+) failed/);
  if (pytestMatch) testCount += parseInt(pytestMatch[1]);
  if (pytestFail) { failCount += parseInt(pytestFail[1]); testCount += failCount; }

  // node:test pattern: "# tests X" "# fail Y"
  const nodeTestMatch = output.match(/# tests (\d+)/);
  const nodeFailMatch = output.match(/# fail (\d+)/);
  if (nodeTestMatch) testCount = parseInt(nodeTestMatch[1]);
  if (nodeFailMatch) failCount = parseInt(nodeFailMatch[1]);

  // Generic: count lines with PASS/FAIL/ok/not ok
  if (testCount === 0) {
    const passLines = (output.match(/\b(PASS|ok |✓|passed)\b/gi) || []).length;
    const failLines = (output.match(/\b(FAIL|not ok|✗|failed|ERROR)\b/gi) || []).length;
    testCount = passLines + failLines;
    failCount = failLines;
  }

  const passed = result.exitCode === 0 && failCount === 0;

  return { passed, output: output.slice(0, 5000), testCount, failCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/jkai/test-runner.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Update orchestrator.ts to use the new module**

In `src/lib/jkai/orchestrator.ts`:

1. Add import: `import { runTests } from './test-runner';`
2. Also import `TestRunResult` type: `import type { TestRunResult } from './test-runner';`
3. Delete the entire `private async runTests(...)` method (lines 1156-1218).
4. Update the call site in `runIteration` (around line 851). Change:
   ```typescript
   const testResult = await this.runTests(buildId, iteration.id);
   ```
   to:
   ```typescript
   await emitLog(buildId, 'system', 'Running tests...', iteration.id);
   const testResult = await runTests(buildId, `/home/jkai/workspace/${buildId}/dev`);
   const emoji = testResult.passed ? 'PASS' : 'FAIL';
   const testSummary = `${emoji} Tests: ${testResult.testCount - testResult.failCount}/${testResult.testCount} passed${testResult.failCount > 0 ? ` (${testResult.failCount} failed)` : ''}`;
   await emitLog(buildId, testResult.passed ? 'system' : 'error', `${testSummary}\n${testResult.output.slice(0, 2000)}`, iteration.id);
   ```

- [ ] **Step 6: Run all tests**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/jkai/test-runner.ts tests/lib/jkai/test-runner.test.ts src/lib/jkai/orchestrator.ts
git commit -m "refactor: extract test runner from orchestrator into standalone module"
```

---

### Task 4: Extract Planner from Orchestrator

**Files:**
- Create: `src/lib/jkai/planner.ts`
- Modify: `src/lib/jkai/orchestrator.ts` (remove `planBuild` and `replanBuild` methods)

This is the largest extraction — ~400 lines of planning debate and re-planning logic.

- [ ] **Step 1: Create the planner module**

Create `src/lib/jkai/planner.ts` by moving the `planBuild` and `replanBuild` methods out of the orchestrator class. They need access to `emitLog` and `getLLMClient`, both of which are already module-level functions. The key change: these become standalone `async function` exports instead of private methods.

```typescript
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getLLMClient } from './llm-client';
import { listWorkspaceFiles } from './sandbox';
import { emitLog } from './log-emitter';

// --- System Prompts ---

const PROPOSER_SYSTEM_PROMPT = `You are a senior software architect creating a project delivery plan. You produce plans only — no code.

Given a project objective, write a delivery plan covering:
- Architecture: technology choices, key components, data flow
- UI Design: layout approach, design system choices, key screens and interactions
- Iteration Plan: 5 iterations, each scoped to approximately 15 code execution steps
- For each iteration: goal, deliverables, milestone (what the user sees), and tests

CONSTRAINTS YOUR PLAN MUST RESPECT:
1. CLIENT-SIDE FIRST: The project is published as a static site. All data fetching must happen in the browser via fetch(). No server-side routes as primary data sources. Use public APIs directly, with the CORS proxy (/api/jkai/cors/{encoded-url}) if needed.
2. REAL DATA ONLY: Every data source must be a real, public API or dataset. Name the specific API and endpoint URL (e.g., Open-Meteo, REST Countries, Wikipedia API). Never propose placeholder or hardcoded data.
3. ITERATION SIZING: Each iteration must be completable in ~15 shell/code execution steps. Iteration 1 must produce a visible, served page — even a skeleton. No iteration should attempt to build the complete feature set.
4. STATIC SERVING: The dev server is a lightweight static server (python3 -m http.server or npx serve). All app logic must work when files are served statically.

Format your response as:

## Architecture
(tech stack, components, data flow — 3-5 sentences)

## UI Design
(layout approach, design system, key screens — 3-5 sentences)

## Iteration Plan

### Iteration 1: [title]
- Goal: [one sentence]
- Deliverables: [bullet list]
- Tests: [what to test]
- Milestone: [what the user sees at the end]

### Iteration 2: [title]
(same format — through Iteration 5)

## Risks & Mitigations
(2-3 key risks and how to handle them)`;

const CRITIC_SYSTEM_PROMPT = `You are a rigorous technical reviewer stress-testing a project delivery plan. Your job is to find real problems, not to validate. Be specific — cite the exact part of the plan that is problematic.

Evaluate the proposed plan across these SIX dimensions:

1. CLIENT-SIDE ARCHITECTURE: Does the plan violate the static publishing constraint? Look for: server-side routes as primary data sources, backend frameworks (Flask, Express) doing data fetching, environment variables for runtime config, assumptions that a server process persists between requests. Flag each with "VIOLATION:" and explain why it breaks static publishing.

2. DATA SOURCING: Are all proposed APIs real, public, and CORS-accessible from a browser? Look for: vague descriptions ("use an API"), APIs requiring server-side auth, APIs with CORS restrictions without proxy support, placeholder data. For each questionable source, suggest a specific replacement with a concrete API URL.

3. ITERATION SCOPING: Is each iteration realistically completable in ~15 code execution steps? Look for: iterations that build too much at once, iteration 1 not delivering a served page, unclear milestones, cascading dependencies. Flag oversized iterations with "OVERSIZED:" and suggest how to split them.

4. TECHNICAL FEASIBILITY: Are the technology choices viable in a sandboxed Linux environment with Python 3.12, Node 22, and internet access? Look for: packages requiring native compilation, UI frameworks needing a build step without one, unnecessarily complex patterns. Flag each with "INFEASIBLE:" and explain what won't work.

5. USER EXPERIENCE: Is the proposed UI genuinely compelling, or is it a generic dashboard/list page? Look for: lack of visual identity, no interactive elements beyond basic filtering, missing animations or transitions, no clear design inspiration, cookie-cutter layouts that any AI would produce. Flag bland designs with "BLAND:" and suggest specific ways to make the experience more distinctive and engaging — a unique visual concept, a memorable interaction pattern, an unexpected layout approach.

6. INNOVATION: Is the approach creative or just the obvious solution? Look for: standard CRUD patterns where something more inventive would serve the user better, missed opportunities for visualisation or storytelling, generic data displays when the data could be presented in a novel way. Flag missed opportunities with "OBVIOUS:" and suggest a more ambitious or creative alternative that would make this project genuinely interesting.

End your review with:

## Summary of Issues
(numbered list of critical problems, ranked by severity)

## Recommended Changes
(concrete, actionable fixes for each critical issue — specific replacements, not vague suggestions)`;

/**
 * Run a 3-round planning debate (propose → critique → revise) and store
 * the result as iteration #0 for the given build.
 */
export async function planBuild(
  buildId: string,
  prompt: string,
  timeLimitMs: number = 4 * 60 * 1000,
): Promise<void> {
  const { client, model } = getLLMClient();
  const deadline = Date.now() + timeLimitMs;

  const [planIteration] = await db
    .insert(jkaiIterations)
    .values({ buildId, number: 0, status: 'running' })
    .returning();

  await emitLog(buildId, 'system', '━━━ Planning Phase (3-round debate) ━━━', planIteration.id);

  const debateMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let totalTokens = 0;
  let bestPlan: string | null = null;
  const startMs = Date.now();

  function checkDeadline(phase: string): void {
    if (Date.now() >= deadline) {
      throw new Error(`Planning time limit exceeded before ${phase} (limit: ${timeLimitMs / 1000}s)`);
    }
  }

  try {
    // Round 1: Proposer
    await emitLog(buildId, 'system', 'Round 1/3 — Proposer drafting initial plan...', planIteration.id);

    const userPromptMsg = `Project objective:\n${prompt}\n\nProduce your initial delivery plan following the required format.`;

    const r1 = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: PROPOSER_SYSTEM_PROMPT },
        { role: 'user', content: userPromptMsg },
      ],
      temperature: 0.7,
      max_tokens: 3000,
    });

    const proposal = r1.choices[0]?.message?.content || '';
    totalTokens += r1.usage?.total_tokens || 0;
    debateMessages.push({ role: 'user', content: userPromptMsg });
    debateMessages.push({ role: 'assistant', content: proposal });

    bestPlan = proposal;
    await emitLog(buildId, 'text', proposal, planIteration.id);
    await db
      .update(jkaiIterations)
      .set({ messages: debateMessages, tokensUsed: totalTokens })
      .where(eq(jkaiIterations.id, planIteration.id));

    // Round 2: Critic
    checkDeadline('Critic review');
    await emitLog(buildId, 'system', 'Round 2/3 — Critic reviewing plan...', planIteration.id);

    const r2 = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: CRITIC_SYSTEM_PROMPT },
        ...debateMessages,
      ],
      temperature: 0.6,
      max_tokens: 2500,
    });

    const critique = r2.choices[0]?.message?.content || '';
    totalTokens += r2.usage?.total_tokens || 0;
    debateMessages.push({ role: 'user', content: `[Critic review]\n\n${critique}` });

    await emitLog(buildId, 'thinking', critique, planIteration.id);
    await db
      .update(jkaiIterations)
      .set({ messages: debateMessages, tokensUsed: totalTokens })
      .where(eq(jkaiIterations.id, planIteration.id));

    // Round 3: Proposer revision
    checkDeadline('Proposer revision');
    await emitLog(buildId, 'system', 'Round 3/3 — Proposer revising based on critique...', planIteration.id);

    const revisionInstruction = `The critic above has reviewed your plan across six dimensions. Address all critical issues raised.

For each "VIOLATION:", "OVERSIZED:", "BLAND:", "OBVIOUS:", "INFEASIBLE:", or critical issue: make a concrete fix. If the critic suggested a specific replacement, use it. If an iteration is oversized, split or descope it. If the design was flagged as bland, make it distinctive. If the approach was flagged as obvious, make it more creative and ambitious.

Start with a ## Changes Made section listing each marker you received and what you changed in response. Then produce the complete revised plan:

## Changes Made
(For each marker: [marker + issue] → [what you changed])

## Architecture
## UI Design
## Iteration Plan
### Iteration 1 through 5 (same structure as before)
## Risks & Mitigations

Be specific — name exact APIs with endpoint URLs, exact CDN URLs for libraries, exact file structure for Iteration 1.`;

    debateMessages.push({ role: 'user', content: revisionInstruction });

    const r3 = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: PROPOSER_SYSTEM_PROMPT },
        ...debateMessages,
      ],
      temperature: 0.7,
      max_tokens: 3000,
    });

    const finalPlan = r3.choices[0]?.message?.content || '';
    totalTokens += r3.usage?.total_tokens || 0;
    bestPlan = finalPlan;
    debateMessages.push({ role: 'assistant', content: finalPlan });

    await emitLog(buildId, 'text', finalPlan, planIteration.id);

    const durationMs = Date.now() - startMs;
    const debateSummary = [
      `Planning debate: 3 rounds, ${totalTokens} tokens, ${Math.round(durationMs / 1000)}s.`,
      '',
      'Critic review highlights:',
      critique.slice(0, 800),
    ].join('\n');

    await db
      .update(jkaiIterations)
      .set({
        status: 'completed',
        goals: 'Project planning — 3-round debate (propose → critique → revise)',
        plan: finalPlan,
        evaluation: debateSummary,
        messages: debateMessages,
        tokensUsed: totalTokens,
        durationMs,
        actions: [],
      })
      .where(eq(jkaiIterations.id, planIteration.id));

    await emitLog(buildId, 'system', `━━━ Planning Phase Complete (${Math.round(durationMs / 1000)}s, 3 rounds) ━━━`, planIteration.id);
  } catch (err: any) {
    const durationMs = Date.now() - startMs;
    await emitLog(buildId, 'error', `Planning failed: ${err.message}`, planIteration.id);
    await db
      .update(jkaiIterations)
      .set({
        status: bestPlan ? 'completed' : 'failed',
        plan: bestPlan,
        messages: debateMessages,
        tokensUsed: totalTokens,
        durationMs,
      })
      .where(eq(jkaiIterations.id, planIteration.id));
  }
}

/**
 * After completion is detected, review outcomes and decide whether
 * to continue with more iterations or mark the build as done.
 * Returns true if further iterations should run.
 */
export async function replanBuild(buildId: string): Promise<boolean> {
  const { client, model } = getLLMClient();

  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) return false;

  const completedIterations = await db
    .select()
    .from(jkaiIterations)
    .where(
      and(
        eq(jkaiIterations.buildId, buildId),
        eq(jkaiIterations.status, 'completed'),
      ),
    )
    .orderBy(jkaiIterations.number);

  const iterationSummaries = completedIterations
    .filter((it) => it.number > 0)
    .map((it) => `### Iteration ${it.number}\n${it.evaluation || 'No evaluation'}`)
    .join('\n\n');

  const fileList = await listWorkspaceFiles(buildId);

  await emitLog(buildId, 'system', '━━━ Re-planning Phase ━━━ Reviewing outcomes and considering further improvements');

  const replanPrompt = `You are a senior software architect reviewing a completed project.

The user's original objective was:
${build.prompt}

Here is a summary of all iterations completed so far:
${iterationSummaries}

Current workspace files:
${fileList || '(empty)'}

CONSTRAINTS (any new iterations must respect these):
1. CLIENT-SIDE FIRST: All data fetching must happen in the browser via fetch(). No server-side routes as primary data sources.
2. REAL DATA ONLY: Use real, public APIs. Name the specific API and endpoint URL.
3. ITERATION SIZING: Each iteration must be completable in ~15 code execution steps.
4. STATIC SERVING: All app logic must work when files are served statically.

Your task:
1. Review the original objective — has everything the user asked for been delivered?
2. Consider whether there are meaningful improvements, features, or polish that would significantly enhance the project beyond what was asked.
3. If you identify worthwhile further work, propose it as a new iteration plan (same format as before: ## Iteration Plan with numbered iterations). Ensure proposed iterations respect the constraints above.
4. If the project genuinely meets or exceeds the original objective and no further work would add significant value, say so clearly.

Respond with ONE of these two formats:

FORMAT A — Further work needed:
## Assessment
(What's been delivered vs. what was asked. Any gaps.)

## Iteration Plan
### Iteration [N]: [title]
- Goal: ...
- Deliverables: ...
(continue for each proposed iteration)

FORMAT B — Project complete:
## Assessment
(What's been delivered vs. what was asked.)

## Complete
No further iterations are needed. The project meets the stated objectives.`;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: replanPrompt }],
      temperature: 0.7,
      max_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content || '';
    await emitLog(buildId, 'text', content);

    const isComplete = content.includes('## Complete') ||
      (content.toLowerCase().includes('no further iterations') && !content.includes('## Iteration Plan'));

    if (isComplete) {
      await emitLog(buildId, 'system', '━━━ Project Complete ━━━ No further work identified.');
      return false;
    }

    // Extract the new plan and update plan iteration (#0)
    const newPlan = content.match(/## Iteration Plan[\s\S]*/)?.[0] || content;

    const [planIteration] = await db
      .select()
      .from(jkaiIterations)
      .where(
        and(
          eq(jkaiIterations.buildId, buildId),
          eq(jkaiIterations.number, 0),
        ),
      )
      .limit(1);

    if (planIteration) {
      await db
        .update(jkaiIterations)
        .set({ plan: newPlan, evaluation: content })
        .where(eq(jkaiIterations.id, planIteration.id));
    }

    await emitLog(buildId, 'system', '━━━ Re-planning Complete ━━━ New iterations proposed. Continuing build.');
    return true;
  } catch (err: any) {
    await emitLog(buildId, 'error', `Re-planning failed: ${err.message}. Stopping build.`);
    return false;
  }
}
```

Note: This requires `emitLog` to be accessible from outside the orchestrator. We'll extract it in this same step.

- [ ] **Step 2: Extract `emitLog` into a shared module**

Create `src/lib/jkai/log-emitter.ts`:

```typescript
import { db } from '$lib/db';
import { jkaiLogs } from '$lib/db/schema';
import { EventEmitter } from 'events';

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function onBuildLog(
  buildId: string,
  handler: (log: { id: number; type: string; content: string; iterationId: string | null }) => void,
): () => void {
  const key = `log:${buildId}`;
  emitter.on(key, handler);
  return () => emitter.off(key, handler);
}

// Strip null bytes and other control chars that break Postgres text columns
function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

export async function emitLog(
  buildId: string,
  type: string,
  content: string,
  iterationId: string | null = null,
): Promise<void> {
  const safeContent = sanitize(content);
  const [log] = await db
    .insert(jkaiLogs)
    .values({ buildId, iterationId, type, content: safeContent })
    .returning();
  emitter.emit(`log:${buildId}`, {
    id: log.id,
    type: log.type,
    content: log.content,
    iterationId: log.iterationId,
  });
}
```

- [ ] **Step 3: Update orchestrator.ts to import from planner and log-emitter**

In `src/lib/jkai/orchestrator.ts`:

1. Remove the `EventEmitter` import and the `emitter`, `onBuildLog`, `sanitize`, and `emitLog` definitions (lines 22-63).
2. Remove the `planBuild` method (lines 370-597) and `replanBuild` method (lines 601-730).
3. Remove the proposer/critic system prompt strings that were inside `planBuild`.
4. Add imports:
   ```typescript
   import { emitLog, onBuildLog } from './log-emitter';
   import { planBuild, replanBuild } from './planner';
   ```
5. Update `onBuildLog` export: change `export function onBuildLog` to just re-export from log-emitter:
   ```typescript
   export { onBuildLog } from './log-emitter';
   ```
6. In the `Orchestrator` class, change `await this.planBuild(...)` to `await planBuild(...)` and `await this.replanBuild(...)` to `await replanBuild(...)`.
7. In `replanBuild` call sites (in `runIteration`), the return value already drives whether to continue — the orchestrator just needs to handle the `false` case (set status to completed, clear activeBuildId). Move that logic into the orchestrator's `runIteration` method:
   ```typescript
   if (detectCompletion(result.evaluation)) {
     await emitLog(buildId, 'system', 'Completion detected — entering re-planning phase.');
     const shouldContinue = await replanBuild(buildId);
     if (!shouldContinue) {
       await db
         .update(jkaiBuilds)
         .set({ status: 'completed', updatedAt: new Date() })
         .where(eq(jkaiBuilds.id, buildId));
       this.activeBuildId = null;
       return;
     }
   }
   ```

- [ ] **Step 4: Verify the build and tests still pass**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/jkai/planner.ts src/lib/jkai/log-emitter.ts src/lib/jkai/orchestrator.ts
git commit -m "refactor: extract planner and log-emitter from orchestrator"
```

---

### Task 5: Extract Executor from Orchestrator

**Files:**
- Create: `src/lib/jkai/executor.ts`
- Modify: `src/lib/jkai/orchestrator.ts` (remove `executeIteration` method)

- [ ] **Step 1: Create the executor module**

Create `src/lib/jkai/executor.ts`. This moves `executeIteration` out of the orchestrator class. The function needs: build record, iteration record, previous iteration, project plan, iteration number. It returns the same result shape.

```typescript
import { db } from '$lib/db';
import { jkaiIterations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getLLMClient } from './llm-client';
import { buildSystemPrompt, buildIterationContext } from './prompt';
import { execInSandboxChecked, listWorkspaceFiles } from './sandbox';
import { emitLog } from './log-emitter';
import type { ActionRecord } from './types';
import type { JkaiBuild, JkaiIteration } from '$lib/db/schema';

const FENCE_REGEX = /```(bash|python|sh|javascript|typescript|node)\n([\s\S]*?)```/;

function extractCodeBlock(text: string): { lang: string; code: string } | null {
  const match = text.match(FENCE_REGEX);
  if (!match) return null;
  return { lang: match[1], code: match[2].trimEnd() };
}

function hasEvaluation(text: string): boolean {
  return text.includes('## Evaluation');
}

function extractSection(text: string, header: string): string | null {
  const regex = new RegExp(`## ${header}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

export interface IterationResult {
  goals: string | null;
  plan: string | null;
  actions: ActionRecord[];
  messages: Array<{ role: string; content: string }>;
  evaluation: string | null;
  nextSteps: string | null;
  tokensUsed: number;
}

export async function executeIteration(
  build: JkaiBuild,
  iteration: JkaiIteration,
  prevIteration: JkaiIteration | null,
  projectPlan: string | null,
  iterationNumber: number,
  isStopped: () => boolean,
): Promise<IterationResult> {
  const { client, model } = getLLMClient();
  const systemPrompt = buildSystemPrompt(build.id);
  const fileList = await listWorkspaceFiles(build.id);
  const contextMessages = buildIterationContext(build.prompt, prevIteration, fileList, projectPlan, iterationNumber);

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...contextMessages,
  ];

  const actions: ActionRecord[] = [];
  let goals: string | null = null;
  let plan: string | null = null;
  let evaluation: string | null = null;
  let nextSteps: string | null = null;
  let totalTokens = 0;
  const maxTurns = 20;
  const maxTokensPerIteration = 100000;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (isStopped()) break;

    // Progressive nudging toward evaluation
    if (turn >= 12 && !evaluation) {
      const turnsLeft = maxTurns - turn - 1;
      if (turnsLeft <= 0) {
        messages.push({
          role: 'user',
          content: 'This is your FINAL step. Write your ## Evaluation and ## Next Steps NOW. No code blocks.',
        });
      }
    }

    const response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    });

    const assistantContent = response.choices[0]?.message?.content || '';
    totalTokens += response.usage?.total_tokens || 0;

    // Check per-iteration token cap
    if (totalTokens >= maxTokensPerIteration && !hasEvaluation(assistantContent)) {
      await emitLog(build.id, 'system', `Token cap reached (${totalTokens} tokens). Forcing evaluation.`, iteration.id);
      messages.push({
        role: 'user',
        content: 'You have exceeded the token budget for this iteration. Write your ## Evaluation and ## Next Steps NOW. No more code blocks.',
      });
      const evalResponse = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 2048,
      });
      const evalContent = evalResponse.choices[0]?.message?.content || '';
      totalTokens += evalResponse.usage?.total_tokens || 0;
      evaluation = extractSection(evalContent, 'Evaluation') || `Iteration stopped at token cap (${totalTokens} tokens). ${actions.length} actions executed.`;
      nextSteps = extractSection(evalContent, 'Next Steps') || 'Continue from where this iteration left off.';
      await emitLog(build.id, 'text', evalContent || evaluation, iteration.id);
      break;
    }

    messages.push({ role: 'assistant', content: assistantContent });

    // Persist messages incrementally
    await db
      .update(jkaiIterations)
      .set({
        messages: messages.filter((m) => m.role !== 'system'),
        tokensUsed: totalTokens,
      })
      .where(eq(jkaiIterations.id, iteration.id));

    if (turn === 0) {
      goals = assistantContent.split('\n').slice(0, 5).join('\n');
      const codeStart = assistantContent.indexOf('```');
      plan = codeStart > 0 ? assistantContent.slice(0, codeStart).trim() : assistantContent;
    }

    // Check for evaluation
    if (hasEvaluation(assistantContent)) {
      evaluation = extractSection(assistantContent, 'Evaluation');
      nextSteps = extractSection(assistantContent, 'Next Steps');

      const textBeforeEval = assistantContent.split('## Evaluation')[0].trim();
      if (textBeforeEval) {
        await emitLog(build.id, 'text', textBeforeEval, iteration.id);
      }
      await emitLog(build.id, 'text', `## Evaluation\n${evaluation || ''}`, iteration.id);
      if (nextSteps) {
        await emitLog(build.id, 'text', `## Next Steps\n${nextSteps}`, iteration.id);
      }
      break;
    }

    // Check for code block
    const codeBlock = extractCodeBlock(assistantContent);
    if (codeBlock) {
      const textBefore = assistantContent.split('```')[0].trim();
      if (textBefore) {
        await emitLog(build.id, 'text', textBefore, iteration.id);
      }

      await emitLog(build.id, 'code', `\`\`\`${codeBlock.lang}\n${codeBlock.code}\n\`\`\``, iteration.id);

      const workdir = `/home/jkai/workspace/${build.id}/dev`;
      let execCmd: string;
      if (['python'].includes(codeBlock.lang)) {
        execCmd = `cd ${workdir} && cat > /tmp/jkai-code.py << 'JKAI_PYTHON_EOF'\n${codeBlock.code}\nJKAI_PYTHON_EOF\npython3 /tmp/jkai-code.py`;
      } else if (['javascript', 'typescript', 'node'].includes(codeBlock.lang)) {
        execCmd = `cd ${workdir} && cat > /tmp/jkai-code.js << 'JKAI_JS_EOF'\n${codeBlock.code}\nJKAI_JS_EOF\nnode /tmp/jkai-code.js`;
      } else {
        execCmd = `cd ${workdir}\n${codeBlock.code}`;
      }
      const execResult = await execInSandboxChecked(
        execCmd,
        codeBlock.code.includes('install') ? 300000 : 120000,
      );

      const action: ActionRecord = {
        lang: codeBlock.lang,
        code: codeBlock.code,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
      };
      actions.push(action);

      const outputStr = [
        execResult.stdout ? `stdout:\n${execResult.stdout}` : '',
        execResult.stderr ? `stderr:\n${execResult.stderr}` : '',
        `exit code: ${execResult.exitCode}`,
      ]
        .filter(Boolean)
        .join('\n');
      await emitLog(build.id, 'output', outputStr, iteration.id);

      const turnsRemaining = maxTurns - turn - 1;
      let outputMsg = `Command output (exit code ${execResult.exitCode}):\n${execResult.stdout}\n${execResult.stderr ? `stderr: ${execResult.stderr}` : ''}`;
      if (turnsRemaining <= 5 && turnsRemaining > 2) {
        outputMsg += `\n\n[${turnsRemaining} steps remaining — start wrapping up soon]`;
      } else if (turnsRemaining <= 2 && turnsRemaining > 0) {
        outputMsg += `\n\n[Only ${turnsRemaining} step(s) left — write your ## Evaluation and ## Next Steps next]`;
      }
      messages.push({ role: 'user', content: outputMsg });
    } else {
      // Plain text response
      await emitLog(build.id, 'text', assistantContent, iteration.id);

      const turnsLeft = maxTurns - turn - 1;
      let continueMsg = 'Continue with your next step. Write exactly ONE code block per response, or if you are done, write your ## Evaluation and ## Next Steps.';
      if (turnsLeft <= 5 && turnsLeft > 2) {
        continueMsg = `You have ${turnsLeft} steps remaining in this iteration. Start planning your evaluation. Continue with code or write your ## Evaluation and ## Next Steps.`;
      } else if (turnsLeft <= 2 && turnsLeft > 0) {
        continueMsg = `Only ${turnsLeft} step(s) left! Write your ## Evaluation and ## Next Steps now, or execute ONE final critical command.`;
      }
      messages.push({ role: 'user', content: continueMsg });
    }
  }

  // Synthesize evaluation if maxTurns exhausted
  if (!evaluation) {
    evaluation = `Iteration reached maximum turns (${maxTurns}) without completing evaluation. ${actions.length} actions were executed.`;
    nextSteps = 'Continue from where this iteration left off.';
    await emitLog(build.id, 'system', `Auto-evaluation: ${evaluation}`, iteration.id);
  }

  return { goals, plan, actions, messages: messages.filter((m) => m.role !== 'system'), evaluation, nextSteps, tokensUsed: totalTokens };
}
```

- [ ] **Step 2: Update orchestrator.ts**

In `src/lib/jkai/orchestrator.ts`:

1. Remove `extractCodeBlock`, `hasEvaluation`, `extractSection` helper functions (they're now in executor.ts).
2. Remove the `executeIteration` method from the `Orchestrator` class.
3. Keep `detectCompletion` in orchestrator.ts (it's used by `runIteration` to decide whether to trigger re-planning).
4. Add import: `import { executeIteration } from './executor';`
5. Update the call in `runIteration` from `this.executeIteration(...)` to `executeIteration(...)`, passing `() => this.stopped` as the `isStopped` callback:
   ```typescript
   const result = await executeIteration(build, iteration, prevIteration, projectPlan, iterationNumber, () => this.stopped);
   ```

- [ ] **Step 3: Verify**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/jkai/executor.ts src/lib/jkai/orchestrator.ts
git commit -m "refactor: extract iteration executor from orchestrator"
```

---

### Task 6: Extract Job Store and Conversation History

**Files:**
- Create: `src/lib/workflows/chat/job-store.ts`
- Create: `src/lib/workflows/chat/conversation-history.ts`
- Create: `tests/lib/workflows/chat/job-store.test.ts`
- Create: `tests/lib/workflows/chat/conversation-history.test.ts`
- Modify: `src/routes/api/workflows/orchestrator/chat/+server.ts`

- [ ] **Step 1: Write the job-store test**

Create `tests/lib/workflows/chat/job-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createJob, getJob, cancelJob, cancelAllRunning, cleanOldJobs } from '$lib/workflows/chat/job-store';

describe('job-store', () => {
  beforeEach(() => {
    // Cancel everything from previous tests
    cancelAllRunning('test cleanup');
    cleanOldJobs(0); // force clean all
  });

  it('creates a job with running status', () => {
    const { jobId, job } = createJob('hello');
    expect(jobId).toBeTruthy();
    expect(job.status).toBe('running');
    expect(job.message).toBe('hello');
  });

  it('retrieves a job by ID', () => {
    const { jobId } = createJob('test');
    const job = getJob(jobId);
    expect(job).toBeTruthy();
    expect(job!.status).toBe('running');
  });

  it('returns null for unknown job', () => {
    expect(getJob('nonexistent')).toBeNull();
  });

  it('cancels a running job', () => {
    const { jobId, job } = createJob('test');
    cancelJob(jobId);
    expect(job.status).toBe('cancelled');
    expect(job.error).toBe('Cancelled by user');
  });

  it('cancelAllRunning cancels all running jobs', () => {
    const { job: job1 } = createJob('a');
    const { job: job2 } = createJob('b');
    cancelAllRunning('superseded');
    expect(job1.status).toBe('cancelled');
    expect(job2.status).toBe('cancelled');
  });

  it('cancelAllRunning supersedes previous running jobs when creating new', () => {
    const { job: old } = createJob('old');
    cancelAllRunning('Superseded by new request');
    const { job: newJob } = createJob('new');
    expect(old.status).toBe('cancelled');
    expect(newJob.status).toBe('running');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/chat/job-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the job-store implementation**

Create `src/lib/workflows/chat/job-store.ts`:

```typescript
export interface ToolProgressStep {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error';
}

export interface OrchestratorJob {
  status: 'running' | 'done' | 'error' | 'cancelled';
  progress: string[];
  toolSteps: ToolProgressStep[];
  result?: Record<string, unknown>;
  error?: string;
  abortController: AbortController;
  startedAt: number;
  message: string;
}

const jobs = new Map<string, OrchestratorJob>();

export function createJob(message: string): { jobId: string; job: OrchestratorJob } {
  const jobId = crypto.randomUUID();
  const job: OrchestratorJob = {
    status: 'running',
    progress: [],
    toolSteps: [],
    abortController: new AbortController(),
    startedAt: Date.now(),
    message: message.slice(0, 100),
  };
  jobs.set(jobId, job);
  return { jobId, job };
}

export function getJob(jobId: string): OrchestratorJob | null {
  return jobs.get(jobId) ?? null;
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.abortController.abort();
  job.status = 'cancelled';
  job.error = 'Cancelled by user';
  job.result = { success: false, error: 'Cancelled by user' };
  return true;
}

export function cancelAllRunning(reason: string): void {
  for (const [id, job] of jobs) {
    if (job.status === 'running') {
      console.log(`[orchestrator] Cancelling job ${id}: ${reason}`);
      job.abortController.abort();
      job.status = 'cancelled';
      job.error = reason;
      job.result = { success: false, error: reason };
    }
  }
}

/**
 * Remove stale jobs. Pass maxAgeMs=0 to clear all non-running jobs (for tests).
 */
export function cleanOldJobs(maxAgeMs = 300000): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && (maxAgeMs === 0 || now - job.startedAt > maxAgeMs)) {
      jobs.delete(id);
    }
    // Force-cancel running jobs older than 10 min (zombie protection)
    if (job.status === 'running' && now - job.startedAt > 600000) {
      job.abortController.abort();
      job.status = 'error';
      job.error = 'Job timed out (10 min limit)';
      job.result = { success: false, error: job.error };
      jobs.delete(id);
    }
  }
}

export function deleteJob(jobId: string, delayMs = 30000): void {
  setTimeout(() => jobs.delete(jobId), delayMs);
}

export function listJobs(): Array<{
  id: string;
  status: string;
  message: string;
  startedAt: number;
  progressCount: number;
  elapsed: number;
}> {
  return Array.from(jobs.entries()).map(([id, job]) => ({
    id,
    status: job.status,
    message: job.message,
    startedAt: job.startedAt,
    progressCount: job.progress.length,
    elapsed: Date.now() - job.startedAt,
  }));
}
```

- [ ] **Step 4: Run job-store test to verify it passes**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/chat/job-store.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Write conversation-history module**

Create `src/lib/workflows/chat/conversation-history.ts`:

```typescript
import { db } from '$lib/db';
import { orchestratorChats, conversations, whatsappConversations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getChatHistory } from '$lib/workflows/orchestrator';

/**
 * Load conversation history for the general chat, merging WhatsApp messages
 * if the conversation is a WhatsApp continuation.
 */
export async function loadConversationHistory(
  conversationId?: string | null,
  workflowId?: string | null,
): Promise<Array<{ role: string; content: string }>> {
  if (conversationId) {
    const convMessages = await db
      .select({ role: orchestratorChats.role, content: orchestratorChats.content, createdAt: orchestratorChats.createdAt })
      .from(orchestratorChats)
      .where(eq(orchestratorChats.conversationId, conversationId))
      .orderBy(asc(orchestratorChats.createdAt));

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (conv?.whatsappPhoneNumber) {
      const waMessages = await db
        .select({ role: whatsappConversations.role, content: whatsappConversations.content, createdAt: whatsappConversations.createdAt })
        .from(whatsappConversations)
        .where(eq(whatsappConversations.phoneNumber, conv.whatsappPhoneNumber))
        .orderBy(asc(whatsappConversations.createdAt));

      const merged = [
        ...waMessages.map(m => ({ role: m.role, content: m.content, ts: m.createdAt.getTime() })),
        ...convMessages.map(m => ({ role: m.role, content: m.content, ts: m.createdAt.getTime() })),
      ].sort((a, b) => a.ts - b.ts);

      return merged.slice(-30).map(m => ({ role: m.role, content: m.content }));
    }

    return convMessages.slice(-30).map(m => ({ role: m.role, content: m.content }));
  }

  if (workflowId) {
    const history = await getChatHistory(workflowId);
    return history.map(h => ({ role: h.role, content: h.content }));
  }

  return [];
}
```

- [ ] **Step 6: Update the chat endpoint to use both modules**

Rewrite `src/routes/api/workflows/orchestrator/chat/+server.ts` to import from the new modules. The route file becomes thin dispatch logic:

Replace the imports and inline types/state at the top with:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateWorkflow, modifyWorkflow, saveWorkflowFromGenerated, getChatHistory } from '$lib/workflows/orchestrator';
import { generalChat } from '$lib/workflows/chat/general-chat';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, orchestratorChats, conversations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { createJob, getJob, cancelJob, cancelAllRunning, cleanOldJobs, deleteJob, listJobs } from '$lib/workflows/chat/job-store';
import { loadConversationHistory } from '$lib/workflows/chat/conversation-history';
```

Remove the `ToolProgressStep` interface, `OrchestratorJob` interface, `jobs` Map, `cancelAllRunning` function, and `cleanOldJobs` function from the file.

In `POST`, replace the job creation code with:
```typescript
cancelAllRunning('Superseded by new request');
cleanOldJobs();
const { jobId, job } = createJob(message);
```

In the general-chat branch of `POST`, replace the conversation history loading (lines 186-223) with:
```typescript
const conversationHistory = await loadConversationHistory(conversationId, workflowId);
```

In `GET`, replace job lookup with:
```typescript
const job = getJob(jobId);
if (!job) {
  return json({ error: 'Job not found' }, { status: 404 });
}
```

For listing jobs:
```typescript
if (!jobId) {
  return json({ jobs: listJobs() });
}
```

In `DELETE`, replace the cancellation with:
```typescript
if (!jobId) {
  cancelAllRunning('Cancelled by user');
  return json({ cancelled: true });
}
const cancelled = cancelJob(jobId);
if (!cancelled) {
  const job = getJob(jobId);
  return json({ error: job ? 'Job not running' : 'Job not found' }, { status: job ? 400 : 404 });
}
return json({ cancelled: true });
```

And use `deleteJob(jobId)` instead of `setTimeout(() => jobs.delete(jobId), 30000)` for the auto-cleanup on poll.

- [ ] **Step 7: Run all tests**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/workflows/chat/job-store.ts src/lib/workflows/chat/conversation-history.ts tests/lib/workflows/chat/job-store.test.ts src/routes/api/workflows/orchestrator/chat/+server.ts
git commit -m "refactor: extract job store and conversation history from chat endpoint"
```

---

### Task 7: Register HA Tools in the Standard Registry

**Files:**
- Create: `src/lib/workflows/site-tools/tools/home-assistant.ts`
- Modify: `src/lib/workflows/site-tools/registry.ts` (add import, remove synthetic manifest entry)
- Modify: `src/lib/workflows/chat/general-chat.ts` (remove HA switch block)
- Create: `tests/lib/workflows/site-tools/tools/home-assistant.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/site-tools/tools/home-assistant.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the HA service
const mockService = {
  queryState: vi.fn().mockResolvedValue({ success: true, data: { state: 'on' } }),
  callService: vi.fn().mockResolvedValue({ success: true, data: {} }),
  fireEvent: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getHistory: vi.fn().mockResolvedValue({ success: true, data: [] }),
  renderTemplate: vi.fn().mockResolvedValue({ success: true, data: { result: '20' } }),
};

vi.mock('$lib/workflows/homeassistant/service', () => ({
  getHomeAssistantService: () => mockService,
}));

// Mock the registry-internal to capture registrations
const registered: any[] = [];
vi.mock('$lib/workflows/site-tools/registry-internal', () => ({
  register: (tool: any) => registered.push(tool),
}));

// Import triggers the register() calls
import '$lib/workflows/site-tools/tools/home-assistant';

describe('home-assistant tools', () => {
  it('registers 5 HA tools in the "home" toolset', () => {
    expect(registered.length).toBe(5);
    expect(registered.every(t => t.toolset === 'home')).toBe(true);
  });

  it('registers ha_query_state', () => {
    const tool = registered.find(t => t.name === 'ha_query_state');
    expect(tool).toBeDefined();
    expect(tool.parameters.required).toContain('entity_id');
  });

  it('ha_query_state handler calls service.queryState', async () => {
    const tool = registered.find(t => t.name === 'ha_query_state');
    const result = await tool.handler({ entity_id: 'light.test' });
    expect(mockService.queryState).toHaveBeenCalledWith('light.test');
    expect(result.success).toBe(true);
  });

  it('ha_call_service handler calls service.callService', async () => {
    const tool = registered.find(t => t.name === 'ha_call_service');
    await tool.handler({ domain: 'light', service: 'turn_on', entity_id: 'light.test', data: { brightness: 128 } });
    expect(mockService.callService).toHaveBeenCalledWith('light', 'turn_on', 'light.test', { brightness: 128 });
  });

  it('registers all expected tool names', () => {
    const names = registered.map(t => t.name);
    expect(names).toContain('ha_query_state');
    expect(names).toContain('ha_call_service');
    expect(names).toContain('ha_fire_event');
    expect(names).toContain('ha_get_history');
    expect(names).toContain('ha_render_template');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/site-tools/tools/home-assistant.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the HA tool registration module**

Create `src/lib/workflows/site-tools/tools/home-assistant.ts`:

```typescript
import { register } from '../registry-internal';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';

register({
  name: 'ha_query_state',
  description: 'Get the current state and attributes of a Home Assistant entity',
  parameters: {
    type: 'object',
    properties: {
      entity_id: { type: 'string', description: 'Entity ID, e.g. light.living_room_ceiling' },
    },
    required: ['entity_id'],
  },
  category: 'Home Assistant',
  toolset: 'home',
  handler: async (args) => {
    const service = getHomeAssistantService();
    return await service.queryState(args.entity_id as string);
  },
});

register({
  name: 'ha_call_service',
  description: 'Call a Home Assistant service to control a device (turn on/off lights, set temperature, play media, etc.)',
  parameters: {
    type: 'object',
    properties: {
      domain: { type: 'string', description: 'Service domain, e.g. light, climate, media_player, switch' },
      service: { type: 'string', description: 'Service name, e.g. turn_on, turn_off, toggle, set_temperature' },
      entity_id: { type: 'string', description: 'Target entity ID' },
      data: { type: 'object', description: 'Additional service data, e.g. { "brightness": 128 } or { "temperature": 20 }' },
    },
    required: ['domain', 'service'],
  },
  category: 'Home Assistant',
  toolset: 'home',
  handler: async (args) => {
    const service = getHomeAssistantService();
    return await service.callService(
      args.domain as string,
      args.service as string,
      args.entity_id as string | undefined,
      args.data as Record<string, unknown> | undefined,
    );
  },
});

register({
  name: 'ha_fire_event',
  description: 'Fire a Home Assistant event to trigger automations',
  parameters: {
    type: 'object',
    properties: {
      event_type: { type: 'string', description: 'Event type name' },
      data: { type: 'object', description: 'Event data payload' },
    },
    required: ['event_type'],
  },
  category: 'Home Assistant',
  toolset: 'home',
  handler: async (args) => {
    const service = getHomeAssistantService();
    return await service.fireEvent(
      args.event_type as string,
      args.data as Record<string, unknown> | undefined,
    );
  },
});

register({
  name: 'ha_get_history',
  description: 'Get historical state data for an entity over a time period',
  parameters: {
    type: 'object',
    properties: {
      entity_id: { type: 'string', description: 'Entity ID to get history for' },
      start: { type: 'string', description: 'ISO 8601 start time (default: 24h ago)' },
      end: { type: 'string', description: 'ISO 8601 end time (default: now)' },
    },
    required: ['entity_id'],
  },
  category: 'Home Assistant',
  toolset: 'home',
  handler: async (args) => {
    const service = getHomeAssistantService();
    return await service.getHistory(
      args.entity_id as string,
      args.start as string | undefined,
      args.end as string | undefined,
    );
  },
});

register({
  name: 'ha_render_template',
  description: 'Evaluate a Home Assistant Jinja2 template server-side',
  parameters: {
    type: 'object',
    properties: {
      template: { type: 'string', description: 'Jinja2 template string' },
    },
    required: ['template'],
  },
  category: 'Home Assistant',
  toolset: 'home',
  handler: async (args) => {
    const service = getHomeAssistantService();
    return await service.renderTemplate(args.template as string);
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/site-tools/tools/home-assistant.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Add the import to registry.ts and remove synthetic manifest entry**

In `src/lib/workflows/site-tools/registry.ts`:

1. Add import at the bottom of the domain module imports:
   ```typescript
   import './tools/home-assistant';
   ```

2. Remove the synthetic HA manifest entry in `getToolsetManifest()` (lines 78-91):
   ```typescript
   // Remove this entire block:
   // HA tools live outside the domain module system — add a synthetic entry
   if (!manifest.some((m) => m.toolset === 'home')) {
     manifest.push({
       // ...
     });
   }
   ```

- [ ] **Step 6: Update general-chat.ts to remove the HA switch block**

In `src/lib/workflows/chat/general-chat.ts`:

1. Remove these imports (no longer needed):
   ```typescript
   import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';
   import { HA_TOOL_DEFINITIONS, buildHASystemPromptSection } from '$lib/workflows/homeassistant/llm-tools';
   ```

2. Keep the HA entity loading (lines 76-86) — this is still needed to decide whether to activate the `home` toolset. But change the activation block. Replace lines 112-123:

   Old:
   ```typescript
   if (ts === 'home') {
     if (haEntities.length > 0) {
       activeTools.push(...HA_TOOL_DEFINITIONS);
       activatedToolsets.add('home');
     }
   } else {
     activeTools.push(...getToolsetDefinitions(ts));
     activatedToolsets.add(ts);
   }
   ```

   New (HA tools are now in the registry like everything else):
   ```typescript
   if (ts === 'home' && haEntities.length === 0) {
     // Skip home toolset if HA is not configured
     continue;
   }
   activeTools.push(...getToolsetDefinitions(ts));
   activatedToolsets.add(ts);
   ```

3. Replace the HA switch block in the tool dispatch (lines 238-275). Remove the entire `switch (fnName)` block for HA tools:

   Old:
   ```typescript
   } else {
     // Handle HA tools
     const haService = getHomeAssistantService();
     switch (fnName) {
       case 'ha_query_state':
         // ...
       case 'ha_render_template':
         // ...
       default:
         if (isRegisteredTool(fnName)) {
           toolResult = await executeSiteTool(fnName, fnArgs);
         } else {
           toolResult = { error: `Unknown function: ${fnName}` };
         }
     }
   }
   ```

   New (all tools go through the registry):
   ```typescript
   } else if (isRegisteredTool(fnName)) {
     toolResult = await executeSiteTool(fnName, fnArgs);
   } else {
     toolResult = { error: `Unknown function: ${fnName}` };
   }
   ```

4. Keep the `activate_toolset` handler for `home` toolset but update it. Replace the HA-specific activation block (lines 191-206):

   Old:
   ```typescript
   } else if (toolset === 'home') {
     if (haEntities.length > 0) {
       activeTools.push(...HA_TOOL_DEFINITIONS);
       activatedToolsets.add('home');
       const entitySummary = buildHASystemPromptSection(haEntities);
       // ...
     }
   ```

   New (uses registry like all other toolsets):
   ```typescript
   } else if (toolset === 'home') {
     if (haEntities.length > 0) {
       const defs = getToolsetDefinitions('home');
       activeTools.push(...defs);
       activatedToolsets.add('home');
       // Import buildHASystemPromptSection only for the entity context
       const { buildHASystemPromptSection } = await import('$lib/workflows/homeassistant/llm-tools');
       const entitySummary = buildHASystemPromptSection(haEntities);
       toolResult = {
         success: true,
         data: {
           toolset: 'home',
           status: 'activated',
           tools: defs.map((d) => d.function.name),
           entityContext: entitySummary,
         },
       };
     } else {
       toolResult = { success: false, error: 'Home Assistant is not configured — no entities available.' };
     }
   ```

5. Remove the now-unused `homeAssistantConfig` import from `$lib/db/schema` if it's only used for the HA config loading — actually keep it, the HA entity loading at the top still needs it.

- [ ] **Step 7: Run all tests**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/workflows/site-tools/tools/home-assistant.ts tests/lib/workflows/site-tools/tools/home-assistant.test.ts src/lib/workflows/site-tools/registry.ts src/lib/workflows/chat/general-chat.ts
git commit -m "refactor: register HA tools in standard registry, remove switch block"
```

---

### Task 8: Deduplicate Conversation List Query

**Files:**
- Create: `src/lib/jkai/queries.ts`
- Modify: `src/routes/jkai/+page.server.ts`
- Modify: `src/routes/api/jkai/conversations/+server.ts`

- [ ] **Step 1: Create the shared query module**

Create `src/lib/jkai/queries.ts`:

```typescript
import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { desc, sql } from 'drizzle-orm';

export async function getConversationList() {
  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      source: conversations.source,
      whatsappPhoneNumber: conversations.whatsappPhoneNumber,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      messageCount: sql<number>`(
        select count(*) from orchestrator_chats
        where orchestrator_chats.conversation_id = "jkai_conversations"."id"
      )`.as('message_count'),
      lastMessage: sql<string>`(
        select content from orchestrator_chats
        where orchestrator_chats.conversation_id = "jkai_conversations"."id"
        order by created_at desc limit 1
      )`.as('last_message'),
    })
    .from(conversations)
    .orderBy(desc(conversations.updatedAt));
}
```

- [ ] **Step 2: Update +page.server.ts**

In `src/routes/jkai/+page.server.ts`, replace the inline conversation query (lines 7-27):

Remove the `orchestratorChats` import from `$lib/db/schema` (keep the other imports).
Add: `import { getConversationList } from '$lib/jkai/queries';`

Replace:
```typescript
const convList = await db
  .select({
    // ... 20 lines of query
  })
  .from(conversations)
  .orderBy(desc(conversations.updatedAt));
```

With:
```typescript
const convList = await getConversationList();
```

Also remove the `sql` import from `drizzle-orm` if it's only used by the conversation query — check if it's used elsewhere in the file (it is, for the `count(*)::int` in metrics). Keep `sql` if other queries use it.

- [ ] **Step 3: Update api/jkai/conversations/+server.ts**

In `src/routes/api/jkai/conversations/+server.ts`, replace the GET handler:

Replace imports:
```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { getConversationList } from '$lib/jkai/queries';
```

Replace GET handler:
```typescript
export const GET: RequestHandler = async () => {
  const rows = await getConversationList();
  return json(rows);
};
```

Remove the `orchestratorChats` import, `desc`, and `sql` imports (no longer needed in GET).

- [ ] **Step 4: Verify**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/jkai/queries.ts src/routes/jkai/+page.server.ts src/routes/api/jkai/conversations/+server.ts
git commit -m "refactor: deduplicate conversation list query into shared module"
```

---

### Task 9: Add Logging to Empty Catch Blocks in general-chat.ts

**Files:**
- Modify: `src/lib/workflows/chat/general-chat.ts`

- [ ] **Step 1: Fix the silent catch blocks**

In `src/lib/workflows/chat/general-chat.ts`:

1. Line 43 — `buildMemorySection` catch block:
   ```typescript
   // Old:
   } catch {
     return '';
   }
   
   // New:
   } catch (err) {
     console.warn('[general-chat] Failed to load memories:', err instanceof Error ? err.message : err);
     return '';
   }
   ```

2. Line 86 — HA config load catch block:
   ```typescript
   // Old:
   } catch {}
   
   // New:
   } catch (err) {
     console.warn('[general-chat] Failed to load HA config:', err instanceof Error ? err.message : err);
   }
   ```

- [ ] **Step 2: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/workflows/chat/general-chat.ts
git commit -m "fix: add logging to silent catch blocks in general-chat"
```

---

### Task 10: Improve Chat Polling with Backoff

**Files:**
- Modify: `src/lib/components/jkai/ChatArea.svelte`

- [ ] **Step 1: Replace fixed 1.5s polling with exponential backoff**

In `src/lib/components/jkai/ChatArea.svelte`, update the polling loop inside `send()` (around line 196):

Replace:
```typescript
while (!done && Date.now() - startTime < TIMEOUT) {
  await new Promise((r) => setTimeout(r, 1500));
```

With:
```typescript
let pollInterval = 500;
const MAX_POLL_INTERVAL = 3000;

while (!done && Date.now() - startTime < TIMEOUT) {
  await new Promise((r) => setTimeout(r, pollInterval));
  pollInterval = Math.min(pollInterval * 1.3, MAX_POLL_INTERVAL);
```

This starts polling at 500ms (faster initial response), then backs off to 3s max. The sequence is roughly: 500, 650, 845, 1100, 1430, 1860, 2420, 3000, 3000...

- [ ] **Step 2: Verify the UI still works**

Start the dev server and test a chat message:

Run: `cd /home/john/strange_rambling_svelte && npm run dev`

Open `http://homeserv:5173/jkai`, send a message, verify it still polls and completes correctly.

- [ ] **Step 3: Commit**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/components/jkai/ChatArea.svelte
git commit -m "improve: use exponential backoff for chat polling (500ms-3s)"
```

---

### Task 11: Final Verification and Cleanup

**Files:**
- Verify: `src/lib/jkai/orchestrator.ts` (should now be significantly smaller)

- [ ] **Step 1: Verify orchestrator.ts line count**

Run: `wc -l /home/john/strange_rambling_svelte/src/lib/jkai/orchestrator.ts`

Expected: roughly 400-500 lines (down from 1221). The file should now contain:
- The `Orchestrator` class with lifecycle methods (`startBuild`, `pauseBuild`, `resumeBuild`, `stopBuild`, `continueBuild`, `recoverOnStartup`)
- The `runIteration` coordinator method (calls `executeIteration` from executor, `runTests` from test-runner, `planBuild`/`replanBuild` from planner)
- `checkServeConfig` private method
- `scheduleNext` private method
- `detectCompletion` helper
- The singleton export

- [ ] **Step 2: Verify chat endpoint line count**

Run: `wc -l /home/john/strange_rambling_svelte/src/routes/api/workflows/orchestrator/chat/+server.ts`

Expected: roughly 180-220 lines (down from 342). The file should now be thin dispatch logic.

- [ ] **Step 3: Run full test suite**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Run typecheck**

Run: `cd /home/john/strange_rambling_svelte && npx tsc --noEmit`
or: `cd /home/john/strange_rambling_svelte && npm run build`
Expected: No type errors

- [ ] **Step 5: Final commit if any cleanup needed**

If any imports or dead code were missed in previous tasks, clean them up and commit:

```bash
cd /home/john/strange_rambling_svelte
git add -A
git commit -m "chore: clean up unused imports after jkai refactoring"
```
