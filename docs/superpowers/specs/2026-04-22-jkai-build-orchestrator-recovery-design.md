# jkai Build Orchestrator: Structured Failure & User-Gated Recovery

**Date:** 2026-04-22
**Scope:** `src/lib/jkai/` orchestrator, pi-runner, sandbox, budget; `/jkai/builds/[id]` UI; `/api/jkai/builds/*` routes; `jkai_iterations` schema.

## Problem

The autonomous build orchestrator keeps failing in ways that eat budget and produce no diagnostic signal:

- Pi (zai/glm-5.1) stalls mid-stream; the 90s idle watchdog kills it but the orchestrator retries 3× in-process (~4.5min), then marks the iteration `completed` with 0 tokens and 0 actions. That counts against the 15min/hour active-minute budget. A build with 3 stall-outs burns its full hourly budget producing nothing (observed: `ca46a5e2`).
- Zero-action iterations are indistinguishable from genuine completions in the control flow — the orchestrator keeps launching new ones into the same broken pipe.
- `No such container: jkai-sandbox` loops (iter 7–12 in `478e7d4a`, 6 seconds elapsed, 0 useful work) because `ensureSandboxRunning()` trusts `docker run`'s start semantics without verifying.
- When anything goes wrong the orchestrator has a single `errorMessage` string — not enough to drive recovery logic, not enough for a human to reason about the failure in the UI.

The existing response has been a stream of surgical patches (`fb1ee23`, `e658fa3`, `aafc358`, `c59b80e`) each fixing one symptom. This spec is the strategic shift: give the orchestrator enough structured signal to fail fast and fail honestly, and give the user a direct lever to recover without SSHing into the VPS.

## Goals

1. Stop wasting budget on stalled/empty iterations.
2. Tell the user *why* a build aborted and let them recover (switch model, continue) from the build detail page.
3. Land the diagnostic envelope that a future LLM supervisor (route B) will need, so we don't have to touch `pi-runner` a third time.

## Non-goals

- Building the LLM supervisor itself (route B proper). The envelope + abort signals are the foundation; the supervisor is a follow-up spec.
- Auto-fallback across providers. User chose to keep the user in the loop for provider switches.
- WhatsApp escalation on abort. Follow-up once the banner proves the abort signal is correct.
- Mid-build mutation (inject prompt, swap model mid-iteration, edit plan). Out of scope — those belong to a future human-in-the-loop control panel.

## Design

### 1. Diagnostic envelope (pi-runner)

`PiRunResult` gains a `failure: FailureEnvelope | null` field. `FailureEnvelope`:

```ts
type FailureKind =
  | 'stalled'           // idle watchdog fired, no stream events
  | 'provider_error'    // upstream returned 5xx / error frame
  | 'rate_limited'      // 429 or provider-specific rate-limit signal
  | 'auth_failed'       // 401/403
  | 'container_missing' // `No such container: jkai-sandbox` from docker
  | 'wall_clock_timeout'// 30min cap hit
  | 'nonzero_exit'      // fell through to generic exit code path
  | 'empty_output';     // exit 0, no tool calls, no evaluation — zero-action iteration

interface FailureEnvelope {
  kind: FailureKind;
  message: string;              // human-readable one-liner for the banner
  httpStatus?: number;          // pulled from pi JSON error frame if present
  providerErrorCode?: string;   // e.g. "model_unavailable", "context_length_exceeded"
  lastEventAgeMs?: number;      // time since last stream event when killed
  tokensBeforeStall?: number;   // tokens seen before the idle period started
  stderrTail?: string;          // last 2KB of pi stderr
  attempts: number;             // always 1 now that we're removing the in-process retry
}
```

`runPi()` no longer retries in-process. The 3-attempt loop in `pi-runner.ts:140-167` is deleted. `stalled` is a failure, not a retry trigger.

Detection responsibilities inside `runPi()`:
- Parse pi's `message_end` frames for `errorMessage` + optional `httpStatus`/`errorCode` (extend `PiMessage` shape).
- Classify exit code: stderr matching `No such container` → `container_missing`; otherwise `nonzero_exit`.
- `empty_output` is classified by the caller (executor), not pi-runner — pi-runner only knows what pi said.

