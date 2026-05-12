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

> **Transport update — 2026-05-11.** Phase 0 discovered that Hermes v2026.5.7 has no native UNIX-socket RPC gateway; `hermes gateway run` is the messaging-platform multiplexer. Rather than building a custom socket gateway, jkai integrates as a **Hermes platform** alongside Telegram/Slack/WhatsApp/Discord/Signal. The transport between SvelteKit and Hermes is therefore HTTP inbound + SSE outbound, mediated by a `JkaiPlatformAdapter` plugin registered with Hermes' `PlatformRegistry`. The architecture diagram and component lists below reflect this design. The original UNIX-socket framing is superseded.

Three planes:

```
┌──────────────── homeserv ────────────────────────────┐
│                                                       │
│  ┌─── SvelteKit (TS, port 5173) ───────────────┐     │
│  │   /jkai, /jkai/builds,                       │     │
│  │   /jkai/canvas, /jkai/curate                 │◄────┼── user (UI unchanged)
│  │   /admin/hermes (new)                        │     │
│  │                                              │     │
│  │   hermes-client.ts  (HTTP/SSE)               │     │
│  │   MCP server (132 tools)                     │     │
│  └─────────┬─────────────────────┬──────────────┘     │
│            │ HTTP POST           ▲ MCP                │
│            │ (user msg)          │ (tool calls)       │
│            ▼                     │                    │
│  ┌──────────────────────────────────────────────┐     │
│  │ jkai-hermes.service  (systemd, Python)       │     │
│  │   hermes gateway run --replace               │     │
│  │   ┌─ JkaiPlatformAdapter (plugin)            │     │
│  │   │    inbound:  POST  /platforms/jkai/msg   │     │
│  │   │    outbound: SSE   /platforms/jkai/out   │     │
│  │   ├─ AIAgent loop (per-session)              │     │
│  │   ├─ SQLite (sessions, skills, memory)       │     │
│  │   └─ skills/                                 │     │
│  │       ├ jkai-build                           │     │
│  │       ├ jkai-canvas                          │     │
│  │       ├ jkai-curate                          │     │
│  │       └ design-system                        │     │
│  └──────────────────────┬───────────────────────┘     │
│                         │ MCP                         │
│                         ▼                             │
│                Postgres (app state)                   │
│                                                       │
└───────────────────────────────────────────────────────┘
```

**Presentation plane** — SvelteKit. Unchanged user UX. Adds `/admin/hermes` for config/inspection. Talks to Hermes through `hermes-client.ts`: HTTP POST for inbound user messages, SSE for outbound stream from the platform adapter.

**Agent plane** — `jkai-hermes.service`. Python systemd user service running `hermes gateway run --replace` with the `JkaiPlatformAdapter` plugin registered. The adapter is a `BasePlatformAdapter` subclass that treats SvelteKit as another messaging channel (just like Telegram or Slack). One Hermes session per chat_id, where chat_id is bound to a jkai resource (`workflow_id` for canvas chats, `build_id` for builds, `curate_session_id` for curate sessions). Hermes' SQLite remains canonical for session, skill, and agent-curated memory state.

**Tool plane** — MCP server inside SvelteKit, exposing all 132 site-tools (existing TS registry — no porting). Hermes calls tools via MCP to mutate Postgres; SvelteKit subscribes to DB changes for SSE to the UI. The two outbound streams to a browser are therefore: (a) Postgres change SSE for DAG/build/curate state, (b) platform-adapter SSE for conversational state.

### State boundary

Hermes owns its SQLite (sessions, skills, conversation history, agent-curated memory). Postgres remains canonical for builds/iterations/workflows/curate. They cross only through MCP tool calls. Phase 0 includes a check for a session-backend hook in Hermes — if a clean Postgres adapter is plug-in-able without forking, we consolidate; otherwise the dual-store design stands (option A in the brainstorming session).

