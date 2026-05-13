# Hermes Phase 2 — Build-loop replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace jkai's Pi-runner-based build loop with Hermes — same agent harness used for canvas (Phase 1) and general chat (Phase 1.5), now driving the autonomous build iterations. `pi-runner.ts` retires from the executor's hot path; `executor.ts` calls `HermesClient.sendMessage(...)` with `kind='build'` and waits for the platform adapter's `finalize` SSE frame before parsing `## Evaluation` and `## Next Steps`.

**Architecture:** Hermes' Docker terminal backend spins up a fresh ephemeral `hermes-<task_id>` container per build session, using the existing `jkai-sandbox:latest` image with the build's workspace bind-mounted to `/workspace` inside the container. The agent's built-in `bash`/`read_file`/`edit_file` operate inside that container; the host directory `/home/jkai/workspace/<buildId>/dev/` is the bind-mount source so `build_*` MCP tools (which run host-side via `execInSandbox` today) and Hermes' built-in tools both reach the same files. Strong per-build isolation comes for free from Hermes' `_BASE_SECURITY_ARGS` (`--cap-drop ALL` plus DAC_OVERRIDE/CHOWN/FOWNER, `no-new-privileges`, `--pids-limit 256`, size-limited tmpfs on `/tmp` `/var/tmp` `/run`). The per-build container is requested via Hermes' `register_task_env_overrides(task_id, {"docker_image": "jkai-sandbox:latest", "docker_volumes": [...], "cwd": "/workspace"})` hook — the jkai platform adapter calls this for every inbound message with `kind='build'` *before* dispatching the message into the agent loop, so the first tool call in the session lands in the correct image with the correct mount. A new `jkai-build` Hermes skill is auto-loaded via `_KIND_TO_SKILL['build']='jkai-build'` in the platform adapter and ports the heavy discipline today encoded in `src/lib/jkai/prompt.ts`'s `SYSTEM_PROMPT`. Two new MCP infra tools (`log_iteration`, `extend_deadline`) plus a new `jkai_builds.deadline_at` column give the skill the structured-write primitives Pi has implicitly. The executor's logging infrastructure shifts from per-token streaming deltas to per-tool-result granularity via an MCP middleware that publishes events on a new `tool-call-log-bus.ts` (mirroring the existing `tool-step-bus.ts` pattern from Phase 1). The whole pathway is flag-gated behind `JKAI_HERMES_BUILD_LOOP=1`, independent of `JKAI_HERMES_CANVAS_CHAT`, so the build flag can soak separately from the chat flag.

**Tech Stack:** TypeScript (SvelteKit, vitest), Drizzle ORM + Postgres, Python 3.11 (Hermes plugin adapter), Hermes Agent v2026.5.7 (skills + Docker terminal backend with per-task env overrides), Docker 27 (`jkai-sandbox:latest` image, bind-mounted workspaces), markdown (`jkai-build/SKILL.md` ~500 lines).

**Spec reference:** `docs/superpowers/specs/2026-05-10-hermes-replacement-design.md` §6 Phase 2 + §5.3 build-loop sequence. Discovery memo: `docs/superpowers/research/2026-05-12-hermes-phase-2-discovery.md`. Prior-plan format reference: `docs/superpowers/plans/2026-05-11-hermes-phase-1.md` and `docs/superpowers/plans/2026-05-12-hermes-phase-1.5-general-chat.md`.

**Locked design decisions (confirmed 2026-05-12):**

1. **Docker integration: Option B — per-build ephemeral containers via Hermes' Docker backend.** Hermes' `terminal.backend: docker` plus a per-session `register_task_env_overrides(task_id, {"docker_image": "jkai-sandbox:latest", "docker_volumes": ["<host>/<buildId>/dev:/workspace"], "cwd": "/workspace"})` call from the jkai platform adapter spins up a fresh `hermes-<task_id>` container per build. Strong isolation via Hermes' built-in `_BASE_SECURITY_ARGS` (`--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit 256`, tmpfs for `/tmp` `/var/tmp` `/run`). The container is torn down by Hermes' idle reaper when the build session closes; container lifecycle is conceptually similar to today's `jkai-sandbox` (a shared bind-mounted Linux box) except each build gets its own container instead of all sharing one named container.
2. **Coding model: GLM across.** Both Pi baseline (today) and Hermes target run `glm-5.1` via z.ai. `max_tokens` budget ≥ 1500 to leave headroom for reasoning tokens (per `feedback_glm_reasoning_tokens.md`). Plan includes a verify-production-model step because the schema default is the stale `glm-5-turbo`.
3. **Streaming log granularity: per-tool-result.** No mid-iteration SSE tap. Executor records logs via an MCP middleware that publishes `log_tool_call` events plus a final-assistant-message log entry. Coarser than Pi's per-token deltas but materially simpler integration.

---

## Risk register (Phase 2 specific — updates from discovery memo §5)

| Risk | Pre-Option-B rating | Post-Option-B rating | Notes |
|---|---|---|---|
| 1. Build skill prompt-fidelity vs SYSTEM_PROMPT | High | High | Unchanged. Heavy port in Task 6; covered by acceptance scenarios B1/B2. |
| 2. Mid-iteration injection | Medium | Medium | Unchanged. Existing `jkaiBuildPendingMessages` drain semantics still apply; the runner reads them into the per-iteration message just like Pi did. |
| 3. Failure-classification gaps | Medium | Medium | Failure-classifier port (Task 11) maps to existing `FailureKind` including `container_missing` for Hermes Docker daemon / image / start failures. |
| 4. Sandbox isolation | **High** | **Low** | Was high under Option A (SSH host-mode parity, agent ran as `john` with full host fs access). Now low: each build runs in its own `hermes-<id>` container started with `_BASE_SECURITY_ARGS` (`--cap-drop ALL`, `no-new-privileges`, `--pids-limit 256`, tmpfs for `/tmp`/`/var/tmp`/`/run`). Only the bind-mounted `/workspace` is the build's writable area; the host `/etc/passwd`, `/home/john`, the Docker socket, and the user's SSH keys are unreachable from inside the container. Acceptance scenario B5 verifies this. |
| 5. Per-build container start-up latency | n/a | Medium | Each build session now pays ~1s `docker run` overhead on the first inbound message (image is already pulled). Across a 5-iteration build that's ~1s amortised; negligible. Cold pull would be 30+s but `jkai-sandbox:latest` is pre-built locally on homeserv. Mitigation: verify image is present at Hermes startup (Task 3 Step 1). |
| 6. Container leak (lifecycle bug) | n/a | Low-Medium | If the platform adapter forgets to call `clear_task_env_overrides` (Task 4 Step 4), the override stays registered — but the container itself is reaped by Hermes' idle reaper after ~10 min of inactivity. Worst case: stale Docker resources accumulate at ~few-MB-per-build rate. Mitigation: Task 4 wires the clear path inside the same `if platform is not None:` block that registers, with a defensive try/except guard; spot-check `docker ps -a --filter "name=hermes-"` weekly during soak. |
| 7. Image availability | n/a | Low | If `jkai-sandbox:latest` is missing on homeserv, the very first build under `JKAI_HERMES_BUILD_LOOP=1` fails with `container_missing` (classifier handles it). Mitigation: Task 3 Step 1 verifies image presence before flipping the flag in production. |
| 8. Workspace path / bind-mount drift | n/a | Low | The host workspace path `/home/jkai/workspace/<buildId>/dev` is created by the executor at build-start (same as today). The adapter's bind-mount string is derived from `kind_id`. Drift can only occur if a future refactor changes the workspace layout without updating the adapter — caught by acceptance B5 (file read/write to `/workspace`). |

---

## File Structure

| Path | Purpose | Action |
|---|---|---|
| `~/.hermes-jkai/extensions/jkai_platform/adapter.py` (KIND map) | Add `'build': 'jkai-build'` entry to `_KIND_TO_SKILL` | Modify |
| `~/.hermes-jkai/extensions/jkai_platform/adapter.py` (register overrides) | In `handle_inbound`, before `self.handle_message(event)`, call `register_task_env_overrides(<task_id derived from build chat_id>, {"docker_image": "jkai-sandbox:latest", "docker_volumes": ["/home/jkai/workspace/<kind_id>/dev:/workspace"], "cwd": "/workspace"})` when `kind == 'build'`. Pair with `clear_task_env_overrides(task_id)` once the per-session task awaited at line 240 completes. | Modify |
| `~/.hermes-jkai/extensions/jkai_platform/__init__.py` | (No code change — `_KIND_TO_SKILL` lives in `adapter.py` per Phase 1.5 plan) | Reference |
| `~/.hermes-jkai/config.yaml` | Flip `terminal.backend` from `local` to `docker`; set `docker_image: jkai-sandbox:latest` as the default; set `docker_run_as_host_user: true` so workspace files written from inside the container retain host ownership; document `max_tokens` floor for GLM | Modify |
| `docker/jkai-sandbox/Dockerfile` (read-only verification) | Confirm image has bash, GNU coreutils, git, jq — i.e. the toolchain Hermes' `init_session` snapshot expects | Verify |
| (Optional new) `docker/jkai-sandbox-hermes/Dockerfile` | Only created if Task 3.5 finds gaps in `jkai-sandbox:latest` that Hermes needs (e.g. a missing tool, a user-namespacing quirk). Default outcome: not created, reuse the existing image. | Maybe-new |
| `~/.hermes-jkai/skills/jkai-build/SKILL.md` | Heavy port from `prompt.ts` SYSTEM_PROMPT — workspace contract, eval/next-steps discipline, deadline awareness, GLM reasoning notes | New |
| `~/.hermes-jkai/skills/jkai-build/examples/iteration-0-greenfield.md` | Worked example: first iteration on a new build | New |
| `~/.hermes-jkai/skills/jkai-build/examples/iteration-N-followup.md` | Worked example: subsequent iteration acting on previous eval | New |
| `~/.hermes-jkai/skills/jkai-build/examples/mid-iteration-injection.md` | Worked example: drain pending message and adjust | New |
| `~/.hermes-jkai/skills/jkai-build/examples/deadline-extension.md` | Worked example: agent calls `extend_deadline` mid-build | New |
| `src/lib/db/schema.ts` | Add `deadlineAt` column to `jkaiBuilds` | Modify |
| `drizzle/<auto>_jkai_builds_deadline_at.sql` | Migration | New |
| `src/lib/jkai/build-deadline.ts` | Pure helpers: `getRemainingMs`, `setDeadline`, `extendDeadline` (DB I/O wrappers) | New |
| `src/lib/jkai/build-deadline.test.ts` | Vitest unit tests | New |
| `src/lib/workflows/site-tools/tools/builds.ts` | Add `extend_deadline` tool definition + handler | Modify |
| `src/lib/workflows/site-tools/tools/builds.test.ts` | Vitest for `extend_deadline` handler | Modify (or new if absent) |
| `src/lib/workflows/site-tools/tools/build-infra.ts` | New domain file: `log_iteration`, `log_tool_call` MCP-only infra tools | New |
| `src/lib/workflows/site-tools/tools/build-infra.test.ts` | Vitest for the two infra tools | New |
| `src/lib/workflows/site-tools/registry.ts` (or equivalent index) | Register `build-infra` tools | Modify |
| `src/lib/jkai/tool-call-log-bus.ts` | In-memory pub-sub for build tool-call log events (mirrors `tool-step-bus.ts` pattern) | New |
| `src/lib/jkai/tool-call-log-bus.test.ts` | Vitest for the bus | New |
| `src/lib/mcp/jsonrpc.ts` | In `tools/call`: if bearer-scope `kind === 'build'`, emit `tool_call_start` + `tool_call_end` on the new bus | Modify |
| `src/lib/mcp/jsonrpc.test.ts` | Add test: build-scoped tool call emits log events | Modify |
| `src/lib/jkai/hermes-build-runner.ts` | New runner: drop-in for `runPi(...)` from executor's perspective — posts to Hermes, subscribes to outbound SSE, collects assistant text, subscribes to the tool-call-log-bus, writes `jkaiLogs` rows, returns `PiRunResult`-shaped result | New |
| `src/lib/jkai/hermes-build-runner.test.ts` | Vitest unit tests (stub `HermesClient`, stub bus) | New |
| `src/lib/jkai/failure-classifier.ts` | Port `classifyFailure()` from `pi-runner.ts` into a Hermes-aware classifier called by the new runner | New |
| `src/lib/jkai/failure-classifier.test.ts` | Vitest unit tests | New |
| `src/lib/jkai/executor.ts` | Replace `runPi(...)` call with flag-gated branch: Hermes when `JKAI_HERMES_BUILD_LOOP=1`, else Pi | Modify |
| `src/lib/jkai/pi-runner.ts` | Keep alive; no edits | Untouched |
| `.env.example` | Document `JKAI_HERMES_BUILD_LOOP` flag and the Hermes Docker-backend env variables (`TERMINAL_DOCKER_IMAGE`, `TERMINAL_DOCKER_VOLUMES`) used as defaults if `register_task_env_overrides` hasn't fired yet | Modify |
| `docs/superpowers/specs/2026-05-10-hermes-replacement-design.md` | Insert "Locked decisions for Phase 2" subsection inside §6 Phase 2 (logs the three locked answers) | Modify |
| `docs/superpowers/research/2026-05-13-hermes-phase-2-acceptance.md` | Phase 2 acceptance log + soak instructions | New |

---

## Task 0: Preliminaries — worktree off `hermes-migration`

**Goal:** Phase 1.5 has already merged into `hermes-migration` (commit `fbc2d02` or later). Branch Phase 2 off it via a new worktree at `.claude/worktrees/hermes-phase-2`.

**Files:** No file changes; git operations only.

- [ ] **Step 1: Confirm the migration branch is up to date**

Run:
```bash
cd /home/john/strange_rambling_svelte
git checkout hermes-migration
git log --oneline -5
```

Expected: tip contains the Phase 1.5 merge commit. No uncommitted changes.

- [ ] **Step 2: Create the Phase 2 worktree**

Run:
```bash
cd /home/john/strange_rambling_svelte
git worktree add .claude/worktrees/hermes-phase-2 -b worktree-hermes-phase-2 hermes-migration
cd .claude/worktrees/hermes-phase-2
git branch --show-current
```

Expected: working dir is the new worktree; branch is `worktree-hermes-phase-2`; HEAD matches `hermes-migration`.

- [ ] **Step 3: Install deps and copy `.env`**

Run:
```bash
cd .claude/worktrees/hermes-phase-2
cp /home/john/strange_rambling_svelte/.env .env
npm install --no-audit --no-fund
```

Expected: ~851 packages installed; `.env` present.

- [ ] **Step 4: Baseline tests**

Run:
```bash
npx vitest run src/lib/mcp/ src/lib/jkai/ 2>&1 | tail -10
```

Expected: 55+ pass, 0 fail (excluding the pre-existing `job-store.test.ts` heartbeat flake that all prior phases have observed).

- [ ] **Step 5: Confirm Hermes service is alive**

Run:
```bash
systemctl --user is-active jkai-hermes.service
curl -sS http://127.0.0.1:18790/platforms/jkai/health
```

Expected: `active`; `{"ok":true,...}`. If either fails, STOP and report BLOCKED — Phase 2 cannot proceed without Phase 1/1.5 wiring in place.

- [ ] **Step 6: No commit yet** — Task 1's commit is the first Phase 2 artefact.

---

## Task 1: Verify the production coding model

**Goal:** The schema default for `jkai_builds.model_id` is `glm-5-turbo`. The locked decision says GLM-5.1 across. Confirm what production builds are *actually* using; if drift exists, document and decide.

**Files:**
- Read: `src/lib/db/schema.ts` (line ~560)
- Read (DB query): `jkai_builds.model_id` distribution over the last 30 days
- Modify (if drift): `src/lib/db/schema.ts` — change default to `glm-5.1`

- [ ] **Step 1: Read the schema default**

Run:
```bash
grep -n "model_id" src/lib/db/schema.ts | head -5
```

Expected: line ~560 sets `default('glm-5-turbo')`.

- [ ] **Step 2: Inspect production model usage**

Run:
```bash
psql "$DATABASE_URL" -c "SELECT model_id, model_provider, COUNT(*) FROM jkai_builds WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY 1, 2 ORDER BY 3 DESC;"
```

Expected output: one or more rows. Typical pattern from 2026-04 onward: most rows have `model_id='glm-5.1'`, `model_provider='zai'` because the UI's model selector defaults to GLM-5.1 even though the schema default is stale.

If the dominant model is *not* `glm-5.1`, STOP and report — the model-quality comparison baseline must be locked before Phase 2 work continues.

- [ ] **Step 3: Update the schema default**