### 2. Orchestrator abort paths

The iteration state machine in `orchestrator.ts:runIteration` changes:

**Before running Pi:** `ensureSandboxRunning()` becomes verify-then-fix. It calls `docker inspect jkai-sandbox` first; only on a negative result does it run the create/start path. This preventative check makes the iter 7–12 `container_missing` loop structurally impossible.

**After running Pi:**
- If `result.failure.kind ∈ { stalled, provider_error, rate_limited, auth_failed, container_missing, wall_clock_timeout, nonzero_exit }` → iteration marked `failed`, build aborted, status set to `failed`, envelope persisted. No retry.
- If `result.actions.length === 0` and `result.failure === null` → classify as `empty_output`, iteration marked `failed`, retry **once** with an extra system-prompt line:
  > "Your previous turn produced no tool calls and no structured evaluation. Re-read the plan and make at least one concrete action this turn."
  If the retry also has 0 actions → build aborts with `failureKind: 'empty_output'`.
- If `result.actions.length > 0` → iteration marked `completed`, normal flow.

Consecutive-failure cap: `jkai_builds.consecutive_failures` is the source of truth (read + incremented at the end of each iteration; reset to 0 on any `completed` iteration or on `continueBuild`). On the 2nd consecutive `failed` iteration the build aborts regardless of `failureKind`. This is the safety net against any failure mode the envelope doesn't catch.

In practice most abort paths in §2 fire on the *first* failed iteration, so the cap only matters for cases the envelope can't classify (e.g. two empty_output retries that both produced no actions — the retry-once-then-abort logic already handles this, making the cap partially redundant but cheap to keep as a belt-and-braces defence).

### 3. Budget accounting

`checkBudget()` currently sums `durationMs` across iterations where `status = 'completed'` (budget.ts:21-29). That's already almost right — the fix is making sure failed iterations stay `failed` (see §2). No code change in budget.ts; the behavioural change is elsewhere. Verify by adding a test that a build with two `failed` iterations totalling 10 minutes still has `activeMinutesPerHour` = 0 consumed.

### 4. Schema

New columns on `jkai_iterations`:

```sql
ALTER TABLE jkai_iterations
  ADD COLUMN failure jsonb,                    -- FailureEnvelope or null
  ADD COLUMN retry_of_iteration_id text;       -- fk to the iteration this one is a retry of
```

New column on `jkai_builds`:

```sql
ALTER TABLE jkai_builds
  ADD COLUMN failure jsonb,                    -- final abort envelope (mirror of the last iter's failure, for quick UI read)
  ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0;
```

Handled via `drizzle-kit push` on deploy per the project convention.

### 5. Continuation endpoint

Existing `POST /api/jkai/builds/[id]/continue` (handled by `orchestrator.continueBuild`) accepts:

```ts
{
  prompt: string;
  modelProvider?: string;  // new — e.g. "openrouter"
  modelId?: string;        // new — e.g. "anthropic/claude-sonnet-4.5"
}
```

When the overrides are present, `continueBuild` updates `jkai_builds.modelProvider` / `modelId` before calling `initContinuation`. Also resets `consecutive_failures = 0` and clears `jkai_builds.failure`.

### 6. UI: failure banner

New component `src/lib/components/jkai/BuildFailureBanner.svelte`, rendered on `/jkai/builds/[id]` when `build.status === 'failed'` and `build.failure` is populated.

Content:
- One-line summary built from `failureKind` + `message` (e.g. "Pi stalled on zai/glm-5.1 — no stream events for 90s after 0 tokens.")
- Collapsible detail block showing `httpStatus`, `providerErrorCode`, `stderrTail` if present
- "Continue with a different model" form:
  - Model dropdown (sourced from an existing model list — keep the allowed set conservative for now: `zai/glm-5.1`, `zai/glm-4.6`, `openrouter/anthropic/claude-sonnet-4.5`, `openrouter/anthropic/claude-opus-4.7`)
  - Optional improvement-prompt textarea (passes through to existing `continue` flow as `prompt`; defaults to a canned "Continue where the last run left off — the previous attempt failed with: `<message>`.")
  - "Continue" button → POSTs to `/api/jkai/builds/[id]/continue` with overrides

