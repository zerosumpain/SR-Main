# JKAI Build — Rewrite Plan

**Status:** proposed (2026-05-03)
**Owner:** John
**Scope:** Replace the current `/jkai/builds/<id>` UX and orchestrator runtime with a live-terminal session backed by a sidecar service, decoupled from web-app deploys.

---

## 0. Why

The current build experience is broken on every axis the user cares about:

| Pain | Root cause (current code) |
|---|---|
| Watching feels dead — no streaming, must page-refresh | `BuildDetailV2.svelte:55-82` SSE handler appends events but doesn't stream LLM tokens; orchestrator buffers full LLM responses (`src/lib/jkai/llm-client.ts`) and only emits stage events at iteration boundaries. |
| Can't interrupt / interject / add to flow | Orchestrator (`src/lib/jkai/orchestrator.ts`) is a linear loop with only HTTP `pause`/`resume`/`stop`/`restart`. No inbound channel for user messages mid-iteration. The agent doesn't even know a user is watching. |
| Doesn't respect the design system | `BuildDetailLegacy.svelte` is full of Tailwind utility classes + ad-hoc inline styles. V2 mixes `nm-*` tokens with raw values. No shared "build chrome" component applying canonical `~/strange-ramblings-design/` tokens. |
| Doesn't respect prompt feeds | Iteration prompts are built inline in `src/lib/jkai/executor.ts`; they don't flow through `$lib/jkai/prompts/` or accept user-injected context. User can't see/amend what the agent is being told. |
| Deploys kill in-flight builds | Orchestrator runs in-process inside SvelteKit. `scripts/deploy.sh` → `systemctl restart strange-rambling-svelte` → orchestrator dies. `MEMORY.md/project_jkai_microarch_idea.md` already names this as the parked architectural concern. |

The deploy-kills-builds problem is the same shape as the stealth-scrape residential-IP problem we solved this session — and the answer is the same: **extract the runtime to a separate process** with the SvelteKit web app talking to it.

---

## 1. Target architecture

### 1.1 Two-tier split

```
┌────────────────────────────────────────────────────────────────┐
│  strange-rambling-svelte (homeserv:5173, restart on deploy)    │
│  - /jkai/builds/[id] page                                      │
│  - /api/jkai/builds/* CRUD + control endpoints                 │
│  - /api/jkai/builds/[id]/session  WebSocket bridge             │
│  - /api/jkai/proxy/[id]/*  (preview proxy — unchanged)         │
└────────────────────────────────────────────────────────────────┘
                       │ Unix domain socket
                       │ /run/jkai-builder.sock (bearer-token gated)
                       ▼
┌────────────────────────────────────────────────────────────────┐
│  jkai-builder.service  (homeserv, separate systemd user unit)  │
│  - Owns the orchestrator loop                                  │
│  - Owns docker exec into jkai-sandbox                          │
│  - Survives deploys of the SvelteKit app                       │
│  - Single source of truth for live build state                 │
│  - Endpoints over the Unix socket:                             │
│      POST /sessions/<buildId>/start                            │
│      POST /sessions/<buildId>/control  {pause|resume|stop}     │
│      POST /sessions/<buildId>/inject   {message, role}         │
│      WS   /sessions/<buildId>/stream   bidirectional events    │
└────────────────────────────────────────────────────────────────┘
```

The builder is a tiny Node app. Same TS codebase as `strange-rambling-svelte`. Imports `$lib/jkai/orchestrator`, `executor`, `sandbox` etc. via a path alias. Boots from `bin/jkai-builder.ts`. No SvelteKit. Fastify or Node `http` for the socket server.

### 1.2 Bidirectional WebSocket session

Browser opens `wss://strangeramblings.com/api/jkai/builds/<id>/session` → SvelteKit upgrades → proxies to the builder over the loopback Unix socket. SvelteKit checks the user's session cookie. Builder trusts requests arriving on the socket (same security model as the existing scraper proxy: SvelteKit gates the public face, the local socket is the internal trust boundary).