A new join table `hermes_sessions(id, hermes_session_id, kind, kind_id, created_at, closed_at)` is the only Postgres↔Hermes-SQLite link.

### What goes away

- `pi-runner.ts` (replaced by Hermes-with-bash/edit/read in jkai-sandbox)
- `llm-client.ts` and `llm-helpers.ts` (replaced by Hermes' `runtime_provider.py`)
- `src/lib/workflows/orchestrator/loop.ts` (replaced by `jkai-canvas` skill)
- `src/lib/curate/engine.ts` orchestration logic (replaced by `jkai-curate` skill); the data-shell event mirror remains
- `builder-client.ts` (replaced by `hermes-client.ts`; HTTP/SSE shape, not RPC-over-socket)
- `jkai-builder.service` (replaced by `jkai-hermes.service` running `hermes gateway run --replace`)

### What stays

- Workflow DAG engine, including breakpoints/healing/sub-workflows/heartbeat-reaper
- All 132 TS tool implementations
- Postgres schema for builds, iterations, workflows, curate, pinned notes, pending messages
- All SvelteKit user UIs
- Curate's `discover.ts`, `generate.ts`, `promote.ts` infrastructure (worktree warmup, npm-install hard-linking, git, deploy verification)
- `jkai-sandbox-<buildId>` Docker containers — Hermes' bash tool execs inside them via the Docker terminal backend (configuration, not new code)

## 4. Components

### 4.1 New artefacts

**`jkai-hermes.service` (systemd user unit)** — `~/.config/systemd/user/jkai-hermes.service`. Runs `hermes gateway run --replace` with the `JkaiPlatformAdapter` plugin loaded. `WantedBy=default.target`; `Restart=on-failure`. Replaces `jkai-builder.service` only after Phase 4.

**`JkaiPlatformAdapter`** — Python plugin under `~/.hermes-jkai/extensions/jkai_platform/`. Subclasses Hermes' `BasePlatformAdapter` (`gateway/platforms/base.py`). Registers via `PlatformRegistry.register(PlatformEntry(name="jkai", ...))` at gateway startup. Implements:
- `connect()` — opens an HTTP listener on a localhost port (default `:18790`) for SvelteKit POSTs.
- `send(chat_id, content, metadata)` — pushes a frame to the chat_id's outbound SSE queue.
- `edit_message(chat_id, message_id, content)` — pushes a `replace` frame for progressive token streaming.
- Inbound POST handler turns each request into a `MessageEvent(platform="jkai", chat_id, text)` and calls the registered message handler (which routes to AIAgent + session).
- All requests carry a `Bridge-Token` header verified by the same HMAC primitive used for MCP (`src/lib/mcp/auth.ts` shape, mirrored in Python).

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
- `src/lib/jkai/hermes-client.ts` — typed HTTP/SSE client to the platform adapter. Methods: `sendMessage(chatId, text)` (POST), `openStream(chatId)` (SSE ReadableStream), `closeSession(chatId)`, `listSkills()`, `setSkillEnabled()`, `complete()` (Phase 4, used by the stateless completion endpoint). Sessions are implicit — established by the first message on a `chat_id`.
- `src/lib/mcp/server.ts` — adapter from `site-tools/registry.ts` to MCP's tool-listing/tool-call shape. HTTP-mounted (Phase 0 decision confirmed by Task 7's working stdio-style MCP round-trip with the echo-stub; the real server uses HTTP since Hermes spawns stdio MCPs per-connection and the SvelteKit MCP needs to be long-lived).
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
- `src/lib/jkai/llm-client.ts`, `src/lib/workflows/nodes/llm-helpers.ts` — replaced with thin shims over Hermes' `complete(...)` HTTP endpoint (alongside but separate from the platform adapter — completions are session-less so they don't need a chat_id).
- `tool-bridge.ts` — retired (legacy Pi-specific bridge); all bridge auth via `mcp/auth.ts`.

