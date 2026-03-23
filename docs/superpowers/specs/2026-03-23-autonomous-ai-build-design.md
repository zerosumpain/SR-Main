# Autonomous AI Build System

**Date:** 2026-03-23
**Status:** Design
**Replaces:** JKAI interactive chat (`/jkai` routes + `$lib/jkai/*`)

## Overview

An autonomous build system where you provide a development goal/prompt and an LLM autonomously builds, reviews, and improves a project in iterative cycles within a Docker sandbox. The system runs on a configurable budget (time, tokens, iterations) and produces serveable projects accessible via reverse proxy.

## Key Decisions

- **Replaces JKAI entirely** — the interactive chat UI and code are removed
- **Single sandbox** — one `jkai-sandbox` container, one active build at a time
- **Orchestrator loop** — server-side state machine in the SvelteKit process, not a separate worker
- **LLM: Z.AI** — uses existing Z.AI via OpenAI-compatible API (model from `keys.json`, currently `glm-4-plus`)
- **LLM-driven serving** — the LLM writes a `serve.json` manifest telling the system how to access its project
- **UI at `/jkai`** — dashboard with project cards, build detail with real-time logs, iteration history, and live preview
- **Container bridge IP** — reverse proxy uses the sandbox container's bridge network IP (not port mapping), avoiding container restarts

## Data Model (Postgres / Drizzle)

Schema is added to the existing `src/lib/db/schema.ts` file (following project conventions — single schema file).

### Database Migration

The existing `jkai_conversations`, `jkai_messages`, `jkai_actions`, and `jkai_component_usage` tables are dropped. They contain only interactive chat history which is no longer needed. Migration via `drizzle-kit push` after removing old schema definitions and adding new ones.

### `jkai_builds`

| Column              | Type        | Description                                              |
|---------------------|-------------|----------------------------------------------------------|
| id                  | uuid (PK)   | Build identifier                                         |
| title               | text        | Display name (LLM-generated or user-provided)            |
| prompt              | text        | The user's goal/development objective                    |
| status              | enum        | pending, running, paused, completed, failed              |
| budgetConfig        | jsonb       | Budget parameters (see below)                            |
| tokensUsed          | integer     | Total tokens consumed across all iterations              |
| iterationsCompleted | integer     | Count of completed iterations                            |
| activeMinutesUsed   | real        | Total active minutes consumed                            |
| serveConfig         | jsonb       | How to access the built project (set by LLM), nullable   |
| createdAt           | timestamp   |                                                          |
| updatedAt           | timestamp   |                                                          |

**budgetConfig shape:**
```json
{
  "activeMinutesPerHour": 15,
  "maxTokensPerHour": 100000,
  "maxIterations": 20,
  "maxTotalMinutes": 300
}
```
All fields optional — omitted fields mean no limit for that dimension.

**serveConfig shape (written by LLM, validated by orchestrator):**
```json
{
  "port": 3050,
  "startCommand": "npm start",
  "healthCheck": "/",
  "description": "A todo app built with Express and React"
}
```

### `jkai_iterations`

| Column     | Type        | Description                                              |
|------------|-------------|----------------------------------------------------------|
| id         | uuid (PK)   |                                                          |
| buildId    | uuid (FK)   | References jkai_builds                                   |
| number     | integer     | Sequential iteration number (1, 2, 3...)                 |
| status     | enum        | running, completed, failed                               |
| goals      | text        | What this iteration set out to do                        |
| plan       | text        | The LLM's stated plan before executing                   |
| actions    | jsonb       | Array of code executions (see below)                     |
| messages   | jsonb       | Full multi-turn conversation within this iteration       |
| evaluation | text        | LLM's self-assessment after execution                    |
| nextSteps  | text        | Proposed future iterations and reasoning                 |
| tokensUsed | integer     | Tokens consumed in this iteration                        |
| durationMs | integer     | Wall-clock duration of the iteration                     |
| createdAt  | timestamp   |                                                          |

**actions shape:**
```json
[
  {
    "lang": "bash",
    "code": "npm init -y && npm install express",
    "stdout": "...",
    "stderr": "",
    "exitCode": 0
  }
]
```

**messages shape:** Array of `{role, content}` objects capturing the full intra-iteration LLM conversation. Persisted incrementally during the iteration so mid-crash recovery doesn't lose context (though the interrupted iteration is marked `failed` and a new one starts).

### `jkai_logs`

| Column      | Type        | Description                                            |
|-------------|-------------|--------------------------------------------------------|
| id          | serial (PK) |                                                       |
| buildId     | uuid (FK)   |                                                        |
| iterationId | uuid (FK)   | Nullable — some logs are between iterations            |
| type        | enum        | thinking, text, code, output, error, system            |
| content     | text        |                                                        |
| createdAt   | timestamp   |                                                        |

## Orchestrator