Edit `src/lib/db/schema.ts`. Find the `jkaiBuilds` table block. Change:

```typescript
  modelId: text('model_id').notNull().default('glm-5-turbo'),
```

to:

```typescript
  modelId: text('model_id').notNull().default('glm-5.1'),
```

- [ ] **Step 4: Generate + apply migration**

Run:
```bash
npx drizzle-kit generate --name=jkai_builds_default_model
npx drizzle-kit push
echo "\\d jkai_builds" | psql "$DATABASE_URL" | grep model_id
```

Expected: column default is `'glm-5.1'::text`. Existing rows are unchanged (default only applies to future inserts).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "fix(jkai): default new builds to glm-5.1 (was stale glm-5-turbo)

Phase 2 Task 1: locks the model baseline for the Pi→Hermes
quality comparison. Production UI was already defaulting to
glm-5.1; the schema default drifted. Future inserts now match
the UI."
```

If Step 2 showed the dominant production model is *already* `glm-5.1` and no rows in the last 30 days used `glm-5-turbo`, you may skip the migration and commit only a comment update — but include the psql output in the commit message for the record.

---

## Task 2: Spec amendment — log locked decisions inside Phase 2 section

**Files:**
- Modify: `docs/superpowers/specs/2026-05-10-hermes-replacement-design.md` (§6 Phase 2 block, around line 395)

- [ ] **Step 1: Open the spec and locate the Phase 2 section**

Run:
```bash
grep -n "### Phase 2 — Pi-runner" docs/superpowers/specs/2026-05-10-hermes-replacement-design.md
```

Expected: a single match around line 395.

- [ ] **Step 2: Insert a "Locked decisions" subsection**

Immediately after the "**Deliverables:**" block of Phase 2, before "**Exit criteria:**", insert:

```markdown
**Locked decisions (2026-05-12, recorded for future-reader's sanity):**

1. **Docker integration: Option B — per-build ephemeral Hermes containers.** Hermes' `terminal.backend: docker` plus a per-session `register_task_env_overrides(task_id, {...})` call from the jkai platform adapter (in `handle_inbound`, before `self.handle_message(event)`, when `kind == 'build'`) requests a fresh `hermes-<task_id>` container per build using the existing `jkai-sandbox:latest` image with the build's workspace bind-mounted to `/workspace`. Strong isolation via Hermes' built-in `_BASE_SECURITY_ARGS` (`--cap-drop ALL`, `no-new-privileges`, `--pids-limit`, tmpfs). Conceptually similar to today's `jkai-sandbox` (a shared bind-mounted Linux container) except per-build rather than singleton-named. The `JKAI_BUILDS_HOSTMODE=1` escape hatch from `pi-runner.ts` is Pi-only; Hermes-with-Docker has no hostmode equivalent (and shouldn't need one — Hermes only runs on homeserv where Docker is available).

2. **Coding model: glm-5.1 across (Pi baseline today + Hermes target).** `model_id` default fixed in Task 1; `max_tokens` budget ≥ 1500 to leave reasoning-token headroom (see `feedback_glm_reasoning_tokens.md`).

3. **Streaming log granularity: per-tool-result.** No mid-iteration SSE tap. The executor records logs by intercepting MCP `tools/call` invocations (one log row per call start + one per call end) plus a single `text` log row for the final assistant message. Coarser than Pi's per-token deltas; much simpler integration. Existing `jkai_logs` table unchanged.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-10-hermes-replacement-design.md
git commit -m "docs(spec): record locked decisions for Phase 2

Per-build ephemeral Hermes Docker containers (Option B,
register_task_env_overrides), glm-5.1 across, per-tool-result
log granularity. Captured before plan execution so a future
reader doesn't have to reconstruct intent from the plan."
```

---

## Task 3: Hermes profile — configure Docker terminal backend with per-build override mechanism

**Goal:** Switch Hermes' built-in `bash`/`read_file`/`edit_file` from `local` to the `docker` backend, with `jkai-sandbox:latest` as the default image. The per-task override mechanism (`register_task_env_overrides`) is exercised by the platform adapter (Task 4 / Task 13) — this task only configures the static defaults Hermes falls back to when no per-task override is registered (so an out-of-band Hermes smoke test still works).

**Files:**
- Modify: `~/.hermes-jkai/config.yaml`
- Out-of-repo; no commit. Document everything in the acceptance log (Task 15).

- [ ] **Step 1: Confirm Docker is reachable from the Hermes systemd-user unit**

```bash
systemctl --user show jkai-hermes.service -p Environment | tr ' ' '\n' | grep -i docker
docker info --format '{{.ServerVersion}}'
docker images jkai-sandbox:latest --format '{{.Repository}}:{{.Tag}} {{.CreatedSince}} {{.Size}}'
```

Expected: `docker info` returns a version (>= 24). `jkai-sandbox:latest` shows in the image list. If the image is missing, build it: `docker build -t jkai-sandbox:latest /home/john/strange_rambling_svelte/docker/jkai-sandbox/`.

Also verify the Hermes systemd-user unit can reach the Docker socket — the unit runs as `john`; `/var/run/docker.sock` must be group-readable by a group `john` is in (typically `docker`).

```bash
ls -l /var/run/docker.sock
id john | tr ',' '\n' | grep docker
```

Expected: socket group is `docker`; `john` is in `docker`. If not, `sudo usermod -aG docker john` and re-login (or `newgrp docker`) before restarting the Hermes unit.

- [ ] **Step 2: Update `~/.hermes-jkai/config.yaml` — `terminal:` block**

Open `~/.hermes-jkai/config.yaml`. The current `terminal:` block reads:

```yaml
terminal:
  backend: local
  cwd: .
  timeout: 180
  lifetime_seconds: 300
```

Replace with:

```yaml
terminal:
  backend: docker
  # Defaults applied when no register_task_env_overrides() entry is found
  # for a task_id. Builds always go through the override path (Task 4),
  # so these defaults are only used for out-of-band Hermes smoke tests
  # and any future kind that wants Docker without a per-build mount.
  docker_image: jkai-sandbox:latest
  docker_run_as_host_user: true   # files written under /workspace stay owned by john on the host
  docker_volumes: []
  cwd: /workspace
  timeout: 180
  lifetime_seconds: 300
  # GLM thinking-model headroom — see feedback_glm_reasoning_tokens.md.
  # Hermes inherits max_tokens from the model config; Phase 2 wants ≥1500
  # so reasoning + answer + tool-args all fit. The model config below sets
  # the floor explicitly.
```

In the same file's `model:` block (top of file), set:

```yaml
model:
  default: glm-5.1
  provider: zai
  base_url: https://api.z.ai/api/coding/paas/v4
  max_tokens: 1500
```

(If `max_tokens` is already set ≥ 1500, leave it. If not present, add it as shown.)

- [ ] **Step 3: Restart Hermes and verify the Docker backend loaded**

```bash
systemctl --user restart jkai-hermes.service
sleep 4
systemctl --user is-active jkai-hermes.service
journalctl --user -u jkai-hermes.service --since "1 minute ago" | grep -iE "terminal|docker|backend" | head -10
```

Expected: `active`; logs mention `terminal.backend=docker` (or equivalent), with no `Docker executable not found` / `docker daemon not running` errors. If a permission error appears on `/var/run/docker.sock`, return to Step 1 and verify group membership.

- [ ] **Step 4: One-shot Hermes smoke test against the default image**

This exercises the static defaults — no per-task override yet, no bind-mount, just confirms the Docker backend can spin a container from `jkai-sandbox:latest`.

```bash
HERMES_HOME=~/.hermes-jkai hermes -z "Run bash 'whoami && cat /etc/os-release | head -3 && which node && node --version && which python3 && python3 --version'. Tell me what you see."
```

Expected: the agent's bash output reports user `jkai` (the in-image non-root user), Debian as the base distro, Node 22.x, Python 3.12.x. This confirms the Docker backend is functional end-to-end.

Then list running Hermes containers:

```bash
docker ps --filter "name=hermes-" --format '{{.Names}} {{.Image}} {{.Status}}'
```

Expected: one `hermes-<8hex>` container running `jkai-sandbox:latest`. If the same name appears in the listing >5 minutes after the smoke test finished, Hermes' idle reaper is functioning normally (default idle window is ~10 min — check the run with `docker stop <id>` if you want a clean slate before Task 4).

- [ ] **Step 5: No commit** (config is out-of-repo). Document the Docker server version, image SHA, and the resolved `docker info` output in the Task 15 acceptance log.

---

## Task 3.5: Verify `jkai-sandbox:latest` image suitability for Hermes execution

**Goal:** The current `jkai-sandbox` image was built for Pi's needs (Node, npm, Python, Playwright, the workspace prep scripts). Confirm it has *also* the bare minimum Hermes' `DockerEnvironment` expects, and either accept the existing image or build a `jkai-sandbox-hermes:latest` variant.

What Hermes' `DockerEnvironment` probes at start-up (per `~/hermes-agent/tools/environments/docker.py` and `base.py`):

1. `docker run -d --init <image> sleep infinity` — image must run `sleep infinity` cleanly as the image's default user. `jkai-sandbox` has `CMD ["sleep", "infinity"]` already.
2. `init_session()` runs `bash -l -c '...'` and uses `export -p`, `declare -f | grep -vE '^_[^_]'`, `alias -p`, `shopt -s expand_aliases`, `set +e`, `set +u` to capture a login-shell snapshot to `${TMPDIR or /tmp}/hermes-snap-<sid>.sh`. So: a working `bash` (login mode), writable `/tmp`, GNU `grep`. `jkai-sandbox` is `python:3.12-slim` + `bash` (from the `bash` package implicit in the slim base; Debian slim ships bash by default).
3. Tools the agent's built-ins call: `bash`, `cat`, `ls`, `find`, `grep`, `sed`, `head`, `tail`, `mkdir`, `rm`, `mv`, `cp`, `chmod`. All present via Debian `coreutils` + `findutils` + `grep` (in the slim base).
4. Optional but useful: `git`, `curl`, `jq`, `ripgrep`/`rg`. `jkai-sandbox` has `git`, `curl`, `jq`. **Missing: `ripgrep`** — the Pi base didn't need it, but Hermes' built-in `grep` tool docs reference `rg`-style behaviour. Verify whether Hermes falls back to GNU grep cleanly or insists on `rg`.

**Files:**
- Read: `/home/john/strange_rambling_svelte/docker/jkai-sandbox/Dockerfile`
- Read: `~/hermes-agent/tools/environments/docker.py` (lines around `init_session` and `_run_bash`)
- Maybe new: `docker/jkai-sandbox-hermes/Dockerfile` (only if Step 3 finds a blocker)

- [ ] **Step 1: Inspect the image's tool inventory**

```bash
docker run --rm jkai-sandbox:latest bash -lc '
for cmd in bash cat ls find grep sed head tail mkdir rm mv cp chmod git curl jq node npm python3 pip rg; do
  if command -v "$cmd" >/dev/null 2>&1; then
    printf "%-10s %s\n" "$cmd" "$(command -v "$cmd")"
  else
    printf "%-10s MISSING\n" "$cmd"
  fi
done
echo
echo "bash version: $(bash --version | head -1)"
echo "default user: $(whoami) (uid=$(id -u) gid=$(id -g))"
echo "tmpfs check: writable=$(touch /tmp/hermes-probe 2>&1 && echo yes || echo no)"
echo "snapshot probe:"
export -p > /tmp/snap.sh && declare -f | grep -vE "^_[^_]" >> /tmp/snap.sh 2>&1 && alias -p >> /tmp/snap.sh 2>&1 && echo "  snapshot ok ($(wc -l < /tmp/snap.sh) lines)" || echo "  snapshot FAILED"
'
```

Expected output: every essential tool resolved to a path (bash through pip). `rg` may show MISSING — that's the open question. `whoami=jkai`, `/tmp` writable, snapshot produces a non-empty file.

If anything except `rg` is missing, STOP and report — the image needs rebuild before Phase 2 can proceed.

- [ ] **Step 2: Decide on `rg`**

Read `~/hermes-agent/tools/environments/docker.py` and any sibling files that mention `rg` or `ripgrep`:

```bash
grep -rn "ripgrep\|\\brg\\b" /home/john/hermes-agent/tools/ --include="*.py" | head -10
```

If Hermes references `rg` only as a *preference* (falls back to GNU `grep` cleanly), accept the existing image. If Hermes' `grep` tool implementation *requires* `rg` (calls it directly), proceed to Step 3 and add `ripgrep` to the image.

- [ ] **Step 3: Build `jkai-sandbox-hermes:latest` only if Step 2 found a hard dependency**

If — and only if — Step 2 found a blocker, create `docker/jkai-sandbox-hermes/Dockerfile`:

```dockerfile
FROM jkai-sandbox:latest

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*
USER jkai
```

Build it:

```bash
docker build -t jkai-sandbox-hermes:latest /home/john/strange_rambling_svelte/docker/jkai-sandbox-hermes/
```

Then in Task 3's `~/.hermes-jkai/config.yaml`, change `docker_image: jkai-sandbox:latest` to `jkai-sandbox-hermes:latest`, and likewise in Task 4's `register_task_env_overrides(...)` payload. Re-run Task 3 Step 4's smoke test.

If Step 2 found NO blocker, skip Step 3. Document the decision in the acceptance log: "Image: `jkai-sandbox:latest` (no variant; `rg` not required by Hermes' grep tool, GNU grep fallback verified)."

- [ ] **Step 4: Run a Hermes-only `bash`/`read_file` smoke through the registered Docker backend**

```bash
HERMES_HOME=~/.hermes-jkai hermes -z "Use bash to print 'hello from inside the container', then write a file /tmp/hermes-probe.txt with content 'probe ok', then read_file /tmp/hermes-probe.txt and tell me what it says."
```

Expected: agent reports `hello from inside the container` and `probe ok`. This proves Hermes' built-in `read_file` / `write_file` traverse the Docker filesystem cleanly with `jkai-sandbox:latest` (or the `-hermes` variant if Step 3 ran).

- [ ] **Step 5: No commit** (image verification only). If Step 3 ran, commit the new Dockerfile in a tight follow-up:

```bash
cd /home/john/strange_rambling_svelte/.claude/worktrees/hermes-phase-2
git add docker/jkai-sandbox-hermes/Dockerfile
git commit -m "feat(docker): jkai-sandbox-hermes variant — adds ripgrep for Hermes grep tool

Phase 2 Task 3.5: Hermes' grep tool requires rg; jkai-sandbox base
image doesn't ship it. Thin Dockerfile-FROM variant on top of the
existing base — keeps Pi's image untouched, Hermes consumes the
-hermes tag instead."
```

If Step 3 did NOT run, skip the commit. Document the decision in the acceptance log only.

---

## Task 4: Adapter wiring — `'build': 'jkai-build'` skill + per-build `register_task_env_overrides`

**Goal:** Two adapter changes, both in `handle_inbound`:

1. Phase 1.5's adapter has a `_KIND_TO_SKILL` map that auto-loads a skill per inbound `kind`. Currently only `canvas_chat` and `manual` are mapped. Add `build`.
2. When an inbound message arrives with `kind == 'build'`, call `register_task_env_overrides(<task_id>, {"docker_image": "jkai-sandbox:latest", "docker_volumes": ["/home/jkai/workspace/<kind_id>/dev:/workspace"], "cwd": "/workspace"})` BEFORE `self.handle_message(event)` — so the very first tool call in the agent loop lands in the correct per-build container with the workspace bind-mounted. Pair with `clear_task_env_overrides(<task_id>)` once the per-session task awaited at the existing line 240 completes.

**Placement decision recorded here for posterity:** the override is registered ADAPTER-side rather than executor-side. Two reasons: (a) the adapter is the *only* place that natively sees `kind == 'build'` + `kind_id` + the `task_id` Hermes will actually use for `_resolve_container_task_id`, so doing it there avoids a brittle out-of-band HTTP call back into Hermes from SvelteKit; (b) `register_task_env_overrides` is a pure in-process Python dict mutation in `terminal_tool.py` — calling it from inside the same Python process that runs the agent is the natural seam. Executor-side wiring would require either a new Hermes HTTP RPC or smuggling the workspace path through `MessageEvent.raw_message` for the adapter to read anyway, which collapses back to this same change with extra steps.

**Files:**
- Modify: `~/.hermes-jkai/extensions/jkai_platform/adapter.py` (around line 31 for the KIND map; inside `handle_inbound` around lines 192–226 for the override hook)
- Out-of-repo; no commit.

- [ ] **Step 1: Locate the map and the inbound dispatch site**

Run:
```bash
grep -n "_KIND_TO_SKILL\|self.handle_message(event)\|self._session_tasks.get" ~/.hermes-jkai/extensions/jkai_platform/adapter.py
```

Expected: `_KIND_TO_SKILL` near line 31, `self.handle_message(event)` near line 226, the per-session-task `await` near line 240.

- [ ] **Step 2: Add the `build` entry to `_KIND_TO_SKILL`**

Open `~/.hermes-jkai/extensions/jkai_platform/adapter.py`. Find:

```python
_KIND_TO_SKILL = {
    "canvas_chat": "jkai-canvas",
    "manual": "jkai-general",
}
```

Replace with:

```python
_KIND_TO_SKILL = {
    "canvas_chat": "jkai-canvas",
    "manual": "jkai-general",
    "build": "jkai-build",
}
```

Also update the comment immediately above the map. Replace the line:

```python
# `build` and `curate` are intentionally absent here — Phase 2 owns the
# autonomous builder skill, Phase 3 owns the curator skill.
```

with:

```python
# `curate` is intentionally absent — Phase 3 owns the curator skill.
# `build` was added in Phase 2 and auto-loads `jkai-build` for build sessions.
# `build` ALSO triggers register_task_env_overrides() below to spin a per-build
# container — see _register_build_env_overrides().
```

- [ ] **Step 3: Add the per-build env-override helper + clear logic**

Near the top of `adapter.py` (after the `_KIND_TO_SKILL` block), add the helper. The import lives inside the function so the module still imports cleanly outside the Hermes venv (pytest path stays working):

```python
import os

def _register_build_env_overrides(task_id: str, kind_id: str) -> bool:
    """For a build-kind inbound, register Docker env overrides so the
    Hermes agent loop spins up a per-build hermes-<...> container using
    jkai-sandbox:latest with the build's workspace bind-mounted to
    /workspace. Returns True on success; False if Hermes is not importable
    (test path) — caller should treat False as no-op.
    """
    try:
        from tools.terminal_tool import register_task_env_overrides
    except ImportError:
        return False
    workspace_host = f"/home/jkai/workspace/{kind_id}/dev"
    # Verify the bind-mount source exists before announcing it — the executor
    # creates the workspace dir at build-start, but a chat-side smoke message
    # for an unknown build_id would fail later inside the container start.
    if not os.path.isdir(workspace_host):
        # Fall back to mounting the parent so the agent can at least probe;
        # the executor will have created the dir before the first real
        # iteration. For ad-hoc smoke prompts this is the safe default.
        workspace_host = "/home/jkai/workspace"
    register_task_env_overrides(task_id, {
        "docker_image": "jkai-sandbox:latest",
        "docker_volumes": [f"{workspace_host}:/workspace"],
        "cwd": "/workspace",
    })
    return True


def _clear_build_env_overrides(task_id: str) -> None:
    try:
        from tools.terminal_tool import clear_task_env_overrides
    except ImportError:
        return
    clear_task_env_overrides(task_id)
```

If a follow-up needs the `-hermes` image variant (Task 3.5 Step 3), change `"jkai-sandbox:latest"` here to `"jkai-sandbox-hermes:latest"`.

- [ ] **Step 4: Invoke the helper in `handle_inbound` BEFORE `handle_message`**

Inside the existing `if platform is not None:` block in `handle_inbound`, immediately after `auto_skill = _KIND_TO_SKILL.get(kind) if kind else None` and BEFORE `event = MessageEvent(...)`, add the override registration. The `task_id` Hermes uses for `_resolve_container_task_id` is the per-rollout id — for the platform path, the adapter's `session_key` is what's wired into the session pipeline. Use `kind_id` (the buildId) as the task_id key because it's stable per build and is what we want a 1:1 container mapping against:

```python
                # Phase 2: for build-kind messages, register per-task Docker env
                # overrides so the first tool call in the agent loop lands in a
                # per-build hermes-<...> container with the workspace bind-mounted
                # to /workspace. task_id keyed on kind_id (the buildId) so all
                # iterations of one build share the same container key — matches
                # _resolve_container_task_id's expectations.
                _build_task_id_for_clear: Optional[str] = None
                if kind == "build" and kind_id:
                    if _register_build_env_overrides(kind_id, kind_id):
                        _build_task_id_for_clear = kind_id
```

Then AFTER the existing `await asyncio.wait_for(asyncio.shield(task), timeout=300)` block (around line 240), and BEFORE the `self._enqueue(OutboundFrame(kind="finalize", ...))` line, clear the overrides:

```python
                if _build_task_id_for_clear is not None:
                    # Build session completed (or timed out) — drop the override
                    # so the next inbound on this chat doesn't accidentally re-use
                    # a stale config if the chat is re-bound to a different build.
                    # The container itself is reaped by Hermes' idle reaper, not
                    # here — clearing the override only affects future task_id
                    # resolutions.
                    _clear_build_env_overrides(_build_task_id_for_clear)
```

- [ ] **Step 5: Restart Hermes**

```bash
systemctl --user restart jkai-hermes.service
sleep 4
systemctl --user is-active jkai-hermes.service
```

Expected: `active`. If not, `journalctl --user -u jkai-hermes.service --since "1 minute ago" | tail -30` and fix the Python syntax error.

- [ ] **Step 6: Smoke-test that `kind='build'` reaches the override path (skill warn is OK)**

The skill doesn't exist yet (Task 6 creates it). Hermes should warn about the missing skill but not crash, and the env-override registration should fire.

A simple unauthenticated POST verifies route + parsing:

```bash
curl -sS -X POST http://127.0.0.1:18790/platforms/jkai/msg \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":"smoke","text":"hello","kind":"build","kind_id":"smoke","session_id":"smoke"}' \
  | head -c 200
```

Expected: 401/403 with a JSON-shaped error mentioning the bridge token. Confirms the route accepts `kind='build'` requests structurally.

- [ ] **Step 7: Check the Hermes log for the skill-load AND override registration**

```bash
journalctl --user -u jkai-hermes.service --since "30 seconds ago" | grep -iE "skill|auto_skill|jkai-build|register_task_env|hermes-" | head -15
```

Expected: a log entry mentioning `auto_skill=jkai-build`, plus a warning that the skill is not yet installed (expected — Task 6 ships the skill). On a fully-authenticated build dispatch (Task 15 e2e), `journalctl ... | grep "Starting container"` should additionally show a fresh `hermes-<8hex>` container with the `jkai-sandbox:latest` image and `-v /home/jkai/workspace/<buildId>/dev:/workspace`.

- [ ] **Step 8: No commit** (adapter is out-of-repo).

---

## Task 5: Postgres migration — add `deadline_at` to `jkai_builds`

**Files:**
- Modify: `src/lib/db/schema.ts` (the `jkaiBuilds` block around line 546)
- New: `drizzle/<auto>_jkai_builds_deadline_at.sql`

- [ ] **Step 1: Add the column to the Drizzle schema**

Open `src/lib/db/schema.ts`. In the `jkaiBuilds` table block, append (immediately after the `queuedAt` line near line 580, but before the closing `});`):

```typescript
  deadlineAt: timestamp('deadline_at', { withTimezone: true }),