**Outbound** (builder → user) — token-by-token streaming:
- `agent.thinking.delta` — chain-of-thought tokens
- `agent.message.delta` — visible response tokens
- `tool.start` / `tool.stdout.chunk` / `tool.stderr.chunk` / `tool.end`
- `lint.finding` — single-shot
- `iter.start` / `iter.complete` — iteration boundaries
- `preview.live` / `preview.down` — preview server transitions
- `pending.interjection` — echo of the user's queued inbound

**Inbound** (user → builder):
| Event | Effect |
|---|---|
| `inject_user_message` | Drops `[user] <text>` into the agent's context for the next turn — Claude-Code-CLI parity. Agent sees it as a message that arrived mid-iteration. |
| `interrupt` | Cancels the in-flight LLM call / tool exec, snapshots progress, returns control to the agent loop with `[user-interrupted]` in context. |
| `direct_command` | Shell command executed in the sandbox `dev/` directory; output streamed back; transcript persisted to the iteration log so the agent sees what the user did. |
| `pin_note` | Persistent note for the build; re-injected into every iteration prompt. Stored in new `jkai_build_notes` table. |

### 1.3 Terminal-pane UI

Single-pane "session view" modeled on a terminal. Replaces the V2/Legacy split + the activity / iterations / preview / controls tabs:

```
╭───────────────────────────────────────────────────────────────╮
│ [• live] Preview: …/api/jkai/proxy/<id>/  [↗ open]  [copy]   │  ← sticky banner (existing)
├───────────────────────────────────────────────────────────────┤
│ planning · iter 3/6 · 47s · 14k tokens · ws connected         │  ← status strip
├───────────────────────────────────────────────────────────────┤
│  ┌── Watch ──┬── Tinker ──┬── Drive ──┐                       │  ← mode switcher
│  │ stream     │ files+chat │ free      │                      │
│  └────────────┴────────────┴───────────┘                      │
│                                                                │
│  [agent] thinking… "I need to add a salary filter"             │
│  [tool ] write index.html (12 lines)                           │
│         ┃ <input type="number" name="minSalary">               │
│  [bash ] curl -fsS http://localhost:8365 | head                │
│         ┃ <!DOCTYPE html>                                      │
│  [lint ] design-lint: 9 violations                             │
│         ┃ index.html:937 [no-tailwind] class="nm-text-input"   │
│  [user ] ← actually keep that class, our linter is wrong       │
│  ─────────────────────────────────────────────────────────────│
│  > _                                                           │  ← user input prompt
╰───────────────────────────────────────────────────────────────╯
```

All-in-one stream — no tabs to discover. User can type at the bottom prompt at any time:

| Input | Routed as |
|---|---|
| plain text | `inject_user_message` for next turn |
| `Ctrl+C` | `interrupt` |
| `$ <cmd>` | `direct_command` in sandbox |
| `# <note>` | `pin_note` |
| `/help`, `/note list`, `/note rm <id>` | local UI commands |

### 1.4 Streaming infrastructure

Replace `/api/jkai/builds/[id]/stream` SSE with the WebSocket. Builder emits one event per token-shaped thing. Frontend appends to a single virtualised log component (collapse `LaneOutput`/`LaneThinking`/`LaneTools` into one stream view; keep them as filter modes).

Reconnect on drop with `last-event-id` replay — builder keeps the last 1000 events per build in an in-memory ring buffer + persists rolled-up summaries to `jkai_logs` on iteration boundary.

### 1.5 Design-system enforcement

Every UI component in `src/lib/builds/` rewritten against `~/strange-ramblings-design/` tokens:
- `nm-sec`, `nm-text-input`, `nm-save-btn`, `row-link`, the warm-brutalist palette CSS vars only
- Zero Tailwind utility classes — kill the `text-xs uppercase tracking-wider` style soup in `BuildDetailLegacy`
- One shared `BuildShell.svelte` provides the page chrome; mode panes + stream are children
- Run the existing design-lint over the rewritten components; the linter must accept them