### State Machine

```
IDLE → (user creates build) → PLANNING → EXECUTING → EVALUATING → BUDGET_CHECK
                                                                        ↓
                                                              budget ok? → PLANNING
                                                              exceeded?  → COOLDOWN → (timer) → BUDGET_CHECK
                                                              limit hit? → COMPLETED
                                                              user pause → PAUSED → (user resume) → BUDGET_CHECK
```

### Implementation: `$lib/jkai/orchestrator.ts`

Singleton class with:
- `startBuild(buildId)` — begins the loop
- `pauseBuild(buildId)` — sets status to paused, stops the loop
- `resumeBuild(buildId)` — restarts the loop from BUDGET_CHECK
- `stopBuild(buildId)` — marks complete, stops the loop

The loop runs via `setTimeout` chains (not `setInterval`) so each step completes before the next is scheduled.

### Budget Enforcement: `$lib/jkai/budget.ts`

Before each iteration, check all four dimensions:
1. **activeMinutesPerHour** — uses a **rolling 60-minute window** (not wall-clock hour). Sum `durationMs` of iterations whose `createdAt` falls within `now - 60min`. If >= limit, sleep until the oldest iteration in the window ages out.
2. **maxTokensPerHour** — same rolling 60-minute window for `tokensUsed`.
3. **maxIterations** — if `iterationsCompleted >= maxIterations`, mark build complete.
4. **maxTotalMinutes** — if total `activeMinutesUsed >= maxTotalMinutes`, mark build complete.

Returns: `{ canProceed: boolean, sleepMs?: number, reason?: string }`

### Recovery on Startup

On SvelteKit server init (in a server hook), check for builds with `status: running`. If found:
1. Mark any iteration with `status: running` as `failed` (it was interrupted mid-execution).
2. Resume the orchestrator loop from **BUDGET_CHECK** — the next iteration starts fresh.
3. The interrupted iteration's multi-turn context is lost, but the previous completed iteration's `evaluation` and `nextSteps` provide continuity.

### LLM Context Management

Each iteration sends:
1. System prompt (autonomous builder instructions)
2. Original user prompt/goal
3. Previous iteration's evaluation + next steps (if not first iteration)
4. A summary of what exists in the workspace (file listing)

This bounded context prevents token bloat across many iterations. The LLM works from its own evaluations rather than full conversation history.

Within an iteration, the multi-turn conversation accumulates (LLM response → code execution → output fed back → next LLM response) until the LLM signals completion with an evaluation block.

## LLM System Prompt (`$lib/jkai/prompt.ts`)

The system prompt instructs the LLM to:
- Work in structured iterations: state goals, plan, execute, evaluate
- Write ONE code block per response, wait for real output
- Create a `serve.json` in the project root when the project can be served
- Self-evaluate honestly: what works, what doesn't, what it would do differently
- Propose ranked next steps with reasoning for each
- Keep all project files in `/home/jkai/workspace/<build-id>/`
- Not fabricate output — wait for real execution results

The iteration flow within the orchestrator is multi-turn: the LLM responds, code blocks are executed, output is fed back, until the LLM signals the iteration is complete (emits an evaluation block).

## Serving Built Projects

### LLM-Driven Configuration

When the LLM creates something serveable, it writes `/home/jkai/workspace/<build-id>/serve.json`:
```json
{
  "port": 3050,
  "startCommand": "node server.js",
  "healthCheck": "/health",
  "description": "Express + React todo app"
}
```

### Validation

The orchestrator validates `serve.json` before acting on it:
- `port` must be a number in range 1024-65535
- `startCommand` must be a non-empty string
- `healthCheck` must be a string starting with `/`

Invalid `serve.json` is logged as a warning and ignored.

### Server Lifecycle Inside Sandbox

When starting a project server:
1. **Kill previous server:** `docker exec jkai-sandbox pkill -f "<previous startCommand>"` (or kill by stored PID)
2. **Start new server:** `docker exec -d jkai-sandbox bash -c 'cd /home/jkai/workspace/<build-id> && <startCommand> & echo $! > /tmp/jkai-serve.pid'` — runs in background with PID tracked
3. **Health check:** Poll `healthCheck` endpoint via `docker exec jkai-sandbox curl -sf http://localhost:<port><healthCheck>` with a 30-second timeout (retry every 2s)
4. **Update build record** with `serveConfig` on successful health check

### Reverse Proxy via Container Bridge IP

The sandbox container sits on Docker's default bridge network. The orchestrator resolves the container's IP via:
```
docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' jkai-sandbox
```

The SvelteKit proxy route fetches from `http://<container-ip>:<port>/<path>`. This avoids port mapping on the host and container restarts. The container IP is cached and refreshed if a request fails.

### Sandbox Resource Limits