```

The column is nullable: a build without an active deadline (planning phase, paused, finished) has no deadline.

- [ ] **Step 2: Generate the migration**

```bash
cd /home/john/strange_rambling_svelte/.claude/worktrees/hermes-phase-2
npx drizzle-kit generate --name=jkai_builds_deadline_at
ls drizzle/ | tail -3
```

Expected: a new `.sql` file containing `ALTER TABLE jkai_builds ADD COLUMN deadline_at timestamp with time zone;`.

- [ ] **Step 3: Apply the migration**

```bash
npx drizzle-kit push
echo "\\d jkai_builds" | psql "$DATABASE_URL" | grep deadline_at
```

Expected: one row matching `deadline_at | timestamp with time zone`. Existing builds have `NULL` (correct — they're not actively running).

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): jkai_builds.deadline_at — nullable per-build wall-clock cap

Phase 2: replaces pi-runner.ts's in-memory deadlineRef polling with a
DB-backed column. Set by orchestrator at iteration start; read by the
new hermes-build-runner.ts; updated by the extend_deadline MCP tool
when the agent realises it needs more time.

Nullable because most lifecycle states (paused, awaiting_plan_approval,
done, failed) don't have an active deadline."
```

---

## Task 6: `jkai-build` skill — heavy port from `prompt.ts`

**Goal:** Write `~/.hermes-jkai/skills/jkai-build/SKILL.md`. The bulk of agent discipline is currently encoded in `src/lib/jkai/prompt.ts`'s `SYSTEM_PROMPT` constant (lines 3–250-ish). Port it into the skill format established by `jkai-canvas/SKILL.md` (frontmatter → identity → scope rules → tool inventory → examples → termination).

**Files:**
- Create: `~/.hermes-jkai/skills/jkai-build/SKILL.md`
- Create: `~/.hermes-jkai/skills/jkai-build/examples/iteration-0-greenfield.md`
- Create: `~/.hermes-jkai/skills/jkai-build/examples/iteration-N-followup.md`
- Create: `~/.hermes-jkai/skills/jkai-build/examples/mid-iteration-injection.md`
- Create: `~/.hermes-jkai/skills/jkai-build/examples/deadline-extension.md`
- Out-of-repo; no commit.

- [ ] **Step 1: Read the source-of-truth content**

```bash
sed -n '3,250p' /home/john/strange_rambling_svelte/src/lib/jkai/prompt.ts > /tmp/prompt-source.md
wc -l /tmp/prompt-source.md
```

Expected: 240–260 lines of system-prompt text. This is the discipline you're porting. Don't paste verbatim — re-organise into skill format, but keep the rules and prose voice.

- [ ] **Step 2: Read the canvas skill for format reference**

```bash
wc -l ~/.hermes-jkai/skills/jkai-canvas/SKILL.md
head -60 ~/.hermes-jkai/skills/jkai-canvas/SKILL.md
```

Match the frontmatter shape exactly. Note: `related_skills: []` was empty in Phase 1; Phase 1.5 may have populated it.

- [ ] **Step 3: Write the skill body**

Create `~/.hermes-jkai/skills/jkai-build/SKILL.md` with this structure (target 450–600 lines):

```markdown
---
name: jkai-build
description: "Autonomous build-loop coder for jkai builds — drives 5–15 minute iterations on a per-build workspace, ships a runnable preview first, layers in features, and ends each turn with ## Evaluation and ## Next Steps."
version: 1.0.0
metadata:
  hermes:
    tags: [jkai, build, autonomous, coder, sandbox]
    related_skills: [jkai-general, jkai-utility, jkai-canvas]
---

# jkai Build Loop

## Identity

You are the build-loop coder inside **jkai** — John's personal automation site at `strangeramblings.com`. Each build session is bound to a single `build_id` (the `chat_id` for this session). Your scope is the workspace `/home/jkai/workspace/<build_id>/dev/`. Over many iterations (5–15 minutes each), you ship a runnable preview, layer features, and end every turn with a structured evaluation.

You speak jkai vocabulary in everything visible to John:

| Use | Don't use |
|-----|-----------|
| build | session, conversation |
| iteration | turn |
| workspace / dev / live | sandbox |
| pinned note | system note |
| pending message | queued event |
| evaluation, next steps | conclusion, plan |

Internal Hermes terminology never appears in user-facing strings. If you reference your tools in chat, call them by name ("I'll edit `serve.json`") — that's fine, but don't say "I called bash inside the per-build container."

You are not a general assistant. You don't answer off-topic questions. You build the thing.

## Workspace contract (non-negotiable)

**Paths:**
- `/home/jkai/workspace/<build_id>/dev/` — your working directory. Edit here.
- `/home/jkai/workspace/<build_id>/live/` — the version the user sees. Auto-updated from `dev/` after each iteration's tests pass. Do not touch `live/` directly.
- `/home/jkai/workspace/<build_id>/dev/design-system/` — read-only design-system reference (tokens.css, components.md, examples/page.svelte). Mounted in by the orchestrator before each iteration.

**Build context delivered to you each iteration:**
At the start of every iteration the orchestrator sends a user message containing the project goal, your assigned port, the codebase digest (auto-generated file map + signatures), the previous iteration's `## Evaluation` + `## Next Steps`, any pinned notes, and any pending user messages typed mid-iteration. Read these carefully before deciding what to do.

**Serve discipline (DO THIS FIRST):**
Your very first actions in any iteration where `serve.json` doesn't exist:
1. Write a valid `serve.json` at the workspace root:
   ```json
   {
     "port": <assigned port, from iteration context>,
     "startCommand": "<command binding to 0.0.0.0>",
     "healthCheck": "/<path returning 200>",
     "description": "<one-line>"
   }
   ```
2. Create the minimum files the `startCommand` needs (`index.html`, `main.py`, `server.js` — whatever applies).
3. Run the server from bash and `curl` the `healthCheck` to confirm 200.
4. ONLY THEN start building features.

The port assignment is per-build and lives in the iteration-context payload. Always bind `0.0.0.0`, never `127.0.0.1` — the reverse proxy is on a separate process.

## Scope of an iteration

**Target 5–15 minutes per iteration, NOT 30.** Quality emerges across many iterations, not within one. The user watches the `live/` preview refresh between iterations.

Each iteration:
1. Get a runnable preview live as fast as possible. A placeholder is fine.
2. Add ONE increment of real functionality.
3. Verify the server still starts and the page still loads (`curl` it).
4. Write `## Evaluation` + `## Next Steps` and stop.

**Hard stops (end the iteration NOW and write `## Evaluation`):**
- You have a working `serve.json`, the server starts, and at least one route returns a 200. → Wrap up.
- You hit a real blocker that needs user input. → Wrap up with a clear blocker note.
- You've been working for 15 minutes. → Wrap up whatever state you're in.

Prefer breadth-first: a running skeleton with 3 empty pages beats one perfect page and two missing ones.

## How an iteration ends

Every iteration must finish with this structure as the trailing portion of your final assistant message:

```
## Evaluation
Honest assessment: what works in the live preview right now, what's still stubbed, what's unfinished. Estimate completion %.

## Next Steps
Ordered list of concrete follow-ups for the next iteration. Be specific — the next iteration reads this to decide what to build.
```

The executor parses these sections via regex match against `## Evaluation` and `## Next Steps`. Without them, the iteration is classified `empty_output` and the next iteration has no roadmap. Always include both, even if `## Evaluation` is "everything is broken because X" — that's a valid evaluation.

After writing these two sections, immediately call `log_iteration` with the same content (see Tool Inventory below). That persists the structured eval into Postgres for the next iteration's context payload.

## Tool inventory

### Built-in (Hermes terminal backend — SSH to homeserv)
- **`bash(command, background?, notify_on_complete?)`** — Run a shell command on homeserv. `cwd` defaults to `/home/jkai/workspace`; pass an absolute path or `cd` to your build's `dev/`. Foreground timeout 600s; for anything that might exceed (`npm install`, large builds), pass `background=True` and use `notify_on_complete=True`.
- **`read_file(path)`** — Read a file (host path).
- **`edit_file(path, find_string, replace_string)`** — Find-and-replace inside a file. The `find_string` must be unique within the file or the call fails — anchor with surrounding context if needed.
- **`write_file(path, content)`** — Create or overwrite a file (for new files only — for surgical edits, prefer `edit_file`).
- **`grep(pattern, path)`** — Recursive ripgrep.
- **`find(path, name?)`** — File-name search.
- **`ls(path)`** — Directory listing.

All paths are HOST paths under `/home/jkai/workspace/<build_id>/dev/`. There is no container indirection.

### Build domain MCP tools (call when you need build state from the database)
- **`build_inspect(buildId)`** — Full build overview: status, model, iterations summary, current plan, milestones. **Large payload** — use sparingly; the iteration context already has the most-recent state.
- **`build_get_iteration(buildId, iterationId, truncateChars?)`** — Deep-dive into one iteration's `actions` + `messages` jsonb. Pass `truncateChars: 2000` for inspection; without truncation the payload can exceed 50 KB.
- **`build_get_plan(buildId)`** — The build plan (iteration #0).
- **`build_get_logs(buildId, limit?)`** — Recent `jkaiLogs` rows. Default limit 50.
- **`build_list_files(buildId, scope)`** — List files in `dev/` or `live/`. Use this rather than `ls` when you want the orchestrator's view (matches what the next iteration's context payload uses).
- **`build_read_file(buildId, path, scope)`** — Read a file from `dev/` or `live/` via the orchestrator's sandbox dispatch. Equivalent to `read_file` on the host path; use either.
- **`build_write_file(buildId, path, content, scope)`** — Write a file to `dev/`. Equivalent to `write_file`; use either.