## 5. Data flow

### 5.1 Session lifecycle

Sessions are **implicit** under the platform-adapter model: the first inbound message on a `chat_id` triggers Hermes' gateway to instantiate (or resume) a session for that chat_id. SvelteKit doesn't call an explicit `createSession`; it picks a `chat_id` (derived from the relevant jkai resource) and sends a message.

```
SvelteKit                                jkai-hermes.service              Postgres
─────────                                ───────────────────              ────────
hermes-client.sendMessage(
  chatId=workflow_id,           POST /platforms/jkai/msg
  text="...user msg...",        Bridge-Token: <HMAC>
  kind="canvas_chat"            { chat_id, text, kind, kind_id, skill="jkai-canvas" }
)
        │                       │
        └──HTTP POST───────────►│
                                ├─► JkaiPlatformAdapter.inbound_handler
                                │     │
                                │     └─► MessageEvent → gateway router
                                │           │
                                │           └─► AIAgent.advance(session(chat_id), text)
                                │                 │
                                │                 └─► writes to sessions.db
                                │
                                ◄── 202 Accepted (session_id, message_id)
        │
        └──INSERT INTO hermes_sessions (first time only) ───────────►  row created
        │
        ◄── SvelteKit opens SSE: GET /platforms/jkai/out?chat_id=...
```

Sessions are persisted and survive `jkai-hermes.service` restarts. On restart, Hermes reloads from `sessions.db`; SvelteKit reconciles its `hermes_sessions` join rows on next message.

### 5.2 Phase 1: canvas chat → DAG mutation

User opens `/jkai/canvas/foo` and types "add a scrape node and wire it to the existing summariser":

```
Browser ──POST──► /api/workflows/orchestrator/chat
                  { workflowId, message }
                            │
                            ▼
            hermes-client.sendMessage(chatId=workflowId, text=message)
                            │
                            └─ HTTP POST ──► JkaiPlatformAdapter
                                                │
                                                ├─► AIAgent.advance(session(workflowId), message)
                                                │   (ReAct loop:
                                                │    1. prompt = jkai-canvas skill + live workflow JSON
                                                │    2. call LLM)
                                                │     │
                                                │     ├──► tool_call: search_nodes("scrape")
                                                │     │       │
                                                │     │       ▼
                                                │     │   /api/mcp/tools  ◄── Hermes (MCP client)
                                                │     │       │ verifies bridge_token
                                                │     │       │ executes registry.ts:executeTool
                                                │     │       ◄──── matches
                                                │     │
                                                │     ├──► tool_call: create_node({type:"scrape",...})
                                                │     │       └──INSERT INTO workflow_nodes──►
                                                │     │
                                                │     ├──► tool_call: add_edge({from, to})
                                                │     │       └──INSERT INTO workflow_edges──►
                                                │     │
                                                │     └──► assistant message: "Added scrape node ..."
                                                │            (streamed as tokens)
                                                │
                                                └─► JkaiPlatformAdapter.send(workflowId, frame)
                                                      └─► pushed to chat_id's outbound SSE queue

SvelteKit endpoint pipes the SSE outbound back to the browser as the assistant's
streaming reply. Canvas separately receives DAG mutations via the existing
Postgres SSE on workflow_nodes / workflow_edges, so the graph re-renders as
tool calls land — independent of the conversational stream.
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

      hermes-client.sendMessage(chatId=buildId, text=ctx)
        │
        └──HTTP POST──► JkaiPlatformAdapter
                          │
                          └──► AIAgent.advance(session(buildId), ctx)
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

For "interrupt the current iteration": SvelteKit POSTs a normal message with
the same chat_id while a session is mid-call. The platform adapter accepts
the inbound, queues it, and Hermes' gateway delivers it at the next message-
handler tick. The current tool call completes; the next reasoning step sees
the new message. (Platform-level injection is the natural behaviour of the
gateway's per-chat message ordering; no custom primitive needed.)
```