Special-case rendering: for `failureKind: 'auth_failed'` the banner shows the envelope message + a "Fix `keys.json` on the VPS and retry" hint, and **hides the model dropdown / Continue form** — continuing with a different model won't fix a missing/revoked key, so we deliberately avoid offering it. For all other kinds the full form is shown.

### 7. Log-emitter changes

When the build aborts, emit a single terminal error log line with the envelope JSON so it shows in the existing log stream too: `emitLog(buildId, 'error', \`Build aborted: \${kind} — \${message}\`)`. The banner is the primary surface; the log line is for anyone reading raw logs.

## Data flow

```
Pi process ──stdout──► pi-runner
                          │
                          ├── success → { actions, messages, finalAssistantText, tokensUsed, failure: null }
                          └── failure → { ..., failure: FailureEnvelope }
                                              │
                                              ▼
                          orchestrator.runIteration
                                              │
                              ┌───────────────┼──────────────────────────┐
                              ▼               ▼                          ▼
                          actions>0       failure.kind set         actions=0, failure=null
                              │               │                          │
                              ▼               ▼                          ▼
                          completed       abort build,             classify empty_output,
                                          write envelope,          retry once with nudge,
                                          emit banner              then abort if still empty
```

## Testing

- `pi-runner.test.ts` (unit): fake pi subprocess that emits no events → expect `failure.kind === 'stalled'` and `lastEventAgeMs >= 90_000`. Another case: pi emits `errorMessage` with httpStatus 429 → `rate_limited`. `No such container` on stderr → `container_missing`.
- `orchestrator.test.ts` (integration-ish, DB-backed): seed a build, stub `executeIteration` to return `failure: {kind: 'stalled', ...}` → assert build status becomes `failed`, `build.failure` populated, `consecutiveFailures` = 1, no next iteration scheduled.
- Same test with `actions: [], failure: null` twice → assert retry kicks in once, then build aborts with `empty_output`.
- `budget.test.ts`: two `failed` iterations with `durationMs: 300_000` each → `checkBudget` returns `canProceed: true` (no minutes consumed).
- E2E on the banner: trigger a real abort (easiest: force `failureKind: 'provider_error'` via a mocked pi script), load `/jkai/builds/[id]`, assert banner renders, model dropdown is populated, Continue POST updates `modelId` on the build row.

## Migration / rollout

1. Deploy schema changes (`drizzle-kit push` on VPS).
2. Existing `running` builds at deploy time will be killed by `recoverOnStartup` (unchanged behaviour) and show the new banner on next load (with `failure = null`, so the banner just falls back to a generic "Service restarted mid-build" message — make sure `BuildFailureBanner` handles the null-envelope case gracefully).
3. `consecutive_failures` defaults to 0 so existing builds are unaffected.

## Risks

- **Pi's JSON error frame shape is assumed.** If pi 0.68 doesn't emit `httpStatus`/`errorCode` on provider errors, the envelope's rich fields stay empty and `kind` falls back to `nonzero_exit` or generic `provider_error`. Acceptable — the banner still works with just `kind` + `message`.
- **"Empty output" false positives.** Pi might legitimately produce 0 actions on a pure-thinking turn (e.g. planning with no tools). We accept one such turn per retry-pair; two in a row aborting is intentional.
- **Model dropdown drift.** Hard-coding the list is fine for now (4 entries) — a follow-up can wire it to a registry when the list grows.

## Out of scope / follow-ups

- LLM supervisor (route B proper) that reads envelopes and decides retry/switch/replan autonomously.
- WhatsApp abort escalation.
- Mid-build control panel (swap model / inject prompt / skip iter without full continuation).
- Auto-detection of provider health pre-launch (cheap probe before committing an iteration).