---

## 2. Component inventory

### 2.1 New code

| File | Purpose |
|---|---|
| `packages/jkai-builder/package.json` | Sidecar package, mirrors root deps |
| `packages/jkai-builder/bin/start.ts` | Entry; binds Unix socket; loads orchestrator |
| `packages/jkai-builder/src/server.ts` | Fastify socket server with HTTP + WS routes |
| `packages/jkai-builder/src/sessions.ts` | Per-build session manager — ring buffer, WS fan-out, inbound queue |
| `packages/jkai-builder/src/recovery.ts` | Boot-time scan: resume builds with `status='running'` |
| `~/.config/systemd/user/jkai-builder.service` | systemd unit, `Restart=always`, after sandbox |
| `src/routes/api/jkai/builds/[id]/session/+server.ts` | SvelteKit WS upgrade → builder socket bridge |
| `src/lib/builds/BuildShell.svelte` | New page chrome |
| `src/lib/builds/BuildSession.svelte` | New single-pane stream + bottom prompt |
| `src/lib/builds/StreamLine.svelte` | Renders one stream event with appropriate icon/colour |
| `src/lib/builds/PromptInput.svelte` | Bottom input with `$`/`#`/`/` prefix routing |
| `src/lib/builds/PinnedNotesPanel.svelte` | View/edit pinned notes |
| `scripts/deploy-builder.sh` | Builder-only zero-downtime restart |
| `migrations/<n>_jkai_build_notes.sql` (via Drizzle) | New `jkai_build_notes` table |

### 2.2 Modified

| File | Change |
|---|---|
| `src/lib/jkai/orchestrator.ts` | (a) `pendingUserMessages` queue per build, drained into prompt at LLM-turn start. (b) `interruptCurrent()` method that aborts the in-flight call. (c) Emit fine-grained events (delta + tool lifecycle) instead of post-hoc batched logs. |
| `src/lib/jkai/llm-client.ts` | All calls `stream: true`; expose `AbortSignal` for interrupts. |
| `src/lib/jkai/executor.ts` | Wrap `execInSandbox` with a streaming variant that yields stdout/stderr chunks. |
| `src/lib/jkai/prompts/` (or wherever the prompt is built) | New section: pinned notes + queued user messages + interrupt context. |
| `src/lib/db/schema.ts` | `jkaiBuildNotes` table. |
| `src/lib/jkai/sandbox.ts` | `streamExecInSandbox(cmd, onChunk)` companion to `execInSandbox`. |
| `scripts/deploy.sh` | Comment block: "this script never restarts jkai-builder". Remove any `systemctl restart` of the builder if added accidentally. |
| `src/hooks.server.ts` | Stop calling `orchestrator.recoverOnStartup()` (moves to builder). Stop registering builder-side state. |

### 2.3 Deleted

| File | Why |
|---|---|
| `src/lib/builds/BuildDetailLegacy.svelte` | Once V2 covers everything, delete after one deploy with the flag still on. |
| `src/lib/builds/BuildDetailV2.svelte` | Superseded by `BuildSession.svelte` (V2 → V3 rename). |
| `src/routes/api/jkai/builds/[id]/stream/+server.ts` | Replaced by WS session route. |
| `BuildPill.svelte` SSE consumer paths that overlap | Keep BuildPill but switch its event source to the WS too. |

---

## 3. Build sequence (8 phases, ordered, each independently shippable)

### Phase 1 — Carve out `jkai-builder` package (no behaviour change yet)
- New `packages/jkai-builder/` workspace with its own `package.json`.
- TypeScript path aliases so it can `import { orchestrator } from '$lib/jkai/orchestrator'`.
- `bin/start.ts` boots, loads orchestrator, binds `/run/jkai-builder.sock`, exposes a stub `GET /health` returning `{ ok, activeBuilds }`.
- systemd user unit installed via `deploy-builder.sh`.
- `hooks.server.ts` keeps doing what it does today — both the SvelteKit and the builder process register the orchestrator (idempotent registration; this phase is parallel observation only).
- **Verification:** `curl --unix-socket /run/jkai-builder.sock http://x/health` returns 200 with the same `activeBuilds` count as the SvelteKit-side orchestrator.