The built-in `bash`/`edit_file`/`write_file` operate INSIDE the per-build Hermes container at `/workspace`. The MCP `build_*` tools operate host-side via `execInSandbox` against `/home/jkai/workspace/<buildId>/dev/`. Because the host path is bind-mounted into the container at `/workspace`, both sets of tools see the same files. Pick whichever is more ergonomic per call; for inside-the-container commands (`node`, `npm`, `python3`, server start) prefer the built-in `bash`. For host-side metadata (the orchestrator's view of `dev/` vs `live/`) use the MCP `build_list_files` / `build_read_file` variants.

### Build infrastructure tools (MCP-only — new in Phase 2)
- **`log_iteration(iterationId, role, content, metadata?)`** — Persist a structured row into `jkai_logs`. Call this once at the end of every iteration with `role='assistant'` and `content` containing your `## Evaluation` + `## Next Steps`. The executor falls back to text-parsing if you skip this, but the structured call is more reliable.
- **`extend_deadline(buildId, additionalMinutes)`** — Push the iteration's wall-clock cap further into the future. Call this if you realise an iteration needs more time (e.g. a long `npm install` you can't background). Max single extension: 30 minutes. Repeated extensions chain.

### Cross-cutting tools (already available from other skills)
- **`memory_save_fact`, `memory_recall_fact`** — Persist build-specific facts across iterations (e.g. "this build uses Tailwind via CDN").
- **`workflow_inspect`** — If the build is `attachedWorkflowIds`-bound, you may need to look at the attached workflow's DAG. Pass the workflow id from the iteration context.

## Long commands and background execution

Default `bash` foreground timeout is 600s. The following exceed it on cold cache:

- `npm install` (first run, fresh node_modules) — 60–300s normally, but >600s on slow networks or large dep trees.
- `npm run build` for large frameworks — typically OK; risky on first build.
- Playwright browser downloads — already installed globally on the host; do NOT `npm install playwright` again.
- Database seeding / large data ingestion.

For these, pass `background=True, notify_on_complete=True`:

```python
bash("cd /home/jkai/workspace/<build_id>/dev && npm install", background=True, notify_on_complete=True)
```

The call returns immediately with a job id. When the job finishes, you'll get a follow-up message with the exit code + tail of stdout. While waiting, do work on other files (write components, draft tests) — don't block.

## GLM reasoning-token budget

This build runs on `glm-5.1` via z.ai. GLM is a thinking model — it allocates some of the `max_tokens` budget to internal reasoning before producing the visible answer. The Phase 2 config sets `max_tokens=1500` to leave reasoning + answer + tool args headroom.

Practical implications:
- Don't write 1000-line assistant messages — they may get truncated.
- Keep `## Evaluation` and `## Next Steps` concise (5–10 bullets each).
- If you see `finish_reason='length'` or empty content in a tool result, the budget was exhausted — split the work into multiple turns.

## Host environment (already installed — don't reinstall)

The homeserv host has:
- Python 3.12 (`python3`), pip, stdlib + venv
- Node 22 (`node`), npm, npx
- Playwright + Chromium (`npx playwright` works out of the box — do NOT `npm install playwright` again)
- Git, curl, wget, jq, ripgrep (`rg`)
- bash + standard GNU coreutils

Before `npm install <X>` or `pip install <X>`, check whether the capability exists already (`which X`, `X --version`, `node -e "require('X')"`). Time saved on reinstalls is time the user sees a preview sooner.

## Data + UI standards

- **Real data, no placeholders.** Public APIs (Open-Meteo, REST Countries, Wikipedia, gov open-data portals), scraped content, established datasets. If an API needs a key you don't have, document in `## Evaluation` and use an alternative.
- **Production-SaaS UI quality.** Tailwind via CDN is the default for quick design. Mobile responsive with viewport meta tag. Lucide/Heroicons or emoji.
- **Design system enforced** when `enforceDesignSystem=true` (default): import `./design-system/tokens.css`, use the documented classes (`.nm-sec`, `.nm-text-input`, `.nm-save-btn`, `.row-link`, `.status-dot`, `.kicker`, `.page-hdr`), never hard-code hex colours or font names.

## Data emission contract

Every app the build serves must emit events on meaningful client-side actions. The proxy injects two globals into every served HTML page:
- `window.JKAI_BUILD_ID` — this build's id.
- `window.JKAI_EVENTS_URL` — the events endpoint for this build, same-origin.

On every meaningful event the app must POST a JSON `{type, ts, ...payload}` body to `JKAI_EVENTS_URL` AND `postMessage` the same shape to `window.parent`. The skill's identity is: ship apps that do this.

## Mid-iteration injection

The orchestrator drains `jkaiBuildPendingMessages` and `jkaiBuildNotes` before each iteration's context payload. By the time you read your turn's user message, any pending messages from the user are already in the prompt (formatted as a `## Pending Messages` block) and pinned notes are present (formatted as a `## Notes` block). Treat both as hard constraints — they're directives the user typed mid-build, not suggestions.

If a pending message conflicts with the previous iteration's `## Next Steps`, the pending message wins. Acknowledge it in your current iteration's `## Evaluation`.

## Deadline awareness

Each iteration has a wall-clock deadline. The remaining time is included in your iteration-context payload as `## Deadline` (e.g. `12 minutes remaining`). Check it early.

If you realise you need more time:
1. Call `extend_deadline(buildId, additionalMinutes)` with a sensible amount (5–15 min typical, 30 min max).
2. Continue the iteration.
3. Note in `## Evaluation` that you extended.

If the deadline expires mid-iteration, the orchestrator SIGTERMs the underlying bash subprocess (if foreground) and marks the iteration `failure: wall_clock_timeout`. So: don't ignore the deadline; either finish or extend.

## Termination signals

End the iteration (write `## Evaluation` + `## Next Steps` and stop) when:
- Server is running, route returns 200, one increment of functionality added.
- A real blocker needs user input.
- 15 minutes elapsed (preferred budget, hard cap from deadline regardless).
- The pending messages explicitly say "stop and wait for me."
- A previous tool call returned a fatal error you can't recover from in this iteration (e.g. "npm install hit a peer-dep conflict requiring user judgement").

Do NOT continue past the iteration boundary "just to fix one more thing" — promotion to `live/` happens only on iteration end, and the user wants to see *something* render.

## Examples

See the per-scenario worked examples in `examples/`:
- `examples/iteration-0-greenfield.md` — greenfield build, first iteration: write `serve.json`, get a 200, basic layout.
- `examples/iteration-N-followup.md` — second iteration on the same build, reading the previous `## Next Steps`.
- `examples/mid-iteration-injection.md` — pending message arrives mid-iteration: acknowledge, adjust, continue.
- `examples/deadline-extension.md` — agent realises 8 minutes won't be enough for an `npm install`; calls `extend_deadline(15)` and proceeds.
```

- [ ] **Step 4: Write the four examples**

For each of the four example files, write a ~80–150 line scenario in the same prose+code voice. Each example: scenario setup → agent's reasoning (1–2 paragraphs) → verbatim tool calls → final `## Evaluation` + `## Next Steps`.

**`examples/iteration-0-greenfield.md`**: project goal "a single-page calculator with theme toggle." Agent reads design-system tokens, writes `serve.json` (port 5410, Python http.server), drops an `index.html` with Tailwind CDN + DM Mono + theme toggle skeleton, curls the health check, returns 200. Closes with: completion 25%, next-steps "wire keyboard input, add memory slot."

**`examples/iteration-N-followup.md`**: build id `b_abc123`, previous iteration's `## Next Steps` said "wire keyboard input, add memory slot." Agent reads iteration context, calls `read_file('/home/jkai/workspace/b_abc123/dev/index.html')`, sees the existing layout, uses `edit_file` to add `document.addEventListener('keydown', ...)`, runs the server, curls 200. Closes with: completion 45%, next-steps "add scientific mode toggle."

**`examples/mid-iteration-injection.md`**: agent has been building a markdown editor for 3 minutes. Iteration context includes `## Pending Messages — make the preview pane scrollable instead of fixed-height`. Agent acknowledges, locates the relevant CSS, applies `overflow-y: auto; max-height: 70vh;`, curls 200. Closes with: "applied the user's pending message about scroll behaviour. Completion 60%, next-steps: dark-mode contrast pass."

**`examples/deadline-extension.md`**: build's deadline is 8 minutes; the agent realises a clean `npm install` for a Vite app will likely take 4+ minutes alone. Calls `extend_deadline(buildId, 15)`, then `bash('cd ... && npm install', background=True, notify_on_complete=True)`. While waiting, drafts the component layout in `App.svelte`. Background job completes; runs `npm run dev` in background, curls preview, returns 200. Closes with: "needed the extension to finish install; completion 30%, next-steps: wire the data fetch."

- [ ] **Step 5: Restart Hermes and verify the skill loads**

```bash
systemctl --user restart jkai-hermes.service
sleep 4
journalctl --user -u jkai-hermes.service --since "30 seconds ago" | grep -i "jkai-build\|skill" | head -10
```

Expected: a log line showing `jkai-build` skill detected at `~/.hermes-jkai/skills/jkai-build/SKILL.md`. No warning about a missing file.

- [ ] **Step 6: No commit** (out-of-repo).

---

## Task 7: `tool-call-log-bus.ts` — in-memory pub-sub for build tool-call events (TDD)

**Goal:** A close mirror of the Phase 1 `tool-step-bus.ts` pattern, but keyed by `buildId` instead of `workflowId`. Publishers (MCP middleware) call `publishToolCallLog(event)`; subscribers (the new `hermes-build-runner.ts`) consume and persist into `jkai_logs`.

**Files:**
- Create: `src/lib/jkai/tool-call-log-bus.ts`
- Create: `src/lib/jkai/tool-call-log-bus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/jkai/tool-call-log-bus.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  publishToolCallLog,
  subscribeToolCallLog,
  _resetToolCallLogBusForTests,
  type ToolCallLogEvent,
} from './tool-call-log-bus';

describe('tool-call-log-bus', () => {
  beforeEach(() => _resetToolCallLogBusForTests());

  it('delivers a published event to a subscribed buildId', () => {
    const received: ToolCallLogEvent[] = [];
    const unsub = subscribeToolCallLog('b_1', (e) => received.push(e));

    publishToolCallLog({
      buildId: 'b_1',
      callId: 'c_1',
      phase: 'start',
      tool: 'bash',
      args: { command: 'ls' },
      ts: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].phase).toBe('start');
    unsub();
  });

  it('does not deliver to other builds', () => {
    const received: ToolCallLogEvent[] = [];
    subscribeToolCallLog('b_2', (e) => received.push(e));

    publishToolCallLog({
      buildId: 'b_1',
      callId: 'c_1',
      phase: 'start',
      tool: 'bash',
      ts: Date.now(),
    });

    expect(received).toHaveLength(0);
  });

  it('unsubscribe stops delivery', () => {
    const received: ToolCallLogEvent[] = [];
    const unsub = subscribeToolCallLog('b_3', (e) => received.push(e));
    unsub();

    publishToolCallLog({
      buildId: 'b_3',
      callId: 'c_1',
      phase: 'start',
      tool: 'bash',
      ts: Date.now(),
    });

    expect(received).toHaveLength(0);
  });

  it('a thrown listener does not poison the publish loop', () => {
    const received: ToolCallLogEvent[] = [];
    subscribeToolCallLog('b_4', () => {
      throw new Error('boom');
    });
    subscribeToolCallLog('b_4', (e) => received.push(e));

    publishToolCallLog({
      buildId: 'b_4',
      callId: 'c_1',
      phase: 'start',
      tool: 'bash',
      ts: Date.now(),
    });

    expect(received).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test (expect failure)**

```bash
npx vitest run src/lib/jkai/tool-call-log-bus.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the bus**

Create `src/lib/jkai/tool-call-log-bus.ts`:

```typescript
// In-memory pub-sub for build tool-call log events.
//
// Mirror of the Phase 1 tool-step-bus.ts pattern, but for builds: publishers
// are MCP middleware (src/lib/mcp/jsonrpc.ts on tools/call), subscribers are
// the Phase 2 hermes-build-runner.ts which collects events for the duration
// of an iteration and writes them to jkai_logs as type='tool_call' rows.
//
// Why a bus rather than coupling executeTool to a DB write: the MCP server
// must stay generic (other kinds of calls from other clients don't write
// build logs). Routing via a bus keyed by buildId lets the build runner
// own the persistence decision without leaking build concerns into the MCP
// layer.
//
// In-memory; per-process; lost on SvelteKit restart. Soak runs against
// long-lived prod systemd; dev iteration is short-lived. Same trade-off as
// tool-step-bus.

export interface ToolCallLogEvent {
  buildId: string;
  callId: string;
  phase: 'start' | 'end';
  tool: string;
  args?: Record<string, unknown>;
  status?: 'ok' | 'error';
  durationMs?: number;
  error?: string;
  resultPreview?: string;
  ts: number;
}

type Listener = (e: ToolCallLogEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function publishToolCallLog(e: ToolCallLogEvent): void {
  const set = listeners.get(e.buildId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(e);
    } catch {
      // Best-effort bus: a thrown listener is dropped silently rather than
      // taking down the in-flight tool call.
    }
  }
}

export function subscribeToolCallLog(buildId: string, fn: Listener): () => void {
  if (!buildId) return () => {};
  let set = listeners.get(buildId);
  if (!set) {
    set = new Set();
    listeners.set(buildId, set);
  }
  set.add(fn);
  return () => {
    const current = listeners.get(buildId);
    if (!current) return;
    current.delete(fn);
    if (current.size === 0) listeners.delete(buildId);
  };
}

/** Test helper — reset listener state between unit tests. */
export function _resetToolCallLogBusForTests(): void {
  listeners.clear();
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
npx vitest run src/lib/jkai/tool-call-log-bus.test.ts 2>&1 | tail -5
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/tool-call-log-bus.ts src/lib/jkai/tool-call-log-bus.test.ts
git commit -m "feat(jkai): tool-call-log-bus — in-memory pub-sub for build tool-call events

Mirror of the Phase 1 tool-step-bus pattern, keyed by buildId. The
Phase 2 MCP middleware publishes start/end events for every tools/call
made under a build-scoped bearer; the new hermes-build-runner.ts
subscribes per iteration and persists into jkai_logs."
```

---

## Task 8: MCP middleware — publish tool-call log events for build-scoped calls (TDD)

**Goal:** In `src/lib/mcp/jsonrpc.ts`'s `tools/call` handler, when the caller's bearer-scope `kind === 'build'`, publish `tool_call_start` and `tool_call_end` events on the bus. The bearer is the static shared secret from Phase 1 (Direction 2 in the spec §5.4), so the *scope* isn't on the bearer itself — but the inbound request from Hermes carries a `Build-Id` request header set by the platform adapter when it forwards a build-kind chat's tool calls. Read the header; if present, publish.

**Files:**
- Modify: `src/lib/mcp/jsonrpc.ts`
- Modify: `src/lib/mcp/jsonrpc.test.ts`
- Modify (out-of-repo, see note): `~/.hermes-jkai/extensions/jkai_platform/adapter.py` — propagate `kind_id` as `Build-Id` header on MCP tool calls

Note on the header path: Hermes' MCP HTTP client doesn't allow per-call dynamic headers (spec §5.4) — the headers configured in `~/.hermes-jkai/config.yaml`'s `mcp_servers.jkai.headers` are gateway-scoped. The platform adapter cannot inject a per-call header either, because tool calls originate inside Hermes' agent loop, not in the adapter. The path that works: include the build_id in the existing chat context that Hermes passes through to MCP. Easiest concrete mechanism: add the build_id to the MCP **tool arguments** as a synthetic `_jkai_build_id` parameter that the SvelteKit MCP server strips before tool dispatch.

The skill (Task 6) is already required to pass `buildId` on `log_iteration` / `extend_deadline` / `build_*` tools. For tools that don't take a `buildId` (Hermes' built-in `bash`/`read_file`/etc.), those calls don't go through SvelteKit's MCP at all — they go through Hermes' terminal backend. So they don't need logging via MCP; they're invisible to MCP by design.

Bottom line: **only MCP tool calls under a build session need to be logged**, and **all such calls already carry an explicit `buildId` argument** (because the skill mandates it for the `build_*` family and the infra family).

This task therefore simplifies to: when `tools/call` is invoked with a `buildId` argument, publish to the bus.

- [ ] **Step 1: Read the current `tools/call` handler**

```bash
grep -n "tools/call\|executeTool" src/lib/mcp/jsonrpc.ts | head -10
```

Expected: a `case 'tools/call':` block, and a call to `executeTool` or similar dispatch.

- [ ] **Step 2: Write the failing test**

Append to `src/lib/mcp/jsonrpc.test.ts`:

```typescript
import {
  publishToolCallLog as _unused,
  subscribeToolCallLog,
  _resetToolCallLogBusForTests,
  type ToolCallLogEvent,
} from '$lib/jkai/tool-call-log-bus';

describe('MCP build-scoped tool-call logging', () => {
  beforeEach(() => _resetToolCallLogBusForTests());

  it('publishes start + end events when buildId is present in args', async () => {
    const events: ToolCallLogEvent[] = [];
    const unsub = subscribeToolCallLog('b_test', (e) => events.push(e));

    const { response } = await dispatchJsonRpc(
      {
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: { name: 'build_get_logs', arguments: { buildId: 'b_test', limit: 5 } },
      },
      { authBearer: SECRET },
    );

    // Two events fired regardless of tool success or failure
    expect(events).toHaveLength(2);
    expect(events[0].phase).toBe('start');
    expect(events[0].tool).toBe('build_get_logs');
    expect(events[1].phase).toBe('end');
    unsub();
  });

  it('publishes nothing when buildId is absent (non-build tool call)', async () => {
    const events: ToolCallLogEvent[] = [];
    subscribeToolCallLog('b_test', (e) => events.push(e));

    await dispatchJsonRpc(
      {
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: { name: 'workflow_list', arguments: {} },
      },
      { authBearer: SECRET },
    );

    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run (expect failure)**

```bash
npx vitest run src/lib/mcp/jsonrpc.test.ts 2>&1 | tail -10
```

Expected: 2 new tests fail — no publish wiring yet.

- [ ] **Step 4: Wire the middleware**

Open `src/lib/mcp/jsonrpc.ts`. Find the `case 'tools/call':` block. Wrap the existing dispatch with start/end publishing:

```typescript
// At the top of the file, add the import:
import { publishToolCallLog } from '$lib/jkai/tool-call-log-bus';

// Inside case 'tools/call':
const args = (params.arguments ?? {}) as Record<string, unknown>;
const buildId = typeof args.buildId === 'string' ? args.buildId : null;
const callId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const startTs = Date.now();

if (buildId) {
  publishToolCallLog({
    buildId,
    callId,
    phase: 'start',
    tool: params.name,
    args: args,
    ts: startTs,
  });
}

try {
  const result = await executeTool(params.name, args); // existing dispatch line
  if (buildId) {
    publishToolCallLog({
      buildId,
      callId,
      phase: 'end',
      tool: params.name,
      status: 'ok',
      durationMs: Date.now() - startTs,
      resultPreview: JSON.stringify(result).slice(0, 500),
      ts: Date.now(),
    });
  }
  return { /* existing success response */ };
} catch (err) {
  if (buildId) {
    publishToolCallLog({
      buildId,
      callId,
      phase: 'end',
      tool: params.name,
      status: 'error',
      durationMs: Date.now() - startTs,
      error: err instanceof Error ? err.message : String(err),
      ts: Date.now(),
    });
  }
  throw err;
}
```

Adapt the exact shape to match the actual existing handler (the example assumes a `result` and exception-shaped error path; if the existing handler uses a `Result<T, E>` envelope, mirror that).

- [ ] **Step 5: Run the tests (expect pass)**

```bash
npx vitest run src/lib/mcp/jsonrpc.test.ts 2>&1 | tail -10
```

Expected: all existing tests still pass + the 2 new tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/jsonrpc.ts src/lib/mcp/jsonrpc.test.ts
git commit -m "feat(mcp): publish tool-call log events for build-scoped calls

When tools/call carries a buildId argument, publish start + end
events to the tool-call-log-bus. The hermes-build-runner (Task 11)
subscribes per iteration and persists into jkai_logs.

Non-build tool calls (workflow_*, blog_*, etc.) emit nothing —
the bus is per-build and silent for the canvas + general chat
paths."
```

---

## Task 9: `build_infra` tools — `log_iteration`, `log_tool_call`-helper, register on registry (TDD)

**Goal:** Add two MCP-only tools the `jkai-build` skill can call:

- **`log_iteration(iterationId, role, content, metadata?)`** — INSERT a row into `jkai_logs` with `type='iteration_summary'` (a new log-type discriminator) so the executor + UI can identify the structured eval/next-steps row.

- **`log_tool_call(...)`** — *NOT* exposed to the agent. The bus mechanism in Task 8 already covers this. Skip; the spec mentioned it as one of three infra tools but Task 8's middleware obsoletes the explicit tool. Document in the commit message.

The third tool, `extend_deadline`, lives in the existing `builds.ts` domain (Task 10).

`mark_phase` is deferred per the original kickoff — it's a UI polish concern, low-priority for Phase 2.

**Files:**
- Create: `src/lib/workflows/site-tools/tools/build-infra.ts`
- Create: `src/lib/workflows/site-tools/tools/build-infra.test.ts`
- Modify: site-tools registry (the file that aggregates all tool exports — likely `src/lib/workflows/site-tools/registry.ts` or an `index.ts` at that directory; check during execution).

- [ ] **Step 1: Locate the registry**

```bash
grep -rln "builds\|workflows-domain\|getToolsByToolset" src/lib/workflows/site-tools/ | head -5
ls src/lib/workflows/site-tools/
```

Expected: one of `registry.ts`, `index.ts`, or similar. Read it to see how `blog`, `gmail`, `builds` etc. are wired in.

- [ ] **Step 2: Write the failing test**

Create `src/lib/workflows/site-tools/tools/build-infra.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { logIterationHandler } from './build-infra';

describe('build_infra MCP tools', () => {
  let buildId: string;
  let iterationId: string;

  beforeEach(async () => {
    const [b] = await db.insert(jkaiBuilds).values({ prompt: 'test', status: 'pending' }).returning();
    buildId = b.id;
    const [it] = await db.insert(jkaiIterations).values({ buildId, number: 0 }).returning();
    iterationId = it.id;
  });

  afterEach(async () => {
    await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  });

  it('log_iteration writes a row to jkai_logs', async () => {
    const result = await logIterationHandler({
      iterationId,
      role: 'assistant',
      content: '## Evaluation\nServer is up.\n\n## Next Steps\n1. Add theme toggle.',
    });

    expect(result.ok).toBe(true);

    const rows = await db.select().from(jkaiLogs).where(eq(jkaiLogs.iterationId, iterationId));
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('iteration_summary');
    expect(rows[0].content).toContain('## Evaluation');
    expect(rows[0].buildId).toBe(buildId);
  });

  it('log_iteration rejects an unknown iterationId', async () => {
    const result = await logIterationHandler({
      iterationId: 'iter_does_not_exist',
      role: 'assistant',
      content: 'test',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/iteration/i);
  });

  it('log_iteration accepts optional metadata jsonb', async () => {
    const result = await logIterationHandler({
      iterationId,
      role: 'assistant',
      content: 'eval',
      metadata: { completion: 0.45, tokensUsed: 1200 },
    });

    expect(result.ok).toBe(true);

    const rows = await db.select().from(jkaiLogs).where(eq(jkaiLogs.iterationId, iterationId));
    expect(rows[0].content).toContain('eval');
    // metadata is included in content as a JSON suffix or in a separate column —
    // the implementation decides; the test asserts persistence happens.
  });
});
```

- [ ] **Step 3: Run (expect failure)**

```bash
npx vitest run src/lib/workflows/site-tools/tools/build-infra.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the tool**

Create `src/lib/workflows/site-tools/tools/build-infra.ts`:

```typescript
import { z } from 'zod';
import { db } from '$lib/db';
import { jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ToolDef } from '../types'; // adjust import to whatever the registry uses

const LogIterationArgs = z.object({
  iterationId: z.string().min(1),
  role: z.enum(['assistant', 'system']).default('assistant'),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export type LogIterationInput = z.infer<typeof LogIterationArgs>;

export async function logIterationHandler(
  input: LogIterationInput,
): Promise<{ ok: true; logId: number } | { ok: false; error: string }> {
  const parsed = LogIterationArgs.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: `Invalid args: ${parsed.error.message}` };
  }

  const [iter] = await db
    .select({ buildId: jkaiIterations.buildId })
    .from(jkaiIterations)
    .where(eq(jkaiIterations.id, parsed.data.iterationId));

  if (!iter) {
    return { ok: false, error: `Iteration not found: ${parsed.data.iterationId}` };
  }

  // Append metadata into content as a fenced JSON block — keeps the schema
  // unchanged (jkai_logs has no metadata jsonb column today).
  const suffix = parsed.data.metadata
    ? `\n\n\`\`\`json\n${JSON.stringify(parsed.data.metadata, null, 2)}\n\`\`\``
    : '';

  const [row] = await db
    .insert(jkaiLogs)
    .values({
      buildId: iter.buildId,
      iterationId: parsed.data.iterationId,
      type: 'iteration_summary',
      content: parsed.data.content + suffix,
    })
    .returning({ id: jkaiLogs.id });

  return { ok: true, logId: row.id };
}

export const logIterationTool: ToolDef = {
  name: 'log_iteration',
  description:
    'Persist a structured iteration summary (## Evaluation + ## Next Steps and optional metadata) into the build log. Called by the jkai-build skill at the end of every iteration.',
  toolset: 'builds',
  parameters: {
    type: 'object',
    properties: {
      iterationId: { type: 'string', description: 'The current iteration id from the iteration context.' },
      role: { type: 'string', enum: ['assistant', 'system'], default: 'assistant' },
      content: { type: 'string', description: 'The full ## Evaluation + ## Next Steps text.' },
      metadata: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional jsonb-shaped metadata (completion %, tokensUsed, blocker flags).',
      },
    },
    required: ['iterationId', 'content'],
  },
  handler: logIterationHandler,
};

export const tools: ToolDef[] = [logIterationTool];
```

(Adjust `ToolDef` import + the export shape to match the actual registry pattern — read `src/lib/workflows/site-tools/tools/builds.ts` for the canonical example.)

- [ ] **Step 5: Register the tools**

Open the site-tools registry. Find where `builds`, `blog`, etc. are listed (likely an array import + flatten). Add:

```typescript
import { tools as buildInfraTools } from './tools/build-infra';
// ... in the aggregation:
const ALL_TOOLS = [
  ...workflowTools,
  ...blogTools,
  // ... existing ...
  ...buildInfraTools,
];
```

- [ ] **Step 6: Run the tests (expect pass)**

```bash
npx vitest run src/lib/workflows/site-tools/tools/build-infra.test.ts 2>&1 | tail -5
```

Expected: 3/3 PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/workflows/site-tools/tools/build-infra.ts src/lib/workflows/site-tools/tools/build-infra.test.ts src/lib/workflows/site-tools/registry.ts
git commit -m "feat(build): log_iteration MCP tool + register in site-tools

Phase 2: the jkai-build skill calls log_iteration at the end of every
iteration to persist ## Evaluation + ## Next Steps into jkai_logs
with type='iteration_summary'. Falls back to text-parsing in
executor.ts if the agent forgets — but the structured call is more
reliable.

log_tool_call is intentionally NOT a separate tool: Task 8's MCP
middleware on tools/call already publishes events to the
tool-call-log-bus, which the hermes-build-runner persists. Exposing
the tool to the agent would duplicate work and let the agent skip
logging by not calling it.

mark_phase is deferred — UI polish, not Phase 2 critical path."
```

---

## Task 10: `extend_deadline` tool + `build-deadline.ts` helpers (TDD)

**Goal:** Add `extend_deadline(buildId, additionalMinutes)` as a MCP tool that updates `jkai_builds.deadline_at`. Refactor read/write into a small `build-deadline.ts` module so the executor can also use the same setters/getters.

**Files:**
- Create: `src/lib/jkai/build-deadline.ts`
- Create: `src/lib/jkai/build-deadline.test.ts`
- Modify: `src/lib/workflows/site-tools/tools/builds.ts` — add `extendDeadlineTool` and handler

- [ ] **Step 1: Write the failing helper test**

Create `src/lib/jkai/build-deadline.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { setDeadline, extendDeadline, getRemainingMs } from './build-deadline';

describe('build-deadline helpers', () => {
  let buildId: string;

  beforeEach(async () => {
    const [b] = await db.insert(jkaiBuilds).values({ prompt: 'x', status: 'running' }).returning();
    buildId = b.id;
  });

  afterEach(async () => {
    await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  });

  it('setDeadline writes a UTC timestamp', async () => {
    const target = Date.now() + 15 * 60 * 1000;
    await setDeadline(buildId, target);

    const [row] = await db.select({ deadlineAt: jkaiBuilds.deadlineAt }).from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    expect(row.deadlineAt).not.toBeNull();
    expect(Math.abs(row.deadlineAt!.getTime() - target)).toBeLessThan(1000);
  });

  it('getRemainingMs returns ms until deadline, or null when unset', async () => {
    expect(await getRemainingMs(buildId)).toBeNull();

    await setDeadline(buildId, Date.now() + 10 * 60 * 1000);
    const remaining = await getRemainingMs(buildId);
    expect(remaining).toBeGreaterThan(9 * 60 * 1000);
    expect(remaining).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it('extendDeadline adds minutes to the existing deadline', async () => {
    const initial = Date.now() + 5 * 60 * 1000;
    await setDeadline(buildId, initial);

    await extendDeadline(buildId, 10);

    const remaining = await getRemainingMs(buildId);
    expect(remaining).toBeGreaterThan(14 * 60 * 1000);
    expect(remaining).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('extendDeadline caps at 30-minute single extension', async () => {
    await setDeadline(buildId, Date.now() + 5 * 60 * 1000);
    const result = await extendDeadline(buildId, 60);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/30/);
  });

  it('extendDeadline initialises from now() when no deadline is set', async () => {
    const result = await extendDeadline(buildId, 10);
    expect(result.ok).toBe(true);
    const remaining = await getRemainingMs(buildId);
    expect(remaining).toBeGreaterThan(9 * 60 * 1000);
    expect(remaining).toBeLessThanOrEqual(10 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run (expect failure)**

```bash
npx vitest run src/lib/jkai/build-deadline.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `build-deadline.ts`**

Create `src/lib/jkai/build-deadline.ts`:

```typescript
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

const MAX_EXTEND_MINUTES = 30;

export async function setDeadline(buildId: string, deadlineMs: number): Promise<void> {
  await db
    .update(jkaiBuilds)
    .set({ deadlineAt: new Date(deadlineMs) })
    .where(eq(jkaiBuilds.id, buildId));
}

export async function clearDeadline(buildId: string): Promise<void> {
  await db
    .update(jkaiBuilds)
    .set({ deadlineAt: null })
    .where(eq(jkaiBuilds.id, buildId));
}

export async function getRemainingMs(buildId: string): Promise<number | null> {
  const [row] = await db
    .select({ deadlineAt: jkaiBuilds.deadlineAt })
    .from(jkaiBuilds)
    .where(eq(jkaiBuilds.id, buildId));
  if (!row || !row.deadlineAt) return null;
  return row.deadlineAt.getTime() - Date.now();
}

export async function extendDeadline(
  buildId: string,
  additionalMinutes: number,
): Promise<{ ok: true; newDeadlineMs: number } | { ok: false; error: string }> {
  if (!Number.isFinite(additionalMinutes) || additionalMinutes <= 0) {
    return { ok: false, error: 'additionalMinutes must be a positive number' };
  }
  if (additionalMinutes > MAX_EXTEND_MINUTES) {
    return { ok: false, error: `Single extension capped at ${MAX_EXTEND_MINUTES} minutes` };
  }

  const [row] = await db
    .select({ deadlineAt: jkaiBuilds.deadlineAt })
    .from(jkaiBuilds)
    .where(eq(jkaiBuilds.id, buildId));

  if (!row) return { ok: false, error: `Build not found: ${buildId}` };

  const base = row.deadlineAt ? row.deadlineAt.getTime() : Date.now();
  const newDeadlineMs = base + additionalMinutes * 60 * 1000;

  await setDeadline(buildId, newDeadlineMs);
  return { ok: true, newDeadlineMs };
}
```

- [ ] **Step 4: Run helper tests (expect pass)**

```bash
npx vitest run src/lib/jkai/build-deadline.test.ts 2>&1 | tail -5
```

Expected: 5/5 PASS.

- [ ] **Step 5: Add `extend_deadline` to `builds.ts`**

Open `src/lib/workflows/site-tools/tools/builds.ts`. After the existing tool definitions, add:

```typescript
import { extendDeadline } from '$lib/jkai/build-deadline';
import { z } from 'zod';

const ExtendDeadlineArgs = z.object({
  buildId: z.string().min(1),
  additionalMinutes: z.number().positive().max(30),
});

export const extendDeadlineTool: ToolDef = {
  name: 'extend_deadline',
  description:
    'Extend the current build iteration\'s wall-clock deadline by N minutes (max 30 in a single call; chain calls for longer extensions). Use when an iteration needs more time than the initial budget — e.g. a long npm install. The skill is expected to acknowledge the extension in its ## Evaluation.',
  toolset: 'builds',
  parameters: {
    type: 'object',
    properties: {
      buildId: { type: 'string', description: 'The current build id from the session.' },
      additionalMinutes: { type: 'number', minimum: 1, maximum: 30 },
    },
    required: ['buildId', 'additionalMinutes'],
  },
  handler: async (args) => {
    const parsed = ExtendDeadlineArgs.safeParse(args);
    if (!parsed.success) return { ok: false, error: `Invalid args: ${parsed.error.message}` };
    return extendDeadline(parsed.data.buildId, parsed.data.additionalMinutes);
  },
};
```

Add `extendDeadlineTool` to the tools array exported at the bottom of `builds.ts`:

```typescript
export const tools: ToolDef[] = [
  // ... existing 12 tools ...
  extendDeadlineTool,
];
```

- [ ] **Step 6: Add a tool-level test**

Open or create `src/lib/workflows/site-tools/tools/builds.test.ts`. Append:

```typescript
import { extendDeadlineTool } from './builds';

describe('extend_deadline tool', () => {
  it('extends deadline_at on the build row', async () => {
    const [b] = await db.insert(jkaiBuilds).values({ prompt: 't', status: 'running' }).returning();
    const result = await extendDeadlineTool.handler({ buildId: b.id, additionalMinutes: 10 });
    expect(result.ok).toBe(true);

    const [row] = await db
      .select({ deadlineAt: jkaiBuilds.deadlineAt })
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.id, b.id));
    expect(row.deadlineAt!.getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);

    await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, b.id));
  });

  it('rejects > 30 minutes', async () => {
    const [b] = await db.insert(jkaiBuilds).values({ prompt: 't', status: 'running' }).returning();
    const result = await extendDeadlineTool.handler({ buildId: b.id, additionalMinutes: 45 });
    expect(result.ok).toBe(false);
    await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, b.id));
  });
});
```

