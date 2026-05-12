# Hermes Phase 2 Discovery — Pre-Plan Research

**Date:** 2026-05-12
**Branch:** hermes-migration
**Status:** Discovery only — not a plan
**Scope:** Build-loop migration (Phase 2 per `docs/superpowers/specs/2026-05-10-hermes-replacement-design.md` §6)

---

## Section 1 — What the build loop actually does today

**`src/lib/jkai/orchestrator.ts`** — singleton queue-based state machine. Owns the build lifecycle: start, pause, resume, stop, plan-approval gate, per-iteration approval gate, deadline management, failure abort logic, and the dequeue-next-build mechanism. Entry point for all external build control. Key exit: calls `executeIteration()` per loop tick; after each iteration, advances build status or aborts.

**`src/lib/jkai/executor.ts`** — per-iteration coordinator. Assembles the full context payload (workspace file list, codebase digest, previous iteration eval, pinned notes drained from `jkaiBuildNotes`, pending messages drained from `jkaiBuildPendingMessages`, attached workflow grounding, design-system suffix) then calls `runPi()`. On return, extracts `## Goals`, `## Evaluation`, `## Next Steps` from the assistant's final text, runs design-system lint and test suite, snapshots the workspace, promotes `dev/` to `live/`. Entry: `executeIteration(build, iteration, ...)`. Exit: returns `IterationResult` to orchestrator.

**`src/lib/jkai/pi-runner.ts`** (~600 LOC) — the Pi subprocess wrapper. Constructs a Pi CLI invocation (`pi --mode json --no-session --tools read,bash,edit,write,grep,find,ls --provider ... --model ... --append-system-prompt ... -p ...`) and spawns it either via `docker exec jkai-sandbox bash -c '...'` (container mode) or directly on host (host mode, `JKAI_BUILDS_HOSTMODE=1`). Streams newline-delimited JSON events from stdout, accumulating tool calls, text, thinking, token counts. Implements: stop-timer polling, mutable-deadline polling (5 s tick), first-event watchdog (240 s), idle-stream watchdog (180 s). Classifies failures (`stalled`, `wall_clock_timeout`, `container_missing`, `auth_failed`, `rate_limited`, `provider_error`, `nonzero_exit`). Entry: `runPi(opts)`. Exit: `PiRunResult` with `actions`, `messages`, `finalAssistantText`, `tokensUsed`, `failure`.

**`src/lib/jkai/prompt.ts`** — system prompt assembly. `buildSystemPrompt(buildId, port)` returns the static `SYSTEM_PROMPT` constant plus workspace path and assigned port. `buildIterationContext(...)` builds the user-turn message from project goal, delivery plan, previous eval/next-steps, codebase digest, and port assignment.

**DB tables used:**
- `jkaiBuilds` — build record, status, model, budgets, milestones, plan status, deadlines implicit in orchestrator memory.
- `jkaiIterations` — per-iteration row (number, status, goals, plan, actions jsonb, messages jsonb, evaluation, nextSteps, tokensUsed, durationMs, failure jsonb).
- `jkaiLogs` — append-only log stream (type: `thinking`, `text`, `code`, `output`, `error`, `system`, `lint`).
- `jkaiBuildPendingMessages` — mid-iteration user messages; soft-deleted on drain by executor.
- `jkaiBuildNotes` — pinned notes; re-injected every iteration; soft-deleted when user removes.

---

## Section 2 — What Pi does that Hermes' bash/edit/read doesn't

**File-aware editing (opens before editing):** Implicit to Pi. Pi's built-in `read` + `edit` tools have Pi's own context tracking. In Hermes, `read_file` and `edit_file` are separate tools the agent calls explicitly. No gap — it's a different UX, not a missing capability. No codification in `prompt.ts`.

**Test-running discipline (`npm test` between changes; reads failures):** Codified in `prompt.ts` SYSTEM_PROMPT: "Once the preview is alive ... maintain a tests/ directory ... Create tests/run.sh ... The orchestrator runs your tests after every iteration. Failing tests block promotion to live." The orchestrator actually runs tests itself (not Pi) — `runTests()` is called by `orchestrator.ts:runIteration()` after `executeIteration()` returns. Pi is not involved in test execution. No gap.