This maps jkai's bespoke "soft-delete consumed messages" pattern directly onto Hermes' existing CLI-injection callback. The Postgres tables for pending messages and pinned notes survive — they're the *queue*; Hermes consumes them through MCP tools.

### 5.4 Auth

> **Layered model — updated 2026-05-11.** The initial design assumed a single per-call HMAC bridge-token in both directions. Phase 1 implementation discovered Hermes' MCP client does not support per-session/per-call header injection — `mcp_servers[*].headers` is gateway-scoped, applied to every call. The two directions therefore use different auth shapes, with scope binding handled at the layer that can actually see it.

**Direction 1 — Platform-inbound (SvelteKit → Hermes):** per-call scoped HMAC bridge token.

- Implemented in Phase 0 at `src/lib/mcp/auth.ts` (JSON+base64url payload, 8/8 tests). Python mirror at `~/.hermes-jkai/extensions/jkai_platform/auth.py` (cross-validated byte-equivalent).
- SvelteKit mints a token for each chat_id and includes it as a `Bridge-Token` header on every POST to `/platforms/jkai/msg`.
- The platform adapter verifies before queuing the message. Scope: `(sessionId, kind, kind_id)` matches the chat_id's resource. Token expiry: session lifetime + grace; rotate on rollover.
- SvelteKit cannot forge a scope it shouldn't have because it's the trusted mint side: this gate ensures only legitimate SvelteKit routes can speak to Hermes on behalf of a given chat.

**Direction 2 — MCP outbound (Hermes → SvelteKit):** static shared bearer.

- Hermes' `mcp_servers.jkai.headers.Authorization` is set to `Bearer ${HERMES_BRIDGE_SECRET}` (env-interpolated from `~/.hermes-jkai/.env` at gateway startup).
- SvelteKit's `/api/mcp` JSON-RPC dispatcher does a constant-time compare against `env.HERMES_BRIDGE_SECRET` (loaded via `$env/dynamic/private`, falling back to `process.env` for tests). On mismatch → JSON-RPC error `-32001` (auth-shaped).
- `initialize`, `tools/list`, `ping`, `notifications/*` are unauthenticated (MCP discovery is public). Only `tools/call` requires the bearer.
- **Scope binding moves to the tool layer:** every workflow-domain tool accepts a `workflow_id` (or `workflowId`) argument. Hermes' skill prompt constrains the agent to call tools only with the workflow_id from its current session context. Tools themselves can enforce business rules (workflow exists, user owns it, etc.).

**Why the asymmetry is OK for Phase 1:** Hermes is single-user on a single machine; the worst a confused agent can do is mutate the wrong workflow on a system where only one user has access. The risk surface is "Hermes' skill prompt fails to constrain the agent" — mitigated by skill review and Task 14's acceptance scenarios. A stricter model (session-bound MCP proxy, or upstream Hermes patch for per-session headers) is recommended for Phase 1.5 if multi-user use ever lands.

### 5.5 Streaming

Two outbound streams reach the browser:

- **Platform-adapter SSE** (conversational): the `JkaiPlatformAdapter` pushes streamed assistant tokens and final-message frames to `/platforms/jkai/out?chat_id=...`. SvelteKit's chat endpoint pipes this directly to the browser. Frame shapes mirror what Telegram/Slack adapters already produce — initial-send, edit, finalize.
- **Postgres-change SSE** (structural): Hermes' MCP tool calls (create_node, log_iteration, curate_advance_phase, etc.) write to Postgres; the existing per-table SSE channels (`workflow_nodes`, `workflow_edges`, `jkaiIterations`, etc.) deliver DAG/build/curate state to the browser independently. The two streams are intentionally decoupled — the UI re-renders structural state from the database, not from inference-time messages.

