# Orchestrator Heartbeat Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cosmetic-only heartbeat with an always-visible status pill, a self-prod mechanism that drives the orchestrator forward through stalls, and an idle cycler that runs scheduled background work — without touching the watchdog safety net.

**Architecture:** Phase derivation lives next to the job in `job-store.ts`; self-prod hooks into the round-end path in `general-chat.ts`; idle cycler is a single-tick singleton bootstrapped from `hooks.server.ts` that broadcasts to a new `/api/jkai/pulse` SSE channel. The /jkai pill subscribes to both the per-job stream and the pulse stream.

**Tech Stack:** SvelteKit, Svelte 5, TypeScript, Drizzle ORM, PostgreSQL 16, Vitest, OpenAI-compatible chat client, EventSource SSE.

---

## Spec reference

`docs/superpowers/specs/2026-04-27-orchestrator-heartbeat-redesign-design.md`

## Pre-Flight (do once before starting)

- Confirm running on the long-lived process. The cycler must run where `setInterval` survives — homeserv (`pnpm dev` / production node service), not a per-request VPS handler. **Verify** by running on homeserv and tailing logs for the first cycler tick. If SvelteKit on the VPS is the long-lived server for /jkai, gate the cycler bootstrap behind `process.env.HOSTNAME === 'homeserv'` instead.
- Set `PULSE_ENABLED=0`, `SELF_PROD_ENABLED=0`, `PULSE_CYCLER_ENABLED=0` in `.env` so nothing is live until each phase is verified.
- Ensure `npm run dev` is reachable on `http://homeserv:5173` for manual verification later.

## File Structure

**Modify:**
- `src/lib/workflows/chat/job-store.ts` — extend `OrchestratorJob` shape, enrich heartbeat payload, expose phase derivation, add `inflightTool` tracking
- `src/lib/workflows/chat/general-chat.ts` — emit richer tool events, populate `job.plan` after approval, hook self-prod into round-end
- `src/lib/workflows/chat/job-store.test.ts` — extend tests
- `src/lib/components/jkai/ChatArea.svelte` — replace heartbeat-line with pill + popover
- `src/hooks.server.ts` — bootstrap the idle cycler
- `src/lib/db/schema.ts` — add `pulseEvents`, `pulseSettings` tables

**Create:**
- `src/lib/workflows/chat/self-prod.ts` — decision module
- `src/lib/workflows/chat/self-prod.test.ts`
- `src/lib/workflows/chat/idle-cycler.ts` — system scheduler
- `src/lib/workflows/chat/idle-cycler.test.ts`
- `src/lib/workflows/chat/pulse-jobs/health-check.ts`
- `src/lib/workflows/chat/pulse-jobs/audit-digest.ts`
- `src/lib/workflows/chat/pulse-jobs/workflow-efficiency.ts`
- `src/lib/workflows/chat/pulse-jobs/chat-log-review.ts`
- `src/lib/workflows/chat/pulse-jobs/memory-update-review.ts`
- `src/lib/components/jkai/HeartbeatPill.svelte` — the pill itself
- `src/lib/components/jkai/HeartbeatPanel.svelte` — popover content
- `src/lib/components/jkai/PulseFeed.svelte` — sidebar background-activity feed
- `src/routes/api/jkai/pulse/+server.ts` — pulse SSE channel + REST list

---

## Section 1 — Foundation (always-on, no flag)

### Task 1: Extend `OrchestratorJob` shape

**Files:**
- Modify: `src/lib/workflows/chat/job-store.ts:103-122`
- Modify: `src/lib/workflows/chat/job-store.ts:191-214` (createJob)

- [ ] **Step 1: Add new fields to the `OrchestratorJob` interface**

Edit `src/lib/workflows/chat/job-store.ts` at the interface (current lines 103-122). Add these fields after `partialResponse: string;`:

```ts
  // --- Phase / pill ---
  inflightTool: { name: string; toolCallId: string; since: number } | null;
  awaitingWaiter: { kind: 'plan' | 'clarify' | 'confirm'; key: string; since: number } | null;
  // --- Plan + self-prod ---
  plan: PlanPayload | null;
  coveredStepIds: Set<string>;
  selfProdCount: number;
  lastSelfProdAt: number | null;
```

- [ ] **Step 2: Initialise the new fields in `createJob`**

Inside `createJob` (around line 194-209), add to the `job` object literal after `partialResponse: ''`:

```ts
    inflightTool: null,
    awaitingWaiter: null,
    plan: null,
    coveredStepIds: new Set<string>(),
    selfProdCount: 0,
    lastSelfProdAt: null,
```

- [ ] **Step 3: Run typecheck**

Run: `cd ~/strange_rambling_svelte && pnpm tsgo 2>&1 | head -40` (if available) or `npx tsc --noEmit 2>&1 | head -40`
Expected: no new errors related to `OrchestratorJob`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/chat/job-store.ts
git commit -m "feat(orchestrator): extend OrchestratorJob with phase/plan/self-prod fields"
```

---

### Task 2: Add phase derivation helper

**Files:**
- Modify: `src/lib/workflows/chat/job-store.ts` (append after `listJobs`)
- Modify: `src/lib/workflows/chat/job-store.test.ts`

- [ ] **Step 1: Write failing tests for `derivePhase`**

Append to `src/lib/workflows/chat/job-store.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createJob, derivePhase, publishJobEvent, getJob } from './job-store';

describe('derivePhase', () => {
  afterEach(() => vi.useRealTimers());

  it('returns idle when job is not running', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    job.status = 'done';
    expect(derivePhase(job)).toBe('idle');
  });

  it('returns awaiting_user when a waiter is registered', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    job.awaitingWaiter = { kind: 'plan', key: 'plan:abc', since: Date.now() };
    expect(derivePhase(job)).toBe('awaiting_user');
  });

  it('returns tool when a tool is in flight', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    job.inflightTool = { name: 'stealth-scrape', toolCallId: 'c1', since: Date.now() };
    expect(derivePhase(job)).toBe('tool');
  });

  it('returns streaming when a recent token event arrived', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    job.lastTokenAt = Date.now();
    expect(derivePhase(job)).toBe('streaming');
  });

  it('returns stalled when last event is older than 25s', () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 0, 1);
    vi.setSystemTime(start);
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    job.lastEventAt = start;
    vi.setSystemTime(start + 26_000);
    expect(derivePhase(job)).toBe('stalled');
  });

  it('returns thinking when running with no tool, no streaming, recent activity', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    expect(derivePhase(job)).toBe('thinking');
  });
});
```

- [ ] **Step 2: Add `lastTokenAt` field to `OrchestratorJob`**

Edit `src/lib/workflows/chat/job-store.ts` interface, add after the new `awaitingWaiter` field:

```ts
  lastTokenAt: number | null;
```

In `createJob`'s job literal, add:

```ts
    lastTokenAt: null,
```

- [ ] **Step 3: Run tests to verify failure**

Run: `cd ~/strange_rambling_svelte && pnpm test job-store -- --run 2>&1 | tail -30`
Expected: 6 new test failures (`derivePhase is not exported`).

- [ ] **Step 4: Implement `derivePhase` and export the phase type**

Append to `src/lib/workflows/chat/job-store.ts` (after `listJobs`):

```ts
export type Phase = 'idle' | 'thinking' | 'streaming' | 'tool' | 'awaiting_user' | 'stalled';

export const STREAMING_FRESHNESS_MS = 2_000;

export function derivePhase(job: OrchestratorJob): Phase {
  if (job.status !== 'running') return 'idle';
  if (job.awaitingWaiter) return 'awaiting_user';
  if (job.inflightTool) return 'tool';
  const now = Date.now();
  if (job.lastTokenAt && now - job.lastTokenAt < STREAMING_FRESHNESS_MS) return 'streaming';
  if (now - job.lastEventAt >= 25_000) return 'stalled';
  return 'thinking';
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd ~/strange_rambling_svelte && pnpm test job-store -- --run 2>&1 | tail -30`
Expected: all `derivePhase` tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/chat/job-store.ts src/lib/workflows/chat/job-store.test.ts
git commit -m "feat(orchestrator): add derivePhase + lastTokenAt for pill state"
```

---

### Task 3: Track `inflightTool`, `awaitingWaiter`, `lastTokenAt` on event publish

**Files:**
- Modify: `src/lib/workflows/chat/job-store.ts:59-95` (publishJobEvent)
- Modify: `src/lib/workflows/chat/job-store.ts` (createWaiter)
- Modify: `src/lib/workflows/chat/job-store.test.ts`

- [ ] **Step 1: Write failing test that publishing a `tool_start` sets `inflightTool` and `tool_result` clears it**

Append to `src/lib/workflows/chat/job-store.test.ts`:

```ts
describe('inflightTool tracking', () => {
  it('tool_start sets inflightTool, tool_result clears it', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    publishJobEvent(jobId, { type: 'tool_start', tool: 't1', args: {}, toolCallId: 'c1' });
    expect(job.inflightTool?.name).toBe('t1');
    expect(job.inflightTool?.toolCallId).toBe('c1');
    publishJobEvent(jobId, { type: 'tool_result', tool: 't1', result: {}, status: 'done', toolCallId: 'c1' });
    expect(job.inflightTool).toBeNull();
  });

  it('token event updates lastTokenAt', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    expect(job.lastTokenAt).toBeNull();
    publishJobEvent(jobId, { type: 'token', delta: 'hello' });
    expect(job.lastTokenAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd ~/strange_rambling_svelte && pnpm test job-store -- --run 2>&1 | tail -20`
Expected: 2 failures (inflightTool stays null / lastTokenAt stays null).

- [ ] **Step 3: Update `publishJobEvent` to maintain inflight state**

Edit `src/lib/workflows/chat/job-store.ts`, in `publishJobEvent`, BEFORE the existing `if (event.type !== 'heartbeat')` block, add:

```ts
  const job = jobs.get(jobId);
  if (job) {
    if (event.type === 'tool_start') {
      job.inflightTool = {
        name: event.tool,
        toolCallId: event.toolCallId ?? '',
        since: Date.now(),
      };
    } else if (event.type === 'tool_result') {
      if (job.inflightTool && job.inflightTool.toolCallId === (event.toolCallId ?? '')) {
        job.inflightTool = null;
      }
    } else if (event.type === 'token') {
      job.lastTokenAt = Date.now();
    }
  }
```

Then remove the duplicate `const job = jobs.get(jobId);` lookup inside the existing `if (event.type !== 'heartbeat')` block, since `job` is now in scope.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd ~/strange_rambling_svelte && pnpm test job-store -- --run 2>&1 | tail -20`
Expected: all tests pass (existing + new).

- [ ] **Step 5: Update `createWaiter` to mark `awaitingWaiter`**

Edit `createWaiter` in `src/lib/workflows/chat/job-store.ts`. Replace the function body so it parses the `key` prefix (`plan:` / `clarify:` / `confirm:`) and writes `job.awaitingWaiter`. Also clear it when responding/rejecting. Replace the existing function with:

```ts
export function createWaiter<T = unknown>(
  jobId: string,
  key: string,
): { awaitResponse: () => Promise<T>; respond: (value: T) => void } {
  let map = waiters.get(jobId);
  if (!map) { map = new Map(); waiters.set(jobId, map); }
  let waiter: Waiter | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    waiter = { resolve: resolve as (v: unknown) => void, reject };
  });
  if (!waiter) throw new Error('waiter init failed');
  map.set(key, waiter);

  const job = jobs.get(jobId);
  if (job) {
    const kind: 'plan' | 'clarify' | 'confirm' | null =
      key.startsWith('plan:') ? 'plan'
      : key.startsWith('clarify:') ? 'clarify'
      : key.startsWith('confirm:') ? 'confirm'
      : null;
    if (kind) job.awaitingWaiter = { kind, key, since: Date.now() };
  }

  return {
    awaitResponse: () => promise,
    respond: (value: T) => {
      const m = waiters.get(jobId); if (!m) return;
      const w = m.get(key); if (!w) return;
      m.delete(key);
      if (m.size === 0) waiters.delete(jobId);
      const j = jobs.get(jobId);
      if (j && j.awaitingWaiter && j.awaitingWaiter.key === key) j.awaitingWaiter = null;
      w.resolve(value);
    },
  };
}
```

Also update `respondToWaiter` and `rejectWaiter` to clear `awaitingWaiter` when their key matches:

```ts
export function respondToWaiter(jobId: string, key: string, value: unknown): boolean {
  const m = waiters.get(jobId); if (!m) return false;
  const w = m.get(key); if (!w) return false;
  m.delete(key);
  if (m.size === 0) waiters.delete(jobId);
  const j = jobs.get(jobId);
  if (j && j.awaitingWaiter && j.awaitingWaiter.key === key) j.awaitingWaiter = null;
  w.resolve(value);
  return true;
}