The `jkai-sandbox` container should be run with resource limits:
- `--memory 2g` — prevents OOM from affecting the host
- `--cpus 2` — prevents CPU starvation of the host

These are set when the orchestrator starts/ensures the container.

### Execution Timeouts

- Build commands (`npm install`, `pip install`, compilation): **5 minute** timeout
- Regular code execution: **2 minute** timeout
- Server start + health check: **30 second** timeout

## Authentication

All `/api/jkai/*` routes and the `/jkai` UI require admin authentication (existing `ADMIN_PASSWORD` env var mechanism).

## UI Routes

### `/jkai` — Dashboard

- Grid of build cards (similar style to `/projects`)
- Each card: title, status badge, iteration count, budget usage bar, timestamp
- "New Build" button
- Active build gets a pulsing indicator

### `/jkai/new` — Create Build

- Prompt textarea (the development objective)
- Budget controls:
  - Active minutes per hour (slider, 1-60, default 15)
  - Max tokens per hour (input, default unlimited)
  - Max iterations (input, default unlimited)
  - Total time cap in minutes (input, default unlimited)
- Start button

### `/jkai/[id]` — Build Detail

Tabbed layout:
- **Activity** — real-time log stream via SSE when running. Historical log entries when paused/complete. Shows LLM thinking, code executions, outputs. SSE supports `Last-Event-ID` for reconnection (uses `jkai_logs.id` as event ID).
- **Iterations** — expandable list of all iterations. Each shows: goals, plan, code actions with output, evaluation, proposed next steps.
- **Preview** — iframe to `/jkai/builds/[id]/app/` when `serveConfig` exists. Placeholder message when not yet serveable.
- **Controls** — pause/resume/stop buttons. Budget usage summary. Option to adjust budget on a running build.

### `/jkai/admin` — removed (functionality merged into build controls)

## API Routes

| Method | Path                              | Description                  |
|--------|-----------------------------------|------------------------------|
| POST   | /api/jkai/builds                  | Create a new build           |
| GET    | /api/jkai/builds                  | List all builds              |
| GET    | /api/jkai/builds/[id]             | Get build + iterations       |
| POST   | /api/jkai/builds/[id]/pause       | Pause active build           |
| POST   | /api/jkai/builds/[id]/resume      | Resume paused build          |
| POST   | /api/jkai/builds/[id]/stop        | Stop build permanently       |
| PATCH  | /api/jkai/builds/[id]/budget      | Update budget config         |
| GET    | /api/jkai/builds/[id]/stream      | SSE log stream               |
| ALL    | /jkai/builds/[id]/app/[...path]   | Reverse proxy to sandbox     |

## File Changes

### Delete (old JKAI)
- `src/lib/jkai/client.ts`
- `src/lib/jkai/component-detector.ts`
- `src/lib/jkai/types.ts`
- `src/routes/jkai/+page.svelte`
- `src/routes/jkai/+layout.svelte`
- `src/routes/jkai/+layout.server.ts`
- `src/routes/jkai/admin/+page.svelte`

### Schema changes in `src/lib/db/schema.ts`
- Remove: `jkai_conversations`, `jkai_messages`, `jkai_actions`, `jkai_component_usage` table definitions
- Add: `jkai_builds`, `jkai_iterations`, `jkai_logs` table definitions
- Run `drizzle-kit push` after changes

### Modify
- `src/lib/jkai/sandbox.ts` — add project-scoped execution, serve management, container IP resolution, configurable timeouts

### New
- `src/lib/jkai/types.ts` — new type definitions
- `src/lib/jkai/orchestrator.ts` — build loop state machine
- `src/lib/jkai/budget.ts` — budget checking logic
- `src/lib/jkai/prompt.ts` — system prompt construction
- `src/lib/jkai/serve.ts` — project serving/proxy logic
- `src/routes/jkai/+page.svelte` — dashboard
- `src/routes/jkai/+page.server.ts` — load builds
- `src/routes/jkai/new/+page.svelte` — create build form
- `src/routes/jkai/[id]/+page.svelte` — build detail
- `src/routes/jkai/[id]/+page.server.ts` — load build data
- `src/routes/api/jkai/builds/+server.ts` — list/create
- `src/routes/api/jkai/builds/[id]/+server.ts` — get build
- `src/routes/api/jkai/builds/[id]/pause/+server.ts`
- `src/routes/api/jkai/builds/[id]/resume/+server.ts`
- `src/routes/api/jkai/builds/[id]/stop/+server.ts`
- `src/routes/api/jkai/builds/[id]/budget/+server.ts`
- `src/routes/api/jkai/builds/[id]/stream/+server.ts` — SSE
- `src/routes/jkai/builds/[id]/app/[...path]/+server.ts` — reverse proxy

### Keep unchanged
- `docker/jkai-sandbox/Dockerfile` — base image is sufficient (resource limits applied at runtime)
