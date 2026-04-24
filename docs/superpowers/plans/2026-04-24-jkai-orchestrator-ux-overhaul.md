# jkai Orchestrator UX Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the `/jkai` chat experience up to parity with Claude Code CLI — visible reasoning, plan-before-execute, sub-agent dispatch, confirmation gates, clarification rounds, and heartbeat updates — while unifying its visual language with `/jkai/canvas`.

**Architecture:**
- Extend the existing `JobEvent` union in `$lib/workflows/chat/job-store.ts` with new discriminated variants (`heartbeat`, `plan`, `confirm`, `clarify`, `subagent_*`). Event buffering and SSE replay already handle unknown event shapes; the client-side reducer in `ChatArea.svelte` needs new branches.
- The orchestrator runs inside a single background coroutine per job. New phases (plan/confirm/clarify) are implemented as **cooperative pauses** — the coroutine awaits a one-shot `resumeWith` promise that the HTTP `PATCH` handler resolves with the user's answer. This avoids a separate state machine.
- Sub-agents reuse the job-store as nested jobs, addressed as `parentJobId:agentId`. The parent job emits `subagent_start`/`subagent_event`/`subagent_done` events that carry the child's payload upward, so the client renders them as nested progress bubbles.
- The UI migrates from ad-hoc Tailwind to the `.nm-*` token system pulled from `/jkai/canvas`. Tokens are extracted into a dedicated `nm.css` import so both surfaces consume the same source.

**Tech Stack:** SvelteKit + Svelte 5 (runes), PostgreSQL + Drizzle, SSE for live streaming, Vitest for unit tests, Playwright for any end-to-end smoke (existing infra).

**Checkpoints:** Five phases. Each ends with a user review gate. Do **not** advance past a checkpoint without explicit confirmation.

---

## Phase Map & Checkpoints

| Phase | Scope | Checkpoint |
|-------|-------|-----------|
| 0 | Shared primitives: event schema + `nm-tokens.css` extract | **CP-0**: Event types compile, no UI behavior changes |
| 1 | Heartbeat + thinking-visible-by-default | **CP-1**: Long task feels alive; reasoning visible |
| 2 | Step summary cards + `.nm-*` migration of chat surface | **CP-2**: `/jkai` visually matches `/jkai/canvas` |
| 3 | Plan-before-execute | **CP-3**: Plan card rendered, "Go" / "Adjust" controls work |
| 4 | Sub-agent dispatch | **CP-4**: `agent_spawn` tool runs; nested bubble renders |
| 5 | Confirmation gates + clarification round | **CP-5**: Destructive ops pause; ambiguous inputs ask back |

---

## Phase 0 — Shared Primitives

**Why first:** every later phase depends on the `JobEvent` schema and a shared design-token stylesheet. Doing this once prevents rewrites.

### Task 0.1 — Extend `JobEvent` union

**Files:**
- Modify: `src/lib/workflows/chat/job-store.ts:9-15`

- [ ] **Step 1: Write a failing unit test**

Create `src/lib/workflows/chat/job-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { publishJobEvent, subscribeJob, createJob } from './job-store';
import type { JobEvent } from './job-store';

describe('job-store event schema', () => {
  it('accepts all new event variants without type error', () => {
    const { jobId } = createJob('test');
    const events: JobEvent[] = [
      { type: 'heartbeat', summary: 'Still working: fetching data', elapsedMs: 30000 },
      { type: 'plan', plan: { steps: [{ id: 's1', title: 'x', detail: 'y' }], filesToTouch: [] }, planId: 'p1' },
      { type: 'plan_ack', planId: 'p1', decision: 'approved' },
      { type: 'confirm', confirmId: 'c1', prompt: 'Delete workflow?', destructive: true },
      { type: 'confirm_ack', confirmId: 'c1', decision: 'approved' },
      { type: 'clarify', clarifyId: 'q1', questions: [{ id: 'a', text: 'Which one?' }] },
      { type: 'clarify_ack', clarifyId: 'q1', answers: { a: 'that one' } },
      { type: 'subagent_start', agentId: 'a1', parentStepId: null, task: 'research x' },
      { type: 'subagent_event', agentId: 'a1', event: { type: 'token', delta: 'hi' } },
      { type: 'subagent_done', agentId: 'a1', summary: 'done', result: { ok: true } },
    ];
    const received: JobEvent[] = [];
    subscribeJob(jobId, (e) => received.push(e));
    for (const e of events) publishJobEvent(jobId, e);
    expect(received.filter((r) => r.type !== 'connected').length).toBeGreaterThanOrEqual(events.length);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd ~/strange_rambling_svelte && npx vitest run src/lib/workflows/chat/job-store.test.ts`
Expected: FAIL with type errors on new event variants.

- [ ] **Step 3: Extend the `JobEvent` union**

Edit `src/lib/workflows/chat/job-store.ts` — replace the `JobEvent` type (lines 9–15) with:

```ts
export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  kind?: 'read' | 'write' | 'run' | 'external';
}

export interface PlanPayload {
  steps: PlanStep[];
  filesToTouch: Array<{ path: string; action: 'create' | 'modify' | 'delete' }>;
  summary?: string;
  estimatedSteps?: number;
}

export interface ClarifyQuestion {
  id: string;
  text: string;
  kind?: 'freeform' | 'choice';
  choices?: string[];
}

export type JobEvent =
  | { type: 'token'; delta: string }
  | { type: 'tool_start'; tool: string; args: Record<string, unknown>; toolCallId?: string }
  | { type: 'tool_result'; tool: string; result: unknown; status: 'done' | 'error'; toolCallId?: string; summary?: string }
  | { type: 'status'; text: string }
  | { type: 'heartbeat'; summary: string; elapsedMs: number; currentStep?: string }
  | { type: 'plan'; planId: string; plan: PlanPayload }
  | { type: 'plan_ack'; planId: string; decision: 'approved' | 'rejected' | 'adjusted'; adjustment?: string }
  | { type: 'confirm'; confirmId: string; prompt: string; destructive?: boolean; details?: Record<string, unknown> }
  | { type: 'confirm_ack'; confirmId: string; decision: 'approved' | 'rejected' }
  | { type: 'clarify'; clarifyId: string; questions: ClarifyQuestion[] }
  | { type: 'clarify_ack'; clarifyId: string; answers: Record<string, string> }
  | { type: 'subagent_start'; agentId: string; parentStepId: string | null; task: string }
  | { type: 'subagent_event'; agentId: string; event: JobEvent }
  | { type: 'subagent_done'; agentId: string; summary: string; result: unknown }
  | { type: 'done'; result: Record<string, unknown> }
  | { type: 'error'; message: string };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/strange_rambling_svelte && npx vitest run src/lib/workflows/chat/job-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/chat/job-store.ts src/lib/workflows/chat/job-store.test.ts
git commit -m "feat(jkai): extend JobEvent with heartbeat/plan/confirm/clarify/subagent variants"
```

### Task 0.2 — Add `resumeWith` primitive to job-store

**Why:** The plan/confirm/clarify phases need a way for the background coroutine to suspend and wait for an HTTP `PATCH` answer without polling.

**Files:**
- Modify: `src/lib/workflows/chat/job-store.ts`

- [ ] **Step 1: Write the failing test** — append to `job-store.test.ts`:

```ts
describe('job-store resumeWith', () => {
  it('suspends a waiter and resumes with payload', async () => {
    const { jobId } = createJob('test');
    const { awaitResponse, respond } = await import('./job-store').then((m) => m.createWaiter(jobId, 'plan:p1'));
    setTimeout(() => respond({ decision: 'approved' }), 10);
    const result = await awaitResponse();
    expect(result).toEqual({ decision: 'approved' });
  });

  it('rejects if job is cancelled', async () => {
    const { jobId, job } = createJob('test');
    const { awaitResponse } = await import('./job-store').then((m) => m.createWaiter(jobId, 'plan:p1'));
    setTimeout(() => { job.abortController.abort(); rejectWaiter(jobId, 'plan:p1', 'cancelled'); }, 10);
    await expect(awaitResponse()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/workflows/chat/job-store.test.ts`
Expected: FAIL — `createWaiter` / `rejectWaiter` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/workflows/chat/job-store.ts`:

```ts
interface Waiter {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

const waiters = new Map<string, Map<string, Waiter>>();

export function createWaiter<T = unknown>(jobId: string, key: string): { awaitResponse: () => Promise<T>; respond: (value: T) => void } {
  let map = waiters.get(jobId);
  if (!map) { map = new Map(); waiters.set(jobId, map); }
  let waiter: Waiter | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    waiter = { resolve: resolve as (v: unknown) => void, reject };
  });
  if (!waiter) throw new Error('waiter init failed');
  map.set(key, waiter);
  return {
    awaitResponse: () => promise,
    respond: (value: T) => {
      const m = waiters.get(jobId); if (!m) return;
      const w = m.get(key); if (!w) return;
      m.delete(key);
      w.resolve(value);
    },
  };
}

export function respondToWaiter(jobId: string, key: string, value: unknown): boolean {
  const m = waiters.get(jobId); if (!m) return false;
  const w = m.get(key); if (!w) return false;
  m.delete(key);
  w.resolve(value);
  return true;
}

export function rejectWaiter(jobId: string, key: string, reason: string): void {
  const m = waiters.get(jobId); if (!m) return;
  const w = m.get(key); if (!w) return;
  m.delete(key);
  w.reject(new Error(reason));
}

// When a job ends (done/error/cancelled), reject any outstanding waiters
// so awaiting coroutines stop leaking.
export function failAllWaiters(jobId: string, reason: string): void {
  const m = waiters.get(jobId); if (!m) return;
  for (const [, w] of m) w.reject(new Error(reason));
  waiters.delete(jobId);
}
```

Then wire `failAllWaiters(jobId, reason)` into:
- `cancelJob` (after line 147): `failAllWaiters(jobId, 'Cancelled by user');`
- `cancelForScope` inner loop (after line 176): `failAllWaiters(id, reason);`
- The watchdog termination path (after line 108): `failAllWaiters(jobId, reason);`

- [ ] **Step 4: Run test**

Run: `npx vitest run src/lib/workflows/chat/job-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/chat/job-store.ts src/lib/workflows/chat/job-store.test.ts
git commit -m "feat(jkai): add waiter primitive to job-store for cooperative pauses"
```

### Task 0.3 — Extract `.nm-*` tokens into a shared stylesheet

**Files:**
- Create: `src/lib/styles/nm-tokens.css`
- Modify: `src/routes/+layout.svelte` (import the stylesheet globally)

- [ ] **Step 1: Read canvas styles**

Run: `grep -n "nm-sec\|nm-text-input\|nm-save-btn\|nm-inline\|trigger-pill\|sr-label-tight" src/routes/jkai/canvas/[slug]/+page.svelte | head -60`
Copy the corresponding CSS blocks from the canvas `<style>` section (approximately lines 1900+).

- [ ] **Step 2: Create `src/lib/styles/nm-tokens.css`**

Paste the canonical definitions. File skeleton:

```css
/* Canonical .nm-* design tokens. Imported globally; both /jkai/canvas and /jkai chat must reference these. */

.nm-sec {
  background: var(--bg-section);
  border: 1px solid var(--card-border);
  padding: 1rem 1.1rem;
  border-radius: 6px;
}

.nm-sec-hd {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border-bottom: 1px dashed var(--card-border);
  padding-bottom: 0.6rem;
  margin-bottom: 0.75rem;
}