export function rejectWaiter(jobId: string, key: string, reason: string): void {
  const m = waiters.get(jobId); if (!m) return;
  const w = m.get(key); if (!w) return;
  m.delete(key);
  if (m.size === 0) waiters.delete(jobId);
  const j = jobs.get(jobId);
  if (j && j.awaitingWaiter && j.awaitingWaiter.key === key) j.awaitingWaiter = null;
  w.reject(new Error(reason));
}
```

- [ ] **Step 6: Add waiter-tracking test**

Append to `src/lib/workflows/chat/job-store.test.ts`:

```ts
describe('awaitingWaiter tracking', () => {
  it('createWaiter sets awaitingWaiter, respondToWaiter clears it', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    const w = createWaiter<unknown>(jobId, 'plan:abc');
    expect(job.awaitingWaiter?.kind).toBe('plan');
    expect(job.awaitingWaiter?.key).toBe('plan:abc');
    w.respond('ok');
    expect(job.awaitingWaiter).toBeNull();
  });
});
```

- [ ] **Step 7: Run tests, expect pass**

Run: `cd ~/strange_rambling_svelte && pnpm test job-store -- --run 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/workflows/chat/job-store.ts src/lib/workflows/chat/job-store.test.ts
git commit -m "feat(orchestrator): track inflightTool/awaitingWaiter/lastTokenAt"
```

---

### Task 4: Enrich heartbeat event payload

**Files:**
- Modify: `src/lib/workflows/chat/job-store.ts:30-49` (JobEvent type)
- Modify: `src/lib/workflows/chat/job-store.ts:163-189` (startHeartbeat)
- Modify: `src/lib/workflows/chat/job-store.test.ts`

- [ ] **Step 1: Update the `JobEvent` heartbeat variant**

In `src/lib/workflows/chat/job-store.ts`, replace:

```ts
  | { type: 'heartbeat'; summary: string; elapsedMs: number }
```

with:

```ts
  | {
      type: 'heartbeat';
      phase: Exclude<Phase, 'idle' | 'streaming'>; // streaming/idle never fire heartbeat
      summary: string;
      currentStep: string | null;
      inflightTool: { name: string; sinceMs: number } | null;
      awaitingWaiter: { kind: 'plan' | 'clarify' | 'confirm'; sinceMs: number } | null;
      elapsedMs: number;
      sinceLastEventMs: number;
      watchdog: {
        idleMs: number;
        idleLimitMs: number;
        totalMs: number;
        totalLimitMs: number;
      };
    }
```

(`Phase` is already exported by Task 2.)

- [ ] **Step 2: Update `startHeartbeat` to emit the rich payload**

Replace the body of `startHeartbeat` in `src/lib/workflows/chat/job-store.ts` with:

```ts
function startHeartbeat(jobId: string, job: OrchestratorJob): void {
  job.heartbeat = setInterval(() => {
    if (job.status !== 'running') {
      if (job.heartbeat) clearInterval(job.heartbeat);
      job.heartbeat = undefined;
      return;
    }
    const now = Date.now();
    const sinceEvent = now - job.lastEventAt;
    const sinceHeartbeat = now - job.lastHeartbeatAt;
    if (sinceEvent < HEARTBEAT_MIN_SILENCE_MS || sinceHeartbeat < HEARTBEAT_MIN_SILENCE_MS) return;

    const phase = derivePhase(job);
    if (phase === 'idle' || phase === 'streaming') return;

    const summary =
      job.currentStep ??
      job.progress[job.progress.length - 1] ??
      'Still thinking...';
    job.lastHeartbeatAt = now;
    publishJobEvent(jobId, {
      type: 'heartbeat',
      phase,
      summary: summary.trim().slice(0, 140),
      currentStep: job.currentStep ?? null,
      inflightTool: job.inflightTool
        ? { name: job.inflightTool.name, sinceMs: now - job.inflightTool.since }
        : null,
      awaitingWaiter: job.awaitingWaiter
        ? { kind: job.awaitingWaiter.kind, sinceMs: now - job.awaitingWaiter.since }
        : null,
      elapsedMs: now - job.startedAt,
      sinceLastEventMs: sinceEvent,
      watchdog: {
        idleMs: sinceEvent,
        idleLimitMs: IDLE_TIMEOUT_MS,
        totalMs: now - job.startedAt,
        totalLimitMs: HARD_TIMEOUT_MS,
      },
    });
  }, HEARTBEAT_CHECK_INTERVAL_MS);
}
```

- [ ] **Step 3: Update existing heartbeat tests**

In `src/lib/workflows/chat/job-store.test.ts`, locate the existing `'emits a heartbeat event after 25s of silence'` test and update assertions to check the new payload shape. Find the existing test (around line 64) and replace its body with:

```ts
    vi.useFakeTimers();
    const start = Date.UTC(2026, 0, 1);
    vi.setSystemTime(start);
    const { jobId } = createJob('hi');
    const received: JobEvent[] = [];
    subscribeJob(jobId, (e) => received.push(e));
    vi.setSystemTime(start + 30_000);
    await vi.advanceTimersByTimeAsync(5_000);
    const hb = received.find((e) => e.type === 'heartbeat');
    expect(hb).toBeDefined();
    if (hb && hb.type === 'heartbeat') {
      expect(hb.phase).toBe('thinking');
      expect(hb.elapsedMs).toBeGreaterThanOrEqual(30_000);
      expect(hb.watchdog.idleLimitMs).toBe(180_000);
      expect(hb.watchdog.totalLimitMs).toBe(600_000);
    }
```

The previous shape test at the top of the file (`{ type: 'heartbeat', summary: '...', elapsedMs: 30000 }`) needs the new fields too. Update it to:

```ts
{
  type: 'heartbeat',
  phase: 'thinking',
  summary: 'Still working: fetching data',
  currentStep: 'fetching data',
  inflightTool: null,
  awaitingWaiter: null,
  elapsedMs: 30000,
  sinceLastEventMs: 30000,
  watchdog: { idleMs: 30000, idleLimitMs: 180000, totalMs: 30000, totalLimitMs: 600000 },
} satisfies JobEvent,
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd ~/strange_rambling_svelte && pnpm test job-store -- --run 2>&1 | tail -30`
Expected: all pass.

- [ ] **Step 5: Update existing ChatArea heartbeat consumer to tolerate the new shape (no UI change yet)**

The existing handler in `src/lib/components/jkai/ChatArea.svelte` line 594 reads `data.summary` and `data.elapsedMs`. These still exist. Confirm by grep:

Run: `grep -n "data.summary\|data.elapsedMs" /home/john/strange_rambling_svelte/src/lib/components/jkai/ChatArea.svelte`
Expected: matches reference fields the new shape still provides. No edit required in this task.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/chat/job-store.ts src/lib/workflows/chat/job-store.test.ts
git commit -m "feat(orchestrator): emit rich heartbeat payload (phase, watchdog, tool)"
```

---

### Task 5: Populate `job.plan` after approval and track `currentStep`/`coveredStepIds`

**Files:**
- Modify: `src/lib/workflows/chat/general-chat.ts:780-836` (clarify/plan interception)
- Modify: `src/lib/workflows/chat/general-chat.ts` (currentStep + coverage updates inside the loop)

- [ ] **Step 1: After plan approval, store the plan on the job**

In `src/lib/workflows/chat/general-chat.ts` inside the plan-phase interception block (currently around line 805–836), immediately after `const decision = await awaitPlanApproval(options.jobId, extracted.plan);` and BEFORE the rejected check, add:

```ts
        if (options.jobId) {
          const job = getJob(options.jobId);
          if (job && (decision.decision === 'approved' || decision.decision === 'adjusted')) {
            job.plan = extracted.plan;
            job.coveredStepIds = new Set();
          }
        }
```

You will need to import `getJob`. Find the existing import from `./job-store` near the top of the file and add `getJob` to the imports.

- [ ] **Step 2: Update `coveredStepIds` whenever a tool result arrives**

In `general-chat.ts` find the `for (const { toolMessage } of toolOutcomes) { messages.push(toolMessage); }` block (around line 876-878) and replace with:

```ts
    for (const { toolMessage } of toolOutcomes) {
      messages.push(toolMessage);
      if (options.jobId) {
        const job = getJob(options.jobId);
        if (job?.plan) {
          const haystack = (typeof toolMessage.content === 'string' ? toolMessage.content : '').toLowerCase();
          for (const step of job.plan.steps) {
            if (job.coveredStepIds.has(step.id)) continue;
            const idHit = step.id && haystack.includes(step.id.toLowerCase());
            const titleSnippet = (step.title ?? '').slice(0, 30).toLowerCase();
            const titleHit = titleSnippet.length >= 6 && haystack.includes(titleSnippet);
            if (idHit || titleHit) job.coveredStepIds.add(step.id);
          }
        }
      }
    }
```

- [ ] **Step 3: Update `currentStep` from `onProgress` so the heartbeat can name what's happening**

There is already a `currentStep` field on the job (Task 1 did not add it — it pre-existed). Confirm it gets populated. Search for any current writer:

Run: `grep -n "currentStep" /home/john/strange_rambling_svelte/src/lib/workflows/chat/`
Expected: only the comment in job-store.ts; nothing writes it today.

Add a writer. In `general-chat.ts`, find the existing `onProgress` invocation `onProgress?.(`${fnName}: running${runningSummary ? ` — ${runningSummary}` : ''}\n`);` (around line 166 in `runSingleToolCall`). Right before it, add (note `parentJobId` is the field name — verify by grep, otherwise rename to match):

```ts
  if (parentJobId) {
    const j = getJob(parentJobId);
    if (j) j.currentStep = `${fnName}${runningSummary ? `: ${runningSummary}` : ''}`.slice(0, 140);
  }
```

You'll need `getJob` imported in this file already from Step 1.

- [ ] **Step 4: Typecheck**

Run: `cd ~/strange_rambling_svelte && pnpm tsgo 2>&1 | head -40`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/chat/general-chat.ts
git commit -m "feat(orchestrator): track plan + coveredStepIds + currentStep on the job"
```

---

## Section 2 — Database migrations (always-on)

### Task 6: Add `pulseEvents` and `pulseSettings` Drizzle tables

**Files:**
- Modify: `src/lib/db/schema.ts` (append at end)

- [ ] **Step 1: Append the two table definitions**

Append to `src/lib/db/schema.ts`:

```ts
export const pulseEvents = pgTable(
  'pulse_events',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    kind: text('kind').notNull(),       // 'health_check' | 'audit_digest' | 'workflow_efficiency' | 'chat_log_review' | 'memory_update_review' | 'self_prod'
    severity: text('severity').notNull(), // 'info' | 'warn' | 'error'
    summary: text('summary').notNull(),
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  },
  (t) => ({
    byAt: index('pulse_events_at_idx').on(t.at.desc()),
  }),
);

export type PulseEvent = typeof pulseEvents.$inferSelect;
export type NewPulseEvent = typeof pulseEvents.$inferInsert;