### Phase 2 — Move authoritative state to builder, SvelteKit becomes a client
- All `engine.execute`-style calls in SvelteKit (`/api/jkai/builds/[id]/start`, etc.) now POST to the builder socket.
- `hooks.server.ts` removes the in-process orchestrator boot — SvelteKit no longer touches the loop directly.
- Recovery (`recoverOnStartup`) moves to `packages/jkai-builder/src/recovery.ts`.
- `scripts/deploy.sh` no longer kills builds when restarting `strange-rambling-svelte`.
- **Verification:** start a build, run `systemctl --user restart strange-rambling-svelte`, watch the build keep going. The web UI may show a momentary disconnect; reconnects.

### Phase 3 — WebSocket session route
- `src/routes/api/jkai/builds/[id]/session/+server.ts` does the WS upgrade, authenticates the user's Auth.js session, then dials `/run/jkai-builder.sock` and pipes both directions.
- Builder exposes WS at `/sessions/<id>/stream`. Outbound: existing stage events + log events for now (no streaming changes yet).
- Frontend `BuildDetailV2.svelte` switches its EventSource to the new WS. Reconnect-with-last-event-id implemented client side.
- **Verification:** events that previously arrived via SSE now arrive via WS. No new event types yet — straight migration.

### Phase 4 — Token-level streaming (outbound)
- `src/lib/jkai/llm-client.ts` switches every chat completion to `stream: true`. Exposes `(deltaTokens, full) => void` callback + `AbortSignal`.
- Orchestrator emits `agent.thinking.delta` / `agent.message.delta` events into the builder's session bus per token chunk.
- `src/lib/jkai/sandbox.ts` adds `streamExecInSandbox` for tool calls; orchestrator uses it for shell tools, emits `tool.stdout.chunk` / `tool.stderr.chunk`.
- Frontend renders deltas with a live cursor on the in-progress line; closes line on `tool.end` / `agent.message.end`.
- DB persistence: stream to WS in real time; persist a rolled-up summary to `jkai_logs` only on iteration boundary. Cuts DB writes ~100×.
- **Verification:** open a build mid-iteration, see characters appear as the LLM types.

### Phase 5 — Inbound interjection (user → agent mid-flight)
- New table `jkai_build_pending_messages(buildId, role, content, createdAt)`.
- Orchestrator: at the start of each LLM turn, drains queue into the system prompt as `<user-injected>` blocks. UI emits `pending.interjection` event so the user sees their message is queued.
- WS inbound `inject_user_message` writes to the queue.
- WS inbound `interrupt` calls `orchestrator.interruptCurrent(buildId)` which aborts the LLM `AbortSignal` and the in-flight tool exec, then runs one synthesis turn with `[user-interrupted]` in context.
- Frontend: bottom prompt input. Plain text → inject. `Ctrl+C` → interrupt with optimistic UI.
- **Verification:** type a message while the build is iterating, see it queued, see the agent acknowledge it on the next turn.

### Phase 6 — Pinned notes + direct shell
- New `jkai_build_notes(buildId, content, createdAt)` table.
- Prompt builder includes notes verbatim every iteration.
- WS inbound `pin_note` adds; UI command `/note rm <id>` removes.
- WS inbound `direct_command` runs `streamExecInSandbox` and tags the transcript with `[user-shell]` so the agent sees it next turn.
- UI: `# <note>` prefix → `pin_note`. `$ <cmd>` prefix → `direct_command`.
- **Verification:** pin "use black not navy", restart iteration, see the agent's behaviour change without re-prompting.