This decoupling is the core trade for adopting the platform-adapter design: the platform layer doesn't see discrete tool-call events as separate frames (only streamed text), but it doesn't need to, because MCP writes are already the canonical structural signal.

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
- `jkai-hermes.service` enabled; `hermes gateway run --replace` with `JkaiPlatformAdapter` plugin loaded; HTTP listener on `:18790` (or chosen port) reachable.
- `~/.hermes-jkai/extensions/jkai_platform/` — Python plugin: `BasePlatformAdapter` subclass + `PlatformRegistry` registration; bridge-token verification (Python mirror of `src/lib/mcp/auth.ts`); per-chat outbound queue.
- `src/lib/jkai/hermes-client.ts` — HTTP+SSE client.
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

### Phase 1.5 — General chat via skills (1–2 weeks)

**Scope:** Extend Hermes coverage from canvas-only to the `/jkai` general chat hub. After Phase 1, Hermes handles workflow-graph editing; every other user query (blog, email, health, research, scheduling, scraping, home automation, files, utilities) still hits the legacy chat path. Phase 1.5 closes that gap without waiting for Phase 2's build-loop work.

**Mechanism:** Phase 1.5 makes Hermes' built-in skill system load-bearing. Rather than a hand-rolled SvelteKit allowlist that gates which tools the agent may call, constraint responsibility shifts entirely to Hermes-native skill scope declarations. Nine per-domain skills (`jkai-general`, `jkai-blog`, `jkai-gmail`, `jkai-health`, `jkai-research`, `jkai-scheduled`, `jkai-scraper`, `jkai-home-assistant`, `jkai-files`, `jkai-utility`) each declare their trigger conditions and tool inventory in `SKILL.md`. Hermes' native router selects the appropriate skill for each incoming chat based on session metadata (`kind`/`kind_id`) and query content; the agent self-selects from there. The `workflows`-only toolset gate in `jsonrpc.ts` is removed — the MCP layer becomes permissive and trusts the skill system to fence scope. `kind`/`kind_id` are propagated through the `JkaiPlatformAdapter` into Hermes session metadata so the router has the context it needs.

**Deliverables:**
- 9 new Hermes skills under `~/.hermes-jkai/skills/` covering all general-chat-relevant tool domains (~64 tools).
- 1 update to `jkai-canvas/SKILL.md`: add cross-skill yield notes so the canvas agent gracefully declines off-topic requests.
- `src/lib/mcp/jsonrpc.ts` — `workflows`-only toolset gate removed; replaced with a comment explaining the skill-system model.
- `src/lib/mcp/jsonrpc.test.ts` — gate test replaced with a positive "full registry callable" assertion.
- `~/.hermes-jkai/extensions/jkai_platform/adapter.py` — confirm `kind` + `kind_id` propagate into `MessageEvent.raw_message` for skill-router consumption.
- Acceptance log (`docs/superpowers/research/2026-05-11-hermes-phase-1-acceptance.md`) extended with 5 general-chat scenarios.

**Exit criteria:**
- 5 additional acceptance scenarios pass on `JKAI_HERMES_CANVAS_CHAT=1`: blog draft, Gmail search, health summary, multi-domain (scheduled + WhatsApp), ambiguous-query clarification.
- All 5 Phase 1 canvas scenarios still pass (regression check).
- One-week soak now covers both canvas and general chat with no regressions in either path.
- Agent routes to the correct domain skill on ≥90% of representative prompts (manual verification).
- `jsonrpc.ts` contains no reference to `getToolsByToolset('workflows')` for gating purposes.