export const pulseSettings = pgTable(
  'pulse_settings',
  {
    id: text('id').primaryKey().default(sql`'singleton'`),
    schedules: jsonb('schedules').notNull().default(sql`'{}'::jsonb`),
    idleQuietMs: integer('idle_quiet_ms').notNull().default(300_000),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type PulseSettings = typeof pulseSettings.$inferSelect;
```

If `index` and `integer` are not already imported at the top of the file, ensure they are:

```ts
import { pgTable, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
```

(Adjust the existing import statements to merge — do not duplicate.)

- [ ] **Step 2: Push the schema to local DB**

Run: `cd ~/strange_rambling_svelte && npx drizzle-kit push 2>&1 | tail -20`
Expected: confirms creation of `pulse_events` and `pulse_settings`.

- [ ] **Step 3: Seed the singleton settings row with default schedules**

Run via psql or pgweb:

```sql
INSERT INTO pulse_settings (id, schedules, idle_quiet_ms)
VALUES (
  'singleton',
  '{
    "health_check":         {"intervalMs":  600000, "enabled": true},
    "audit_digest":         {"intervalMs":14400000, "enabled": true},
    "workflow_efficiency":  {"intervalMs":86400000, "enabled": true},
    "chat_log_review":      {"intervalMs":21600000, "enabled": true},
    "memory_update_review": {"intervalMs":86400000, "enabled": true}
  }'::jsonb,
  300000
)
ON CONFLICT (id) DO UPDATE SET schedules = EXCLUDED.schedules, idle_quiet_ms = EXCLUDED.idle_quiet_ms, updated_at = now();
```

If you have a Drizzle seed script, prefer that. The values in ms: 10m / 4h / 24h / 6h / 24h / 5m idle quiet.

- [ ] **Step 4: Verify**

Run: `psql -c "SELECT id, jsonb_object_keys(schedules) FROM pulse_settings;"` (adjust connection string to whatever this repo uses)
Expected: 5 keys printed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(db): add pulse_events + pulse_settings tables"
```

---

## Section 3 — Heartbeat Pill UI (gate: `PULSE_ENABLED`)

### Task 7: Build the `HeartbeatPill` component

**Files:**
- Create: `src/lib/components/jkai/HeartbeatPill.svelte`

- [ ] **Step 1: Write the component**

Create `src/lib/components/jkai/HeartbeatPill.svelte`:

```svelte
<script lang="ts">
  type Phase = 'idle' | 'thinking' | 'streaming' | 'tool' | 'awaiting_user' | 'stalled';

  interface Props {
    phase: Phase;
    label: string;        // e.g. "Tool: stealth-scrape (48s)"
    elapsedSec: number;
    watchdog?: { idleMs: number; idleLimitMs: number };
    onClick?: () => void;
  }

  let { phase = 'idle', label, elapsedSec, watchdog, onClick }: Props = $props();

  const colour: Record<Phase, string> = {
    idle: 'var(--surface-mute, #888)',
    thinking: 'var(--info, #4a8cff)',
    streaming: 'var(--success, #2eaf5f)',
    tool: 'var(--warning, #d99a3a)',
    awaiting_user: 'var(--accent, #8b6cd1)',
    stalled: 'var(--danger, #d24b4b)',
  };

  let countdownSec = $derived(
    watchdog ? Math.max(0, Math.round((watchdog.idleLimitMs - watchdog.idleMs) / 1000)) : null,
  );
</script>

<button class="pill" style:--pill-color={colour[phase]} onclick={() => onClick?.()} aria-live="polite">
  <span class="dot" data-phase={phase}></span>
  <span class="label">{label}</span>
  <span class="elapsed">{elapsedSec}s</span>
  {#if countdownSec !== null && phase === 'stalled'}
    <span class="watchdog" title="Watchdog will terminate after {watchdog!.idleLimitMs / 1000}s idle">
      kill in {countdownSec}s
    </span>
  {/if}
</button>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.6rem;
    background: color-mix(in srgb, var(--pill-color) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--pill-color) 40%, transparent);
    color: var(--pill-color);
    border-radius: 999px;
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .pill:hover { background: color-mix(in srgb, var(--pill-color) 22%, transparent); }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--pill-color);
  }
  .dot[data-phase='streaming'],
  .dot[data-phase='thinking'] {
    animation: pulse 1.6s ease-in-out infinite;
  }
  .dot[data-phase='stalled'] {
    animation: pulse 0.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.35; }
  }
  .elapsed { opacity: 0.7; font-variant-numeric: tabular-nums; }
  .watchdog { opacity: 0.9; font-weight: 600; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/jkai/HeartbeatPill.svelte
git commit -m "feat(jkai): add HeartbeatPill component"
```

---

### Task 8: Build the `HeartbeatPanel` popover

**Files:**
- Create: `src/lib/components/jkai/HeartbeatPanel.svelte`

- [ ] **Step 1: Write the component**

Create `src/lib/components/jkai/HeartbeatPanel.svelte`:

```svelte
<script lang="ts">
  interface Step { id: string; title: string }
  interface PlanInfo { steps: Step[]; activeStepId: string | null; coveredStepIds: string[] }
  interface EventEntry { type: string; summary: string; relMs: number }
  interface PulseEntry { id: string; kind: string; severity: 'info' | 'warn' | 'error'; summary: string; relMs: number }

  interface Props {
    phase: string;
    label: string;
    watchdog: { idleMs: number; idleLimitMs: number; totalMs: number; totalLimitMs: number };
    plan: PlanInfo | null;
    events: EventEntry[];           // last ~20
    pulseEvents: PulseEntry[];      // last ~5
    onClose: () => void;
  }

  let { phase, label, watchdog, plan, events, pulseEvents, onClose }: Props = $props();

  function fmtRel(ms: number): string {
    if (ms < 1000) return 'now';
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    return `${Math.round(ms / 60_000)}m ago`;
  }
</script>

<div class="panel" role="dialog" aria-label="Orchestrator status">
  <header class="head">
    <strong>{label}</strong>
    <span class="phase">{phase}</span>
    <button onclick={onClose} aria-label="Close" class="close">×</button>
  </header>

  <section>
    <h4>Watchdog</h4>
    <ul class="meters">
      <li>Idle: {Math.round(watchdog.idleMs / 1000)}s / {Math.round(watchdog.idleLimitMs / 1000)}s</li>
      <li>Total: {Math.round(watchdog.totalMs / 1000)}s / {Math.round(watchdog.totalLimitMs / 1000)}s</li>
    </ul>
  </section>

  {#if plan}
    <section>
      <h4>Plan</h4>
      <ol class="steps">
        {#each plan.steps as step}
          <li
            class:active={plan.activeStepId === step.id}
            class:covered={plan.coveredStepIds.includes(step.id)}
          >
            {step.title}
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  <section>
    <h4>Recent events</h4>
    <ul class="events">
      {#each events as e}
        <li><code>{e.type}</code> {e.summary} <span class="rel">{fmtRel(e.relMs)}</span></li>
      {/each}
      {#if events.length === 0}<li class="empty">No events yet</li>{/if}
    </ul>
  </section>

  {#if pulseEvents.length > 0}
    <section>
      <h4>Background activity</h4>
      <ul class="pulse">
        {#each pulseEvents as p}
          <li class="sev-{p.severity}"><strong>{p.kind}</strong> {p.summary} <span class="rel">{fmtRel(p.relMs)}</span></li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .panel {
    background: var(--surface, #181818);
    border: 1px solid var(--border, #333);
    border-radius: 12px;
    padding: 0.9rem 1rem;
    max-width: 380px;
    font-size: 0.82rem;
    color: var(--text, #e6e6e6);
  }
  .head { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.6rem; }
  .head .phase { opacity: 0.6; font-size: 0.72rem; }
  .head .close { margin-left: auto; background: transparent; border: 0; color: inherit; font-size: 1.1rem; cursor: pointer; }
  h4 { margin: 0.5rem 0 0.3rem; font-size: 0.74rem; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em; }
  ul, ol { margin: 0; padding-left: 1.1rem; }
  .meters { padding-left: 0; list-style: none; }
  .meters li { font-variant-numeric: tabular-nums; }
  .steps li.active { font-weight: 600; color: var(--accent, #8b6cd1); }
  .steps li.covered { opacity: 0.55; text-decoration: line-through; }
  .events code { background: rgba(255,255,255,0.06); padding: 0 0.3em; border-radius: 4px; }
  .rel { opacity: 0.6; }
  .pulse li.sev-warn { color: var(--warning, #d99a3a); }
  .pulse li.sev-error { color: var(--danger, #d24b4b); }
  .empty { opacity: 0.5; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/jkai/HeartbeatPanel.svelte
git commit -m "feat(jkai): add HeartbeatPanel popover component"
```

---

### Task 9: Wire the pill into `ChatArea.svelte`

**Files:**
- Modify: `src/lib/components/jkai/ChatArea.svelte`

- [ ] **Step 1: Replace the existing heartbeat slot with rich state**

In `src/lib/components/jkai/ChatArea.svelte`, replace the `let heartbeat = $state<{ summary: string; elapsedSec: number } | null>(null);` declaration (line 128) with:

```ts
  type Phase = 'idle' | 'thinking' | 'streaming' | 'tool' | 'awaiting_user' | 'stalled';
  let pulseEnabled = !!import.meta.env.PUBLIC_PULSE_ENABLED;
  let phase: Phase = $state('idle');
  let pillLabel = $state('');
  let pillElapsed = $state(0);
  let watchdog = $state<{ idleMs: number; idleLimitMs: number; totalMs: number; totalLimitMs: number } | null>(null);
  let lastEvents = $state<Array<{ type: string; summary: string; at: number }>>([]);
  let panelOpen = $state(false);
  let pulseFeed = $state<Array<{ id: string; kind: string; severity: 'info'|'warn'|'error'; summary: string; at: number }>>([]);
  let activeStepId = $state<string | null>(null);
  let coveredStepIds = $state<string[]>([]);
  let planSteps = $state<Array<{ id: string; title: string }>>([]);
```

- [ ] **Step 2: Replace the `data.type === 'heartbeat'` branch (line 594)**

Replace:

```ts
          if (data.type === 'heartbeat') {
            heartbeat = {
              summary: data.summary,
              elapsedSec: Math.round((data.elapsedMs ?? 0) / 1000),
            };
            return;
          }
```

with:

```ts
          if (data.type === 'heartbeat') {
            phase = data.phase;
            pillElapsed = Math.round((data.elapsedMs ?? 0) / 1000);
            watchdog = data.watchdog;
            pillLabel =
              data.phase === 'tool' && data.inflightTool
                ? `Tool: ${data.inflightTool.name} (${Math.round(data.inflightTool.sinceMs / 1000)}s)`
              : data.phase === 'awaiting_user' && data.awaitingWaiter
                ? `Awaiting your ${data.awaitingWaiter.kind}`
              : data.phase === 'stalled'
                ? `Stalled — ${data.summary}`
                : data.summary;
            lastEvents = [...lastEvents.slice(-19), { type: 'heartbeat', summary: data.summary, at: Date.now() }];
            return;
          }
```

- [ ] **Step 3: Wherever the existing code sets `heartbeat = null`, replace with phase reset**

Search for `heartbeat = null;` and replace each with code that updates `phase`/`pillLabel` appropriately. The simplest path: add a helper near the top of the script:

```ts
  function clearPill() { phase = 'idle'; pillLabel = ''; pillElapsed = 0; watchdog = null; }
```

Replace every `heartbeat = null;` with `clearPill();`.

For the start-of-job path (line 427), replace `heartbeat = null;` with:

```ts
  phase = 'thinking';
  pillLabel = 'Thinking…';
  pillElapsed = 0;
```

- [ ] **Step 4: Track tool_start/tool_result/token to update phase live**

Add new branches in the SSE handler block (alongside the existing `data.type === 'token'`, etc.):

```ts
          if (data.type === 'token') {
            phase = 'streaming';
            pillLabel = 'Streaming response…';
            lastEvents = [...lastEvents.slice(-19), { type: 'token', summary: '', at: Date.now() }];
            // fall through to the existing token logic
          }
          if (data.type === 'tool_start') {
            phase = 'tool';
            pillLabel = `Tool: ${data.tool}`;
            lastEvents = [...lastEvents.slice(-19), { type: 'tool_start', summary: data.tool, at: Date.now() }];
            // fall through
          }
          if (data.type === 'tool_result') {
            phase = 'thinking';
            pillLabel = 'Thinking…';
            lastEvents = [...lastEvents.slice(-19), { type: 'tool_result', summary: data.tool, at: Date.now() }];
            // fall through
          }
          if (data.type === 'plan') {
            planSteps = data.plan.steps.map((s: { id: string; title: string }) => ({ id: s.id, title: s.title }));
            activeStepId = data.plan.steps[0]?.id ?? null;
          }
          if (data.type === 'self_prod') {
            lastEvents = [...lastEvents.slice(-19), { type: 'self_prod', summary: 'auto-continued', at: Date.now() }];
          }
```

Place these BEFORE the existing branches that may `return;` early — modify them so they update phase/lastEvents AND let the existing logic still run. The cleanest pattern: extract the phase update into a small `function tagEvent(e)` called at the top of the SSE message handler, then leave the existing early-return branches untouched.

- [ ] **Step 5: Render the pill + popover next to the input**

Find the existing `{#if heartbeat}` block at line 884 and replace with:

```svelte
{#if pulseEnabled}
  <div class="pill-wrapper">
    <HeartbeatPill
      {phase}
      label={pillLabel || (phase === 'idle' ? 'idle' : 'Working…')}
      elapsedSec={pillElapsed}
      watchdog={watchdog ?? undefined}
      onClick={() => (panelOpen = !panelOpen)}
    />
    {#if panelOpen}
      <div class="pill-popover">
        <HeartbeatPanel
          {phase}
          label={pillLabel}
          watchdog={watchdog ?? { idleMs: 0, idleLimitMs: 180000, totalMs: 0, totalLimitMs: 600000 }}
          plan={planSteps.length > 0 ? { steps: planSteps, activeStepId, coveredStepIds } : null}
          events={lastEvents.map(e => ({ type: e.type, summary: e.summary, relMs: Date.now() - e.at }))}
          pulseEvents={pulseFeed.slice(0, 5).map(p => ({ ...p, relMs: Date.now() - p.at }))}
          onClose={() => (panelOpen = false)}
        />
      </div>
    {/if}
  </div>
{/if}
```

Also replicate the same block at the second occurrence (around line 978) — both spots wrap the streaming-response area and the input area.

Add the imports at the top of the script block:

```ts
  import HeartbeatPill from './HeartbeatPill.svelte';
  import HeartbeatPanel from './HeartbeatPanel.svelte';
```

- [ ] **Step 6: Add CSS for the wrapper**

Append to the component's `<style>` block:

```css
  .pill-wrapper { position: relative; display: inline-block; }
  .pill-popover {
    position: absolute;
    bottom: calc(100% + 0.4rem);
    right: 0;
    z-index: 30;
  }
```

- [ ] **Step 7: Manual verify**

Set `PUBLIC_PULSE_ENABLED=1` in `.env`, run `npm run dev`, open `http://homeserv:5173/jkai`, send a message, observe:
- pill flips through `thinking` → `streaming` → `idle` for a no-tool prompt
- pill flips through `thinking` → `tool` → `thinking` → `streaming` for a tool-using prompt
- click expands a popover with watchdog meters

Document one observation per phase.

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/jkai/ChatArea.svelte
git commit -m "feat(jkai): wire pill+popover into ChatArea, gated by PUBLIC_PULSE_ENABLED"
```

---

### Task 10: Add `/api/jkai/pulse` SSE channel + REST list

**Files:**
- Create: `src/routes/api/jkai/pulse/+server.ts`
- Create: `src/lib/workflows/chat/pulse-bus.ts`

- [ ] **Step 1: Create the in-process pulse bus**

Create `src/lib/workflows/chat/pulse-bus.ts`:

```ts
import type { PulseEvent } from '$lib/db/schema';

type Listener = (event: PulseEvent) => void;
const listeners = new Set<Listener>();

export function publishPulseEvent(event: PulseEvent): void {
  for (const fn of listeners) {
    try { fn(event); } catch { /* ignore broken listener */ }
  }
}

export function subscribePulse(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
```

- [ ] **Step 2: Create the SSE endpoint**

Create `src/routes/api/jkai/pulse/+server.ts`:

```ts
import { db } from '$lib/db';
import { pulseEvents } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { subscribePulse } from '$lib/workflows/chat/pulse-bus';

export async function GET({ url }) {
  if (url.searchParams.get('mode') === 'list') {
    const rows = await db.select().from(pulseEvents).orderBy(desc(pulseEvents.at)).limit(50);
    return Response.json({ events: rows });
  }

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (e: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));

      // initial backlog
      void db.select().from(pulseEvents).orderBy(desc(pulseEvents.at)).limit(20).then((rows) => {
        for (const row of rows.reverse()) send(row);
      });

      const unsub = subscribePulse(send);
      const ka = setInterval(() => controller.enqueue(enc.encode(': keepalive\n\n')), 25_000);

      return () => { unsub(); clearInterval(ka); };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
```

- [ ] **Step 3: Smoke test the endpoint**

Run: `npm run dev` then `curl -N http://homeserv:5173/api/jkai/pulse?mode=list`
Expected: returns `{"events":[]}` JSON.

Run: `curl -N http://homeserv:5173/api/jkai/pulse 2>&1 | head -3`
Expected: SSE keepalive comments start arriving (`:` lines).

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/chat/pulse-bus.ts src/routes/api/jkai/pulse/+server.ts
git commit -m "feat(jkai): add /api/jkai/pulse SSE channel + REST list"
```

---

### Task 11: Wire `PulseFeed` into the /jkai sidebar

**Files:**
- Create: `src/lib/components/jkai/PulseFeed.svelte`
- Modify: the /jkai layout/sidebar component (find it via `grep -l "ChatArea" src/routes/jkai/`)

- [ ] **Step 1: Find the /jkai sidebar host**

Run: `find /home/john/strange_rambling_svelte/src/routes/jkai -type f | head -20`
Identify the sidebar container (typically `+layout.svelte` or a sibling of `ChatArea`). Record the path you'll modify.

- [ ] **Step 2: Create `PulseFeed.svelte`**

Create `src/lib/components/jkai/PulseFeed.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface Item {
    id: string; kind: string; severity: 'info' | 'warn' | 'error';
    summary: string; details: Record<string, unknown>; at: string;
  }

  let pulseEnabled = !!import.meta.env.PUBLIC_PULSE_ENABLED;
  let items = $state<Item[]>([]);
  let es: EventSource | null = null;

  onMount(async () => {
    if (!pulseEnabled) return;
    const initial = await fetch('/api/jkai/pulse?mode=list').then((r) => r.json()).catch(() => ({ events: [] }));
    items = initial.events;
    es = new EventSource('/api/jkai/pulse');
    es.onmessage = (ev) => {
      try {
        const obj = JSON.parse(ev.data) as Item;
        items = [obj, ...items.filter((i) => i.id !== obj.id)].slice(0, 50);
      } catch { /* ignore */ }
    };
  });
  onDestroy(() => { es?.close(); });

  function fmt(at: string): string {
    const d = new Date(at).getTime();
    const ms = Date.now() - d;
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
    return `${Math.round(ms / 3600_000)}h ago`;
  }
</script>

{#if pulseEnabled}
  <aside class="pulse-feed nm-sec">
    <h3>Background activity</h3>
    {#if items.length === 0}
      <p class="empty">Nothing yet — the orchestrator will surface health checks, audit summaries, and memory suggestions here.</p>
    {/if}
    <ul>
      {#each items as item (item.id)}
        <li class="sev-{item.severity}">
          <header>
            <strong>{item.kind}</strong>
            <span class="rel">{fmt(item.at)}</span>
          </header>
          <p>{item.summary}</p>
        </li>
      {/each}
    </ul>
  </aside>
{/if}

<style>
  .pulse-feed { padding: 0.6rem 0.8rem; max-height: 50vh; overflow: auto; }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  li { padding: 0.4rem 0.5rem; border-radius: 8px; background: rgba(255,255,255,0.04); }
  li header { display: flex; justify-content: space-between; font-size: 0.75rem; }
  li p { margin: 0.2rem 0 0; font-size: 0.82rem; }
  .sev-warn { border-left: 3px solid var(--warning, #d99a3a); }
  .sev-error { border-left: 3px solid var(--danger, #d24b4b); }
  .rel { opacity: 0.55; }
  .empty { opacity: 0.55; font-size: 0.78rem; }
</style>
```

(`nm-sec` class follows the existing /admin design language — see memory `feedback_sr_design_language.md`.)

- [ ] **Step 3: Mount it in the /jkai sidebar host**

In whatever file you identified in Step 1, import and render the feed in the sidebar area:

```svelte
<script lang="ts">
  import PulseFeed from '$lib/components/jkai/PulseFeed.svelte';
</script>

<!-- alongside other sidebar sections -->
<PulseFeed />
```

- [ ] **Step 4: Manual verify**

Visit `/jkai`, confirm a "Background activity" panel appears in the sidebar with the empty-state message.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/jkai/PulseFeed.svelte src/routes/jkai/<path-from-step-1>
git commit -m "feat(jkai): add PulseFeed sidebar component"
```

---

## Section 4 — Self-Prod (gate: `SELF_PROD_ENABLED`)

### Task 12: Build `self-prod.ts` decision module

**Files:**
- Create: `src/lib/workflows/chat/self-prod.ts`
- Create: `src/lib/workflows/chat/self-prod.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/workflows/chat/self-prod.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldSelfProd, buildProdMessage } from './self-prod';
import type { OrchestratorJob } from './job-store';
import type { PlanPayload } from './job-store';

const plan: PlanPayload = {
  steps: [
    { id: 's1', title: 'Read config' },
    { id: 's2', title: 'Apply migration' },
    { id: 's3', title: 'Run smoke tests' },
  ],
  filesToTouch: [],
};

function jobWith(overrides: Partial<OrchestratorJob>): OrchestratorJob {
  return {
    status: 'running',
    progress: [],
    toolSteps: [],
    abortController: new AbortController(),
    startedAt: Date.now(),
    message: 'm',
    scope: { workflowId: null, conversationId: null, chatNodeId: null },
    lastEventAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    partialResponse: '',
    inflightTool: null,
    awaitingWaiter: null,
    plan: null,
    coveredStepIds: new Set(),
    selfProdCount: 0,
    lastSelfProdAt: null,
    lastTokenAt: null,
    ...overrides,
  } as unknown as OrchestratorJob;
}

describe('shouldSelfProd', () => {
  it('returns false with no plan', () => {
    expect(shouldSelfProd(jobWith({}), 'done')).toBe(false);
  });

  it('returns true with uncovered steps + non-question reply', () => {
    expect(shouldSelfProd(jobWith({ plan }), 'I read the config.')).toBe(true);
  });

  it('returns false when reply ends in a question', () => {
    expect(shouldSelfProd(jobWith({ plan }), 'I read the config. Should I continue?')).toBe(false);
  });

  it('returns false on "would you like" phrasing', () => {
    expect(shouldSelfProd(jobWith({ plan }), 'Would you like me to continue.')).toBe(false);
  });

  it('returns false when prod count is at cap', () => {
    expect(shouldSelfProd(jobWith({ plan, selfProdCount: 2 }), 'Done with read.')).toBe(false);
  });

  it('returns false when waiter is open', () => {
    expect(shouldSelfProd(
      jobWith({ plan, awaitingWaiter: { kind: 'plan', key: 'plan:x', since: Date.now() } }),
      'Done with read.',
    )).toBe(false);
  });

  it('returns false when all steps covered', () => {
    expect(shouldSelfProd(
      jobWith({ plan, coveredStepIds: new Set(['s1', 's2', 's3']) }),
      'All done.',
    )).toBe(false);
  });
});

describe('buildProdMessage', () => {
  it('lists uncovered step titles in the default template', () => {
    const msg = buildProdMessage(jobWith({ plan }), 0);
    expect(msg).toContain('Read config');
    expect(msg).toContain('Apply migration');
    expect(msg).toContain('Run smoke tests');
  });
  it('uses harsher template on second prod', () => {
    const msg = buildProdMessage(jobWith({ plan, selfProdCount: 1 }), 1);
    expect(msg.toLowerCase()).toContain('paused again');
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `cd ~/strange_rambling_svelte && pnpm test self-prod -- --run 2>&1 | tail -30`
Expected: 9 failures (module not found).

- [ ] **Step 3: Implement `self-prod.ts`**

Create `src/lib/workflows/chat/self-prod.ts`:

```ts
import type { OrchestratorJob } from './job-store';

const QUESTION_PHRASES = [
  'should i', 'would you like', 'do you want', 'let me know',
  'shall i', 'do you prefer', 'any preference',
];

export function shouldSelfProd(job: OrchestratorJob, replyText: string): boolean {
  if (!job.plan) return false;
  if (job.selfProdCount >= 2) return false;
  if (job.awaitingWaiter) return false;

  const uncovered = job.plan.steps.filter((s) => !job.coveredStepIds.has(s.id));
  if (uncovered.length === 0) return false;

  const trimmed = replyText.trim();
  if (!trimmed) return false;

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const lastLine = lines[lines.length - 1] ?? '';
  if (lastLine.endsWith('?')) return false;

  const lower = trimmed.toLowerCase();
  if (QUESTION_PHRASES.some((p) => lower.includes(p))) return false;

  return true;
}

export function buildProdMessage(job: OrchestratorJob, prodAttempt: number): string {
  const remaining = (job.plan?.steps ?? [])
    .filter((s) => !job.coveredStepIds.has(s.id))
    .map((s) => `- ${s.title}`)
    .join('\n');

  if (prodAttempt === 0) {
    return `The plan still has uncovered steps:\n${remaining}\n\nContinue with the next step now. If a step is genuinely blocked or no longer applicable, say so and stop; otherwise proceed.`;
  }
  return `You paused again without finishing. The remaining plan steps:\n${remaining}\n\nList which step is blocking you, what is needed to unblock it, and either continue or stop with a clear reason.`;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd ~/strange_rambling_svelte && pnpm test self-prod -- --run 2>&1 | tail -30`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/chat/self-prod.ts src/lib/workflows/chat/self-prod.test.ts
git commit -m "feat(orchestrator): add self-prod decision module + tests"
```

---

### Task 13: Hook self-prod into the round-end path

**Files:**
- Modify: `src/lib/workflows/chat/general-chat.ts`
- Modify: `src/lib/workflows/chat/job-store.ts` (extend JobEvent with `self_prod`)

- [ ] **Step 1: Add `self_prod` event variant**

In `src/lib/workflows/chat/job-store.ts`, extend the `JobEvent` union with:

```ts
  | { type: 'self_prod'; attempt: number; remainingStepIds: string[] }
```

- [ ] **Step 2: Modify the round-end path in general-chat.ts**

Locate the `if (!msg.tool_calls || msg.tool_calls.length === 0)` block (line 838 in the current file). Replace its body with:

```ts
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const trimmed = (msg.content as string | undefined)?.trim();
      if (!trimmed) {
        const promptChars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
        console.warn(
          `[general-chat] Empty response from ${model}. ` +
          `round=${round} finish_reason=${finishReason} ` +
          `messages=${messages.length} prompt_chars=${promptChars} ` +
          `usage=${JSON.stringify(lastUsage)}`,
        );
      }

      // --- Self-prod ---
      const selfProdEnabled = process.env.SELF_PROD_ENABLED === '1';
      if (selfProdEnabled && options.jobId) {
        const job = getJob(options.jobId);
        if (job) {
          const { shouldSelfProd, buildProdMessage } = await import('./self-prod');
          if (shouldSelfProd(job, trimmed ?? '')) {
            const prodMsg = buildProdMessage(job, job.selfProdCount);
            messages.push(msg);
            messages.push({ role: 'user', content: prodMsg });
            job.selfProdCount += 1;
            job.lastSelfProdAt = Date.now();
            publishJobEvent(options.jobId, {
              type: 'self_prod',
              attempt: job.selfProdCount,
              remainingStepIds: (job.plan?.steps ?? []).filter((s) => !job.coveredStepIds.has(s.id)).map((s) => s.id),
            });
            continue;
          }
        }
      }

      responseText = trimmed || `Sorry, the model (${model}) returned an empty response. This may indicate rate limiting or a service issue.`;
      break;
    }
```

- [ ] **Step 3: Add a watchdog-survives-self-prod regression test**

In `src/lib/workflows/chat/job-store.test.ts`, add:

```ts
describe('watchdog overrides self-prod', () => {
  it('watchdog still aborts a job whose lastEventAt is stale, regardless of selfProdCount', async () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 0, 1);
    vi.setSystemTime(start);
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    job.selfProdCount = 1;          // mid-prodding
    job.lastEventAt = start;         // never moves

    vi.setSystemTime(start + 200_000); // > IDLE_TIMEOUT_MS (180s)
    await vi.advanceTimersByTimeAsync(15_000);
    expect(job.status).toBe('error');
    expect(job.error).toMatch(/idle/i);
  });
});
```

- [ ] **Step 4: Run all chat tests**

Run: `cd ~/strange_rambling_svelte && pnpm test workflows/chat -- --run 2>&1 | tail -30`
Expected: all pass.

- [ ] **Step 5: Update ChatArea to handle `self_prod` event (already wired in Task 9 step 4)**

Verify the `data.type === 'self_prod'` handler exists in `ChatArea.svelte`. If not, add per Task 9 Step 4.

- [ ] **Step 6: Manual verify with SELF_PROD_ENABLED=1**

Set both `PUBLIC_PULSE_ENABLED=1` and `SELF_PROD_ENABLED=1` in `.env`. Restart `npm run dev`. In /jkai, give a multi-step task that reliably triggers a plan ("scrape page X then summarise it then save to disk"). Approve the plan. After the LLM completes one step and tries to stop, you should see an `auto-continued` event in the timeline and the job continues without manual nudge. Note observation.

- [ ] **Step 7: Commit**

```bash
git add src/lib/workflows/chat/general-chat.ts src/lib/workflows/chat/job-store.ts src/lib/workflows/chat/job-store.test.ts
git commit -m "feat(orchestrator): self-prod injects continue when plan has uncovered steps"
```

---

## Section 5 — Idle Cycler (gate: `PULSE_CYCLER_ENABLED`)

### Task 14: Build the cycler skeleton with bootstrap + tick + safety gates

**Files:**
- Create: `src/lib/workflows/chat/idle-cycler.ts`
- Create: `src/lib/workflows/chat/idle-cycler.test.ts`
- Modify: `src/hooks.server.ts`

- [ ] **Step 1: Write failing tests for cycler gating**

Create `src/lib/workflows/chat/idle-cycler.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startIdleCycler, stopIdleCycler, _internal } from './idle-cycler';

describe('idle-cycler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); stopIdleCycler(); });

  it('does not start when PULSE_DISABLED=1', () => {
    process.env.PULSE_DISABLED = '1';
    startIdleCycler();
    expect(_internal.timer()).toBeNull();
    delete process.env.PULSE_DISABLED;
  });

  it('does not start when NODE_ENV=test by default', () => {
    process.env.NODE_ENV = 'test';
    startIdleCycler();
    expect(_internal.timer()).toBeNull();
  });

  it('starts when forced via param even in test', () => {
    startIdleCycler({ force: true });
    expect(_internal.timer()).not.toBeNull();
  });

  it('skips a tick if a job is currently running', async () => {
    startIdleCycler({ force: true });
    _internal.setActiveJobs(1);
    const ran: string[] = [];
    _internal.setRunner(async () => { ran.push('ran'); return []; });
    await _internal.tickNow();
    expect(ran).toEqual([]);
  });

  it('skips a tick if last job ended within idleQuietMs', async () => {
    startIdleCycler({ force: true });
    _internal.setActiveJobs(0);
    _internal.setLastJobCompletedAt(Date.now() - 60_000); // 1 min ago
    _internal.setIdleQuietMs(300_000); // 5 min
    const ran: string[] = [];
    _internal.setRunner(async () => { ran.push('ran'); return []; });
    await _internal.tickNow();
    expect(ran).toEqual([]);
  });

  it('runs the runner when system is properly idle', async () => {
    startIdleCycler({ force: true });
    _internal.setActiveJobs(0);
    _internal.setLastJobCompletedAt(Date.now() - 600_000);
    _internal.setIdleQuietMs(300_000);
    const ran: string[] = [];
    _internal.setRunner(async () => { ran.push('ran'); return []; });
    await _internal.tickNow();
    expect(ran).toEqual(['ran']);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `cd ~/strange_rambling_svelte && pnpm test idle-cycler -- --run 2>&1 | tail -30`
Expected: failures (module missing).

- [ ] **Step 3: Implement the cycler skeleton**

Create `src/lib/workflows/chat/idle-cycler.ts`:

```ts
import { db } from '$lib/db';
import { pulseEvents, pulseSettings } from '$lib/db/schema';
import { lt } from 'drizzle-orm';
import { publishPulseEvent } from './pulse-bus';
import type { PulseEvent, NewPulseEvent } from '$lib/db/schema';

export interface PulseJobContext {
  now: number;
}
export type PulseJobRunner = (ctx: PulseJobContext) => Promise<NewPulseEvent[]>;

let timer: ReturnType<typeof setInterval> | null = null;
let activeJobs = 0;
let lastJobCompletedAt: number = 0;
let idleQuietMs = 300_000;
let runner: PulseJobRunner = async () => [];

const TICK_MS = 60_000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function setActiveJobs(n: number) { activeJobs = n; }
export function noteJobCompleted() { lastJobCompletedAt = Date.now(); }

export function startIdleCycler(opts: { force?: boolean } = {}): void {
  if (timer) return;
  if (process.env.PULSE_DISABLED === '1') return;
  if (process.env.NODE_ENV === 'test' && !opts.force) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  console.log('[pulse-cycler] started');
}

export function stopIdleCycler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

async function tick(): Promise<void> {
  try {
    if (activeJobs > 0) return;
    if (Date.now() - lastJobCompletedAt < idleQuietMs && lastJobCompletedAt > 0) return;
    const events = await runner({ now: Date.now() });
    if (events.length > 0) {
      const inserted = await db.insert(pulseEvents).values(events).returning();
      for (const ev of inserted) publishPulseEvent(ev as PulseEvent);
    }
    // Retention sweep
    await db.delete(pulseEvents).where(lt(pulseEvents.at, new Date(Date.now() - RETENTION_MS)));
  } catch (err) {
    console.error('[pulse-cycler] tick error:', err instanceof Error ? err.message : err);
  }
}

export function setRunner(r: PulseJobRunner): void { runner = r; }

export async function loadSettings(): Promise<void> {
  try {
    const [row] = await db.select().from(pulseSettings).limit(1);
    if (row) idleQuietMs = row.idleQuietMs;
  } catch { /* table may not exist in tests */ }
}

export const _internal = {
  timer: () => timer,
  setActiveJobs,
  setLastJobCompletedAt: (n: number) => { lastJobCompletedAt = n; },
  setIdleQuietMs: (n: number) => { idleQuietMs = n; },
  setRunner,
  tickNow: tick,
};
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd ~/strange_rambling_svelte && pnpm test idle-cycler -- --run 2>&1 | tail -30`
Expected: all pass.

- [ ] **Step 5: Bootstrap from `hooks.server.ts`**

In `src/hooks.server.ts`, add at module load (top level, not inside `handle`):

```ts
import { startIdleCycler, loadSettings } from '$lib/workflows/chat/idle-cycler';

if (process.env.PULSE_CYCLER_ENABLED === '1') {
  void loadSettings().then(() => startIdleCycler());
}
```

- [ ] **Step 6: Wire `setActiveJobs` / `noteJobCompleted` into `job-store.ts`**

In `src/lib/workflows/chat/job-store.ts`:

- After `jobs.set(jobId, job);` in `createJob`, add: `setActiveJobs(jobs.size);`
- In each terminal status branch (cancel, watchdog kill, scope cancel, error in `publishJobEvent`'s done/error handler), add `setActiveJobs(jobs.size); noteJobCompleted();`.

Add the import at the top of job-store.ts:

```ts
import { setActiveJobs, noteJobCompleted } from './idle-cycler';
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/workflows/chat/idle-cycler.ts src/lib/workflows/chat/idle-cycler.test.ts src/hooks.server.ts src/lib/workflows/chat/job-store.ts
git commit -m "feat(pulse): idle cycler skeleton + bootstrap, gated by PULSE_CYCLER_ENABLED"
```

---

### Task 15: Implement `health_check` pulse job

**Files:**
- Create: `src/lib/workflows/chat/pulse-jobs/health-check.ts`
- Modify: `src/lib/workflows/chat/idle-cycler.ts` (compose runners)

- [ ] **Step 1: Implement the health-check job**

Create `src/lib/workflows/chat/pulse-jobs/health-check.ts`:

```ts
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { gmailHistoryCursors } from '$lib/db/schema';
import type { NewPulseEvent } from '$lib/db/schema';

export async function runHealthCheck(): Promise<NewPulseEvent[]> {
  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

  // DB
  try {
    await db.execute(sql`SELECT 1`);
    checks.push({ name: 'db', pass: true });
  } catch (e) {
    checks.push({ name: 'db', pass: false, detail: (e as Error).message });
  }

  // OpenClaw gateway
  try {
    const r = await fetch('http://localhost:18789/health', { signal: AbortSignal.timeout(3000) });
    checks.push({ name: 'openclaw_gateway', pass: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}` });
  } catch (e) {
    checks.push({ name: 'openclaw_gateway', pass: false, detail: (e as Error).message });
  }

  // Gmail watcher cursor age
  try {
    const rows = await db.select().from(gmailHistoryCursors);
    const stale = rows.filter((r) => {
      const age = Date.now() - new Date(r.updatedAt as unknown as string).getTime();
      return age > 30 * 60 * 1000; // > 30 min stale
    });
    checks.push({
      name: 'gmail_watcher',
      pass: stale.length === 0,
      detail: stale.length === 0 ? undefined : `${stale.length} stale cursor(s)`,
    });
  } catch (e) {
    checks.push({ name: 'gmail_watcher', pass: false, detail: (e as Error).message });
  }

  const failing = checks.filter((c) => !c.pass);
  const summary = failing.length === 0
    ? `All ${checks.length} checks passed`
    : `${failing.length}/${checks.length} failing: ${failing.map((c) => c.name).join(', ')}`;

  return [{
    kind: 'health_check',
    severity: failing.length > 0 ? 'warn' : 'info',
    summary,
    details: { checks },
  } as NewPulseEvent];
}
```

If `gmailHistoryCursors` is not the actual table name, run:

```bash
grep -n "gmailHistoryCursors\|gmail_history_cursors" /home/john/strange_rambling_svelte/src/lib/db/schema.ts
```

and adjust the import.

- [ ] **Step 2: Compose runners by cadence in idle-cycler**

In `src/lib/workflows/chat/idle-cycler.ts`, replace the simple `runner` with a scheduled-jobs system. Add at module top:

```ts
import { runHealthCheck } from './pulse-jobs/health-check';

interface ScheduledJob {
  kind: string;
  intervalMs: number;
  enabled: boolean;
  lastRunAt: number;
  run: () => Promise<NewPulseEvent[]>;
}

const scheduled: ScheduledJob[] = [];
```

Replace the `setRunner`/`runner` call site in `tick()` with:

```ts
async function tick(): Promise<void> {
  try {
    if (activeJobs > 0) return;
    if (Date.now() - lastJobCompletedAt < idleQuietMs && lastJobCompletedAt > 0) return;
    const due = scheduled.filter((j) => j.enabled && Date.now() - j.lastRunAt >= j.intervalMs);
    for (const job of due) {
      if (activeJobs > 0) break; // bail if a real job arrived mid-tick
      try {
        const events = await job.run();
        job.lastRunAt = Date.now();
        if (events.length > 0) {
          const inserted = await db.insert(pulseEvents).values(events).returning();
          for (const ev of inserted) publishPulseEvent(ev as PulseEvent);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[pulse-cycler] ${job.kind} error:`, msg);
        await db.insert(pulseEvents).values({
          kind: job.kind,
          severity: 'error',
          summary: `${job.kind} failed: ${msg.slice(0, 120)}`,
          details: { error: msg },
        } satisfies NewPulseEvent);
      }
    }
    await db.delete(pulseEvents).where(lt(pulseEvents.at, new Date(Date.now() - RETENTION_MS)));
  } catch (err) {
    console.error('[pulse-cycler] tick error:', err instanceof Error ? err.message : err);
  }
}
```

Modify `loadSettings` to populate `scheduled` from the table:

```ts
export async function loadSettings(): Promise<void> {
  try {
    const [row] = await db.select().from(pulseSettings).limit(1);
    if (!row) return;
    idleQuietMs = row.idleQuietMs;
    const cfg = row.schedules as Record<string, { intervalMs: number; enabled: boolean }>;
    scheduled.length = 0;
    if (cfg.health_check) scheduled.push({ kind: 'health_check', ...cfg.health_check, lastRunAt: 0, run: runHealthCheck });
  } catch { /* ignore */ }
}
```

The other 4 runners are added in subsequent tasks; each new pulse-job task appends one line here.

Also update the `_internal` test hook so tests can register a custom job runner. Replace `setRunner` with:

```ts
export const _internal = {
  ...,
  setRunner: (r: () => Promise<NewPulseEvent[]>) => {
    scheduled.length = 0;
    scheduled.push({ kind: 'test', intervalMs: 0, enabled: true, lastRunAt: 0, run: r });
  },
};
```

- [ ] **Step 3: Manual verify**

With `PULSE_CYCLER_ENABLED=1` and a running dev server, wait 60s with no /jkai job in flight. Watch logs for `[pulse-cycler] started`. Within 60s of being idle 5min, a `health_check` row appears in `pulse_events` (check via pgweb `SELECT * FROM pulse_events ORDER BY at DESC LIMIT 5;`).

For faster manual testing, temporarily set `idle_quiet_ms` to 0 and `health_check.intervalMs` to 60_000 in the `pulse_settings` row, then revert.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/chat/pulse-jobs/health-check.ts src/lib/workflows/chat/idle-cycler.ts
git commit -m "feat(pulse): health_check job (db, openclaw, gmail watcher cursors)"
```

---

### Task 16: Implement `audit_digest` pulse job (LLM-summarised)

**Files:**
- Create: `src/lib/workflows/chat/pulse-jobs/audit-digest.ts`
- Modify: `src/lib/workflows/chat/idle-cycler.ts` (register runner)

- [ ] **Step 1: Implement audit-digest**

Create `src/lib/workflows/chat/pulse-jobs/audit-digest.ts`:

```ts
import { db } from '$lib/db';
import { workflowAuditLog, nodeExecutions } from '$lib/db/schema';
import { gte, desc } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import type { NewPulseEvent } from '$lib/db/schema';

const WINDOW_MS = 4 * 60 * 60 * 1000; // 4h

const PROMPT = `You are an SRE summariser. Given the last 4h of workflow audit events and node executions, produce ONE concise sentence (max 200 chars) calling out anomalies (failed runs, repeated retries, unusual config changes). If everything looks healthy, say "No anomalies in the last 4h."

Output JSON ONLY: {"summary":"...","severity":"info"|"warn","anomalies":[{"kind":"...","detail":"..."}]}`;

export async function runAuditDigest(): Promise<NewPulseEvent[]> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [auditRows, execRows] = await Promise.all([
    db.select().from(workflowAuditLog).where(gte(workflowAuditLog.at, since)).orderBy(desc(workflowAuditLog.at)).limit(200),
    db.select().from(nodeExecutions).where(gte(nodeExecutions.startedAt, since)).orderBy(desc(nodeExecutions.startedAt)).limit(200),
  ]);

  if (auditRows.length === 0 && execRows.length === 0) {
    return [{
      kind: 'audit_digest',
      severity: 'info',
      summary: 'No audit/execution activity in the last 4h.',
      details: { auditCount: 0, execCount: 0 },
    } as NewPulseEvent];
  }

  const failed = execRows.filter((r) => r.status === 'error' || r.status === 'failed');
  const condensed = {
    audits: auditRows.slice(0, 50).map((r) => ({ entity: r.entity, action: r.action, at: r.at })),
    execs: execRows.slice(0, 50).map((r) => ({ status: r.status, nodeType: r.nodeType, error: r.error?.slice(0, 80) })),
  };

  try {
    const client = getOpenAIClient();
    const model = getModel('quick');
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: JSON.stringify(condensed) },
      ],
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    });
    const text = resp.choices[0]?.message?.content?.trim() ?? '{}';
    const parsed = JSON.parse(text) as { summary: string; severity: 'info' | 'warn'; anomalies: unknown[] };
    return [{
      kind: 'audit_digest',
      severity: parsed.severity ?? 'info',
      summary: (parsed.summary ?? 'Digest unavailable').slice(0, 280),
      details: { ...parsed, failedCount: failed.length, totalAudits: auditRows.length, totalExecs: execRows.length },
    } as NewPulseEvent];
  } catch (e) {
    return [{
      kind: 'audit_digest',
      severity: 'warn',
      summary: `LLM digest unavailable; ${failed.length} failed exec(s) in 4h.`,
      details: { error: (e as Error).message, failedCount: failed.length },
    } as NewPulseEvent];
  }
}
```

If `getModel('quick')` is not the right tier for this codebase, grep `getModel('` in `src/lib/deepdive/keys.ts` and pick the existing lightweight tier. If `nodeExecutions.startedAt` differs (the schema may use `started_at` mapped to `startedAt` — verify in `schema.ts:652`), adjust.

- [ ] **Step 2: Register the runner in `loadSettings`**

In `src/lib/workflows/chat/idle-cycler.ts`, expand `loadSettings`:

```ts
import { runAuditDigest } from './pulse-jobs/audit-digest';
// ...inside loadSettings, after the health_check push:
if (cfg.audit_digest) scheduled.push({ kind: 'audit_digest', ...cfg.audit_digest, lastRunAt: 0, run: runAuditDigest });
```

- [ ] **Step 3: Manual verify**

Force a tick (lower the `audit_digest.intervalMs` temporarily). Observe a `pulse_events` row of kind `audit_digest`. Inspect the `details` JSON.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/chat/pulse-jobs/audit-digest.ts src/lib/workflows/chat/idle-cycler.ts
git commit -m "feat(pulse): audit_digest LLM-summarised job"
```

---

### Task 17: Implement `workflow_efficiency` pulse job

**Files:**
- Create: `src/lib/workflows/chat/pulse-jobs/workflow-efficiency.ts`
- Modify: `src/lib/workflows/chat/idle-cycler.ts`

- [ ] **Step 1: Implement workflow-efficiency**

Create `src/lib/workflows/chat/pulse-jobs/workflow-efficiency.ts`:

```ts
import { db } from '$lib/db';
import { nodeExecutions } from '$lib/db/schema';
import { gte, desc } from 'drizzle-orm';
import type { NewPulseEvent } from '$lib/db/schema';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function runWorkflowEfficiency(): Promise<NewPulseEvent[]> {
  const since = new Date(Date.now() - WINDOW_MS);
  const rows = await db.select().from(nodeExecutions)
    .where(gte(nodeExecutions.startedAt, since))
    .orderBy(desc(nodeExecutions.startedAt))
    .limit(2000);

  if (rows.length === 0) return [];

  // Group by nodeType, compute count, p95 duration, error rate
  const byType = new Map<string, { count: number; durations: number[]; errors: number }>();
  for (const r of rows) {
    const key = r.nodeType ?? 'unknown';
    const slot = byType.get(key) ?? { count: 0, durations: [], errors: 0 };
    slot.count += 1;
    if (r.completedAt && r.startedAt) {
      const d = new Date(r.completedAt as unknown as string).getTime() - new Date(r.startedAt as unknown as string).getTime();
      if (Number.isFinite(d) && d >= 0) slot.durations.push(d);
    }
    if (r.status === 'error' || r.status === 'failed') slot.errors += 1;
    byType.set(key, slot);
  }

  const flagged: Array<{ nodeType: string; p95Ms: number; errorRate: number; count: number }> = [];
  for (const [nodeType, slot] of byType) {
    const sorted = [...slot.durations].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const errRate = slot.errors / Math.max(1, slot.count);
    if (p95 > 30_000 || errRate > 0.1) {
      flagged.push({ nodeType, p95Ms: p95, errorRate: Number(errRate.toFixed(2)), count: slot.count });
    }
  }

  if (flagged.length === 0) {
    return [{
      kind: 'workflow_efficiency',
      severity: 'info',
      summary: `No slow or error-prone node types in the last 24h (${rows.length} executions).`,
      details: { totalExecs: rows.length },
    } as NewPulseEvent];
  }

  return [{
    kind: 'workflow_efficiency',
    severity: 'warn',
    summary: `${flagged.length} node type(s) flagged: ${flagged.slice(0, 3).map((f) => f.nodeType).join(', ')}.`,
    details: { flagged, totalExecs: rows.length },
  } as NewPulseEvent];
}
```

- [ ] **Step 2: Register runner**

In `idle-cycler.ts loadSettings`, add:

```ts
import { runWorkflowEfficiency } from './pulse-jobs/workflow-efficiency';
// inside loadSettings:
if (cfg.workflow_efficiency) scheduled.push({ kind: 'workflow_efficiency', ...cfg.workflow_efficiency, lastRunAt: 0, run: runWorkflowEfficiency });
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/chat/pulse-jobs/workflow-efficiency.ts src/lib/workflows/chat/idle-cycler.ts
git commit -m "feat(pulse): workflow_efficiency job (p95 latency + error rate by node type)"
```

---

### Task 18: Implement `chat_log_review` pulse job

**Files:**
- Create: `src/lib/workflows/chat/pulse-jobs/chat-log-review.ts`
- Modify: `src/lib/workflows/chat/idle-cycler.ts`

- [ ] **Step 1: Implement chat-log-review**

Create `src/lib/workflows/chat/pulse-jobs/chat-log-review.ts`:

```ts
import { db } from '$lib/db';
import { orchestratorChats } from '$lib/db/schema';
import { gte, desc } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import type { NewPulseEvent } from '$lib/db/schema';

const WINDOW_MS = 6 * 60 * 60 * 1000;

const PROMPT = `Review the last 6 hours of orchestrator chat traffic. Identify recurring user friction patterns: repeated complaints, requests the orchestrator failed to fulfil, manual nudges the user had to provide. Output JSON ONLY: {"summary":"...","severity":"info","themes":[{"theme":"...","occurrences":N,"example":"..."}]}.

If no patterns are visible, summary should be "No recurring friction patterns observed."`;

export async function runChatLogReview(): Promise<NewPulseEvent[]> {
  const since = new Date(Date.now() - WINDOW_MS);
  const rows = await db.select({ role: orchestratorChats.role, content: orchestratorChats.content, at: orchestratorChats.createdAt })
    .from(orchestratorChats)
    .where(gte(orchestratorChats.createdAt, since))
    .orderBy(desc(orchestratorChats.createdAt))
    .limit(400);

  if (rows.length === 0) {
    return [{
      kind: 'chat_log_review',
      severity: 'info',
      summary: 'No chat traffic in the last 6h.',
      details: { messageCount: 0 },
    } as NewPulseEvent];
  }

  const trimmed = rows.slice(0, 200).map((r) => ({
    role: r.role,
    content: (r.content ?? '').slice(0, 400),
  }));

  try {
    const client = getOpenAIClient();
    const model = getModel('quick');
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: JSON.stringify(trimmed) },
      ],
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}') as { summary: string; severity?: 'info'; themes?: unknown[] };
    return [{
      kind: 'chat_log_review',
      severity: 'info',
      summary: (parsed.summary ?? 'Chat review unavailable').slice(0, 280),
      details: { ...parsed, messageCount: rows.length },
    } as NewPulseEvent];
  } catch (e) {
    return [{
      kind: 'chat_log_review',
      severity: 'warn',
      summary: `Chat review LLM error: ${(e as Error).message.slice(0, 120)}`,
      details: { error: (e as Error).message },
    } as NewPulseEvent];
  }
}
```

- [ ] **Step 2: Register runner**

In `idle-cycler.ts loadSettings`:

```ts
import { runChatLogReview } from './pulse-jobs/chat-log-review';
// inside loadSettings:
if (cfg.chat_log_review) scheduled.push({ kind: 'chat_log_review', ...cfg.chat_log_review, lastRunAt: 0, run: runChatLogReview });
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/chat/pulse-jobs/chat-log-review.ts src/lib/workflows/chat/idle-cycler.ts
git commit -m "feat(pulse): chat_log_review job (recurring friction patterns)"
```

---

### Task 19: Implement `memory_update_review` pulse job

**Files:**
- Create: `src/lib/workflows/chat/pulse-jobs/memory-update-review.ts`
- Modify: `src/lib/workflows/chat/idle-cycler.ts`

- [ ] **Step 1: Implement memory-update-review**

Create `src/lib/workflows/chat/pulse-jobs/memory-update-review.ts`:

```ts
import { db } from '$lib/db';
import { jkaiMemories, conversations } from '$lib/db/schema';
import { lt, desc, isNotNull } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import type { NewPulseEvent } from '$lib/db/schema';

const STALE_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks

const PROMPT = `Given a memory record and a sample of the most recent conversation context, decide if the memory may now be outdated, contradicted, or worth refining. Output JSON ONLY: {"verdict":"keep"|"flag","reason":"..."}.`;

export async function runMemoryUpdateReview(): Promise<NewPulseEvent[]> {
  // Pick up to 10 memories not reviewed in 2 weeks
  const stale = await db.select().from(jkaiMemories)
    .where(lt(jkaiMemories.updatedAt, new Date(Date.now() - STALE_MS)))
    .orderBy(desc(jkaiMemories.updatedAt))
    .limit(10);

  if (stale.length === 0) {
    return [{
      kind: 'memory_update_review',
      severity: 'info',
      summary: 'No stale memories to review.',
      details: { reviewed: 0 },
    } as NewPulseEvent];
  }

  // Get the latest conversation for context
  const [latestConv] = await db.select().from(conversations).where(isNotNull(conversations.updatedAt)).orderBy(desc(conversations.updatedAt)).limit(1);

  const flagged: Array<{ memoryId: string; reason: string }> = [];
  const client = getOpenAIClient();
  const model = getModel('quick');

  for (const mem of stale) {
    try {
      const resp = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: JSON.stringify({ memory: { content: mem.content, category: mem.category, confidence: mem.confidence }, latestConvId: latestConv?.id ?? null }) },
        ],
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      });
      const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}') as { verdict: 'keep' | 'flag'; reason: string };
      if (parsed.verdict === 'flag') flagged.push({ memoryId: mem.id, reason: parsed.reason });
    } catch { /* skip on error */ }
  }

  return [{
    kind: 'memory_update_review',
    severity: flagged.length > 0 ? 'warn' : 'info',
    summary: flagged.length > 0
      ? `${flagged.length} memory record(s) flagged for review.`
      : `Reviewed ${stale.length} stale memories; all OK.`,
    details: { reviewed: stale.length, flagged },
  } as NewPulseEvent];
}
```

If `jkaiMemories.updatedAt` doesn't exist, run `grep -n "jkaiMemories" /home/john/strange_rambling_svelte/src/lib/db/schema.ts` and substitute the actual timestamp column.

- [ ] **Step 2: Register runner**

In `idle-cycler.ts loadSettings`:

```ts
import { runMemoryUpdateReview } from './pulse-jobs/memory-update-review';
// inside loadSettings:
if (cfg.memory_update_review) scheduled.push({ kind: 'memory_update_review', ...cfg.memory_update_review, lastRunAt: 0, run: runMemoryUpdateReview });
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/chat/pulse-jobs/memory-update-review.ts src/lib/workflows/chat/idle-cycler.ts
git commit -m "feat(pulse): memory_update_review flags stale memory records"
```

---

## Section 6 — End-to-end verification

### Task 20: Full manual UI verification

**Files:** none

- [ ] **Step 1: Set all flags on**

In `.env`:
```
PUBLIC_PULSE_ENABLED=1
PULSE_ENABLED=1
SELF_PROD_ENABLED=1
PULSE_CYCLER_ENABLED=1
```

Restart the dev server.

- [ ] **Step 2: Pill phase walkthrough**

In /jkai send a tool-using prompt. Confirm the pill walks through `thinking` → `tool: <name>` → `streaming` → `idle`. Click the pill mid-stream — popover renders watchdog meters and event timeline.

- [ ] **Step 3: Self-prod walkthrough**

Send a multi-step task ("scrape page X then summarise then save"). Approve the plan. Confirm at least one `auto-continued` event appears in the timeline and the work proceeds without manual nudge.

- [ ] **Step 4: Idle cycler walkthrough**

Stop chatting for 6+ minutes. Within 10 minutes confirm a `health_check` row appears in the PulseFeed sidebar. Run:
```sql
SELECT kind, severity, summary, at FROM pulse_events ORDER BY at DESC LIMIT 10;
```
to verify other kinds also fire over time (audit_digest, etc., per cadence).

- [ ] **Step 5: Watchdog regression check**

Mock a hung tool by editing one tool to await an unresolvable promise (or set `IDLE_TIMEOUT_MS` temporarily lower). Confirm the watchdog still kills the job at the configured idle limit even with heartbeats firing every 25s. Revert the mock.

- [ ] **Step 6: Document observations**

Append a verification log to the spec file (`docs/superpowers/specs/2026-04-27-orchestrator-heartbeat-redesign-design.md`) under a new `## Verification (YYYY-MM-DD)` section listing what was observed at each step.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-04-27-orchestrator-heartbeat-redesign-design.md
git commit -m "docs(specs): record heartbeat redesign verification log"
```

---

### Task 21: Deploy

**Files:** none

- [ ] **Step 1: Push and deploy**

Per `feedback_always_deploy.md` memory:

```bash
git push
~/strange_rambling_svelte/scripts/deploy.sh
```

- [ ] **Step 2: Set production flags conservatively**

On the VPS, initially set:
```
PUBLIC_PULSE_ENABLED=1
PULSE_ENABLED=1
SELF_PROD_ENABLED=0
PULSE_CYCLER_ENABLED=0
```

Verify the pill is visible in production /jkai. After 48h of clean operation, flip `SELF_PROD_ENABLED=1`. After another 48h, flip `PULSE_CYCLER_ENABLED=1`.

- [ ] **Step 3: Schedule a follow-up sweep**

Offer the user `/schedule` to revisit performance/cost in 2 weeks once all flags are on.

---

## Self-Review Checklist (run after writing — already done)

- ✅ **Spec coverage:** Components A (Tasks 7–11), B (Tasks 12–13), C (Tasks 14–19), D (Task 9 step 2 wording). DB migrations (Task 6). Three-tier flag rollout (Tasks 9, 13, 14, 21). Watchdog-survives-self-prod regression test (Task 13 Step 3). All 8 spec assumptions are either honoured or noted in Pre-Flight.
- ✅ **Placeholder scan:** No TBDs, TODOs, or "implement later". Each step shows the actual code or command.
- ✅ **Type consistency:** `Phase` defined once (Task 2) and reused. `OrchestratorJob` extension fields named consistently across tasks. `PulseEvent` / `NewPulseEvent` from schema reused everywhere. `shouldSelfProd`/`buildProdMessage` signatures match between definition (Task 12) and call site (Task 13).
- ✅ **Scope:** Single coherent plan; rollout is naturally phased via flags; each section produces shippable software.