**Plan-then-act discipline:** Codified. `prompt.ts` SYSTEM_PROMPT §SCOPE: "Target 5–15 minutes per iteration ... Write ## Evaluation + ## Next Steps and stop." Separate planner (`planBuild`) runs before iterations begin.

**jkai-sandbox container conventions (workspace at `/home/jkai/workspace/<id>/dev`, port assignment, serve.json):** Fully codified in `prompt.ts`: workspace path, port, serve.json format, workspace layout `dev/` vs `live/` distinction.

**Per-iteration goals + evaluation:** Codified. `prompt.ts` SYSTEM_PROMPT mandates the `## Evaluation` + `## Next Steps` closing structure. `executor.ts` parses these sections with `extractSection()`.

**Mid-iteration injection (pending messages, pinned notes):** Codified in `executor.ts` lines 131–144. Notes formatted via `formatNotesForPrompt()`, pending messages formatted via `formatPendingForPrompt()`, both appended to `systemPrompt` before passing to `runPi()`. No gap — the content is assembled by the executor, not Pi.

**Deadline-aware behaviour (extends deadline, checks remaining time):** Implicit to Pi-runner. `pi-runner.ts` polls `deadlineRef.current` every 5 s and SIGTERMs the subprocess when exceeded. Orchestrator exposes `extendDeadline(buildId, additionalMs)`. Under Hermes, there is no equivalent — Hermes' per-session loop has no deadline concept. This behaviour needs a new MCP tool (`extend_deadline`) and corresponding logic in the `jkai-build` skill (the spec already calls this out).

**Streaming deltas (live token-by-token display):** Implicit to Pi's `--mode json` event protocol. Pi emits `message_update` events with `text_delta`, `thinking_delta`, `tool_input_delta`. These are forwarded by `pi-runner.ts` to `emitLive()`. Hermes' platform adapter pushes streamed tokens as SSE frames. The streaming shape changes but the end result (live token stream to browser) is preserved.

**Failure classification:** Implicit to Pi-runner's `classifyFailure()`. Under Hermes, failure classification needs to happen in the executor or a new infra wrapper — container death, stall, provider errors will all look like generic tool errors from Hermes' perspective.

---

## Section 3 — Tool inventory for `jkai-build` skill

All 12 tools in `src/lib/workflows/site-tools/tools/builds.ts`:

1. `build_create` — Start a new build, insert row, call orchestrator.startBuild. **Problematic:** mutates Postgres and starts a long-running background task. Hermes shouldn't be calling this to start its own build session — it would be recursive. Not needed in the jkai-build skill; the executor calls startBuild directly.
2. `build_list` — List recent builds. Fine; returns rows.
3. `build_control` — Pause/resume/stop/publish. Fine for agent to call; simple orchestrator dispatch.
4. `build_inspect` — Full build overview with all iterations. **Large payload risk:** returns all iteration summaries. Should cap or paginate for Hermes use.
5. `build_get_iteration` — Single iteration deep dive (actions, messages). **Huge payload:** messages jsonb can contain full LLM conversation. Tool needs a content-truncation flag.
6. `build_get_plan` — Iteration #0 plan. Moderate size.
7. `build_get_logs` — Recent build logs. Fine; limited to 50 by default.
8. `build_list_files` — List files in dev/live space. Fine; calls `execInSandboxChecked` on the single `jkai-sandbox` container.
9. `build_read_file` — Read a file from build workspace. Fine; same container dispatch.
10. `build_tweak` — Inject improvement instruction. Fine; calls orchestrator.continueBuild.
11. `build_write_file` — Write a file to workspace. Fine; calls `writeFileInSandbox`.
12. `build_delete` — Delete build and workspace. Fine.

Tools 8, 9, 11 call `execInSandboxChecked` / `execInSandbox`, which talk to the single `jkai-sandbox` container. These remain viable as MCP tools since they're already container-aware. They are different from Hermes' own bash tool, which spawns into a separate Docker environment (see §4 below).

New MCP-only tools needed (as called out in the spec): `log_iteration`, `extend_deadline`, `mark_phase`.

---

## Section 4 — jkai-sandbox Docker integration — the load-bearing question

**How Hermes' Docker backend works:** `DockerEnvironment.__init__()` (`hermes-agent/tools/environments/docker.py:494-512`) always calls `docker run -d --name hermes-<uuid> ... sleep infinity` to start a **new** container from a configured image. It does not attach to an existing named container. There is no `docker exec jkai-sandbox` path in Hermes' terminal backend.