### Phase 7 — Terminal UI rewrite
- New `BuildShell.svelte`, `BuildSession.svelte`, `StreamLine.svelte`, `PromptInput.svelte`, `PinnedNotesPanel.svelte`.
- All built against `~/strange-ramblings-design/` tokens, zero Tailwind, design-lint-clean.
- Mode switcher (Watch / Tinker / Drive) becomes a stream-filter, not a pane swap.
- Sticky preview banner from this session's earlier work — kept as-is.
- Replaces both `BuildDetailLegacy` and `BuildDetailV2`. Old files deleted.
- Public flag `PUBLIC_BUILDS_V3` gates rollout; default off for one deploy, then default on, then flag removed.
- **Verification:** open a build, see all activity stream in one pane, type messages, run `$ ls`, pin notes. Design-lint passes on every component.

### Phase 8 — Decoupled deploy
- `scripts/deploy-builder.sh`: blue/green-style restart. Builder snapshots the current iteration's in-memory state to a checkpoint table on `SIGTERM`, restarts, picks up the checkpoint, resumes.
- `scripts/deploy.sh` documents that it ONLY restarts the web app, never the builder.
- Health check on the builder added to `/api/health/workflow-engine`-style probe (or a separate `/api/health/jkai-builder` route) wired into the existing systemd watchdog timer.
- **Verification:** push a SvelteKit-only change, run `deploy.sh`, watch a build keep iterating with zero stream interruption.

---

## 4. Decisions to make before phase 1

1. **Builder transport: Unix socket vs loopback HTTP.** Plan above assumes Unix socket — simpler, no port collision risk, file-perm based ACL. Loopback HTTP would let us use the existing `SCRAPER_SERVICE_TOKEN` pattern unchanged. **Recommendation: Unix socket.**
2. **Builder is a workspace package or a separate repo.** Workspace is much simpler (shared types, single `npm install`, deploys together). Separate repo lets the builder version independently. **Recommendation: workspace package in this repo.**
3. **WebSocket library.** SvelteKit doesn't expose WS natively for the node adapter — needs a hook in the http upgrade event. Options: `ws` package + adapter shim, or `socket.io` (heavier). **Recommendation: `ws` + a thin shim, since we control both ends.**
4. **Resume semantics on builder restart.** Simplest: every running iteration is checkpointed at LLM-turn boundary; on builder restart, replay from last checkpoint. The agent re-runs the current turn (idempotent for write tools, may re-bill for the LLM call). **Recommendation: accept the re-bill; it only happens on builder restart, which is rare.**

---

## 5. Tradeoffs already considered

- **Why not just SSE upgrade.** SSE is one-way; user inbound has to go through a separate POST. Doable but the round-trip latency makes interruption feel sluggish, and we lose the chance to drop the polling fallback.
- **Why a separate process, not a worker thread.** Worker threads die with the parent. The whole point is for `git push && deploy` to not kill an in-flight build.
- **Token-level streaming has cost.** Mitigated by streaming to WS in real time and only persisting iteration-boundary summaries.
- **User interjection blast radius.** A bad inject could derail the build. Guardrail: "Pending interjection" pill above the stream until the agent has consumed it; user can undo before next turn fires.

---

## 6. Out of scope (explicitly)

- Multi-user collaboration on a single build (one watcher at a time is fine for now).
- Tinker mode's interactive file editor and Drive mode's free-prompt — those were already deferred per `MEMORY.md/project_jkai_builds_redesign.md`. Keep them deferred.
- Replacing the autonomous-builder LLM model selection — that's a separate brain.
- Replacing the design-lint rules themselves — separate concern. We make the linter respect static-HTML projects in a follow-up if/when needed.

---

## 7. Estimate

5–8 focused days of work, broken into the 8 phases above. Phases 1, 2, 3 are infrastructure (~3 days). Phase 4 is the most technically interesting (~1.5 days). Phases 5, 6 are feature work (~1.5 days). Phase 7 is UI rewrite (~1.5 days). Phase 8 is polish (~0.5 days). Each phase is independently shippable; we can stop after any of them and have a strictly better state than today.
