# Hermes-as-jkai-engine: Replacing Pi-runner, LLM gateway, canvas orchestrator, and Curate

**Date:** 2026-05-10
**Status:** Draft (awaiting user review)
**Authors:** John, Claude (jkai-design pairing session)

## 1. Goals

Replace four agentic surfaces in jkai with [Hermes Agent](https://github.com/nousresearch/hermes-agent) (Nous Research), running as a Python sidecar on homeserv:

1. **Pi-runner** (`src/lib/jkai/pi-runner.ts`) — the build-loop coding-agent wrapper.
2. **LLM gateway** (`src/lib/jkai/llm-client.ts`, `src/lib/workflows/nodes/llm-helpers.ts`) — provider abstraction for chat completions.
3. **Canvas orchestrator chat** (`src/routes/api/workflows/orchestrator/chat/+server.ts`, `src/lib/workflows/orchestrator/loop.ts`) — the bespoke ReAct loop that edits workflow DAGs from natural language.
4. **Curate phase engine** (`src/lib/curate/engine.ts` orchestration logic) — discovery → propose → generate → test → promote.

The two motivations, ranked:

- **Capability:** Hermes' skills system, agent-curated memory, autonomous skill creation, MCP support, and 18+ provider runtime resolver are concrete capability lifts over the bespoke pieces above.
- **Architectural inversion:** Hermes becomes the core agent runtime; SvelteKit (canvas + builds + chat hub + curate) is presentation + tool host. End users never see Hermes' chat UI; integration is at the API/MCP level.

## 2. Non-goals

- Replace the workflow DAG engine (`src/lib/workflows/engine.ts`). Hermes has no DAG primitive; the engine is preserved.
- Port the 132 site-tools to Python. They stay in TypeScript; Hermes consumes them via MCP.
- Change any user-facing UI. `/jkai`, `/jkai/builds`, `/jkai/canvas`, `/jkai/curate` look and behave identically (or better).
- Expose Hermes' CLI/gateway chat surface to end users. `/admin/hermes` is the only new UI, for config/inspection.
- Migrate jkai's app state (builds, iterations, workflows, curate sessions) out of Postgres.
- Remove `jkai-sandbox` containers — Hermes' bash/edit/read run inside them via Hermes' Docker terminal backend.

## 3. Architecture

Three planes:

```
┌──────────────── homeserv ────────────────┐
│                                           │
│  ┌─── SvelteKit (TS, port 5173) ───┐     │
│  │   /jkai, /jkai/builds,           │     │
│  │   /jkai/canvas, /jkai/curate     │◄────┼─── user (UI unchanged)
│  │   /admin/hermes (new)            │     │
│  │                                  │     │
│  │   HermesClient.ts                │     │
│  │   MCP server (132 tools)         │     │
│  └────────┬────────────┬────────────┘     │
│           ▲            ▼                  │
│           │   ┌────────────────────┐      │
│           │   │ jkai-hermes.service│      │
│           └───┤ (Python, systemd)  │      │
│   /run/user/  │   AIAgent loop     │      │
│   1000/jkai-  │   SQLite (sessions,│      │
│   hermes.sock │   skills, memory)  │      │
│               │   skills/          │      │
│               │   ├ jkai-build     │      │
│               │   ├ jkai-canvas    │      │
│               │   ├ jkai-curate    │      │
│               │   └ design-system  │      │
│               └─────────┬──────────┘      │
│                         │ MCP             │
│                         ▼                 │
│                Postgres (app state)       │
│                                           │
└───────────────────────────────────────────┘
```

**Presentation plane** — SvelteKit. Unchanged user UX. Adds `/admin/hermes` for config/inspection. Talks to Hermes via socket-RPC mirroring the existing `builder-client.ts` pattern.

**Agent plane** — `jkai-hermes.service`. Python systemd user service running Hermes' `AIAgent`. Owns session state, skills, agent-curated memory in SQLite under `~/.hermes-jkai/`. Single Hermes profile (`jkai`) with one Hermes session per build / canvas-orchestrator-conversation / curate-session.

**Tool plane** — MCP server inside SvelteKit, exposing all 132 site-tools (existing TS registry — no porting). Hermes calls tools via MCP to mutate Postgres; SvelteKit subscribes to DB changes for SSE to the UI.

### State boundary

Hermes owns its SQLite (sessions, skills, conversation history, agent-curated memory). Postgres remains canonical for builds/iterations/workflows/curate. They cross only through MCP tool calls. Phase 0 includes a check for a session-backend hook in Hermes — if a clean Postgres adapter is plug-in-able without forking, we consolidate; otherwise the dual-store design stands (option A in the brainstorming session).

A new join table `hermes_sessions(id, hermes_session_id, kind, kind_id, created_at, closed_at)` is the only Postgres↔Hermes-SQLite link.

### What goes away

- `pi-runner.ts` (replaced by Hermes-with-bash/edit/read in jkai-sandbox)
- `llm-client.ts` and `llm-helpers.ts` (replaced by Hermes' `runtime_provider.py`)
- `src/lib/workflows/orchestrator/loop.ts` (replaced by `jkai-canvas` skill)
- `src/lib/curate/engine.ts` orchestration logic (replaced by `jkai-curate` skill); the data-shell event mirror remains
- `builder-client.ts` (replaced by `hermes-client.ts`)
- `jkai-builder.service` (replaced by `jkai-hermes.service`)

### What stays

- Workflow DAG engine, including breakpoints/healing/sub-workflows/heartbeat-reaper
- All 132 TS tool implementations
- Postgres schema for builds, iterations, workflows, curate, pinned notes, pending messages
- All SvelteKit user UIs
- Curate's `discover.ts`, `generate.ts`, `promote.ts` infrastructure (worktree warmup, npm-install hard-linking, git, deploy verification)
- `jkai-sandbox-<buildId>` Docker containers — Hermes' bash tool execs inside them via the Docker terminal backend (configuration, not new code)

## 4. Components

### 4.1 New artefacts

**`jkai-hermes.service` (systemd user unit)** — `~/.config/systemd/user/jkai-hermes.service`. Runs Hermes' socket-gateway; `WantedBy=default.target`; `Restart=on-failure`. Replaces `jkai-builder.service` only after Phase 4.

**Hermes profile** — `HERMES_HOME=~/.hermes-jkai/`:
- `SOUL.md` — assistant identity ("you are jkai's engine; you act through MCP tools; you never expose Hermes-specific terminology to user-facing strings")
- `MEMORY.md` — agent-curated memory (Hermes-managed)
- `USER.md` — facts about John (seeded from `~/.claude/projects/-home-john/memory/MEMORY.md`)
- `config.yaml` — providers, default model, MCP server URL
- `sessions.db` — Hermes' SQLite (Phase 0 verifies the option-D hook)
- `skills/` — see 4.2

**Skills** (Hermes content, four to start):
- `skills/jkai-canvas/` — workflow-graph editing (Phase 1)
- `skills/jkai-build/` — build loop (Phase 2)
- `skills/jkai-curate/` — discovery → propose → generate → test → promote (Phase 3)
- `skills/design-system/` — static reference of tokens/type-ramp/brand-mark rules, lifted from `~/strange-ramblings-design/`

**SvelteKit additions:**
- `src/lib/jkai/hermes-client.ts` — typed RPC client over the socket. Mirror of `builder-client.ts`: `{method, args} → {ok, result/error}`. Methods: `createSession`, `sendMessage`, `streamEvents`, `injectMessage`, `getSession`, `closeSession`, `listSkills`, `setSkillEnabled`, `complete` (Phase 4).
- `src/lib/mcp/server.ts` — adapter from `site-tools/registry.ts` to MCP's tool-listing/tool-call shape. Mounted at `/api/mcp/tools` (HTTP) or as a UNIX-socket MCP listener (decision in Phase 0).
- `src/lib/mcp/auth.ts` — bridge auth (HMAC token, mirror of existing `tool-bridge.ts`). Hermes presents the token; SvelteKit verifies signature and *scopes* the call to the session/build context (`kind` + `kind_id`).
- `src/routes/admin/hermes/+page.svelte` — admin UI. Tabs: Sessions, Skills, Memory, Providers, Health.
- `src/routes/api/admin/hermes/[...path]/+server.ts` — thin proxy.
- `src/routes/api/mcp/+server.ts` — MCP server entry point.

**Postgres additions:**
- `hermes_sessions(id, hermes_session_id, kind, kind_id, created_at, closed_at)` — `kind ∈ {build, canvas_chat, curate, manual}`; `kind_id` foreign-keys into the relevant existing table.

### 4.2 Modified files (per phase)

**Phase 1 (canvas):**
- `src/routes/api/workflows/orchestrator/chat/+server.ts` — body becomes a thin Hermes proxy.
- `src/lib/workflows/orchestrator/loop.ts` — retired.

**Phase 2 (build loop):**
- `src/lib/jkai/executor.ts` — `runPi(...)` becomes `hermes-client.sendMessage(...)`.
- `src/lib/jkai/prompt.ts` — slimmed to *iteration-context payload assembly* only; agent identity moved into `jkai-build` skill.
- `src/lib/jkai/pi-runner.ts` — deleted.
- `src/lib/jkai/builder-client.ts` — deleted; callers migrated to `hermes-client.ts`.

**Phase 3 (curate):**
- `src/lib/curate/engine.ts` — gutted to a thin event mirror; orchestration logic deleted.
- `src/lib/curate/discover.ts`, `generate.ts`, `promote.ts` — kept, exposed as MCP tools.

**Phase 4 (LLM gateway):**
- `src/lib/jkai/llm-client.ts`, `src/lib/workflows/nodes/llm-helpers.ts` — replaced with thin shims over Hermes' `complete(...)` socket method.
- `tool-bridge.ts` — retired (legacy Pi-specific bridge); all bridge auth via `mcp/auth.ts`.

## 5. Data flow

### 5.1 Session lifecycle

```
SvelteKit                    jkai-hermes.service       Postgres
─────────                    ───────────────────       ────────
hermes-client.createSession(
  kind="canvas_chat",
  kind_id=workflowId,
  skill="jkai-canvas",
  context={workflow_id, ...}
)
        │
        ├──RPC──► AIAgent.new_session(skill=jkai-canvas, bridge_token=<HMAC>)
        │              │
        │              └──► writes to sessions.db
        │◄──────hermes_session_id──┘
        │
        └──INSERT INTO hermes_sessions ────────────►  row created
        │
        ◄── { sessionId, hermesSessionId } returned to caller
```

Sessions are persisted and survive `jkai-hermes.service` restarts. On restart, Hermes reloads from `sessions.db`; SvelteKit reloads its rows from `hermes_sessions`.

### 5.2 Phase 1: canvas chat → DAG mutation

User opens `/jkai/canvas/foo` and types "add a scrape node and wire it to the existing summariser":

```
Browser ──POST──► /api/workflows/orchestrator/chat
                  { workflowId, message }
                            │
                            ▼
            hermes-client.sendMessage(sessionId, message)
                            │
                            └─ socket RPC ─► AIAgent.advance(session, message)
                                                       │
                                                       │ (Hermes ReAct loop:
                                                       │   1. compose prompt with
                                                       │      jkai-canvas skill +
                                                       │      live workflow JSON
                                                       │   2. call LLM)
                                                       │
                                                       ├──► tool_call: search_nodes("scrape")
                                                       │       │
                                                       │       ▼
                                                       │   /api/mcp/tools  ◄──Hermes
                                                       │       │ verifies bridge_token
                                                       │       │ executes site-tools/registry.ts:executeTool
                                                       │       ◄──── matches
                                                       │
                                                       ├──► tool_call: create_node({type:"scrape",...})
                                                       │       └──INSERT INTO workflow_nodes──►
                                                       │
                                                       ├──► tool_call: add_edge({from, to})
                                                       │       └──INSERT INTO workflow_edges──►
                                                       │
                                                       └──► assistant message: "Added scrape node ..."

SvelteKit endpoint pipes Hermes' event stream back as SSE to the browser.
Canvas re-fetches workflow_nodes/edges (existing SSE on those tables) → graph re-renders.
```

The bespoke ReAct loop in `loop.ts` is gone. The "knowledge of when to call which tool" lives in the `jkai-canvas` skill markdown. The DAG-mutation tools stay where they always were.

### 5.3 Phase 2: build iteration with mid-flight injection

```
SvelteKit executor.ts
─────────────────────
  build_iteration_loop(buildId):
    while not done:
      ctx = buildIterationContext(buildId)   ─── reads from Postgres ───
        ├─ pinned notes (jkaiBuildNotes)
        ├─ pending messages (jkaiBuildPendingMessages, soft-deleted on consume)
        ├─ workflow attachment (workflow_nodes/edges)
        ├─ build plan + last iteration eval
        └─ deadline

      hermes-client.sendMessage(sessionId, ctx)
        │
        └──► AIAgent.advance(session, ctx)
               │
               ├─ skill: jkai-build (system prompt, identity, "you are
               │   coding agent for build N, your sandbox is at /workspace")
               │
               ├─ tool_call: bash("npm test")
               │     └─ Hermes' Docker terminal backend execs INSIDE
               │        jkai-sandbox-<buildId> container. Stream lines back.
               │
               ├─ tool_call: edit_file(path, patch) — also runs in container
               │
               ├─ tool_call: log_iteration({ goals, actions, evaluation, ... })
               │     └─ MCP → INSERT INTO jkaiIterations
               │
               └─ assistant: "iteration complete, eval=..."

      iteration done → check deadline, plan, etc.
```

**Mid-flight injection:**
```
User sends message via UI mid-iteration:
  POST /api/jkai/builds/123/inject
    └─ INSERT INTO jkaiBuildPendingMessages

The next iteration's buildIterationContext() drains pending messages, includes
them in the user-message payload to Hermes. No special primitive needed.

For "interrupt the current iteration": SvelteKit calls
hermes-client.injectMessage(sessionId, message), which Hermes routes through
its existing user-input-mid-flight callback (the same primitive that handles
CLI interjection). The current tool call completes; the next reasoning step
sees the new message.
```

This maps jkai's bespoke "soft-delete consumed messages" pattern directly onto Hermes' existing CLI-injection callback. The Postgres tables for pending messages and pinned notes survive — they're the *queue*; Hermes consumes them through MCP tools.

### 5.4 Auth: bridge token

Mirror of the existing `tool-bridge.ts` HMAC pattern.

- Session creation mints a token: `HMAC(sharedSecret, sessionId|kind|kind_id|expiry)`.
- The token is passed to Hermes at session creation and stored in Hermes' session record.
- Every MCP tool call from Hermes presents the token; the MCP server verifies the signature and that the call's target matches the scope (`kind_id`).
- Token expiry = session lifetime + grace; rotate on rollover.

Hermes can't escape its scope: a canvas chat session can mutate *its* workflow's nodes/edges; it cannot start a build, edit blog posts, or call gmail tools (different `kind`, different scope, different secret).

### 5.5 Streaming

Hermes emits typed events: `tool_call_started`, `tool_call_completed`, `assistant_message`, `model_call_started`, `error`, `done`. The SvelteKit endpoint subscribes via the socket, translates to the existing UI's expected SSE shapes (build log lines, canvas mutation events, curate phase updates), and forwards to the browser. Existing UI surfaces are untouched.

### 5.6 Error path

- **Hermes service down:** SvelteKit's `hermes-client` returns a typed error. UI surfaces "engine offline." Build executor pauses (existing pattern). systemd restarts; sessions reload.
- **MCP tool failure:** propagates to Hermes as a tool error; Hermes' existing retry/fallback path applies.
- **Sandbox container died (Phase 2):** bash returns failure; build skill flags iteration as `failure: sandbox_dead`; existing failure handling kicks in.
- **Bridge token rejected:** session marked compromised, closed; user re-opens.

## 6. Migration phases

Five phases, each independently shippable, each with a feature flag, each with a `git revert`-based rollback after deletion.

### Phase 0 — Install standalone + verify (2–3 days)

**Deliverables:**
- `~/.hermes-jkai/` profile with `config.yaml`, seed `SOUL.md`, seed `USER.md`.
- Providers configured for z.ai, OpenRouter, Anthropic.
- `hermes -p jkai` CLI works against each provider.
- MCP smoke test: stub `echo_tool` MCP server, Hermes calls it with bridge-token auth.
- Investigation memo: "Does Hermes expose a session-backend hook?" If yes, prototype Postgres adapter (1-day spike). If no, lock in dual-store design.
- `~/.config/systemd/user/jkai-hermes.service` created but **not enabled** yet.

**Exit criteria:**
- 3-provider smoke test passes.
- MCP echo round-trip works.
- Session-backend question has a documented answer.

**Rollback:** uninstall Hermes; delete `~/.hermes-jkai/`. Zero blast radius.

### Phase 1 — Canvas orchestrator chat (1–2 weeks)

**Deliverables:**
- `jkai-hermes.service` enabled; socket reachable.
- `src/lib/jkai/hermes-client.ts`.
- `src/lib/mcp/server.ts` — **initial scope: only the 22 `workflows` domain tools**. Other 110 tools not exposed yet.
- `src/lib/mcp/auth.ts`.
- `~/.hermes-jkai/skills/jkai-canvas/SKILL.md`.
- `src/routes/api/workflows/orchestrator/chat/+server.ts` — body replaced with Hermes proxy.
- `src/routes/admin/hermes/+page.svelte` v1 (read-only: sessions, health, last 50 events).
- `hermes_sessions` table migrated.
- Feature flag `JKAI_HERMES_CANVAS_CHAT=1`.

**Exit criteria:**
- Flag-on for one week with no canvas regressions; same node-creation success rate; latency p50 unchanged (allow +20% p95).
- Out-of-scope token attempt → 403.
- `loop.ts` deleted.

**Rollback:** flip flag; or `git revert` after deletion.

### Phase 2 — Pi-runner / build loop (3–4 weeks)

**Deliverables:**
- MCP server expands: `builds` (12), `memory` (3), `visualise` (3), `web` (1), `files` (2), plus infra tools (`log_iteration`, `extend_deadline`, `mark_phase`).
- `~/.hermes-jkai/skills/jkai-build/SKILL.md`.
- `~/.hermes-jkai/skills/design-system/`.
- Hermes' Docker terminal backend wired per build session — `bash`/`edit`/`read` inside `jkai-sandbox-<buildId>`.
- `executor.ts` — `runPi(...)` replaced with `hermes-client.sendMessage(...)`.
- `prompt.ts` slimmed; agent identity moved to `jkai-build` skill.
- `pi-runner.ts`, `builder-client.ts` deleted; callers migrated.
- `jkai-builder.service` kept as flagged fallback during this phase.
- Mid-flight injection wired (pending-messages drain + Hermes injection callback).
- Coding-model selection via existing `modelId` field on `jkaiBuilds`. Default model logged in this doc at phase start.
- Feature flag `JKAI_HERMES_BUILD_LOOP=1`.

**Exit criteria:**
- 5 consecutive end-to-end builds pass with no regression in iteration success rate, deadline-hit rate, mid-flight injection, plan-approval gate, sandbox isolation.
- Token usage and per-iteration latency within ±20% of Pi baseline (or better).
- `pi-runner.ts` deleted.

**Rollback:** flip flag while `jkai-builder.service` is alive; or `git revert` after deletion.

### Phase 3 — Curate (2–3 weeks)

**Deliverables:**
- MCP `curate` domain: `curate_create_session`, `curate_advance_phase`, `curate_set_proposal`, `curate_record_test_results`, plus wraps for `discover.ts`, `generate.ts`, and the 8 individual `promote_step_*` tools (so Hermes can checkpoint between steps).
- `~/.hermes-jkai/skills/jkai-curate/SKILL.md`.
- `engine.ts` gutted to thin event mirror; orchestration logic deleted.
- `discover.ts`, `generate.ts`, `promote.ts` kept; called from MCP server.
- Worktree warmup, template hard-linking, npm-install skipping unchanged.
- Feature flag `JKAI_HERMES_CURATE=1`.

**Exit criteria:**
- 3 end-to-end Curate sessions complete (discovery → live test → promote) with no regression in promote success rate.
- Worktree cleanup, deploy verification, merge conflicts handled correctly.
- Apple Calendar acceptance scenario passes on Hermes.

**Rollback:** flip flag; or `git revert` after deletion.

### Phase 4 — LLM gateway cleanup (1 week)

**Deliverables:**
- Hermes exposes stateless `complete({messages, tools, model, stream}) → {message, tool_calls, usage}` via socket.
- `llm-client.ts`, `llm-helpers.ts` replaced with shims over `complete(...)`.
- Remaining direct callers (`/api/quickanswer`, `/api/deepdive`, `llm-call` workflow nodes) — no code change if shim signatures match.
- `jkai-builder.service` retired.
- `tool-bridge.ts` retired.
- MCP server fully populated: all 132 existing site-tools exposed (in addition to the new MCP-only infra/curate tools added in Phases 2–3).
- External MCP-aware client (Claude Code, Cursor) can connect and call jkai tools.

**Exit criteria:**
- Zero references to `llm-client.ts` outside the shim.
- `jkai-builder.service` removed from systemd.
- Hermes is the only LLM client in the codebase.
- All 132 existing site-tools reachable via MCP, plus the infra/curate MCP-only tools.

**Rollback:** `git revert`. By this stage Hermes has been running three phases of production load.

### Total

Roughly **8–13 weeks of focused work**. Each phase shippable; rollback intact at every step. The highest-risk phase (Phase 2) lands while reversibility is still cheap.

### Cumulative tool-exposure on MCP

| Phase | Domain added | Cumulative existing tools | New MCP-only tools added |
|---|---|---|---|
| 1 | workflows (22) | 22 / 132 | bridge-token-test stubs |
| 2 | builds (12), memory (3), visualise (3), web (1), files (2) | 43 / 132 | `log_iteration`, `extend_deadline`, `mark_phase` |
| 3 | (no new existing-domain expansion) | 43 / 132 | `curate_*` family wrapping `discover`/`generate`/`promote` (~12 new MCP tools) |
| 4 | remaining 89 (research, gmail, blog, health, scraper, home-assistant, scheduled, heartbeat, followup, ephemeral-tools, diagnostics, media-*, whatsapp) | 132 / 132 | (none net-new) |

This makes Phase 4's "fully populated MCP" concrete: the bulk of the surface area lands in Phase 4, after the agentic surfaces have been validated on the smallest tool set possible.

### Implementation plan scope

Implementation plans are written **per-phase**, not for the whole migration at once. The next plan to write covers Phase 0 only. Each subsequent phase gets its own plan, written when its predecessor's exit criteria pass — so the plan can incorporate what we learned from the previous phase.

## 7. Testing and risk

### 7.1 Per-phase acceptance scenarios

**Phase 0:**
- 3-provider smoke test (z.ai, OpenRouter, Anthropic).
- MCP echo round-trip with bridge-token auth.
- Service crash recovery — kill mid-session, restart, verify session reloads.

**Phase 1 (canvas):**
- "Add a node" — single-tool flow.
- "Wire the existing graph differently" — multi-tool flow.
- "Build me a workflow that scrapes X and emails me a summary" — sustained conversation, finalize.
- Out-of-scope token rejection.
- 3 simultaneous canvas chats — concurrency check.

**Phase 2 (build):**
- Greenfield SvelteKit page build with design-token check.
- Mid-flight injection survives across iterations.
- Plan-approval gate works (resume + reject).
- Sandbox isolation (build can't read outside `/workspace`).
- 5 consecutive builds matching Pi baseline.

**Phase 3 (curate):**
- Apple Calendar acceptance scenario end-to-end.
- Failing-test rollback — Hermes halts before promote.
- 2 concurrent curate sessions with isolated worktrees.

**Phase 4 (gateway):**
- All `llm-call` workflow nodes continue to work.
- No retired-module references in compiled output.
- External MCP client can list and call jkai tools.

### 7.2 Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Capability regression: Hermes-with-bash performs worse than Pi on coding tasks | Medium | High (Phase 2) | Fixed prompt-set comparison vs Pi baseline. Below threshold → tune skill, change coding model, or expose richer tools. Fallback: keep Pi alive longer, partial swap. |
| Skill-prompt quality variance | Medium | Medium | Skills in git, reviewed alongside test runs. Skill rollback = `git revert`. |
| MCP bridge bugs leak scope | Low | High (data integrity) | Token scope verified inline on every MCP call. Adversarial test cases. Audit log. Phase 1 starts on smallest tool surface. |
| Hermes single-threaded ⇒ concurrency bottleneck | Medium | Medium | First measure, then mitigate. Most LLM time is network-wait (cooperative async). If observed, shard at session granularity behind one socket via a small dispatcher. Hermes' profile isolation enables multi-process if needed. |
| Service unavailability | Medium | Medium | systemd `Restart=on-failure`. SvelteKit surfaces "engine offline." Build executor pauses. Health check at `/admin/hermes`. Re-enable `jkai-builder.service` as emergency fallback. |
| Two-datastore drift (option A) | Medium | Low | `hermes_sessions` join table canonical; cleanup job reconciles. Risk vanishes if option D succeeds in Phase 0. |
| Hermes upstream changes break us | Low | Medium | Pin to a tag; explicit upgrade path with full Phase 1–3 acceptance re-run. No auto-update. |
| Bridge token compromise | Low | High | Secret rotation procedure documented; secret in `~/.hermes-jkai/.env` (700). Localhost-only. Audit log. |
| Model-cost surprise | Medium | Low | Phase 0 token-usage benchmark per provider. Phase 2 explicit before/after. Hermes' prompt-caching breakpoints (first-class feature) keep marginal cost low. |

### 7.3 Reversibility budget

- **End of Phase 1:** Reversibility intact. Restoring `loop.ts` from git.
- **End of Phase 2:** Reversibility costly but possible. Restoring `pi-runner.ts`, `builder-client.ts`, plus `jkai-builder.service` config — about 1 day's work.
- **End of Phase 3:** Reversibility moderate. Restoring `engine.ts` orchestration logic — about half a day.
- **End of Phase 4:** Effectively irreversible without significant work. By this point Hermes has been running three phases of production load — if rollback is needed, the answer is "fix Hermes."

The structure puts the highest-risk phase (Phase 2) at the point where reversibility is still cheap.

### 7.4 Operational readiness checklist (per phase, before final flag-on)

- [ ] systemd service stable for ≥7 days under realistic load.
- [ ] Acceptance scenarios pass on flag-on.
- [ ] Comparison metrics within ±20% of pre-Hermes baseline (or favourable).
- [ ] Audit log shows zero unexplained out-of-scope token attempts.
- [ ] `/admin/hermes` health tab reflects accurate state.
- [ ] Rollback drill tested in staging.
- [ ] Loud-failure mode verified (kill Hermes mid-build → executor pauses, doesn't lose state).

## 8. Open questions and follow-ups

- **Coding-model default for Phase 2.** Decide at Phase 2 kickoff (likely `claude-opus-4-7`, `glm-4.6`, or `gpt-5`). Log decision and benchmark.
- **MCP transport: HTTP vs UNIX-socket.** Phase 0 prototypes both, picks one for Phase 1.
- **Profile sharding strategy if concurrency bottlenecks emerge.** Defer to observation; document threshold (e.g. >3 concurrent sessions causing >2× latency).
- **`USER.md` strategy.** Symlink to `~/.claude/projects/-home-john/memory/MEMORY.md`? One-way sync? Independent? Decide during Phase 0.

## 9. Appendix: terminology

- **Hermes session** — A Hermes-internal conversation context with a skill loaded, persisted in `sessions.db`. Distinct from "build session" or "curate session" (those are jkai concepts in Postgres).
- **Profile** — A Hermes-level config + skills + memory unit isolated by `HERMES_HOME`. We use one profile, `jkai`.
- **Skill** — Hermes' procedural-memory primitive. A directory under `skills/` with a `SKILL.md` plus optional supporting files. Defines agent identity, tool-usage guidance, examples for a particular task class.
- **MCP** — Model Context Protocol. The standards-based bridge over which Hermes calls jkai's TS tools without porting them.
- **Bridge token** — HMAC-signed scope-limited capability passed by Hermes to the MCP server on every tool call. Mirrors the existing `tool-bridge.ts` pattern that protects Pi's tool calls today.
- **`kind` / `kind_id`** — The fields in `hermes_sessions` that link a Hermes session to a specific jkai resource (build, canvas chat, curate session, manual admin session) and constrain which tools/resources it can touch.