**Per-session container assignment:** `register_task_env_overrides(task_id, {"docker_image": "...", "cwd": "..."})` (`terminal_tool.py:936-952`) allows specifying a Docker image per `task_id`, but the container is still always freshly created. Container name is always auto-generated.

**How bash dispatches:** `_run_bash()` (`docker.py:555-576`) calls `docker exec <container_id> bash -c <cmd>`. It is purely a `docker exec` into the container that was started during `__init__`. The container is a long-lived `sleep infinity` process.

**edit_file / read_file container awareness:** `file_tools.py` resolves paths against `TERMINAL_CWD` — the **host** filesystem, not inside the container. File tools are container-aware only if the workspace is bind-mounted to the host via `docker_volumes` config or `TERMINAL_DOCKER_MOUNT_CWD_TO_WORKSPACE=true`. Without explicit bind-mounts, `edit_file("/home/jkai/workspace/...")` would operate on the host path, not inside the container.

**The gap:** jkai today runs Pi inside the pre-existing `jkai-sandbox` container (a single named container serving all builds, with build workspaces as subdirectories at `/home/jkai/workspace/<buildId>/`). Hermes cannot target this container by name — it can only create new containers. Options:

- **Option A (SSH backend / host-mode parity):** Configure Hermes' SSH terminal backend to SSH into homeserv and run commands directly on the host (where `JKAI_BUILDS_HOSTMODE=1` applies). File tools would then operate on host paths correctly. Build isolation is the same as current host mode.
- **Option B (Docker exec shim — per-build containers):** Write a custom `JkaiPlatformAdapter` session initializer that, per build session, calls `register_task_env_overrides(buildId, {...})` to force a new per-build container using the `jkai-sandbox:latest` image with the build's workspace bind-mounted. Each build gets its own ephemeral container. Requires workspace to be bind-mounted to `/workspace` inside the container.
- **Option C (Wrapper bash tool):** Expose a custom `sandbox_exec(buildId, command)` MCP tool that does the `docker exec jkai-sandbox bash -c` dispatch itself. Hermes calls this instead of its built-in `bash`. File tools still need a separate resolution.

Option A is the lowest-friction path given that `JKAI_BUILDS_HOSTMODE=1` already exists and works in production (VPS). Option B gives better isolation but requires per-session Docker lifecycle management inside the platform adapter.

**Foreground timeout:** Default 600 s, configurable via `TERMINAL_MAX_FOREGROUND_TIMEOUT`. Sufficient for `npm test`; likely insufficient for cold `npm install`. The `background=True` flag + `notify_on_complete` is the correct pattern for long installs.

---

## Section 5 — Risk register

| Risk | Rating | Mitigation |
|---|---|---|
| 1. Iteration-quality regression | High | Fixed prompt-set comparison vs Pi baseline over 10 runs before flag-on; fall back to `jkai-builder.service` flag if below threshold. |
| 2. Mid-iteration injection | Medium | Pattern is already solved: executor drains `jkaiBuildPendingMessages` before assembling context payload; same mechanism works unchanged. Risk is timing — current injection lands at next iteration boundary, not truly mid-tool-call. |
| 3. Plan-approval gate | Low | Gate is implemented entirely in orchestrator.ts, not in Pi. Hermes replaces only the Pi invocation; the orchestrator's `awaiting_plan_approval` status and `approvePlan()` pathway are unchanged. |
| 4. Sandbox isolation | High | Without per-build containers, a `cd ../..` escape is possible if the host-mode path is used without a chroot or namespace. If Option B (per-build containers) is chosen, `--cap-drop ALL` + `--pids-limit` from Hermes' `_BASE_SECURITY_ARGS` provides strong isolation. Decision must precede Phase 2 planning. |
| 5. Per-iteration logging | Medium | Today `pi-runner.ts` calls `emitLog()` incrementally as events arrive. Under Hermes, log writes happen via a new `log_iteration` MCP tool. Streaming logs will be coarser (one call per tool result rather than per streaming token). The `jkaiLogs` table is unchanged; the rate changes. |
| 6. Deadline awareness | Medium | `deadlineRef` is an in-memory mutable object polled by `pi-runner.ts`. Hermes has no equivalent. Needs: (a) `extend_deadline` MCP tool that updates a build-level DB field, (b) skill prose instructing the agent to check remaining time and wrap up proactively. |
| 7. Long-running tool calls | Low | `TERMINAL_MAX_FOREGROUND_TIMEOUT` defaults to 600 s, overridable via env var. `npm install` on cold cache can exceed this; the `background=True` pattern handles it. The jkai-build SKILL.md should explicitly instruct use of `background=True` for install steps. |