.sr-label-tight {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.nm-text-input {
  font-family: var(--font-mono);
  font-size: 12px;
  background: rgba(26, 16, 8, 0.04);
  border: 1px solid var(--card-border);
  border-radius: 4px;
  padding: 6px 10px;
  color: var(--text-primary);
  transition: border-color 120ms ease;
}
.nm-text-input:focus {
  outline: none;
  border-color: var(--accent);
}

.nm-save-btn {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: var(--accent);
  color: #0b0604;
  padding: 6px 14px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.nm-save-btn[disabled] { opacity: 0.5; cursor: not-allowed; }

.nm-inline { display: inline-flex; align-items: center; gap: 0.35rem; }
.nm-inline-hdr { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; }
.nm-label-input { font-family: var(--font-mono); font-size: 11px; background: transparent; border: 0; border-bottom: 1px dashed var(--card-border); padding: 2px 4px; color: var(--text-primary); }

.trigger-pill {
  display: inline-flex; align-items: center; height: 18px; padding: 0 6px;
  font-family: var(--font-mono); font-size: 9px; text-transform: uppercase;
  border: 1px solid var(--card-border); border-radius: 3px;
}
.trigger-pill[data-type="cron"] { border-color: #c08a5a; color: #c08a5a; }
.trigger-pill[data-type="webhook"] { border-color: var(--accent); color: var(--accent); }
.trigger-pill[data-kind="running"] { border-color: #6ab88a; color: #6ab88a; }
.trigger-pill[data-kind="error"] { border-color: #c25b5b; color: #c25b5b; }
```

If the canvas stylesheet diverges from this draft in meaningful ways, favour the canvas source of truth — this file is the canvas block copied verbatim.

- [ ] **Step 3: Import globally**

Edit `src/routes/+layout.svelte`; add near other global imports:

```svelte
<script lang="ts">
  import '$lib/styles/nm-tokens.css';
  // ... existing imports
</script>
```

- [ ] **Step 4: Verify no visual regression on canvas**

Start dev: `npm run dev`. Load `http://homeserv:5173/jkai/canvas/<any-slug>`. Confirm the page still renders identically (tokens now come from the shared stylesheet but declarations match). If anything breaks, the extracted CSS diverged from canvas — reconcile.

- [ ] **Step 5: Commit**

```bash
git add src/lib/styles/nm-tokens.css src/routes/+layout.svelte
git commit -m "refactor(jkai): extract .nm-* design tokens to shared stylesheet"
```

---

## **CHECKPOINT CP-0**

**Review points with the user before proceeding:**
1. Event schema covers all phases — any missing variants?
2. Is the `resumeWith` primitive acceptable, or does the user prefer a queue-based approach?
3. `nm-tokens.css` matches the canvas reference — any styling drift?

**STOP HERE. Wait for explicit "go" before starting Phase 1.**

---

## Phase 1 — Heartbeat + Thinking Visible by Default

### Task 1.1 — Heartbeat interval in job-store

**Files:**
- Modify: `src/lib/workflows/chat/job-store.ts:87-111` (replace watchdog with watchdog+heartbeat)

- [ ] **Step 1: Write failing test** (append to `job-store.test.ts`):

```ts
import { vi } from 'vitest';

describe('heartbeat', () => {
  it('emits heartbeat event when no tokens arrive for >= 25s', async () => {
    vi.useFakeTimers();
    const { jobId } = createJob('test');
    const received: JobEvent[] = [];
    subscribeJob(jobId, (e) => received.push(e));
    vi.advanceTimersByTime(26_000);
    expect(received.some((e) => e.type === 'heartbeat')).toBe(true);
    vi.useRealTimers();
  });

  it('does not emit heartbeat if tokens are flowing', async () => {
    vi.useFakeTimers();
    const { jobId } = createJob('test');
    const received: JobEvent[] = [];
    subscribeJob(jobId, (e) => received.push(e));
    for (let i = 0; i < 5; i++) {
      publishJobEvent(jobId, { type: 'token', delta: 'x' });
      vi.advanceTimersByTime(10_000);
    }
    expect(received.filter((e) => e.type === 'heartbeat').length).toBe(0);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run — verify it fails** (no heartbeat emitter yet).

- [ ] **Step 3: Implement**

In `job-store.ts`, inside the `OrchestratorJob` interface add:

```ts
  currentStep?: string;   // updated by onProgress / tool_start — used in heartbeat
  lastHeartbeatAt: number;
```

In `createJob`, set `lastHeartbeatAt: now`.

Add a separate heartbeat timer inside `startWatchdog` (or a companion function `startHeartbeat`). The heartbeat timer fires every 5s, checks `Date.now() - job.lastEventAt >= 25_000 && Date.now() - job.lastHeartbeatAt >= 25_000`, and when true publishes:

```ts
publishJobEvent(jobId, {
  type: 'heartbeat',
  summary: job.currentStep ?? job.progress[job.progress.length - 1] ?? 'Still thinking...',
  elapsedMs: Date.now() - job.startedAt,
  currentStep: job.currentStep,
});
job.lastHeartbeatAt = Date.now();
```

**Critical:** a `heartbeat` event must NOT reset `job.lastEventAt` (otherwise watchdog never trips). Special-case inside `publishJobEvent`:

```ts
if (event.type !== 'heartbeat') {
  const job = jobs.get(jobId);
  if (job) job.lastEventAt = Date.now();
}
```

And update `onProgress` in the orchestrator (chat/+server.ts:83) to also set `job.currentStep = text.slice(0, 120);`.

- [ ] **Step 4: Run tests** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/chat/job-store.ts src/lib/workflows/chat/job-store.test.ts src/routes/api/workflows/orchestrator/chat/+server.ts
git commit -m "feat(jkai): emit heartbeat events every 25s during silent work"
```

### Task 1.2 — Render heartbeats in chat UI

**Files:**
- Modify: `src/lib/components/jkai/ChatArea.svelte` (SSE handler around lines 290–345 and progress render around 700–760)

- [ ] **Step 1: Add heartbeat state and handler**

Find the SSE `onmessage` switch in ChatArea.svelte (~line 490–600). Add a case:

```ts
case 'heartbeat': {
  // Replace progressBubble's "...still working" with a live heartbeat line.
  heartbeat = {
    summary: data.summary,
    elapsedSec: Math.round(data.elapsedMs / 1000),
    currentStep: data.currentStep,
  };
  break;
}
```

In the `<script>` declarations, add near other `$state`:

```ts
let heartbeat = $state<{ summary: string; elapsedSec: number; currentStep?: string } | null>(null);
```

Clear `heartbeat = null` in the `token`, `tool_start`, `tool_result`, `done`, `error` branches (any incoming real event means we're no longer in a silent stretch).

- [ ] **Step 2: Render the heartbeat under the progress bubble**

In the progress-bubble template (around line 700), add under the "Working..." header:

```svelte
{#if heartbeat}
  <div class="heartbeat-line">
    <span class="hb-dot"></span>
    <span class="hb-summary">{heartbeat.summary}</span>
    <span class="hb-elapsed">{heartbeat.elapsedSec}s</span>
  </div>
{/if}
```

Add styles (will be re-skinned during phase 2, interim is fine):

```svelte
<style>
  .heartbeat-line { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
  .hb-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: hb-pulse 1.2s ease-in-out infinite; }
  .hb-summary { flex: 1; }
  .hb-elapsed { opacity: 0.7; }
  @keyframes hb-pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
</style>
```

- [ ] **Step 3: Manual verification**

Start dev server: `npm run dev`. Open `http://homeserv:5173/jkai`, send a message that triggers a long tool chain (e.g. "scrape civilservicejobs and summarize"). After ~25s of silence, a pulsing heartbeat line should appear with the elapsed second counter climbing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/jkai/ChatArea.svelte
git commit -m "feat(jkai): render heartbeat line during silent work in chat"
```

### Task 1.3 — Thinking visible by default

**Files:**
- Modify: `src/lib/components/jkai/ChatMessage.svelte` (default collapse state)
- Modify: `src/lib/components/jkai/ChatArea.svelte` (live-stream thinking tokens if emitted by onStreamEvent)

- [ ] **Step 1: Locate thinking render in ChatMessage**

```bash
grep -n "thinking\|Thinking" src/lib/components/jkai/ChatMessage.svelte | head -40
```

Find the collapsible block and flip the default from collapsed to expanded. Rename button label from "Show thinking" → "Hide thinking" when expanded.

- [ ] **Step 2: Stream live thinking into the progress bubble**

If `onStreamEvent` already emits `type: 'token'` for reasoning deltas, they mix with content. Check `src/lib/workflows/chat/general-chat.ts:580` — if the provider streams `reasoning_content` separately, add a new event variant (Phase 0 only added main-list events; reasoning could reuse `status` or a new `reasoning_delta`).

If the provider does NOT stream reasoning separately, skip live streaming — static reasoning on the finished message is sufficient.

Audit outcome determines path. If adding `reasoning_delta`:

```ts
// job-store.ts — add to JobEvent union
| { type: 'reasoning_delta'; delta: string }
```

```ts
// general-chat.ts — emit alongside token handling
onStreamEvent?.({ type: 'reasoning_delta', delta: reasoningText });
```

In ChatArea.svelte add:

```ts
let liveReasoning = $state('');
// in SSE switch:
case 'reasoning_delta': liveReasoning += data.delta; break;
// on done/error: append liveReasoning to the message's thinking field, clear state.
```

Render above the heartbeat line:

```svelte
{#if liveReasoning}
  <details class="live-thinking" open>
    <summary class="sr-label-tight">Thinking</summary>
    <pre class="thinking-body">{liveReasoning}</pre>
  </details>
{/if}
```

- [ ] **Step 3: Manual verification**

Open `/jkai`, ask a question that elicits reasoning. Thinking panel is expanded by default and streams live if the model supports it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/jkai/ChatMessage.svelte src/lib/components/jkai/ChatArea.svelte \
        src/lib/workflows/chat/job-store.ts src/lib/workflows/chat/general-chat.ts
git commit -m "feat(jkai): show thinking by default; stream reasoning live during work"
```

### Task 1.4 — Deploy + verify on prod

- [ ] **Step 1: Run typecheck + lint**

```bash
cd ~/strange_rambling_svelte
npm run lint
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 2: Push and deploy**

```bash
git push origin main
./scripts/deploy.sh
```

- [ ] **Step 3: Smoke test on `strangeramblings.com/jkai`**

Send a message with a long tool call. Verify:
- Heartbeat appears after 25s of silence
- Elapsed counter increments
- Thinking panel is expanded by default
- No console errors

---

## **CHECKPOINT CP-1**

**Review with user:**
1. Does the heartbeat cadence (25s) feel right? Too fast? Too slow?
2. Is the thinking-visible-by-default OK, or does it dominate the screen for short answers?
3. Is the heartbeat summary useful (progress-derived) or does it need orchestrator-side improvement?

**STOP. Await confirmation before Phase 2.**

---

## Phase 2 — Step Summary Cards + `.nm-*` Migration

### Task 2.1 — Step summary cards for tool invocations

**Why:** raw token streams in the progress bubble are noisy. Each tool should render as a card with a one-line summary. Model the visual after `/jkai/builds` iteration cards.

**Files:**
- Modify: `src/lib/components/jkai/ChatArea.svelte` (lines 710–753 — tool step rendering)
- Modify: `src/lib/workflows/chat/general-chat.ts:253` (add `summary` to tool_result payload)

- [ ] **Step 1: Generate tool summaries in `general-chat.ts`**

When emitting `tool_result`, include a short human-readable summary derived from the tool name + result shape. Add a helper:

```ts
// src/lib/workflows/chat/tool-summary.ts — new file
import type { ToolProgressStep } from './job-store';

export function summarizeToolResult(step: ToolProgressStep): string {
  const { tool, args, result, status } = step;
  if (status === 'error') return `${tool} failed`;
  const r = result as Record<string, unknown> | undefined;
  switch (tool) {
    case 'workflow_create': return `Created canvas "${(r?.data as any)?.workflowId ?? 'new'}"`;
    case 'workflow_modify': return `Updated canvas`;
    case 'intel_search':   return `Found ${((r as any)?.results as unknown[])?.length ?? 0} results for "${(args.query as string)?.slice(0, 40)}"`;
    case 'web_search':     return `Searched the web for "${(args.query as string)?.slice(0, 40)}"`;
    case 'gmail_search':   return `Searched Gmail for "${(args.query as string)?.slice(0, 40)}"`;
    case 'gmail_fetch':    return `Fetched ${(r?.data as any)?.messages?.length ?? '?'} messages`;
    case 'stealth_scrape': return `Scraped ${(args.url as string)?.slice(0, 50) ?? 'url'}`;
    default: return `${tool} completed`;
  }
}
```

In `general-chat.ts:253`, attach the summary:

```ts
onStreamEvent?.({
  type: 'tool_result',
  tool: fnName,
  result: progressResult,
  status,
  toolCallId,
  summary: summarizeToolResult({ tool: fnName, toolCallId, args: fnArgs, result: progressResult, status }),
});
```

- [ ] **Step 2: Render as cards in ChatArea**

Replace the progress bubble's tool-step loop (approximately lines 710–753) with:

```svelte
<ul class="step-cards">
  {#each toolSteps as step (step.toolCallId)}
    <li class="step-card nm-sec" data-status={step.status}>
      <header class="step-card-hdr">
        <span class="step-status-pill trigger-pill" data-kind={step.status}>
          {step.status === 'running' ? '…' : step.status === 'done' ? '✓' : '✗'}
        </span>
        <span class="step-tool sr-label-tight">{step.tool}</span>
        <span class="step-summary">{step.summary ?? ''}</span>
        <button type="button" class="step-toggle" onclick={() => step.expanded = !step.expanded}>
          {step.expanded ? 'hide' : 'details'}
        </button>
      </header>
      {#if step.expanded}
        <div class="step-card-body">
          <details open><summary class="sr-label-tight">args</summary><pre>{JSON.stringify(step.args, null, 2)}</pre></details>
          {#if step.result !== undefined}
            <details><summary class="sr-label-tight">result</summary><pre>{JSON.stringify(step.result, null, 2)}</pre></details>
          {/if}
        </div>
      {/if}
    </li>
  {/each}
</ul>
```

Type additions: extend `ToolStep` in ChatArea.svelte to include `summary?: string` (already present in job-store event).

Card styles (will be normalized by nm-tokens; inline here as overrides):

```svelte
<style>
  .step-cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .step-card { padding: 8px 10px; }
  .step-card-hdr { display: flex; align-items: center; gap: 8px; }
  .step-tool { flex-shrink: 0; }
  .step-summary { flex: 1; font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); }
  .step-toggle { background: transparent; border: 0; color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.08em; }
  .step-card[data-status="error"] { border-color: #c25b5b; }
  .step-card-body { margin-top: 8px; }
  .step-card-body pre { font-family: var(--font-mono); font-size: 11px; padding: 8px; background: rgba(26, 16, 8, 0.06); border-radius: 4px; overflow-x: auto; max-height: 300px; }
</style>
```

- [ ] **Step 3: Manual verification**

Trigger several tool calls in /jkai. Each shows a compact card with status pill + tool name + one-line summary. Clicking "details" expands args/result.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/chat/tool-summary.ts \
        src/lib/workflows/chat/general-chat.ts \
        src/lib/workflows/chat/job-store.ts \
        src/lib/components/jkai/ChatArea.svelte
git commit -m "feat(jkai): render tool invocations as compact step summary cards"
```

### Task 2.2 — Migrate ChatArea shell to `.nm-*`

**Files:**
- Modify: `src/lib/components/jkai/ChatArea.svelte` (all Tailwind utility classes in the template)
- Modify: `src/lib/components/jkai/ChatMessage.svelte`
- Modify: `src/lib/components/jkai/ComposerAttachmentTray.svelte`

- [ ] **Step 1: Inventory current Tailwind usage**

```bash
grep -n "class=\"[^\"]*\(px-\|py-\|text-\[\|bg-\|border\|rounded\)" src/lib/components/jkai/ChatArea.svelte | head -100
```

- [ ] **Step 2: Replace per region**

Work region-by-region. For each block:
- Outer container → `.nm-sec`
- Section headers → `.nm-sec-hd` wrapping an `.sr-label-tight`
- Text inputs / textarea → `.nm-text-input`
- Send button → `.nm-save-btn`
- Model pill, attachment pill → `.trigger-pill`

Example — the composer bottom bar. Before:

```svelte
<div class="border-t border-neutral-800 bg-neutral-950/60 px-3 py-2 flex items-end gap-2">
  <textarea class="flex-1 bg-transparent text-sm ..." />
  <button class="px-3 py-1.5 text-xs ...">Send</button>
</div>
```

After:

```svelte
<div class="composer nm-sec">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">message</span>
    {#if modelContext}<span class="trigger-pill" data-type="webhook">{modelContext.modelId}</span>{/if}
  </header>
  <textarea class="nm-text-input composer-textarea" bind:value={draft}></textarea>
  <footer class="composer-footer">
    <ComposerAttachmentTray {...} />
    <button type="submit" class="nm-save-btn" disabled={!canSend}>send</button>
  </footer>
</div>

<style>
  .composer { display: flex; flex-direction: column; gap: 6px; }
  .composer-textarea { min-height: 80px; resize: vertical; }
  .composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
</style>
```

Apply analogous transforms to:
- Message bubbles (ChatMessage.svelte): wrap user/assistant messages in `.nm-sec` variants with `data-role="user" | "assistant"` and scoped CSS
- Progress bubble shell → `.nm-sec` with `data-kind="progress"`
- Status updates → a muted `.nm-sec` variant with dashed left border

Keep margin/gap spacing in region-local `<style>` blocks to avoid polluting global tokens.

- [ ] **Step 3: Visual QA**

Load `/jkai` and `/jkai/canvas/<slug>` side-by-side. Monospace fonts, border radius, accent color, input styling must be visually consistent.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/jkai/ChatArea.svelte src/lib/components/jkai/ChatMessage.svelte src/lib/components/jkai/ComposerAttachmentTray.svelte
git commit -m "refactor(jkai): migrate chat components to .nm-* design system"
```

### Task 2.3 — Deploy Phase 2

- [ ] **Step 1: Lint + typecheck + deploy**

```bash
npm run lint && npx tsc --noEmit && git push origin main && ./scripts/deploy.sh
```

- [ ] **Step 2: Side-by-side QA on prod**

`/jkai` and `/jkai/canvas/<slug>` should feel like the same product.

---

## **CHECKPOINT CP-2**

**Review with user:**
1. Visual parity with `/jkai/canvas` — any residual Tailwind?
2. Step summary cards readable? Summaries useful or too generic?
3. Any regressions on mobile breakpoints?

**STOP. Await confirmation before Phase 3.**

---

## Phase 3 — Plan-Before-Execute

### Task 3.1 — Orchestrator plan phase primitive

**Files:**
- Create: `src/lib/workflows/chat/plan-phase.ts`
- Modify: `src/lib/workflows/chat/general-chat.ts` (insert plan step before tool loop)
- Modify: `src/routes/api/workflows/orchestrator/chat/+server.ts` (add PATCH handler for plan_ack)

- [ ] **Step 1: Design the trigger**

A plan phase is only worth invoking when the request is "substantive" — i.e. the model intends to call >=2 tools or touch files. Two gating options:
- **Option A (prompt-based):** prepend a system instruction telling the model to emit a JSON `<plan>...</plan>` block for any multi-step task before calling tools.
- **Option B (heuristic):** if the first proposed tool call matches a destructive or multi-step tool (`workflow_create`, `workflow_modify`, `web_app_publish`, etc.), pause and ask the model to produce a plan.

Start with Option A — it scales to new tools without whitelist maintenance.

- [ ] **Step 2: Prompt augmentation**

In `general-chat.ts` find the system prompt assembly. Add:

```text
For any request that will require more than one tool call, first emit a plan as a JSON block:

<plan>{
  "steps": [{"id": "s1", "title": "Short title", "detail": "One-line detail", "kind": "read|write|run|external"}],
  "filesToTouch": [{"path": "...", "action": "create|modify|delete"}],
  "summary": "What you will do, in one sentence."
}</plan>

After emitting this, STOP and wait. The system will either return the user's approval or their adjustment instructions. Do not call any tools until approved.
```

- [ ] **Step 3: Plan extraction + suspension**

Create `src/lib/workflows/chat/plan-phase.ts`:

```ts
import { publishJobEvent, createWaiter } from './job-store';
import type { PlanPayload } from './job-store';

const PLAN_RE = /<plan>([\s\S]*?)<\/plan>/;

export function extractPlan(text: string): { plan: PlanPayload; cleaned: string } | null {
  const m = text.match(PLAN_RE);
  if (!m) return null;
  try {
    const plan = JSON.parse(m[1]);
    if (!plan.steps || !Array.isArray(plan.steps)) return null;
    return { plan, cleaned: text.replace(PLAN_RE, '').trim() };
  } catch {
    return null;
  }
}

export async function awaitPlanApproval(
  jobId: string,
  plan: PlanPayload,
): Promise<{ decision: 'approved' | 'rejected' | 'adjusted'; adjustment?: string }> {
  const planId = crypto.randomUUID();
  publishJobEvent(jobId, { type: 'plan', planId, plan });
  const { awaitResponse } = createWaiter<{ decision: 'approved' | 'rejected' | 'adjusted'; adjustment?: string }>(jobId, `plan:${planId}`);
  return awaitResponse();
}
```

- [ ] **Step 4: Wire into general-chat**

After the LLM emits its first streamed message (before any tool call), call `extractPlan` on the accumulated buffer. If found, pause:

```ts
const extracted = extractPlan(accumulated);
if (extracted) {
  const decision = await awaitPlanApproval(jobId, extracted.plan);
  if (decision.decision === 'rejected') {
    onStreamEvent?.({ type: 'status', text: 'Plan rejected — stopping.' });
    return { response: extracted.cleaned || 'Plan rejected.' };
  }
  if (decision.decision === 'adjusted') {
    // Feed adjustment back as a new user turn
    conversationHistory.push({ role: 'user', content: `Adjust the plan: ${decision.adjustment}` });
    // re-enter LLM loop
  }
  // approved: continue to tool execution
}
```

Exact integration point depends on the existing loop structure in `general-chat.ts` — read the loop around line 580 before wiring.

- [ ] **Step 5: PATCH endpoint for plan_ack**

In `src/routes/api/workflows/orchestrator/chat/+server.ts`, add:

```ts
import { respondToWaiter, getJob } from '$lib/workflows/chat/job-store';

export const PATCH: RequestHandler = async ({ request, url }) => {
  const jobId = url.searchParams.get('jobId');
  if (!jobId) return json({ error: 'jobId required' }, { status: 400 });
  const job = getJob(jobId);
  if (!job) return json({ error: 'job not found' }, { status: 404 });

  const body = await request.json() as
    | { type: 'plan_ack'; planId: string; decision: 'approved' | 'rejected' | 'adjusted'; adjustment?: string }
    | { type: 'confirm_ack'; confirmId: string; decision: 'approved' | 'rejected' }
    | { type: 'clarify_ack'; clarifyId: string; answers: Record<string, string> };

  let key: string;
  switch (body.type) {
    case 'plan_ack':     key = `plan:${body.planId}`; break;
    case 'confirm_ack':  key = `confirm:${body.confirmId}`; break;
    case 'clarify_ack':  key = `clarify:${body.clarifyId}`; break;
    default: return json({ error: 'unknown ack type' }, { status: 400 });
  }

  const ok = respondToWaiter(jobId, key, body);
  if (!ok) return json({ error: 'no waiter for that key' }, { status: 404 });

  // Echo the ack into the SSE stream so every subscriber sees the user decision.
  publishJobEvent(jobId, body as JobEvent);
  return json({ ok: true });
};
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/chat/plan-phase.ts \
        src/lib/workflows/chat/general-chat.ts \
        src/routes/api/workflows/orchestrator/chat/+server.ts
git commit -m "feat(jkai): plan phase — orchestrator emits plan and awaits user approval"
```

### Task 3.2 — Plan card UI

**Files:**
- Create: `src/lib/components/jkai/PlanCard.svelte`
- Modify: `src/lib/components/jkai/ChatArea.svelte`

- [ ] **Step 1: Build `PlanCard.svelte`**

```svelte
<script lang="ts">
  import type { PlanPayload } from '$lib/workflows/chat/job-store';
  let { planId, plan, jobId, onresolve } = $props<{
    planId: string;
    plan: PlanPayload;
    jobId: string;
    onresolve: (decision: 'approved' | 'rejected' | 'adjusted', adjustment?: string) => void;
  }>();
  let adjustment = $state('');
  let adjusting = $state(false);
  let submitting = $state(false);

  async function send(decision: 'approved' | 'rejected' | 'adjusted') {
    if (submitting) return;
    submitting = true;
    const body = { type: 'plan_ack', planId, decision, adjustment: decision === 'adjusted' ? adjustment : undefined };
    await fetch(`/api/workflows/orchestrator/chat?jobId=${jobId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    onresolve(decision, adjustment);
  }
</script>

<section class="plan-card nm-sec" data-kind="plan">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">proposed plan</span>
    {#if plan.summary}<span class="plan-summary">{plan.summary}</span>{/if}
  </header>

  <ol class="plan-steps">
    {#each plan.steps as step}
      <li class="plan-step">
        <span class="plan-step-kind trigger-pill" data-type={step.kind === 'write' ? 'webhook' : 'cron'}>{step.kind ?? 'step'}</span>
        <div class="plan-step-body">
          <div class="plan-step-title">{step.title}</div>
          <div class="plan-step-detail">{step.detail}</div>
        </div>
      </li>
    {/each}
  </ol>

  {#if plan.filesToTouch.length > 0}
    <details class="plan-files" open>
      <summary class="sr-label-tight">files to touch ({plan.filesToTouch.length})</summary>
      <ul>
        {#each plan.filesToTouch as f}
          <li><code>{f.action}</code> {f.path}</li>
        {/each}
      </ul>
    </details>
  {/if}

  <footer class="plan-actions">
    {#if !adjusting}
      <button class="nm-save-btn" disabled={submitting} onclick={() => send('approved')}>go</button>
      <button class="nm-save-btn secondary" disabled={submitting} onclick={() => (adjusting = true)}>adjust</button>
      <button class="nm-save-btn danger" disabled={submitting} onclick={() => send('rejected')}>cancel</button>
    {:else}
      <textarea class="nm-text-input" bind:value={adjustment} placeholder="What should change?"></textarea>
      <button class="nm-save-btn" disabled={submitting || !adjustment.trim()} onclick={() => send('adjusted')}>send adjustment</button>
      <button class="nm-save-btn secondary" disabled={submitting} onclick={() => (adjusting = false)}>back</button>
    {/if}
  </footer>
</section>

<style>
  .plan-card { margin: 8px 0; }
  .plan-summary { font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); }
  .plan-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .plan-step { display: flex; align-items: flex-start; gap: 8px; }
  .plan-step-body { font-family: var(--font-mono); font-size: 11px; }
  .plan-step-title { color: var(--text-primary); font-weight: 500; }
  .plan-step-detail { color: var(--text-muted); }
  .plan-files { margin-top: 10px; }
  .plan-files ul { list-style: none; padding-left: 0; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
  .plan-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .nm-save-btn.secondary { background: transparent; color: var(--text-primary); border: 1px solid var(--card-border); }
  .nm-save-btn.danger { background: #c25b5b; color: #fff; }
</style>
```

- [ ] **Step 2: Wire into ChatArea**

Add state `let pendingPlan = $state<{ planId: string; plan: PlanPayload } | null>(null);`. In the SSE switch:

```ts
case 'plan': pendingPlan = { planId: data.planId, plan: data.plan }; break;
case 'plan_ack': pendingPlan = null; break;
```

Render it inline between messages and the progress bubble:

```svelte
{#if pendingPlan && currentJobId}
  <PlanCard planId={pendingPlan.planId} plan={pendingPlan.plan} jobId={currentJobId} onresolve={() => (pendingPlan = null)} />
{/if}
```

- [ ] **Step 3: Manual verification**

Ask /jkai to create a workflow. The model should emit a plan; UI shows the card; clicking "go" resumes work. Clicking "adjust" with text re-prompts; clicking "cancel" aborts.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/jkai/PlanCard.svelte src/lib/components/jkai/ChatArea.svelte
git commit -m "feat(jkai): render plan cards with go/adjust/cancel controls"
```

### Task 3.3 — Deploy Phase 3

- [ ] **Step 1: Lint + push + deploy**

```bash
npm run lint && npx tsc --noEmit && git push origin main && ./scripts/deploy.sh
```

- [ ] **Step 2: Prod smoke**

Ask for a multi-step task. Verify plan appears, each button works, resulting workflow is still correct.

---

## **CHECKPOINT CP-3**

**Review with user:**
1. Is the plan prompt reliably triggering? Any cases where the model skips it?
2. Are plan cards useful or intrusive for trivial requests?
3. Do we need to persist plan decisions on the conversation (so reloading a conversation shows approved plans)?

**STOP. Await confirmation before Phase 4.**

---

## Phase 4 — Sub-Agent Dispatch

### Task 4.1 — `agent_spawn` tool

**Files:**
- Create: `src/lib/workflows/chat/sub-agent.ts`
- Modify: `src/lib/workflows/chat/general-chat.ts` (register the tool in the tool loop)

- [ ] **Step 1: Define the tool schema**

```ts
// src/lib/workflows/chat/sub-agent.ts
import { createJob, publishJobEvent, subscribeJob } from './job-store';
import type { JobEvent } from './job-store';
import { generalChat } from './general-chat';
import { loadConversationHistory } from './conversation-history';
import type { ModelContext } from '$lib/server/models/types';

export const AGENT_SPAWN_SCHEMA = {
  name: 'agent_spawn',
  description: 'Dispatch an independent sub-agent for isolated research or parallel work. Returns when the sub-agent completes. Use for tasks that can run without the main conversation context.',
  parameters: {
    type: 'object',
    required: ['task'],
    properties: {
      task: { type: 'string', description: 'Self-contained task description for the sub-agent.' },
      tools: { type: 'array', items: { type: 'string' }, description: 'Optional: whitelist of tools the sub-agent may call. Defaults to a safe read-only subset.' },
    },
  },
} as const;

const SAFE_DEFAULT_TOOLS = ['web_search', 'intel_search', 'gmail_search', 'webpage_fetch'];

export async function runSubAgent(
  parentJobId: string,
  args: { task: string; tools?: string[] },
  modelContext: ModelContext,
): Promise<{ summary: string; result: unknown }> {
  const agentId = crypto.randomUUID();
  const { jobId: childJobId } = createJob(args.task, {});
  publishJobEvent(parentJobId, { type: 'subagent_start', agentId, parentStepId: null, task: args.task });

  // Forward child events upward as subagent_event
  const unsubscribe = subscribeJob(childJobId, (event) => {
    if (event.type === 'done' || event.type === 'error') return; // surface via summary below
    publishJobEvent(parentJobId, { type: 'subagent_event', agentId, event });
  });

  try {
    const { response } = await generalChat(
      { text: args.task, attachments: [] },
      [],
      {
        conversationId: null,
        workflowId: null,
        onStreamEvent: (e) => publishJobEvent(childJobId, e),
        modelContext,
        useIntelContext: false,
        toolWhitelist: args.tools ?? SAFE_DEFAULT_TOOLS,
      },
    );
    const summary = response.slice(0, 200);
    publishJobEvent(parentJobId, { type: 'subagent_done', agentId, summary, result: { text: response } });
    return { summary, result: { text: response } };
  } finally {
    unsubscribe();
  }
}
```

Add `toolWhitelist` support to the `generalChat` options (filter which tools are registered for this call). If the current `generalChat` doesn't support whitelisting, this is the task where it gains that feature — see existing tool registration around the prompt assembly in general-chat.ts.

- [ ] **Step 2: Register the tool**

In `general-chat.ts`, add `agent_spawn` to the tool list. When invoked, route to `runSubAgent(parentJobId, args, modelContext)`. The parent job id is already available as `ctx.jobId` (verify; thread through if missing).

- [ ] **Step 3: Tests**

Add to `src/lib/workflows/chat/sub-agent.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

describe('sub-agent dispatch', () => {
  it('emits subagent_start and subagent_done on parent job', async () => {
    // Mock generalChat to return a trivial response
    vi.doMock('./general-chat', () => ({
      generalChat: async () => ({ response: 'done' }),
    }));
    const { runSubAgent } = await import('./sub-agent');
    const { createJob, subscribeJob } = await import('./job-store');
    const { jobId: parentId } = createJob('parent');
    const events: any[] = [];
    subscribeJob(parentId, (e) => events.push(e));
    await runSubAgent(parentId, { task: 'find X' }, { provider: 'openrouter', modelId: 'test' });
    expect(events.some((e) => e.type === 'subagent_start')).toBe(true);
    expect(events.some((e) => e.type === 'subagent_done')).toBe(true);
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/chat/sub-agent.ts \
        src/lib/workflows/chat/sub-agent.test.ts \
        src/lib/workflows/chat/general-chat.ts
git commit -m "feat(jkai): add agent_spawn tool for sub-agent dispatch"
```

### Task 4.2 — Nested progress bubble for sub-agents

**Files:**
- Create: `src/lib/components/jkai/SubAgentBubble.svelte`
- Modify: `src/lib/components/jkai/ChatArea.svelte`

- [ ] **Step 1: Track sub-agent state in ChatArea**

```ts
interface SubAgent {
  agentId: string;
  task: string;
  status: 'running' | 'done';
  summary?: string;
  toolSteps: ToolStep[];
  liveTokens: string;
}
let subAgents = $state<Record<string, SubAgent>>({});

// SSE switch:
case 'subagent_start':
  subAgents[data.agentId] = { agentId: data.agentId, task: data.task, status: 'running', toolSteps: [], liveTokens: '' };
  break;
case 'subagent_event': {
  const a = subAgents[data.agentId]; if (!a) break;
  const ev = data.event;
  if (ev.type === 'token') a.liveTokens += ev.delta;
  else if (ev.type === 'tool_start') a.toolSteps.push({ toolCallId: ev.toolCallId ?? '', tool: ev.tool, args: ev.args, status: 'running' });
  else if (ev.type === 'tool_result') {
    const i = a.toolSteps.findIndex((s) => s.toolCallId === ev.toolCallId);
    if (i >= 0) a.toolSteps[i] = { ...a.toolSteps[i], status: ev.status, result: ev.result, summary: ev.summary };
  }
  break;
}
case 'subagent_done':
  if (subAgents[data.agentId]) {
    subAgents[data.agentId].status = 'done';
    subAgents[data.agentId].summary = data.summary;
  }
  break;
```

- [ ] **Step 2: Render**

`SubAgentBubble.svelte` is structurally identical to the main progress bubble minus the composer — re-use step-card markup. Render a list of active sub-agents above the progress bubble:

```svelte
{#each Object.values(subAgents) as agent (agent.agentId)}
  <SubAgentBubble {agent} />
{/each}
```

Style with a distinct left-border colour or slight indent so they read as nested.

- [ ] **Step 3: Manual verification**

Ask /jkai a question that triggers `agent_spawn` (prompt the orchestrator: "spawn a sub-agent to research X while you keep responding"). Two progress regions appear: parent + nested child. Child shows its own step cards; parent sees a summary when child completes.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/jkai/SubAgentBubble.svelte src/lib/components/jkai/ChatArea.svelte
git commit -m "feat(jkai): nested progress bubble for sub-agents"
```

### Task 4.3 — Deploy Phase 4

Standard deploy + prod smoke test.

---

## **CHECKPOINT CP-4**

**Review with user:**
1. Does sub-agent dispatch work reliably? Any race conditions when parent + child tool-call simultaneously?
2. Is the nested bubble legible, or does it clutter the chat?
3. Should the parent be able to cancel a sub-agent from the UI (destructive action — out of scope here, add to a follow-up if wanted)?

**STOP. Await confirmation before Phase 5.**

---

## Phase 5 — Confirmation Gates + Clarification Round

### Task 5.1 — Confirmation gate for destructive ops

**Files:**
- Create: `src/lib/workflows/chat/confirmation-gate.ts`
- Modify: tool implementations for `workflow_delete`, `web_app_publish`, `gmail_send`, `intel_note_delete` — wrap each to call `requireConfirmation` before executing
- Modify: `ChatArea.svelte`
- Create: `src/lib/components/jkai/ConfirmBanner.svelte`

- [ ] **Step 1: Implement the gate**

```ts
// src/lib/workflows/chat/confirmation-gate.ts
import { publishJobEvent, createWaiter } from './job-store';

export async function requireConfirmation(
  jobId: string,
  prompt: string,
  details?: Record<string, unknown>,
  opts: { destructive?: boolean } = {},
): Promise<boolean> {
  const confirmId = crypto.randomUUID();
  publishJobEvent(jobId, { type: 'confirm', confirmId, prompt, destructive: opts.destructive ?? true, details });
  const { awaitResponse } = createWaiter<{ decision: 'approved' | 'rejected' }>(jobId, `confirm:${confirmId}`);
  const res = await awaitResponse();
  return res.decision === 'approved';
}
```

- [ ] **Step 2: Wire into destructive tools**

Identify destructive tools. Audit: `grep -n "tool.*{ name:" src/lib/workflows/site-tools/ src/lib/workflows/intel/` to list them. Wrap the execution body, e.g. in `workflow_delete`:

```ts
const ok = await requireConfirmation(jobId, `Delete workflow "${workflow.name}"? This cannot be undone.`, { workflowId, nodeCount: workflow.nodes.length }, { destructive: true });
if (!ok) return { success: false, error: 'User declined' };
// ... actual delete
```

- [ ] **Step 3: ConfirmBanner component**

```svelte
<script lang="ts">
  let { confirmId, prompt, destructive, details, jobId, onresolve } = $props<{
    confirmId: string;
    prompt: string;
    destructive?: boolean;
    details?: Record<string, unknown>;
    jobId: string;
    onresolve: (decision: 'approved' | 'rejected') => void;
  }>();
  let submitting = $state(false);
  async function send(decision: 'approved' | 'rejected') {
    submitting = true;
    await fetch(`/api/workflows/orchestrator/chat?jobId=${jobId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'confirm_ack', confirmId, decision }),
    });
    onresolve(decision);
  }
</script>
<section class="confirm-banner nm-sec" data-destructive={destructive}>
  <header class="nm-sec-hd"><span class="sr-label-tight">{destructive ? 'confirm destructive action' : 'confirm'}</span></header>
  <p class="confirm-prompt">{prompt}</p>
  {#if details}
    <details><summary class="sr-label-tight">details</summary><pre>{JSON.stringify(details, null, 2)}</pre></details>
  {/if}
  <div class="confirm-actions">
    <button class="nm-save-btn" disabled={submitting} onclick={() => send('approved')}>proceed</button>
    <button class="nm-save-btn secondary" disabled={submitting} onclick={() => send('rejected')}>cancel</button>
  </div>
</section>
<style>
  .confirm-banner[data-destructive="true"] { border-color: #c25b5b; }
  .confirm-prompt { font-family: var(--font-mono); font-size: 12px; color: var(--text-primary); }
  .confirm-actions { display: flex; gap: 8px; margin-top: 10px; }
  .nm-save-btn.secondary { background: transparent; color: var(--text-primary); border: 1px solid var(--card-border); }
</style>
```

- [ ] **Step 4: Wire into ChatArea** (analogous to PlanCard):

```ts
let pendingConfirm = $state<{ confirmId: string; prompt: string; destructive?: boolean; details?: Record<string, unknown> } | null>(null);
case 'confirm': pendingConfirm = { ...data }; break;
case 'confirm_ack': pendingConfirm = null; break;
```

- [ ] **Step 5: Tests**

```ts
describe('confirmation gate', () => {
  it('publishes confirm event and awaits response', async () => {
    const { createJob, subscribeJob, respondToWaiter } = await import('./job-store');
    const { requireConfirmation } = await import('./confirmation-gate');
    const { jobId } = createJob('t');
    const events: any[] = [];
    subscribeJob(jobId, (e) => events.push(e));
    const pending = requireConfirmation(jobId, 'Delete?', { x: 1 });
    // Find the confirm event and its id
    await new Promise((r) => setTimeout(r, 5));
    const confirmEv = events.find((e) => e.type === 'confirm');
    expect(confirmEv).toBeDefined();
    respondToWaiter(jobId, `confirm:${confirmEv.confirmId}`, { decision: 'approved' });
    const ok = await pending;
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/chat/confirmation-gate.ts \
        src/lib/workflows/chat/confirmation-gate.test.ts \
        src/lib/components/jkai/ConfirmBanner.svelte \
        src/lib/components/jkai/ChatArea.svelte \
        src/lib/workflows/site-tools/*.ts  # whichever files were modified
git commit -m "feat(jkai): confirmation gate for destructive tool invocations"
```

### Task 5.2 — Clarification round

**Files:**
- Create: `src/lib/workflows/chat/clarify-phase.ts`
- Modify: `src/lib/workflows/chat/general-chat.ts` (recognize `<clarify>` tag)
- Create: `src/lib/components/jkai/ClarifyCard.svelte`

- [ ] **Step 1: Prompt augmentation**

In the system prompt (same area as plan-phase prompt), add:

```text
If the request is genuinely ambiguous — i.e. you cannot safely proceed without more information — emit a clarify block and stop:

<clarify>{
  "questions": [
    {"id": "q1", "text": "Question text", "kind": "freeform"},
    {"id": "q2", "text": "Pick an option", "kind": "choice", "choices": ["a", "b", "c"]}
  ]
}</clarify>

Limit to at most 3 questions. Do not clarify if you can proceed with a reasonable assumption.
```

- [ ] **Step 2: Extract + suspend**

`src/lib/workflows/chat/clarify-phase.ts` mirrors plan-phase.ts:

```ts
import { publishJobEvent, createWaiter } from './job-store';
import type { ClarifyQuestion } from './job-store';

const CLARIFY_RE = /<clarify>([\s\S]*?)<\/clarify>/;

export function extractClarify(text: string): { questions: ClarifyQuestion[]; cleaned: string } | null {
  const m = text.match(CLARIFY_RE);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (!Array.isArray(parsed.questions)) return null;
    return { questions: parsed.questions, cleaned: text.replace(CLARIFY_RE, '').trim() };
  } catch {
    return null;
  }
}

export async function awaitClarifyAnswers(
  jobId: string,
  questions: ClarifyQuestion[],
): Promise<{ answers: Record<string, string> }> {
  const clarifyId = crypto.randomUUID();
  publishJobEvent(jobId, { type: 'clarify', clarifyId, questions });
  const { awaitResponse } = createWaiter<{ answers: Record<string, string> }>(jobId, `clarify:${clarifyId}`);
  return awaitResponse();
}
```

Wire into general-chat ahead of plan extraction — clarifications should happen before plans.

- [ ] **Step 3: ClarifyCard component**

```svelte
<script lang="ts">
  import type { ClarifyQuestion } from '$lib/workflows/chat/job-store';
  let { clarifyId, questions, jobId, onresolve } = $props<{
    clarifyId: string;
    questions: ClarifyQuestion[];
    jobId: string;
    onresolve: (answers: Record<string, string>) => void;
  }>();
  let answers = $state<Record<string, string>>(Object.fromEntries(questions.map((q) => [q.id, ''])));
  let submitting = $state(false);
  async function submit() {
    submitting = true;
    await fetch(`/api/workflows/orchestrator/chat?jobId=${jobId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'clarify_ack', clarifyId, answers }),
    });
    onresolve(answers);
  }
  const canSubmit = $derived(questions.every((q) => answers[q.id]?.trim()));
</script>
<section class="clarify-card nm-sec">
  <header class="nm-sec-hd"><span class="sr-label-tight">need a little more info</span></header>
  <ul class="q-list">
    {#each questions as q}
      <li class="q-item">
        <label class="q-text">{q.text}</label>
        {#if q.kind === 'choice' && q.choices}
          <select class="nm-text-input" bind:value={answers[q.id]}>
            <option value="">—</option>
            {#each q.choices as c}<option value={c}>{c}</option>{/each}
          </select>
        {:else}
          <input class="nm-text-input" type="text" bind:value={answers[q.id]} />
        {/if}
      </li>
    {/each}
  </ul>
  <div class="q-actions">
    <button class="nm-save-btn" disabled={submitting || !canSubmit} onclick={submit}>continue</button>
  </div>
</section>
<style>
  .clarify-card { margin: 8px 0; }
  .q-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
  .q-item { display: flex; flex-direction: column; gap: 4px; }
  .q-text { font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); }
  .q-actions { margin-top: 12px; }
</style>
```

- [ ] **Step 4: Wire into ChatArea** (analogous to PlanCard)

```ts
let pendingClarify = $state<{ clarifyId: string; questions: ClarifyQuestion[] } | null>(null);
case 'clarify': pendingClarify = { clarifyId: data.clarifyId, questions: data.questions }; break;
case 'clarify_ack': pendingClarify = null; break;
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/chat/clarify-phase.ts \
        src/lib/workflows/chat/general-chat.ts \
        src/lib/components/jkai/ClarifyCard.svelte \
        src/lib/components/jkai/ChatArea.svelte
git commit -m "feat(jkai): clarification phase for ambiguous requests"
```

### Task 5.3 — Final deploy

- [ ] **Step 1: Lint + typecheck + full test suite**

```bash
cd ~/strange_rambling_svelte
npm run lint
npx tsc --noEmit
npx vitest run
```

- [ ] **Step 2: Deploy**

```bash
git push origin main && ./scripts/deploy.sh
```

- [ ] **Step 3: End-to-end prod smoke**

Exercise each phase on `strangeramblings.com/jkai`:
- Long tool call → heartbeat appears
- Multi-step request → plan card → "go" → steps execute with summary cards
- `agent_spawn` dispatch → nested bubble
- Destructive tool (e.g. delete a throwaway workflow) → confirm banner
- Ambiguous request ("do the thing") → clarify card

---

## **CHECKPOINT CP-5 (Final)**

Full feature parity with the review document. User signs off; close out the plan.

---

## Self-Review

**Spec coverage:**
- #1 Heartbeat — Task 1.1–1.2 ✓
- #2 Thinking visible — Task 1.3 ✓
- #3 Step summary cards — Task 2.1 ✓
- #4 `.nm-*` migration — Task 0.3, 2.2 ✓
- #5 Plan-before-execute — Task 3.1–3.2 ✓
- #6 Sub-agent dispatch — Task 4.1–4.2 ✓
- #7 Confirmation gates — Task 5.1 ✓
- #8 Clarification round — Task 5.2 ✓

**Known residual risks:**
- `general-chat.ts` plan-extraction integration point is described generically because its exact loop structure was not fully read during plan-writing; the executing agent must read lines 500–700 before wiring.
- Tool whitelist support in `generalChat` may not exist today; Task 4.1 introduces it.
- Sub-agent dispatched from inside another sub-agent is not prohibited here; if depth is a concern, add a depth counter in `runSubAgent`.
- Confirmation gate wrapping in individual tool files is enumerated generically; the executing agent must audit `src/lib/workflows/site-tools/` and `src/lib/workflows/intel/` to find every destructive entrypoint.

**Cross-task type consistency:**
- `PlanPayload`, `ClarifyQuestion`, `JobEvent` defined in Task 0.1 and reused consistently.
- `respondToWaiter` / `createWaiter` API stable across 3.1, 5.1, 5.2.
- `PATCH` endpoint (Task 3.1 Step 5) handles `plan_ack`, `confirm_ack`, `clarify_ack` — all three consistent.