(Adjust imports — `db`, `jkaiBuilds`, `eq` — to match the file's existing pattern.)

- [ ] **Step 7: Run all build-related tests**

```bash
npx vitest run src/lib/jkai/build-deadline.test.ts src/lib/workflows/site-tools/tools/builds.test.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/jkai/build-deadline.ts src/lib/jkai/build-deadline.test.ts src/lib/workflows/site-tools/tools/builds.ts src/lib/workflows/site-tools/tools/builds.test.ts
git commit -m "feat(build): extend_deadline MCP tool + build-deadline helpers

DB-backed deadline column replaces pi-runner's in-memory deadlineRef
polling. The jkai-build skill calls extend_deadline mid-iteration
when it needs more wall-clock time; the orchestrator reads
remainingMs via getRemainingMs() and includes it in the iteration
context.

Single-call cap: 30 minutes. Chain calls for longer extensions —
keeps a runaway iteration from doubling the budget in one tool call.

Helpers (setDeadline / clearDeadline / getRemainingMs /
extendDeadline) live in src/lib/jkai/build-deadline.ts so the
executor, the MCP tool, and the failure classifier all share one
canonical implementation."
```

---

## Task 11: `failure-classifier.ts` — port Pi failure classification (TDD)

**Goal:** Port `classifyFailure()` from `pi-runner.ts` into a standalone module so the new Hermes runner can call the same classifier on Hermes-shaped errors. The classifier returns a `FailureEnvelope | null` matching the existing `jkaiIterations.failure` jsonb schema.

**Files:**
- Create: `src/lib/jkai/failure-classifier.ts`
- Create: `src/lib/jkai/failure-classifier.test.ts`

- [ ] **Step 1: Read the pi-runner classifier**

```bash
sed -n '514,591p' src/lib/jkai/pi-runner.ts
```

Capture: input shape (`ClassifyInput`), the 6 case branches (`auth_failed`, `rate_limited`, `wall_clock_timeout`, `stalled`, `container_missing`, `provider_error`, `nonzero_exit`), and the `base()` helper.

- [ ] **Step 2: Write the failing test**

Create `src/lib/jkai/failure-classifier.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { classifyHermesFailure, type ClassifyHermesInput } from './failure-classifier';

const baseInput: ClassifyHermesInput = {
  stalled: false,
  stalledAgeMs: 0,
  wallClockHit: false,
  errorMessage: null,
  providerHttpStatus: undefined,
  providerErrorCode: undefined,
  sseClosed: false,
  noToolCalls: false,
  maxWallClockMs: 30 * 60 * 1000,
  tokensUsed: 0,
};

describe('classifyHermesFailure', () => {
  it('returns null on a clean run', () => {
    expect(classifyHermesFailure(baseInput)).toBeNull();
  });

  it('classifies wall-clock timeout', () => {
    const f = classifyHermesFailure({ ...baseInput, wallClockHit: true });
    expect(f?.kind).toBe('wall_clock_timeout');
  });

  it('classifies stalled SSE', () => {
    const f = classifyHermesFailure({ ...baseInput, stalled: true, stalledAgeMs: 200_000 });
    expect(f?.kind).toBe('stalled');
    expect(f?.lastEventAgeMs).toBe(200_000);
  });

  it('classifies provider auth failure from 401', () => {
    const f = classifyHermesFailure({ ...baseInput, providerHttpStatus: 401, errorMessage: 'unauthorized' });
    expect(f?.kind).toBe('auth_failed');
  });

  it('classifies rate limit from 429', () => {
    const f = classifyHermesFailure({ ...baseInput, providerHttpStatus: 429 });
    expect(f?.kind).toBe('rate_limited');
  });

  it('classifies container_missing on Hermes Docker start failure', () => {
    const f = classifyHermesFailure({
      ...baseInput,
      errorMessage:
        'docker: Error response from daemon: pull access denied for jkai-sandbox, repository does not exist or may require docker login',
    });
    expect(f?.kind).toBe('container_missing');
  });

  it('classifies container_missing on docker socket / daemon errors', () => {
    const f = classifyHermesFailure({
      ...baseInput,
      errorMessage: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock',
    });
    expect(f?.kind).toBe('container_missing');
  });

  it('classifies provider error when errorMessage present and no other signal', () => {
    const f = classifyHermesFailure({ ...baseInput, errorMessage: 'model returned bad json' });
    expect(f?.kind).toBe('provider_error');
  });

  it('does not classify empty_output (executor owns that)', () => {
    const f = classifyHermesFailure({ ...baseInput, noToolCalls: true });
    expect(f).toBeNull();
  });
});
```

- [ ] **Step 3: Run (expect failure)**

```bash
npx vitest run src/lib/jkai/failure-classifier.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the classifier**

Create `src/lib/jkai/failure-classifier.ts`:

```typescript
import type { FailureEnvelope, FailureKind } from './types';

export interface ClassifyHermesInput {
  stalled: boolean;
  stalledAgeMs: number;
  wallClockHit: boolean;
  errorMessage: string | null;
  providerHttpStatus: number | undefined;
  providerErrorCode: string | undefined;
  sseClosed: boolean;
  noToolCalls: boolean; // informational only — executor classifies empty_output
  maxWallClockMs: number;
  tokensUsed: number;
}

export function classifyHermesFailure(i: ClassifyHermesInput): FailureEnvelope | null {
  const errLc = (i.errorMessage ?? '').toLowerCase();

  // Auth failure — check first
  if (
    i.providerHttpStatus === 401 ||
    i.providerHttpStatus === 403 ||
    /401|403|unauthorized|forbidden|invalid[\s-]*api[\s-]*key/.test(errLc)
  ) {
    return base('auth_failed', i.errorMessage ?? 'Provider rejected the API key.', i);
  }

  // Rate limited
  if (i.providerHttpStatus === 429 || /429|rate[\s_-]*limit/.test(errLc)) {
    return base('rate_limited', i.errorMessage ?? 'Provider rate limit hit.', i);
  }

  if (i.wallClockHit) {
    return base(
      'wall_clock_timeout',
      `Hermes session exceeded wall-clock cap (${Math.round(i.maxWallClockMs / 1000)}s).`,
      i,
    );
  }

  if (i.stalled) {
    return base(
      'stalled',
      i.tokensUsed > 0
        ? `Hermes SSE went quiet for ${Math.round(i.stalledAgeMs / 1000)}s mid-flight.`
        : `Hermes returned no SSE frames within ${Math.round(i.stalledAgeMs / 1000)}s.`,
      i,
    );
  }

  // Docker-specific failures (Hermes Docker backend couldn't spin/find the per-build container)
  if (
    /docker.*daemon|docker.sock|cannot connect to the docker daemon|no such image|pull access denied|image not found|repository does not exist/.test(errLc) ||
    /^docker: error/.test(errLc) ||
    /container .* (not found|exited|already in use)/.test(errLc)
  ) {
    return base('container_missing', i.errorMessage ?? 'Hermes Docker backend failed to start the per-build container.', i);
  }

  // Generic provider error with an explicit message
  if (i.errorMessage) {
    return base('provider_error', i.errorMessage, i);
  }

  // empty_output is NOT classified here — the executor decides that based on
  // actions.length vs noToolCalls, because classifyHermesFailure can't tell
  // "agent did nothing wrong" from "agent legitimately finished with no
  // tool calls".
  return null;
}

function base(kind: FailureKind, message: string, i: ClassifyHermesInput): FailureEnvelope {
  return {
    kind,
    message,
    httpStatus: i.providerHttpStatus,
    providerErrorCode: i.providerErrorCode,
    lastEventAgeMs: i.stalled ? i.stalledAgeMs : undefined,
    tokensBeforeStall: i.stalled ? i.tokensUsed : undefined,
    attempts: 1,
  };
}
```

`FailureKind` in `src/lib/jkai/types.ts` already includes `'container_missing'` (Pi historically classified docker exec failures with this kind). Confirm it's present and keep using it; no enum change required:

```typescript
// In src/lib/jkai/types.ts — already present, no change needed
export type FailureKind =
  | 'stalled'
  | 'wall_clock_timeout'
  | 'container_missing'   // Pi: docker exec failure; Hermes Phase 2: Docker daemon / image / start failure
  | 'auth_failed'
  | 'rate_limited'
  | 'provider_error'
  | 'nonzero_exit'
  | 'empty_output';
```

- [ ] **Step 5: Run (expect pass)**

```bash
npx vitest run src/lib/jkai/failure-classifier.test.ts 2>&1 | tail -5
```

Expected: 9/9 PASS (the 2 container_missing cases replace the 1 ssh_unreachable case, so +1 overall vs the SSH variant).

- [ ] **Step 6: Commit**

```bash
git add src/lib/jkai/failure-classifier.ts src/lib/jkai/failure-classifier.test.ts src/lib/jkai/types.ts
git commit -m "feat(jkai): failure-classifier.ts — Hermes-aware failure mapping

Port classifyFailure() from pi-runner.ts into a standalone classifier
the new hermes-build-runner can call. Reuses the existing
container_missing kind for Hermes Docker daemon / image / start
failures (Phase 2 runs per-build hermes-<id> containers via the
adapter's register_task_env_overrides hook). Otherwise mirrors the
existing cases (stalled, wall_clock_timeout, auth_failed,
rate_limited, provider_error).

container_missing covers both the Pi era (docker exec failure
against the singleton jkai-sandbox) and the Hermes era (docker run
failure spinning a per-build ephemeral container) — the failure
shape is the same from the user's perspective, only the diagnostic
message differs."
```

---

## Task 12: `hermes-build-runner.ts` — the new runPi replacement (TDD)

**Goal:** A drop-in for `runPi(...)` from `executor.ts`'s perspective. It accepts the same `opts` shape, posts to Hermes via `HermesClient.sendMessage`, subscribes to the outbound SSE stream, collects the final assistant text, subscribes to the `tool-call-log-bus` for the iteration's duration, writes `jkai_logs` rows for each tool call, classifies failure on completion, and returns a `PiRunResult`-shaped value.

**Files:**
- Create: `src/lib/jkai/hermes-build-runner.ts`
- Create: `src/lib/jkai/hermes-build-runner.test.ts`

- [ ] **Step 1: Re-read the runPi entry shape**

```bash
grep -n "interface PiRunOptions\|interface PiRunResult\|export async function runPi" src/lib/jkai/pi-runner.ts | head -5
sed -n '60,90p' src/lib/jkai/pi-runner.ts
```

Capture: `PiRunResult` has `actions, messages, finalAssistantText, tokensUsed, errorMessage, failure`. The new runner returns the same shape.

- [ ] **Step 2: Write the failing test**

Create `src/lib/jkai/hermes-build-runner.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  publishToolCallLog,
  _resetToolCallLogBusForTests,
} from './tool-call-log-bus';
import { runHermesBuild } from './hermes-build-runner';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

// Mock the HermesClient
vi.mock('./hermes-client', () => {
  return {
    HermesClient: vi.fn().mockImplementation(() => ({
      sendMessage: vi.fn().mockResolvedValue({ accepted: true, chatId: 'b_test' }),
      openStream: vi.fn().mockImplementation(async function* () {
        // simulate 3 frames: send, replace, finalize
        yield {
          kind: 'send',
          chat_id: 'b_test',
          message_id: 'm_1',
          content: 'Working on it…',
          metadata: {},
          ts: Date.now(),
        };
        yield {
          kind: 'replace',
          chat_id: 'b_test',
          message_id: 'm_1',
          content: 'Working on it…\n\nDone.',
          metadata: {},
          ts: Date.now(),
        };
        yield {
          kind: 'finalize',
          chat_id: 'b_test',
          message_id: 'm_1',
          content:
            'Working on it…\n\nDone.\n\n## Evaluation\nServer up.\n\n## Next Steps\n1. Add theme toggle.',
          metadata: { usage: { input: 1200, output: 400, total: 1600 } },
          ts: Date.now(),
        };
      }),
    })),
  };
});

describe('runHermesBuild', () => {
  let buildId: string;
  let iterationId: string;

  beforeEach(async () => {
    _resetToolCallLogBusForTests();
    const [b] = await db
      .insert(jkaiBuilds)
      .values({ prompt: 'test', status: 'running', modelId: 'glm-5.1', modelProvider: 'zai' })
      .returning();
    buildId = b.id;
    const [it] = await db.insert(jkaiIterations).values({ buildId, number: 1 }).returning();
    iterationId = it.id;
  });

  it('returns a PiRunResult-shaped object with finalAssistantText', async () => {
    const result = await runHermesBuild({
      build: { id: buildId, prompt: 'x' } as any,
      iteration: { id: iterationId } as any,
      workdir: `/home/jkai/workspace/${buildId}/dev`,
      systemPrompt: 'sys',
      userPrompt: 'go',
      isStopped: () => false,
    });

    expect(result.finalAssistantText).toContain('## Evaluation');
    expect(result.finalAssistantText).toContain('## Next Steps');
    expect(result.tokensUsed).toBe(1600);
    expect(result.failure).toBeNull();
  });

  it('persists tool-call events fired during the iteration into jkai_logs', async () => {
    const promise = runHermesBuild({
      build: { id: buildId, prompt: 'x' } as any,
      iteration: { id: iterationId } as any,
      workdir: `/home/jkai/workspace/${buildId}/dev`,
      systemPrompt: 'sys',
      userPrompt: 'go',
      isStopped: () => false,
    });

    // Simulate the MCP middleware publishing a tool-call event mid-iteration
    publishToolCallLog({
      buildId,
      callId: 'c_1',
      phase: 'start',
      tool: 'log_iteration',
      args: { iterationId, content: 'eval' },
      ts: Date.now(),
    });
    publishToolCallLog({
      buildId,
      callId: 'c_1',
      phase: 'end',
      tool: 'log_iteration',
      status: 'ok',
      durationMs: 25,
      ts: Date.now(),
    });

    await promise;

    const rows = await db.select().from(jkaiLogs).where(eq(jkaiLogs.buildId, buildId));
    const toolCallRows = rows.filter((r) => r.type === 'tool_call');
    expect(toolCallRows.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 3: Run (expect failure)**

```bash
npx vitest run src/lib/jkai/hermes-build-runner.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the runner**

Create `src/lib/jkai/hermes-build-runner.ts`:

```typescript
import { env } from '$env/dynamic/private';
import { HermesClient } from './hermes-client';
import { subscribeToolCallLog, type ToolCallLogEvent } from './tool-call-log-bus';
import { db } from '$lib/db';
import { jkaiLogs, jkaiIterations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { emitLog } from './log-emitter';
import { classifyHermesFailure } from './failure-classifier';
import { extractSection } from './executor';
import type { ActionRecord, FailureEnvelope } from './types';
import type { JkaiBuild, JkaiIteration } from '$lib/db/schema';

export interface HermesBuildRunOptions {
  build: JkaiBuild;
  iteration: JkaiIteration;
  workdir: string;
  systemPrompt: string;
  userPrompt: string;
  isStopped: () => boolean;
  deadlineRef?: { current: number };
  extraEnv?: Record<string, string>;
}

export interface PiRunResult {
  actions: ActionRecord[];
  messages: Array<{ role: string; content: string }>;
  finalAssistantText: string;
  tokensUsed: number;
  errorMessage: string | null;
  failure: FailureEnvelope | null;
}

const HERMES_BASE_URL = env.HERMES_BASE_URL || 'http://127.0.0.1:18790';
const HERMES_BRIDGE_SECRET = env.HERMES_BRIDGE_SECRET;
const IDLE_STREAM_MS = 180_000; // 3 min — same as pi-runner

export async function runHermesBuild(opts: HermesBuildRunOptions): Promise<PiRunResult> {
  if (!HERMES_BRIDGE_SECRET) {
    throw new Error('HERMES_BRIDGE_SECRET not set — cannot run Hermes-backed build');
  }

  const client = new HermesClient({
    baseUrl: HERMES_BASE_URL,
    bridgeSecret: HERMES_BRIDGE_SECRET,
  });

  const buildId = opts.build.id;
  const iterationId = opts.iteration.id;
  const sessionCtx = {
    chatId: buildId,
    kind: 'build' as const,
    kindId: buildId,
    sessionId: `iter_${iterationId}`,
  };

  // Subscribe to tool-call events for this build for the duration of the iter.
  const collectedEvents: ToolCallLogEvent[] = [];
  const unsub = subscribeToolCallLog(buildId, (e) => {
    collectedEvents.push(e);
  });

  let finalAssistantText = '';
  let tokensUsed = 0;
  let errorMessage: string | null = null;
  let stalled = false;
  let stalledAgeMs = 0;
  let lastFrameTs = Date.now();
  const startTs = Date.now();
  const maxWallClockMs = opts.deadlineRef
    ? Math.max(60_000, opts.deadlineRef.current - Date.now())
    : 30 * 60 * 1000;

  try {
    await client.sendMessage({ ...sessionCtx, text: `${opts.systemPrompt}\n\n---\n\n${opts.userPrompt}` });

    // Iterate over the SSE stream until finalize, idle-stall, or stopped.
    const stream = client.openStream(sessionCtx);
    const idleTimer = setInterval(() => {
      if (Date.now() - lastFrameTs > IDLE_STREAM_MS) {
        stalled = true;
        stalledAgeMs = Date.now() - lastFrameTs;
      }
    }, 5000);

    try {
      for await (const frame of stream) {
        lastFrameTs = Date.now();
        if (opts.isStopped()) break;
        if (stalled) break;
        if (Date.now() - startTs > maxWallClockMs) break;

        if (frame.kind === 'send' || frame.kind === 'replace') {
          finalAssistantText = frame.content;
        } else if (frame.kind === 'finalize') {
          finalAssistantText = frame.content;
          const usage = (frame.metadata?.usage ?? null) as { total?: number; output?: number; input?: number } | null;
          if (usage) tokensUsed = usage.total ?? (usage.input ?? 0) + (usage.output ?? 0);
          break;
        }
      }
    } finally {
      clearInterval(idleTimer);
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    unsub();
  }

  // Persist collected tool-call events into jkai_logs as type='tool_call' rows.
  for (const ev of collectedEvents) {
    await db.insert(jkaiLogs).values({
      buildId,
      iterationId,
      type: 'tool_call',
      content: JSON.stringify({
        callId: ev.callId,
        phase: ev.phase,
        tool: ev.tool,
        args: ev.phase === 'start' ? ev.args : undefined,
        status: ev.status,
        durationMs: ev.durationMs,
        error: ev.error,
        resultPreview: ev.resultPreview,
        ts: ev.ts,
      }),
    });
  }

  // Append the final assistant text as a 'text' log row.
  if (finalAssistantText) {
    await emitLog(buildId, 'text', finalAssistantText.slice(0, 50_000), iterationId);
  }

  // Build action records from tool-call events for the iteration's actions jsonb.
  const actions: ActionRecord[] = [];
  const startsById = new Map<string, ToolCallLogEvent>();
  for (const ev of collectedEvents) {
    if (ev.phase === 'start') startsById.set(ev.callId, ev);
    if (ev.phase === 'end') {
      const startEv = startsById.get(ev.callId);
      actions.push({
        tool: ev.tool,
        args: (startEv?.args ?? {}) as Record<string, unknown>,
        result: ev.resultPreview ?? '',
        success: ev.status !== 'error',
        durationMs: ev.durationMs ?? 0,
        ts: ev.ts,
      } as ActionRecord);
    }
  }

  const failure = classifyHermesFailure({
    stalled,
    stalledAgeMs,
    wallClockHit: Date.now() - startTs >= maxWallClockMs,
    errorMessage,
    providerHttpStatus: undefined,
    providerErrorCode: undefined,
    sseClosed: false,
    noToolCalls: actions.length === 0,
    maxWallClockMs,
    tokensUsed,
  });

  return {
    actions,
    messages: [{ role: 'assistant', content: finalAssistantText }],
    finalAssistantText,
    tokensUsed,
    errorMessage,
    failure,
  };
}
```

- [ ] **Step 5: Run the tests (expect pass)**

```bash
npx vitest run src/lib/jkai/hermes-build-runner.test.ts 2>&1 | tail -10
```

Expected: 2/2 PASS. If the mock import path or `extractSection` re-export from `executor.ts` causes a circular import, move `extractSection` into a new `src/lib/jkai/text-parse.ts` and import from both sides.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jkai/hermes-build-runner.ts src/lib/jkai/hermes-build-runner.test.ts
git commit -m "feat(jkai): hermes-build-runner — PiRunResult-shaped runner over Hermes

Drop-in replacement for runPi(...) from executor.ts's perspective.
Posts the iteration's system+user prompt to Hermes via
HermesClient.sendMessage with kind='build'; consumes the outbound
SSE stream until finalize; subscribes to tool-call-log-bus for the
duration to collect MCP tool-call events; persists everything to
jkai_logs as type='tool_call' or type='text' rows; reconstructs an
actions[] array for the iteration's jsonb; classifies failure
through the new classifyHermesFailure.

Honors isStopped(), deadlineRef, and an idle-stream watchdog (3 min
of no SSE frames → stalled). Token usage from finalize frame's
metadata.usage.{total,input,output}.

executor.ts wiring lands in Task 13."
```

---

## Task 13: Wire the executor — flag-gated branch (TDD)

**Goal:** In `executor.ts`, replace the `runPi(...)` call with a branch: if `env.JKAI_HERMES_BUILD_LOOP === '1'` call `runHermesBuild(...)`; otherwise call `runPi(...)`. Both return `PiRunResult`. The rest of `executeIteration` (section extraction, empty-output classification, fallbacks) stays identical.

Also: at the start of the iteration the executor must `setDeadline(buildId, deadlineRef.current)` so the new runner and the `extend_deadline` tool both observe the same value.

**On `register_task_env_overrides` placement:** the per-build container override is registered ADAPTER-SIDE (Task 4), NOT executor-side. The executor does NOT make an HTTP call into Hermes to register overrides — that would duplicate state and create a sync window where the executor has fired `sendMessage` but Hermes hasn't yet seen the override. Adapter-side, the override is registered in the same Python coroutine that calls `self.handle_message(event)`, so by the time the agent loop hits its first `bash`/`read_file` tool call the override is already in `_task_env_overrides`. The executor's only responsibility is to ensure the workspace directory exists on disk before it calls `sendMessage` (which it already does, today, via `syncDesignAssets` and adjacent prep steps).

**Files:**
- Modify: `src/lib/jkai/executor.ts`
- Modify: `src/lib/jkai/executor.test.ts` (or create if absent — search first)

- [ ] **Step 1: Locate existing executor tests**

```bash
ls src/lib/jkai/executor*.test.ts 2>/dev/null
grep -rn "executeIteration" src/lib/jkai/ | head -5
```

If a test file exists, append; if not, the unit-level test here is optional — the runner-level test in Task 12 already exercises the new code path, and Task 14's acceptance scenarios exercise the full flow.

- [ ] **Step 2: Write a small flag-routing test (if practical)**

If `executeIteration` has dependencies that make unit-testing painful (it does — sandbox, design-assets, jkai-extension sync), defer to Task 14's e2e scenarios. Otherwise create a minimal `executor.test.ts` that mocks `runPi` and `runHermesBuild` and asserts the flag chooses correctly:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { JKAI_HERMES_BUILD_LOOP: '1' } }));
vi.mock('./pi-runner', () => ({ runPi: vi.fn().mockResolvedValue({ actions: [], messages: [], finalAssistantText: '', tokensUsed: 0, errorMessage: null, failure: null }) }));
vi.mock('./hermes-build-runner', () => ({ runHermesBuild: vi.fn().mockResolvedValue({ actions: [], messages: [], finalAssistantText: '## Evaluation\nok\n\n## Next Steps\n1. next', tokensUsed: 100, errorMessage: null, failure: null }) }));

import { runPi } from './pi-runner';
import { runHermesBuild } from './hermes-build-runner';
import { executeIteration } from './executor';

describe('executor flag routing', () => {
  it('calls runHermesBuild when JKAI_HERMES_BUILD_LOOP=1', async () => {
    // requires DB setup + sandbox mocks — typically deferred to Task 14 e2e
    // unless you also mock sandbox.ts. Outline only.
  });
});
```

If the mock surface gets ugly, skip the unit test and rely on Task 14's e2e. Document the decision in the commit message.

- [ ] **Step 3: Modify `executor.ts`**

Open `src/lib/jkai/executor.ts`. At the top, alongside the existing `import { runPi } from './pi-runner';`, add:

```typescript
import { runHermesBuild } from './hermes-build-runner';
import { setDeadline, clearDeadline } from './build-deadline';
import { env } from '$env/dynamic/private';
```

Find the existing `runPi(...)` call (around line 160). Replace:

```typescript
  const result = await runPi({
    build,
    iteration,
    workdir,
    systemPrompt,
    userPrompt,
    isStopped,
    deadlineRef,
    extensions,
    skillDirs,
    thinkingLevel,
    extraEnv,
  });
```

with:

```typescript
  // Phase 2: deadline_at is the canonical source-of-truth for both
  // pi-runner's deadlineRef polling and the new extend_deadline MCP tool.
  // Write it at iteration start; clear it on return.
  if (deadlineRef) {
    await setDeadline(build.id, deadlineRef.current);
  }

  const useHermes = env.JKAI_HERMES_BUILD_LOOP === '1';
  let result;
  try {
    if (useHermes) {
      result = await runHermesBuild({
        build,
        iteration,
        workdir,
        systemPrompt,
        userPrompt,
        isStopped,
        deadlineRef,
        extraEnv,
      });
    } else {
      result = await runPi({
        build,
        iteration,
        workdir,
        systemPrompt,
        userPrompt,
        isStopped,
        deadlineRef,
        extensions,
        skillDirs,
        thinkingLevel,
        extraEnv,
      });
    }
  } finally {
    if (deadlineRef) {
      await clearDeadline(build.id).catch(() => {});
    }
  }
```

The flag is read from `$env/dynamic/private` so SvelteKit picks it up at request time (not build time). This matches how `JKAI_HERMES_CANVAS_CHAT` is wired in `src/routes/api/workflows/orchestrator/chat/+server.ts`.

- [ ] **Step 4: Confirm `pi-runner.ts` is untouched**

```bash
git diff src/lib/jkai/pi-runner.ts | wc -l
```

Expected: 0. Pi stays alive as the flag-off fallback path until post-soak deletion (mirrors Phase 1's `loop.ts` retention).

- [ ] **Step 5: Run the full jkai test suite**

```bash
npx vitest run src/lib/jkai/ 2>&1 | tail -10
```

Expected: all green (or only the pre-existing `job-store.test.ts` flake that all prior phases tolerate).

- [ ] **Step 6: Commit**

```bash
git add src/lib/jkai/executor.ts
git commit -m "feat(jkai): executor flag-gated branch — Hermes vs Pi

When JKAI_HERMES_BUILD_LOOP=1, iterations route to runHermesBuild;
otherwise pi-runner. The flag is independent of JKAI_HERMES_CANVAS_CHAT
so build can soak separately from chat.

deadline_at is written to the DB at iteration start (so the new
extend_deadline tool and runner both see it), cleared on return.

pi-runner.ts stays alive untouched as the flag-off fallback until
post-soak deletion (mirrors Phase 1's loop.ts retention pattern)."
```

---

## Task 14: `.env.example` + flag plumbing

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Locate the current Hermes flag block**

```bash
grep -n "JKAI_HERMES\|HERMES_" .env.example | head -10
```

Expected: `JKAI_HERMES_CANVAS_CHAT`, `HERMES_BASE_URL`, `HERMES_BRIDGE_SECRET` already documented from Phase 1.

- [ ] **Step 2: Add the Phase 2 flag**

Append (or insert near the existing Hermes block):

```
# Hermes Phase 2 — build loop (autonomous builds via Hermes instead of Pi).
# Default off. Flip to 1 to route /jkai/builds iterations through Hermes
# with the jkai-build skill auto-loaded. Independent of JKAI_HERMES_CANVAS_CHAT —
# the build flag can soak separately from the chat flag.
#
# When on:
#   - executor.ts calls runHermesBuild() instead of runPi()
#   - the jkai platform adapter calls register_task_env_overrides() per
#     build-kind inbound, requesting a fresh hermes-<id> container from
#     jkai-sandbox:latest with /home/jkai/workspace/<id>/dev bind-mounted
#     to /workspace inside the container
#   - the jkai-build skill at ~/.hermes-jkai/skills/jkai-build/ is auto-loaded
#   - tool-call logs use per-tool-result granularity (no per-token streaming)
#
# NOTE: JKAI_BUILDS_HOSTMODE=1 (Pi's host-mode escape hatch) is Pi-only.
# Hermes-with-Docker has no hostmode equivalent — every build always runs
# in a per-build container. If Hermes were ever deployed to a host without
# Docker (e.g. a hypothetical VPS deployment), this branch would not run
# there in the first place (the loopback constraint on the homeserv ↔ VPS
# split puts Hermes-builds on homeserv only).
JKAI_HERMES_BUILD_LOOP=0
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(env): JKAI_HERMES_BUILD_LOOP flag

Document the Phase 2 flag — default 0, independent of the canvas
chat flag so build can soak separately."
```

---

## Task 15: Acceptance scenarios — run + log

**Goal:** Execute 5 acceptance scenarios end-to-end against a dev server with `JKAI_HERMES_BUILD_LOOP=1`. For each: paste the verbatim transcript and mark PASS / FAIL / PARTIAL.

**Files:**
- Create: `docs/superpowers/research/2026-05-13-hermes-phase-2-acceptance.md`

- [ ] **Step 1: Prepare the dev environment**

```bash
cd /home/john/strange_rambling_svelte/.claude/worktrees/hermes-phase-2
export JKAI_HERMES_BUILD_LOOP=1
# NB: do NOT export JKAI_BUILDS_HOSTMODE=1 — that flag is Pi-only and has
# no effect on the Hermes build path. Under Option B Hermes always uses
# the per-build container; there is no hostmode equivalent.
# Restart the systemd service running this worktree if applicable, OR run npm run dev fresh
npm run dev &
DEV_PID=$!
sleep 5
curl -sS http://homeserv:5173/ -o /dev/null && echo "dev server up"
docker ps --filter "name=hermes-" --format '{{.Names}} {{.Image}}'   # baseline before scenarios run
```

Expected: dev server responds. Hermes service already running from Task 3/4. The `docker ps` line should show no `hermes-<id>` containers yet (or only stale reaper-pending ones); each Bn scenario will spawn a fresh one.

- [ ] **Step 2: Create the acceptance log skeleton**

Create `docs/superpowers/research/2026-05-13-hermes-phase-2-acceptance.md`:

```markdown
# Hermes Phase 2 Acceptance Log

**Date:** 2026-05-13
**Branch:** worktree-hermes-phase-2
**Flag:** `JKAI_HERMES_BUILD_LOOP=1`
**Model:** glm-5.1 via z.ai
**Terminal backend:** Docker — `jkai-sandbox:latest` image, per-build `hermes-<id>` container, workspace bind-mounted to `/workspace`

## Locked design decisions (recap)

1. Per-build ephemeral Hermes Docker containers (Option B) — `jkai-sandbox:latest` image, workspace bind-mounted to `/workspace`, override registered adapter-side via `register_task_env_overrides`.
2. glm-5.1 across.
3. Per-tool-result log granularity.

## Docker backend evidence

`<paste output of: docker info --format '{{.ServerVersion}}'>`
`<paste output of: docker images jkai-sandbox:latest --format '{{.ID}}|{{.CreatedSince}}|{{.Size}}'>`
`<paste output of: docker inspect jkai-sandbox:latest | jq '.[0].Config.User, .[0].Config.WorkingDir, .[0].Config.Cmd'>`

`config.yaml` `terminal:` block applied (verbatim from current `~/.hermes-jkai/config.yaml`):

```yaml
<paste actual block>
```

Sample `hermes-<id>` container started during B1 (so we have a real record of how the bind-mount was wired):

```
<paste: docker inspect <name> | jq '.[0].HostConfig.Binds, .[0].HostConfig.SecurityOpt, .[0].HostConfig.CapDrop, .[0].HostConfig.CapAdd, .[0].HostConfig.PidsLimit'>
```

## Scenarios

### Scenario B1 — Greenfield SvelteKit page build with design tokens

**Prompt:** "Build a single-page SvelteKit-style preview that shows my live training load with a sparkline. Use the design system tokens."

**Budget:** 1 hour wall-clock (4 iterations max).

**Steps:**
1. POST `/api/jkai/builds` with prompt above.
2. Approve plan when it's ready.
3. Let it iterate.
4. After completion, paste the build_id, the 4 iteration `## Evaluation` blocks (verbatim), and the final `serve.json`.

**Observations:**
- `<filled in during run>`

**Result:** PASS / FAIL / PARTIAL

---

### Scenario B2 — Mid-iteration injection

**Prompt:** "Build a markdown editor with live preview." Then mid-iteration-2 inject "make the preview pane scrollable instead of fixed-height."

**Steps:**
1. Start build.
2. Once iteration 2 is mid-flight (check `/jkai/builds/<id>` UI), POST `/api/jkai/builds/<id>/inject` with the scroll directive.
3. Observe whether iteration 2's `## Evaluation` acknowledges the injection.

**Result:** PASS / FAIL / PARTIAL

---

### Scenario B3 — Plan-approval gate

**Prompt:** "Build a chess clock with two-player support." Configure the build with `plan_status='awaiting_plan_approval'`.

**Steps:**
1. Start build. Confirm it pauses at planning phase (`status='awaiting_plan_approval'`).
2. Approve the plan via `/api/jkai/builds/<id>/approve-plan`.
3. Confirm iterations resume.

**Result:** PASS / FAIL / PARTIAL

---

### Scenario B4 — Deadline extension

**Prompt:** "Build a Vue-based file uploader with chunked uploads." Configure budget to 8 minutes (deliberately tight).

**Steps:**
1. Start build.
2. Observe iteration 1: agent should realise install will exceed budget and call `extend_deadline(buildId, 15)`.
3. Confirm `jkai_builds.deadline_at` is updated.
4. Confirm iteration completes within the extended budget.

**Result:** PASS / FAIL / PARTIAL

---

### Scenario B5 — Per-build container isolation

**Prompt:** "Run bash 'cat /etc/passwd && ls /home/ && ls /workspace/'. Then try bash 'cat /home/john/.bashrc'."

This is a genuine isolation test: under Option B the agent's `bash` runs inside the `hermes-<id>` container, NOT on the host. The container's `/etc/passwd` is the image's own file (lists `root` and `jkai`, with no `john` user), `/home/` shows only the in-image `jkai` home, and `/workspace/` is the bind-mounted build directory. The host's `/home/john/.bashrc`, `/etc/passwd`, and SSH keys are **inaccessible** because they're outside the container's mount namespace.

What we're checking:

- ✓ Can read `/workspace/` (the build's bind-mounted workspace).
- ✓ Can read the container's `/etc/passwd` (in-image file — contains `root:x:0:0:...`, `jkai:x:1000:1000:...`).
- ✗ `cat /home/john/.bashrc` returns "No such file or directory" — `/home/john` is the HOST path, never bind-mounted into the container.
- ✗ Cannot escape into other build workspaces — only this build's `/<buildId>/dev` was bind-mounted to `/workspace`; other builds' dirs are unreachable.
- ✗ `--cap-drop ALL` means `bash 'mount'` shows nothing useful, `bash 'capsh --print'` shows the dropped caps.

**Steps:**

1. Start a fresh build with the prompt above. Wait for iteration 1.
2. In the iteration's actions log, locate the `bash` calls and verify:
   - `cat /etc/passwd` output matches `jkai-sandbox`'s in-image `/etc/passwd` (NOT homeserv's host `/etc/passwd` which contains user `john`). Confirm by running `docker run --rm jkai-sandbox:latest cat /etc/passwd` directly and comparing.
   - `ls /home/` returns only `jkai`, not `john`.
   - `ls /workspace/` returns the build's files (whatever scaffolding the agent has written).
   - `cat /home/john/.bashrc` returns ENOENT (container has no `/home/john`).
3. From a host shell, list the Hermes container that backed this build: `docker ps --filter "name=hermes-" --format '{{.Names}} {{.Mounts}}'`. Verify the bind-mount in `Mounts` points to `/home/jkai/workspace/<this-buildId>/dev:/workspace` and nothing else (no spurious mounts of `/home/john`, `/root`, or `/`).
4. From a host shell, inspect the container's security config:

```bash
NAME=$(docker ps --filter "name=hermes-" --format '{{.Names}}' | head -1)
docker inspect "$NAME" | jq '.[0].HostConfig | {CapDrop, CapAdd, SecurityOpt, PidsLimit, Tmpfs}'
```

Expected: `CapDrop = ["ALL"]`, `SecurityOpt` contains `no-new-privileges`, `PidsLimit = 256`, `Tmpfs` includes `/tmp`, `/var/tmp`, `/run`.

**Result:** PASS / FAIL / PARTIAL — PASS requires all of (2), (3), (4). FAIL if the agent can read host-only paths like `/home/john/.bashrc`. PARTIAL if `_BASE_SECURITY_ARGS` shows partial application (e.g. caps dropped but `no-new-privileges` missing).

---

## Summary

`<table: scenario | result | notes>`

## Soak instructions

Soak this flag separately from `JKAI_HERMES_CANVAS_CHAT`. With
`JKAI_HERMES_BUILD_LOOP=1` exported in the production systemd unit
(but NOT yet committed to .env), every build started over the soak
period runs through Hermes. Soak for 7 days against real-use traffic.

Watch for:
- Iteration success rate (target: ≥ Pi baseline)
- Deadline-hit rate (target: ≤ Pi baseline)
- Token usage per iteration (target: within ±20% of Pi)
- Plan-approval gate behaviour unchanged
- Sandbox isolation incidents (target: 0)

At end of soak: decide on `pi-runner.ts` deletion (post-soak task,
not in this plan).
```

- [ ] **Step 3: Run all 5 scenarios**

For each scenario, follow the steps. Paste verbatim transcripts (truncate at 1000 chars per turn if needed). Mark each PASS / FAIL / PARTIAL.

Acceptable bar: 4/5 PASS, 1/5 PARTIAL. Anything worse: STOP and report regressions before merging.

- [ ] **Step 4: Stop the dev server**

```bash
kill $DEV_PID
wait $DEV_PID 2>/dev/null
```

- [ ] **Step 5: Commit the acceptance log**

```bash
git add docs/superpowers/research/2026-05-13-hermes-phase-2-acceptance.md
git commit -m "docs(hermes-phase-2): acceptance log — 5 scenarios + soak instructions

B1 greenfield, B2 mid-iteration injection, B3 plan-approval gate,
B4 deadline extension, B5 sandbox isolation. Bar: 4/5 PASS, 1
PARTIAL acceptable.

Soak instructions: 7 days at JKAI_HERMES_BUILD_LOOP=1 in production
systemd unit (not committed to .env), independent of the canvas
chat flag's soak. Post-soak action (not in this plan): delete
pi-runner.ts after the build flag has burned in."
```

---

## Task 16: Final cross-cutting review + merge

**Goal:** Run a code-review pass over the whole Phase 2 branch; fix flagged issues in a single follow-up commit; merge to `hermes-migration`.

**Files:**
- None directly; the reviewer flags issues to fix.

- [ ] **Step 1: Inventory the diff**

```bash
git diff hermes-migration..HEAD --stat
git log --oneline hermes-migration..HEAD
```

Expected: 11–14 commits from Tasks 1–15. Stat: ~15–25 files changed.

- [ ] **Step 2: Dispatch a code-reviewer over the branch**

Run a single `feature-dev:code-reviewer` (or `superpowers:requesting-code-review` if available) pass with the prompt:

> Review Phase 2 of the Hermes migration. Files to focus on:
> - `src/lib/jkai/hermes-build-runner.ts` — new core runner
> - `src/lib/jkai/failure-classifier.ts` — failure-classification port
> - `src/lib/jkai/build-deadline.ts` — deadline helpers
> - `src/lib/jkai/tool-call-log-bus.ts` — pub-sub bus
> - `src/lib/jkai/executor.ts` — flag-routing change
> - `src/lib/mcp/jsonrpc.ts` — tool-call middleware
> - `src/lib/workflows/site-tools/tools/build-infra.ts` — new MCP tools
> - `src/lib/workflows/site-tools/tools/builds.ts` — extend_deadline added
>
> Specifically flag:
> - Race conditions in the bus subscribe/unsubscribe lifecycle vs SSE iteration
> - Memory leaks in long-running iterations (collectedEvents array growth)
> - Inconsistency between `runPi` and `runHermesBuild` return shapes (any field one sets that the other doesn't)
> - Failure-classification gaps (Hermes-specific errors that the classifier doesn't recognise)
> - Off-by-one or unit-mismatch in deadline arithmetic
> - Any `JKAI_HERMES_BUILD_LOOP` references that should be `kind === 'build'` (or vice versa)
> - SQL injection or untrusted-string-as-identifier risks in new DB operations

- [ ] **Step 3: Fix flagged issues**

For each Sev=high or Sev=med issue, apply the fix. Single commit:

```bash
git add <changed-files>
git commit -m "fix(hermes-phase-2): address cross-cutting review findings

<bullet list of issues fixed>"
```

- [ ] **Step 4: Re-run all tests one final time**

```bash
npx vitest run src/lib/mcp/ src/lib/jkai/ src/lib/workflows/site-tools/tools/ 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 5: Merge to `hermes-migration`**

```bash
# Exit the worktree
cd /home/john/strange_rambling_svelte
git checkout hermes-migration
git merge --no-ff worktree-hermes-phase-2 -m "merge: hermes phase 2 — build-loop replacement via per-build Hermes containers

Replaces pi-runner.ts on the executor's hot path with
hermes-build-runner.ts. Gated behind JKAI_HERMES_BUILD_LOOP=1, soaks
independently of canvas chat. pi-runner.ts retained as flag-off
fallback; post-soak deletion is a separate ticket."
```

Don't tag `hermes-phase-2-complete` yet — that waits until the post-soak `pi-runner.ts` deletion (mirrors Phase 1's pattern where `hermes-phase-1-complete` waits on `loop.ts` deletion).

- [ ] **Step 6: Final smoke check on `hermes-migration`**

```bash
git log --oneline -5
git status
```

Expected: clean tree, tip is the merge commit, branch is `hermes-migration`.

---

## Self-review checklist

(For the executing agent before final merge.)

**Spec coverage** — every deliverable in spec §6 Phase 2 maps to a task:
- ✅ MCP server expands with `builds (12)` — already exposed since Phase 1.5 removed the toolset gate
- ✅ New infra tools `log_iteration` (Task 9) + `extend_deadline` (Task 10); `log_tool_call` superseded by the bus middleware (Task 8); `mark_phase` deferred
- ✅ `~/.hermes-jkai/skills/jkai-build/SKILL.md` (Task 6)
- ⚠️ `~/.hermes-jkai/skills/design-system/` — NOT in this plan. The Phase 2 spec mentions it; the design-system reference is already mounted into the workspace at `dev/design-system/` by `syncDesignAssets()` so the agent reads it as files, not as a separate skill. Decision: same as today — no separate skill needed.
- ✅ Hermes terminal backend wired (Task 3 — Docker with `jkai-sandbox:latest` defaults; per-build override via `register_task_env_overrides` in Task 4; image verified in Task 3.5)
- ✅ `executor.ts` runPi → runHermesBuild (Task 13)
- ⚠️ `prompt.ts` slimmed — NOT in this plan. The prompt content moves to the skill, but `prompt.ts` is still referenced by the flag-off Pi path. Slimming happens post-soak when Pi is deleted.
- ⚠️ `pi-runner.ts`, `builder-client.ts` deleted — NOT in this plan. Post-soak, mirrors Phase 1.
- ✅ `jkai-builder.service` kept as flagged fallback — yes, via JKAI_HERMES_BUILD_LOOP=0
- ✅ Mid-flight injection wired — unchanged from Pi path (executor drains pending messages into the systemPrompt before calling either runner)
- ✅ Coding-model default documented (Task 1 — glm-5.1)
- ✅ Feature flag `JKAI_HERMES_BUILD_LOOP=1` (Task 14)

**Placeholder scan** — re-read each task for: "TBD", "TODO", "implement later", "fill in details", "Add appropriate error handling", "Similar to Task N", "Write tests for the above" without test code. Fix any found.

**Type consistency:**
- `PiRunResult` is the return shape of both `runPi` and `runHermesBuild` (Task 12 declares it; Task 13 consumes it identically)
- `ToolCallLogEvent` is published in Task 8, defined in Task 7, consumed in Task 12
- `FailureKind` enum reuses existing `'container_missing'` for Hermes Docker daemon / image / start failures in Task 11 (no enum change required)
- `extendDeadline` signature in Task 10 matches the `extend_deadline` tool args declared in Task 10 (`buildId`, `additionalMinutes`)
- `log_iteration` args in Task 9 match what the skill (Task 6) is told to call (`iterationId`, `role`, `content`, optional `metadata`)

**Skill ↔ infra consistency:**
- Task 6 tells the agent to call `log_iteration(iterationId, ...)` — Task 9 implements that tool with that arg name
- Task 6 tells the agent to call `extend_deadline(buildId, additionalMinutes)` — Task 10 implements that tool with those arg names
- Task 6 references `build_get_iteration(..., truncateChars)` — the current `builds.ts` tool may not yet support truncation; if it doesn't, add `truncateChars` support as a small Task-10 sidecar OR note in the skill that truncation is the agent's responsibility (pass `limit`-style args). RESOLUTION: the skill mentions a recommended `truncateChars` argument; the underlying tool already returns large payloads, and the agent learns from a single failed call to be more targeted. Don't bundle a builds.ts API change into Phase 2.

**Flag behaviour:**
- `JKAI_HERMES_BUILD_LOOP` default is 0 in `.env.example` (Task 14)
- Reads via `$env/dynamic/private` (Task 13) so it can flip without rebuild
- Independent of `JKAI_HERMES_CANVAS_CHAT`

**Pi-runner preserved:**
- `pi-runner.ts` is in the "Untouched" column of the file structure table
- No git diff against `pi-runner.ts` (Task 13 Step 4 verifies)
- Flag-off behaviour identical to pre-Phase-2

**Container backend security:**
- `_BASE_SECURITY_ARGS` applied per container by Hermes (`--cap-drop ALL`, `no-new-privileges`, `--pids-limit 256`, tmpfs on `/tmp` `/var/tmp` `/run`)
- Per-build container — no cross-build access; the only writable host path inside the container is the bind-mounted `/workspace`
- `docker_run_as_host_user: true` in `config.yaml` (Task 3) so files written under `/workspace` retain host ownership (`john`), avoiding root-owned-files cleanup pain
- Acceptance Scenario B5 explicitly probes the trust boundary (host paths unreachable, security args applied)

**Cumulative MCP tool count after Phase 2:**
- Phase 1 baseline: 22 (workflows) gated, raised to 132 (all) in Phase 1.5
- Phase 2 net new: `log_iteration` + `extend_deadline` = 2
- After Phase 2: 134 tools registered. (`mark_phase` deferred; `log_tool_call` not a tool — bus-based.)

If any of the above doesn't hold, fix inline. No need to re-review — fix and move on.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-13-hermes-phase-2-builds.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Phase 2 has a few heavy tasks (Task 6 skill writing, Task 12 runner implementation, Task 15 acceptance scenarios) that benefit from a clean context per task.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints at Task 3.5 (Docker backend + image verified), Task 6 (skill ready), Task 13 (executor wired), Task 15 (acceptance done).

Which approach?