---

## Section 6 — Recommended next steps

- **Skills to write:** `jkai-build/SKILL.md` covering build identity, workspace conventions, serve-first discipline, eval/next-steps structure, deadline awareness, and explicit guidance on `background=True` for long commands. A `jkai-build-sandbox` sub-note on container/host-mode conventions.

- **Docker integration decision needed before planning:** Choose between Option A (SSH backend, host-mode parity) and Option B (per-build containers via `register_task_env_overrides`). This is the highest-uncertainty question; the answer shapes the entire Phase 2 plan.

- **New MCP tools to build:** `log_iteration` (INSERT into `jkaiIterations`), `extend_deadline` (UPDATE `jkaiBuilds` with new deadline field), `mark_phase` (optional phase tagging for UI). Also: expose the deadline value to Hermes via a `get_build_context` MCP tool or include it in the per-iteration payload from executor.

- **Failure classification wrapper:** The per-iteration executor currently classifies Pi failures (stalled, timeout, etc.). Under Hermes, this classification logic needs to move to the executor's analysis of whatever Hermes returns, or to a post-turn hook.

- **Streaming log fidelity:** Decide whether per-token streaming to the builds UI is required or whether coarser per-tool-result logs are acceptable. If fine-grained streaming is required, the platform adapter's SSE stream needs to be tapped by the executor alongside the MCP writes.

- **Acceptance scenarios to define:** At minimum: (a) greenfield SvelteKit page with design tokens, (b) mid-iteration injection, (c) plan-approval gate, (d) wall-clock deadline extension, (e) sandbox `cd ..` escape attempt blocked.

- **Open questions for John before planning starts:**
  1. **Docker integration path:** SSH backend (host-mode parity, simpler) vs per-build containers (stronger isolation, more infra)? The answer determines the Phase 2 file list.
  2. **Coding model default:** The spec defers this to Phase 2 kickoff. Which model is the Pi baseline using? (`build.modelId` defaults to `glm-5-turbo` in the schema; is that what's in production, or has it been updated?) The baseline model needs to be locked before any quality comparison is meaningful.
  3. **Streaming log granularity:** Are per-token streaming deltas in the builds UI a hard requirement, or is per-tool-result acceptable? If per-token is required, the integration approach changes materially (the executor needs to tap the platform adapter's SSE stream, not just wait for the iteration to complete).

---

## Appendix — load-bearing file references

- `src/lib/jkai/executor.ts` — iteration coordinator, context assembly, note/message draining
- `src/lib/jkai/pi-runner.ts` — subprocess wrapper, streaming, watchdogs, failure classification
- `src/lib/jkai/prompt.ts` — all codified agent discipline (system prompt + iteration context)
- `src/lib/jkai/orchestrator.ts` — queue-based state machine, plan/iteration approval gates, deadline management
- `src/lib/jkai/pending-messages.ts` — mid-iteration injection implementation
- `src/lib/jkai/build-notes.ts` — pinned notes implementation
- `src/lib/workflows/site-tools/tools/builds.ts` — the 12 build domain MCP tools
- `src/lib/db/schema.ts` lines 546-692 — jkaiBuilds, jkaiIterations, jkaiLogs, jkaiBuildPendingMessages, jkaiBuildNotes tables
- `~/hermes-agent/tools/environments/docker.py` — Docker backend implementation (`docker run -d` always, no exec-into-existing-container)
- `~/hermes-agent/tools/terminal_tool.py` lines 920-985 — `register_task_env_overrides`, `_resolve_container_task_id`, per-task override registry
- `~/hermes-agent/tools/file_tools.py` lines 80-127 — path resolution (host `TERMINAL_CWD`, not container-aware without bind-mounts)
- `docs/superpowers/specs/2026-05-10-hermes-replacement-design.md` — master spec, Phase 2 section §6