**Rollback:** flip `JKAI_HERMES_CANVAS_CHAT` off — both canvas and general chat revert to legacy paths. Or `git revert` the Phase 1.5 merge commit: the in-repo change (gate removal + test update) reverts, which fences the agent back to canvas-only; the skill files under `~/.hermes-jkai/skills/` (outside the repo) should be removed manually.

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
- Hermes exposes stateless `complete({messages, tools, model, stream}) → {message, tool_calls, usage}` via a dedicated HTTP endpoint on the gateway (alongside but separate from the platform adapter — completions are session-less so they don't need a chat_id).
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
| Hermes single-threaded ⇒ concurrency bottleneck | Medium | Medium | First measure, then mitigate. Most LLM time is network-wait (cooperative async); the platform-adapter HTTP layer is async by default. If observed, Hermes' profile isolation enables multi-process (run multiple `hermes gateway run` instances on different ports, SvelteKit routes by chat_id hash). |
| Service unavailability | Medium | Medium | systemd `Restart=on-failure`. SvelteKit surfaces "engine offline." Build executor pauses. Health check at `/admin/hermes`. Re-enable `jkai-builder.service` as emergency fallback. |
| Two-datastore drift (option A) | Medium | Low | `hermes_sessions` join table canonical; cleanup job reconciles. Risk vanishes if option D succeeds in Phase 0. |
| Hermes upstream changes break us | Low | Medium | Pin to a tag; explicit upgrade path with full Phase 1–3 acceptance re-run. No auto-update. |
| Bridge token compromise | Low | High | Secret rotation procedure documented; secret in `~/.hermes-jkai/.env` (700). Localhost-only. Audit log. |
| Model-cost surprise | Medium | Low | Phase 0 token-usage benchmark per provider. Phase 2 explicit before/after. Hermes' prompt-caching breakpoints (first-class feature) keep marginal cost low. |

### 7.3 Reversibility budget

- **End of Phase 1:** Reversibility intact. Restoring `loop.ts` from git.
- **End of Phase 2:** Reversibility costly but possible. Restoring `pi-runner.ts`, the old `builder-client.ts` shape, plus `jkai-builder.service` config — about 1 day's work.
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

- **Coding-model default for Phase 2.** Decide at Phase 2 kickoff (likely `claude-opus-4-7`, `glm-5.1`, or `gpt-5`). Log decision and benchmark.
- **Platform adapter port number.** Default `:18790` proposed; confirm against existing port usage on homeserv during Phase 1 kickoff.
- **Plugin packaging.** Does Hermes' `PlatformRegistry` accept plugins via Python entry-points (per `pyproject.toml`) or only via in-tree imports? If entry-points: the `~/.hermes-jkai/extensions/jkai_platform/` becomes a small pip-installable package. If in-tree: a startup hook loads the plugin from a config path. Verify in Phase 1.
- **Profile sharding strategy if concurrency bottlenecks emerge.** Defer to observation; document threshold (e.g. >3 concurrent sessions causing >2× latency).
- **`USER.md` strategy.** Symlink to `~/.claude/projects/-home-john/memory/MEMORY.md`? One-way sync? Independent? Decided during Phase 0: independent file, seeded from MEMORY.md but Hermes-managed thereafter.

## 9. Appendix: terminology

- **Hermes session** — A Hermes-internal conversation context with a skill loaded, persisted in `sessions.db`. Distinct from "build session" or "curate session" (those are jkai concepts in Postgres).
- **Profile** — A Hermes-level config + skills + memory unit isolated by `HERMES_HOME`. We use one profile, `jkai`.
- **Skill** — Hermes' procedural-memory primitive. A directory under `skills/` with a `SKILL.md` plus optional supporting files. Defines agent identity, tool-usage guidance, examples for a particular task class.
- **MCP** — Model Context Protocol. The standards-based bridge over which Hermes calls jkai's TS tools without porting them.
- **Bridge token** — HMAC-signed scope-limited capability passed by Hermes to the MCP server on every tool call. Mirrors the existing `tool-bridge.ts` pattern that protects Pi's tool calls today.
- **`kind` / `kind_id`** — The fields in `hermes_sessions` that link a Hermes session to a specific jkai resource (build, canvas chat, curate session, manual admin session) and constrain which tools/resources it can touch.
