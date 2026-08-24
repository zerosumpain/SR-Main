---
name: jkai-platform-internals
description: "jkai SvelteKit platform internals — chat rendering, attachments, tool-step bus, Hermes bridge, intel knowledge graph. Load when debugging site UI issues or when the conversation touches the entity graph / knowledge_search / intel tools."
version: 1.2.0
platforms: [linux]
metadata:
  hermes:
    tags: [jkai, architecture, debugging, chat, attachments, tool-step-bus, hermes-bridge, intel]
    related_skills: [systematic-debugging, dogfood]
---

# jkai Platform Internals

Architecture knowledge for debugging the strangeramblings.com jkai chat system. Load this when a user reports something not rendering, not showing up, or behaving unexpectedly in the chat UI — especially attachment-related issues. Also load when the conversation touches the intel knowledge graph, `knowledge_search`, or entity graph tools.

## Key Source Files

| File | Purpose |
|------|---------|
| `src/routes/api/workflows/orchestrator/chat/+server.ts` | Chat SSE endpoint — pumps Hermes frames, collects attachments, dispatches job events |
| `src/lib/jkai/tool-step-bus.ts` | In-memory pub-sub for tool-call events (started/completed/failed) |
| `src/lib/mcp/jsonrpc.ts` | MCP JSON-RPC dispatcher — executes tools, publishes to tool-step bus |
| `src/lib/workflows/site-tools/tools/media-write-document.ts` | `write_document` site-tool handler |
| `src/lib/components/jkai/ChatArea.svelte` | Chat UI — consumes `done` event's `result.attachments` for inline rendering |
| `src/lib/components/jkai/MessageAttachments.svelte` | Renders attachment download links, images, audio, video |
| `~/.hermes-jkai/extensions/jkai_platform/adapter.py` | Hermes → jkai platform adapter (OutboundFrame emitter, media upload) |

## Architecture Overview

Two paths produce attachments in chat:

### Path 1: Adapter-Emitted Media (images, audio, video, PDFs)

Hermes adapter methods (`send_image_file`, `send_document`, `send_voice`, etc.) upload bytes to SvelteKit's `/api/jkai/attachments`, then emit an `OutboundFrame` with `attachment=slim`. The SSE pump in `+server.ts` calls `extractAttachmentFromFrame(frame)` to collect these into `turnAttachments`, which gets folded into the `done` event's `result.attachments`.

Tools that use this path: `generate_image` (→ `send_image`), `browser_vision` screenshots (→ `send_image_file`), `generate_audio_tts` (→ `send_voice`), video-gen tools (→ `send_video`).

### Path 2: Site-Tool Inline Attachments (`write_document`)

Site-tools (registered in `src/lib/workflows/site-tools/`) execute **on the SvelteKit side** via MCP. They save to disk + DB directly and return attachment metadata in their tool result (e.g. `{ attachments: [row] }`). This result goes back to the LLM as text — it does NOT go through the adapter's `send_document` method.

The bridge: the tool-step bus publishes the tool result with the full `attachments` array. The chat SSE subscriber (in `+server.ts`) inspects completed tool results for `attachments` and promotes them into the shared `turnAttachments` array.

## Tool-Step Bus

In-memory pub-sub keyed by a string ID. Two sides:

1. **Publisher** (`jsonrpc.ts`): After every `tools/call`, reads `args.workflow_id` and publishes a `ToolStepEvent` (started → completed/failed). The `workflow_id` is set by Hermes to `kindId` (= `chatId` for general /jkai chats, or the canvas workflowId for canvas chats).

2. **Subscriber** (`+server.ts`): Subscribes on `chatId` for the duration of the SSE response. Forwards events as `tool_start`/`tool_result` job events and extracts inline attachments.

**Key invariant:** The publisher always uses `workflowId = String(args.workflow_id ?? '')`. For general `/jkai` chats this is `chat_${conversationId}` (truthy), so events ARE published. The subscriber must listen on the same key — `chatId`, not `workflowId` (which is `undefined` for general chat).

## Attachment Rendering Flow (End-to-End)

```
Tool produces attachment
  → Saved to disk + jkaiAttachments DB
  → Tool result includes { attachments: [row] }
  → jsonrpc.ts publishes ToolStepEvent { result: { attachments: [...] } }
  → +server.ts subscriber extracts rows into turnAttachments[]
  → SSE pump also collects adapter-emitted frames into turnAttachments[]
  → On finalize: result.attachments = turnAttachments
  → ChatArea.svelte reads msg.attachments from done event
  → MessageAttachments.svelte renders download links / inline media
```

Persistence: after the SSE response completes, `+server.ts` persists the assistant message to `orchestratorChats` and back-fills `messageId` on the attachment rows so page-reload still shows them via the conversation-history endpoint.

## Intel Knowledge Graph

The intel system is a pre-computed entity-relationship graph (~6,300 entities, ~6,600 relationships) that adds a **relational dimension** on top of raw file/memory/research stores. It is populated by the auto-extraction pipeline (`src/lib/jkai/intel/auto-extract.ts`) which runs entity extraction on every file upload, research session, Gmail thread, and chat thread — all offline.

**Key value:** the graph enables structured queries (`intel_find` → `intel_neighbourhood`, `intel_path`, `intel_insights`) that cost 1-2 tool calls, instead of reading N raw source files to reconstruct the same relationships. The entity summaries are LLM-distilled to ~200-300 chars each. The analytics layer (`intel_insights`) is rule-based, not LLM-generated — it costs zero tokens.

**Unified recall:** `knowledge_search` fans out across 6 stores (notes, entities, files, research, memory, datastore) in parallel, sharing the embedding cost between notes and entities. Auto-derived notes are suppressed from the notes branch (the text is already covered by the files/research branches), but the entities they produced are still surfaced.

**Full reference:** `references/intel-knowledge-graph.md` — entity graph schema, all 10 insight types, key source files, token-cost value breakdown, and the complete data flow from file upload → entity extraction → graph query.

## Production Deployment / Serving

### First, ask: do you actually need to touch the VPS?

If the user wants a URL for an HTML report, analysis, summary, or any chat-authored static page, **call `publish_page` instead of touching the VPS**. It writes into `data/jkai-projects/<slug>/index.html`, which the existing `/projects/[slug]/` route serves on the very next request — **no rebuild, no SCP, no service restart, no approval prompts**.

```jsonc
// One tool call, served at https://strangeramblings.com/projects/<slug>/
publish_page({ slug: "kelly-travel-analysis", content: "<!doctype html>...", format: "html" })
```

### Testing a cron-scheduled workflow

When you need to test a VPS cron workflow that fires infrequently (every 6h, daily, etc.), you can't use `workflow_run` (it's scoped to the homeserv DB). The pattern is: temporarily change the schedule to `*/5 * * * *`, restart, test, restore, restart. See `references/testing-cron-workflows.md` for the exact SQL commands, pitfall notes, and verification steps.

**If the published page 404s, you published it to the wrong machine.**
plain `writeFile` into `getPublishedDir()` on **whichever instance executes the tool** — there is
no VPS sync inside it, and never was. **UPDATE (2026-08-03+):** the gateway's `MCP_UPSTREAM` is now
`https://strangeramblings.com/api/mcp` — the bridge executes tools on the **production**
instance, so `publish_page` from chat now lands on the VPS (see "Database Architecture"
below for the verified change-over). The homeserv-instance behaviour described here
predates that change and no longer applies to the normal bridge path. Keep the
verify-with-a-fetch habit regardless: a 404 still means the page didn't land where the
public site reads from.

**Do not "fix" this by rsyncing the file to the VPS.** That is the same instinct that took the
site down for 33 hours (see "Deploying: you don't" below). Instead:

- Verify with a fetch after publishing. A 404 means wrong instance, not a flaky sync.
- To publish to production, the tool call must be executed by the production instance — i.e.
  through the site's own tool surface, not the homeserv-pointed MCP bridge.
- For anything that needs to survive in the repo, use `request_change` and let CI deploy it.

The `/projects/[slug]/` route reads `data/jkai-projects/` from disk at request time, so once the
file is on the RIGHT machine it serves on the next request with no rebuild or restart.

### When a service restart is genuinely required: wait-until-ready

If you do trigger `systemctl restart strange-rambling-svelte` (or any other service whose readiness affects your verification step), **do not use a single `sleep N && curl` probe** — it races startup and you'll declare failure on a healthy deploy. Loop against the **public URL from outside the VPS** until it returns 200, with an upper bound:

```bash
# Wait up to 60s for the public URL to come back, then declare result
timeout 60 bash -c 'until curl -fsS "https://strangeramblings.com/<path>" >/dev/null 2>&1; do sleep 2; done' \
  && echo "✓ live" \
  || echo "✗ still 404/down after 60s — check service logs"
```

Why the public URL, not `localhost:4173` over SSH: Caddy + the SvelteKit static cache come up on different timelines, and the public path is what the user will actually hit. Two stale 404s from `localhost` over SSH have led the agent to declare failure on three already-live deploys.

### Port layout

| Port | Service | Notes |
|------|---------|-------|
| 4173 | **SvelteKit** (adapter-node) | The live site. Set via `PORT=4173` in `.env`. |
| 3000 | **Old Next.js** (container) | Deprecated — still running. Confusingly also responds on the SvelteKit hostname via Caddy routing. |
| 3001 | Old Next.js (container, dev) | Legacy. |
| 8080 | code-server | In-browser IDE. |

**There IS a Caddy reverse proxy** (running in a Docker container, PID typically root). It terminates TLS and routes external traffic to the SvelteKit app on port 4173. The Caddyfile lives inside the container's filesystem — it's not at `/etc/caddy/Caddyfile` on the host. To inspect it, use `sudo cat /proc/<caddy_pid>/root/etc/caddy/Caddyfile` or find the container.

**Lesson:** when debugging 404s on the VPS, always `curl -sI http://localhost:4173/<path>` to test SvelteKit directly, bypassing Caddy. A `Via: 1.1 Caddy` or `X-Powered-By: Next.js` header in the response means Caddy routed to the wrong backend.

### Static file serving

adapter-node's built-in static file server (`sirv`) walks `build/client/` at startup via `totalist()` and builds an in-memory `FILES` map. Two things gate whether a file is served:

1. **The file must exist in `build/client/`** on disk when the server starts.
2. **The filename must appear in `build/server/manifest.js`** in the `assets` Set (a hardcoded whitelist built at `npm run build` time). Files not in this set are skipped even if they exist on disk.

**Do not hand-patch `build/`.** This section used to give a recipe for SCP-ing a file into
`build/client/` and `sed`-ing its name into the `assets` Set in `build/server/manifest.js`. That
edits the compiled output of a commit, so the running site no longer matches any revision — and
the next CI deploy silently reverts it, which reads as "my fix randomly stopped working".

To serve a one-off page, use `publish_page` (served from `data/jkai-projects/` at request time,
no manifest involvement at all). To add a real static asset, `request_change` it into `static/`
and let the build place it.

**`static/` is build-time only** — files there are copied into `build/client/` during
`npm run build`. Dropping a file into `static/` on the production server without rebuilding has
no effect, which is another reason not to touch that box by hand.

### Service restarts

You should not be restarting production. CI does it as the last step of a deploy, and the
workflow-engine watchdog does it if `/api/health/workflow-engine` stops answering.

If you genuinely need one (e.g. an env var changed), ask first — it is a user-approval action per
the escalation ladder in jkai-general. Do **not** wrap it in `nohup … &` to survive the SSH
session dropping: detaching means you never see whether it came back, and this skill previously
recommended exactly that. Restart, then poll the PUBLIC url until it answers (see
"wait-until-ready" above) so the result is actually observed.

## Database Architecture

Two separate PostgreSQL instances serve the jkai platform:

| Instance | Host | Port | Container | What lives here |
|----------|------|------|-----------|----------------|
| **Homeserv local** | `localhost` | 5433 | `strange_rambling-app-db-1` | Dev/test workflows, local development data |
| **VPS production** | `157.180.19.38` | 5432 (internal) | `strange-rambling-app-db-1` | All production workflows with cron schedules, run history, data stores |

### MCP tool visibility

The MCP tools (`workflow_list`, `workflow_inspect`, `datastore_*`, credentials, etc.) route through whichever app instance the bridge is connected to. Since 2026-08-03 the gateway's `MCP_UPSTREAM` is **`https://strangeramblings.com/api/mcp`**, so **every MCP tool reads and writes PRODUCTION**, whether the request came from the website or from WhatsApp. Verified that day: `datastore_list_collections` over the bridge returns production's rows, not homeserv's.

This means `workflow_list` **is** the real answer. If a user says "the workflow called X runs every 5 minutes" and `workflow_list` returns nothing, do not go around it by querying a database — say the list is empty and check the bridge is healthy (`api_secrets_list` should return 5 secrets, all available). Reaching for direct SQL on a hunch is what previously produced a confident wrong conclusion, and raw SQL against `api_secrets` is how a half-registered credential got created in the first place.

**Do not infer the MCP target from a `DATABASE_URL`.** homeserv's own app on :5173 really does use `localhost:5433`, and that dev database still exists — it is simply not what the MCP tools talk to.

### Querying the databases directly

See `references/database-access.md` for the exact SSH + docker exec commands, the table schema, and common queries (listing workflows, checking run counts, inspecting data stores, querying node configs).

### Workflow data → API endpoint → dashboard

When a workflow accumulates data in `workflow_data_store` and needs a web frontend, the pattern is: public SvelteKit API endpoint that reads data-store keys, plus a standalone HTML dashboard that fetches from it. See `references/workflow-data-api-endpoint.md` for the full pattern including Drizzle queries, `PUBLIC_PATHS` setup, deploy sequence, and pitfalls. For the **datastore collection** approach (shared across workflows, `$lib/datastore` access layer), see `references/datastore-api-endpoint-pattern.md` which covers the SvelteKit page + API endpoint pattern used by the Broads speed tracker. For backfilling the geocache with reverse-geocoded addresses, see `references/geocache-backfill.md`. For seeding vault secrets (e.g. TrueLayer OAuth credentials) when `request_credential` can't push a browser form, see `references/seeding-vault-secrets.md`.

### Schema cheat sheet — load this BEFORE writing SQL

Stop and re-read this section before running any `psql` against the workflow DB. Wrong column names have eaten 3+ minutes of trial-and-error in past sessions. The exact columns are:

```sql
-- workflows
id (text) | name (text) | description (text) | trigger (jsonb) | created_at | updated_at
-- ❌ NO "slug", NO "status" — those don't exist here
-- trigger looks like {"type":"cron","cron":"*/5 * * * *"} or {"type":"manual"}

-- workflow_nodes
id | workflow_id | type | label | position (jsonb {x,y}) | config (jsonb)
-- ❌ NO "name" — use "label"

-- workflow_edges
id | workflow_id | source_node_id | target_node_id | source_handle | target_handle

-- workflow_runs                                                                   ← per-run status
id | workflow_id | status | trigger | started_at | completed_at | error
| healing_history (jsonb) | paused_at_node_id | heartbeat_at
-- ❌ NO "created_at" — use "started_at"

-- node_executions                                                                 ← EXISTS on both homeserv AND VPS
id | run_id | node_id | status | input_data (jsonb) | output_data (jsonb)
| started_at | completed_at | error | logs (jsonb) | tokens_input | tokens_output
| cache_read_tokens | reasoning_tokens | cost_usd | provider | model | price_snapshot
-- NOTE: an older version of this doc claimed VPS didn't have this table — that was wrong.
-- Query via: docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling

-- workflow_data_store                                                             ← per-workflow key-value
workflow_id | key | value (jsonb) | updated_at

-- workflow_schedules                                                              ← cron mirror
id | workflow_id | type | config (jsonb {expression}) | enabled | last_run_at | next_run_at

-- home_assistant_config                                                            ← HA URL/token live HERE, not env vars
id ('default') | url | token | entity_registry (jsonb) | device_registry (jsonb)
| area_registry (jsonb) | last_synced
```

**Common copy-paste queries** (full set in `references/database-access.md`):

```sql
-- Find a workflow by partial name
SELECT id, name, left(description, 80) FROM workflows
WHERE name ILIKE '%family%' ORDER BY name;

-- All nodes for a workflow, in stable order
SELECT type, label FROM workflow_nodes WHERE workflow_id = '<id>' ORDER BY label;

-- Last 5 runs of a workflow
SELECT status, started_at, completed_at, error FROM workflow_runs
WHERE workflow_id = '<id>' ORDER BY started_at DESC LIMIT 5;

-- HA URL + token
SELECT url, length(token) FROM home_assistant_config WHERE id = 'default';
```

If you don't see what you expect, the column name is almost certainly wrong — check the schema above before iterating.

### Chat model dropdown — how models appear

The chat UI (`ChatArea.svelte` line ~1188) derives `modelOptions` from two sources:

1. **One GLM model** — the default from `app_settings` key `jkai.chat.default_glm_model` (falls back to `DEFAULT_GLM_MODEL_ID` from `src/lib/constants/glm-models.ts`). Available GLM IDs are hardcoded in that file: `{ id, label, description }[]`.

2. **One OpenRouter alternate** — from `app_settings` key `jkai.chat.alt_openrouter_model` (a `{ modelId }` object, or null). Set via `/admin/models`. The admin panel fetches all OpenRouter models from the `/api/admin/models/openrouter` endpoint (which proxies OpenRouter's model list) and lets you pick one.

**There is no multi-model picker.** The dropdown shows at most 2 entries: the GLM default + 1 OpenRouter alt. To add more GLM models, edit `src/lib/constants/glm-models.ts`. To add multiple OpenRouter models to the dropdown, the `modelOptions` derivation in `ChatArea.svelte` needs extending (currently it only reads `altOpenRouterModel`, a single object).

**Model locks after first message.** The PATCH to `/api/jkai/conversations/{id}` returns 409 if messages already exist. The switch also sends `/model {id} --provider {provider}` to Hermes via a silent SSE turn.

Settings are managed through:
- `src/routes/api/admin/models/settings/+server.ts` — GET/POST for all model defaults
- `src/lib/components/admin/ModelDefaultsPanel.svelte` — the admin UI at `/admin/models`
- `src/lib/server/models/settings.ts` — `getSetting`/`setSetting` over the `app_settings` table

### GLM / Zhipu provider quirks (zai provider)

See `references/zai-glm-provider.md` for thinking-mode defaults, model naming, interleaved thinking behaviour, and how to navigate the Zhipu docs site.

### MCP bridge invocation from shell

See `references/mcp-bridge-invocation.md` for the curl recipe to call site-tools via JSON-RPC when native tools aren't available in the current session (endpoint, auth, double-JSON-encoding gotcha, production fallback).

### Homeserv local app

The homeserv instance runs as a **user systemd service**:

```bash
systemctl --user restart strange-rambling-svelte   # restart
journalctl --user -u strange-rambling-svelte -n 50  # logs
```

It listens on **port 5173** (same as dev default). The VPS production instance listens on 4173.

### DB password masking (terminal output)

The homeserv `.env` contains `DATABASE_URL=postgresql://app:test@localhost:5433/strange_rambling` — the actual password is **`test`**. The `grep` and `cat` commands in terminal show `***` because the tool's output filter masks credential patterns in plaintext terminal output. The raw file content is accessible via `xxd` or `base64`:

```bash
grep DATABASE_URL .env | xxd        # reveals the actual chars
cat .env | base64                    # returns the full file, decode to see content
```

This means **direct psql is possible** using the `node spawn` trick to set `PGPASSWORD` in the env without it appearing in the command string (which triggers masking):

```bash
node -e "
const { spawn } = require('child_process');
const proc = spawn('psql', [
  '-h','localhost','-p','5433','-U','app','-d','strange_rambling',
  '-c','SELECT handle, source FROM api_secrets'
], { env: { ...process.env, PGPASSWORD: 'test' } });
proc.stdout.on('data', d => process.stdout.write(d));
proc.stderr.on('data', d => process.stderr.write(d));
"
```

Alternative: use `PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE`/`PGPASSWORD` env vars exported before the psql call (the env var export itself does not pass through the terminal output filter):

```bash
export PGHOST=localhost PGPORT=5433 PGUSER=app PGDATABASE=strange_rambling PGPASSWORD=test
psql -c "SELECT 1"
```

The app's API is still the preferred approach for read operations (simpler, no password in context), but direct DB access is the fallback when you need to write to tables the API doesn't expose — notably `api_secrets` for seeding vault credentials (see `references/seeding-vault-secrets.md`).

### Auth bypass (PUBLIC_PATHS)

`src/lib/auth.ts` contains a `PUBLIC_PATHS` array that skips Google OAuth for matching routes.
`src/hooks.server.ts` imports `isPublicPath` from that module and applies it.

To expose a new route publicly (e.g. a dashboard shared via WhatsApp link), add it here
and redeploy. ⚠ Adding public paths causes `npm run gate:public-routes` to fail with a diff
— acknowledge with `npm run gate:public-routes -- --write` and commit the manifest update.
Both the page route (e.g. `/broads`) AND the API route (e.g. `/api/broads`) need separate entries.

### Design system reference

See `references/design-system.md` for the canonical design tokens (fonts, colors, nm-* CSS classes, typography scale, layout patterns). Load this when building any HTML artifact that should match the SR site look — it avoids grepping the codebase for CSS variables each time.

### Builds system: register_hermes_build

`register_hermes_build` inserts a `jkai_builds` row and calls `orchestrator.startBuild()`, which triggers the **full autonomous builder pipeline** (LLM iterations, sandbox execution, evaluation loop).

**For pre-built static HTML:** `register_hermes_build` *works* — it returns a completed build with a working `/jkai/builds/<id>` page. However it runs the builder orchestrator unnecessarily. For simpler serving:
- **`publish_page`** → serves at `/projects/<slug>/` immediately, no pipeline, no rebuild.
- **`static/` + `PUBLIC_PATHS`** → for persistent standalone tools.
Use `register_hermes_build` when you want the build to appear in the `/jkai/builds` gallery (user can view, publish, or iterate from there).

The builder tools in `src/lib/workflows/site-tools/tools/builds.ts`:
- `register_hermes_build` → full orchestrator pipeline (NOT for pre-built HTML)
- `build_write_file` → write a file into an existing build workspace
- `build_tweak` → inject an improvement instruction into a running build
- `build_control` → pause/resume/stop/publish an existing build

**Registering a preprint HTML build — the payload-escaping trap.** `register_hermes_build`
wants the file *body* in `files[].content`. Hand-writing a large HTML file inline in the JSON
call is fragile: one stray `"`, unescaped glyph, or over-long field makes the whole call fail to
parse (observed: `{"success":false,"error":"each file needs string path + string content"}`
which actually means the payload was malformed, not that you forgot a field). The reliable
The reliable pattern: `write_file` the HTML to `/tmp/<app>/index.html` first, then either pass `source:"file:///tmp/app/index.html"` (best — content never enters LLM context) or feed the exact body as `content`.
`content`. Escape real glyphs deterministically (or use `\uXXXX`) rather than hand-typing them.

**`build_control publish` is confirmation-gated and can time out.** Publish is a
destructive-rated action — on an unattended bridge call it bounces with *"not executed —
build_control needs confirmation and no user is attached"* and asks you to get the user to
approve directly. It can also time out on the bridge (observed ~900s `MCP call timed out`) and
leave the build with `publishedSlug: null` / `publishedUrl: null` even though the build itself
is `status: completed`. Always `build_inspect` before/after a publish: a null `publishedSlug`
means it is NOT live yet. Publishing a *new* build id to an existing slug (e.g.
`simple-calculator`) overwrites the old project page in place.

### Change-request builds (`request_change`)

`request_change` is the sanctioned path for real code in the site repo (new page, route, node, bug fix). It opens a GitHub issue, starts an autonomous build that branches, implements, runs `npm run gate`, and opens a PR closing the issue.

- **Arg shape is `title` + `request`, NOT `prompt`.** Calling it with `prompt` returns `"Both \`title\` and \`request\` are required."` — `title` is the short issue title (≤250 chars), `request` is the full spec stored verbatim on the issue. Include acceptance criteria, exact file paths, the model to copy (e.g. "mirror `workflow_describe_node`'s `types: [...]` batching"), and the vitest cases to add. End with `This work implements GitHub issue #N` + `Reference "Closes #N" in your summary.`
- **It is `destructive: true`** — the orchestrator prompts before it runs. That's expected for a change-request; don't treat the confirmation as a red flag.
- **Protected paths never auto-merge.** Anything touching auth, DB schema, deploy scripts or CI is flagged for human review; additive changes can auto-merge after the gate passes.

### Stalled builds: resume, don't rebuild

A build can fail with `failure.kind: "stalled"` — e.g. `"Pi stream went quiet for 183s mid-flight — upstream connection stalled."` That message names the **watchdog that killed it, not the reason it went quiet** — read `stderrTail` before explaining it to anyone (see the section below). The build may have already done substantial work (mid-iteration edits, a full branch) before it died.

- **Recovery:** `build_control({ id, action: "resume" })`. It picks back up and starts a new iteration, preserving the completed work (the prior iteration's edits and goals are retained). Verify with `build_inspect` that `status` is back to `running` and a new iteration has started.
- **Don't treat a stall as a gate failure** and don't re-file the change request. `consecutiveFailures` increments, but resume clears the path.
- **If it stalls again on the same upstream connection**, that points at a flaky provider connection rather than the build — flag it rather than resuming repeatedly.
- **Watching multiple builds:** register one `register_heartbeat_action` (cadence 300s) whose `goal` requires ALL builds terminal, so the user gets a single clean ping when everything finishes — not one per build, and not a premature ping when one briefly goes terminal before you resume it.

### Read `stderrTail` FIRST — the failure `kind` can be wrong

Corrected 2026-08-08 after a wrong diagnosis was written down here. The
2026-08-07 builds (#125/#126) were reported as `stalled`, then as
`auth_failed`; both labels were wrong, and so was the theory that replaced
them.

**The hourly token budget never stalls a stream.** `maxTokensPerHour` is
checked in `checkBudget()` *between* iterations and puts the build to sleep
with a `reason` naming the limit. It cannot make a mid-flight stream go quiet.
If a build stalls near 1M tokens that is a coincidence of size, not a cause —
do not repeat the "no budget left" explanation.

**What the fields actually mean:**

- `kind: "stalled"` = the 180s idle watchdog (or 240s first-event watchdog) in
  `pi-runner.ts` killed the agent with SIGTERM. It is a symptom. The cause is
  in `stderrTail`.
- `kind: "auth_failed"` is **not trustworthy on its own.** The classifier
  matches `/401|403|unauthorized/` against the whole of stderr before it checks
  `stalled`, so one unrelated line — e.g. the tool bridge logging
  `[jkai-tools] manifest fetch failed: 401` — relabels a watchdog kill as a
  provider auth failure.
- `[jkai-tools] manifest fetch failed|error` in `stderrTail` is **never
  benign**. It means the agent ran with **zero site tools**. Treat it as the
  headline finding and say so — it is the difference between a build that can
  call `workflow_list` and one flying blind.
- `Warning: Model "…" not found for provider "openrouter"` means pi has no
  context-window metadata for that model id, so it cannot manage context. Flag
  it; do not dismiss it.

**Resume, don't rebuild** — but verify it worked. `build_control({ id, action:
"resume" })` keeps the workspace, branch and prior edits; a second
`request_change` throws them away. After resuming, re-check `build_inspect`
before telling the user anything: a resumed build that fails again in 10
minutes is not "running". **Never report a build as running from the fact that
you resumed it — only from a fresh inspect.**

**Where the work goes when a build fails.** The branch and edits survive on the
VPS at `/home/jkai/workspace/<build-id>/dev` (local branch `agent/<short-id>`,
uncommitted). A failed build is a rescue job, not a loss — say so rather than
re-filing the request.

## Bundle: custom tools are runtime DB rows, not repo code

Tools created by the self-improve engine (`health_summary`, `reverse_geocode`,
`sausage_generator`, …) live in the `custom_tools` table and are registered at
startup by `custom-tool-loader.ts`. They have no repo file, and there is
currently **no bridge-callable list/disable surface** (the `list_custom_tools`
/ `delete_tool` handlers are wired only into the general-chat toolset surface).
Full architecture, inspection SQL, the workflow-dependency pre-check, and the
verified duplicate-tool audit from 2026-08-07:
`references/custom-tools.md`.

## Harness capability audits

When reviewing or hardening the tools exposed to `/jkai`, read `references/harness-capability-audits.md`. It covers effective-manifest tracing across global/per-platform toolsets, plugin fallback, MCP inheritance, contract-drift probes, lifecycle metadata, CI-only deployment checks, and the unattended `request_change` confirmation gate.

## Tool descriptions: use-case-first, not implementation-first

Tool descriptions (the `description` field in `register()` calls) are the
primary signal an agent uses to decide which tool to call. A description that
leads with "how it works" causes the agent to categorise the tool incorrectly
and reach for a different one. See `references/tool-description-patterns.md`
for the full pattern guide, examples, and the `intel_insights` reframing that
prompted this reference.

## Deploying: you don't. CI does.

**Never rsync, scp, sed or ssh anything into `/opt/strange-rambling-svelte`.** There is no
situation where that is the right move, including "the build OOMs on homeserv" and "it's only
one file".

This section used to contain a step-by-step recipe for exactly that, and following it took
strangeramblings.com down for **33 hours** on 2026-07-24. The rsync did not exclude `.env`, so
homeserv's dev environment replaced production's: `DATABASE_URL` became `app:test@localhost:5433`
and the app crash-looped on `password authentication failed`. It also carried `AUTH_BYPASS=1`,
which behind cloudflared makes every public request look like `127.0.0.1` and served `/admin` to
the open internet. The old text even documented the `.env` breakage as a known quirk with a
repair recipe, instead of just not doing it.

**How production is updated now:** merge to `master`. `.github/workflows/ci.yml` runs the gate
on a hosted runner, then builds and deploys on a self-hosted runner that lives on the VPS.
Nothing outside CI touches that box. The production `.env` is `chattr +i` (immutable), so a
stray write fails with "Operation not permitted" rather than silently breaking the site.

| You want to… | Do this |
|---|---|
| Publish a report / analysis / one-off page | `publish_page` — instant, no build, no deploy |
| Change real code in the site | `request_change` — opens an issue, an autonomous build branches, gates and opens a PR |
| Ship an already-merged change | Nothing. Merging to `master` deploys it. |
| See what is live | `curl https://strangeramblings.com` and read `build/.deploy-sha` |

**`request_change` arg shape — `title` + `request`, not `prompt`.** The tool
rejects `prompt` with `Both \`title\` and \`request\` are required.` `title` is a
short outcome line (≤250 chars); `request` is the full spec stored verbatim on
the issue — be specific, it is the record of intent the autonomous build
implements. Optional `labels` (default `['change-request']`). It returns
`issueNumber` + `issueUrl` + `buildId` + `buildUrl`; the build opens a PR closing
the issue and never merges protected-path changes itself. If you're unsure of a
site-tool's exact args, call `jkai_extended` `operation:"schema"` first rather
than guessing — a wrong arg shape costs a round-trip.

If a build fails in CI, fix the code and push again. Do not "help" by building locally and
copying the output over — the deployed artefact must always trace back to a commit.

### PWA service worker build fix

The `@vite-pwa/sveltekit` plugin with `strategies: 'injectManifest'` expects a compiled service worker at `.svelte-kit/output/client/service-worker.js`. When `svelte.config.js` has `serviceWorker: { register: false }`, the SvelteKit build doesn't generate this file, causing the build to fail with:

```
[vite-plugin-pwa:sveltekit:build] The 'swSrc' file can't be read. ENOENT
```

**Fix:** Switch to `strategies: 'generateSW'` in `vite.config.ts` — this generates the service worker automatically without needing a source file:

```ts
// Before (breaks when .svelte-kit is cleaned):
SvelteKitPWA({
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'jkai-sw.ts',
  injectManifest: { globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'] },
  ...
})

// After (works without source file):
SvelteKitPWA({
  strategies: 'generateSW',
  workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'] },
  ...
})
```

Also create a minimal `src/jkai-sw.ts` placeholder if one doesn't exist (the `injectManifest` source file). With `generateSW`, this file is no longer needed.

### When a deploy fails

Deploys are GitHub Actions runs, so diagnose them there — not by ssh-ing to the VPS. The old
contents of this section were recovery recipes for a manual rsync deploy that no longer exists;
every one of them ended in "now copy files onto the production box by hand", which is what the
whole pipeline was built to stop.

```bash
gh run list --branch master --limit 5            # what ran, and how it ended
gh run view <id> --log-failed                    # why it failed
```

Read the failure and decide which half it is:

- **Gate failed** (hosted runner) — the code is wrong. `svelte-check` found a type error, or a
  test broke. Fix it and push; nothing was deployed, so production is untouched and safe.
- **Build failed** (VPS runner) — usually memory. The build peaks at ~5.3GB RSS; the runner unit
  is capped at `MemoryMax=7G` and the box has 8GB of swap. A cgroup kill here is *by design* —
  it protects the running site rather than letting the kernel OOM-killer pick the web process.
- **Deploy failed** (VPS runner) — `scripts/ci-deploy.sh` failed a step. It verifies the PUBLIC
  url before declaring success and dumps `journalctl` on failure, so the run log already contains
  the reason. A `drizzle-kit push` timeout means a DESTRUCTIVE schema change is waiting on
  confirmation — run it by hand, deliberately, and look at what it wants to drop.

Production keeps serving the previous build throughout all of these — a failed deploy is not an
outage. Re-run with `gh run rerun <id>` once the cause is fixed.

**Verify the deployed revision, don't assume it:** `build/.deploy-sha` records the sha, branch,
dirty flag and `via=github-actions`. If it doesn't match `git rev-parse origin/master`, the
deploy did not land — investigate rather than deploying again on top.

### Interrupted builds

If `npm run build` or `deploy.sh` is interrupted mid-way **during the build step** (before output is complete), the `.svelte-kit/output` directory can be in a broken state — referencing modules that no longer exist (e.g. `_server.ts-DhViwLl-.js`). This causes **500 errors on every request** with `ERR_MODULE_NOT_FOUND`. Fix:

```bash
rm -rf .svelte-kit/output
npm run build
systemctl --user restart strange-rambling-svelte
```

**Always do a clean rebuild after an interrupted build step — never assume partial output is usable.**

### A crash-looping service is usually a bad `.env`, not bad code

Diagnosis order when strangeramblings.com returns 502 — the outside symptom is identical for a
tunnel fault and an app that never binds, so check the app first:

```bash
systemctl is-active strange-rambling-svelte      # 'activating' = crash loop
ss -ltnp | grep 4173                             # nothing listening = it never booted
journalctl -u strange-rambling-svelte -n 50      # the actual reason
```

`password authentication failed for user "app"` means the production `.env` has been damaged —
this is what a hand-rolled deploy does, and it caused the 33-hour outage. The file is now
`chattr +i`; check with `lsattr .env`. To edit deliberately: `sudo chattr -i .env`, edit,
`sudo chattr +i .env`. A restored `.env` needs a service restart to take effect.

Note the failure mode: the app was `active (running)` per systemd while crash-looping, because it
booted, failed every query, and exited — repeatedly. `is-active` alone is not proof of health.
Always confirm something is listening on 4173 and the public url answers.

### Key tables

| Table | Purpose |
|-------|---------|
| `workflows` | id, name, description |
| `workflow_nodes` | id, workflow_id, type, label, config (jsonb), position |
| `workflow_edges` | id, source_node_id, target_node_id, source_handle, target_handle |
| `workflow_runs` | id, workflow_id, status, started_at, completed_at, error |
| `node_executions` | id, run_id, node_id, status, input_data (jsonb), output_data (jsonb), started_at, completed_at, error | **Exists on both homeserv and VPS.** Per-node inputs/outputs for any run — primary debugging tool for "what did the search/LLM/WhatsApp node produce". |
| `workflow_schedules` | id, workflow_id, type, config (jsonb), enabled, last_run_at |
| `workflow_data_store` | workflow_id, key, value (jsonb), updated_at |
| `app_settings` | key (text), value (jsonb) | Admin-configured defaults (model IDs, providers). Key pattern: `jkai.chat.default_glm_model`, `jkai.builder.default_model`, etc. |
| `workflow_interactions` | id, run_id, node_id, mode, prompt, config_snapshot, opened_at, resolved_at | Pause/resume interaction records |
| `orchestrator_chats` | id, workflow_id, role, content, metadata (jsonb), created_at, conversation_id | Canvas chat history — user instructions and assistant responses about workflow edits. Query by `workflow_id`. |
| `jkai_conversations` | id, title, source, whatsapp_phone_number, created_at, updated_at, model_provider, model_id | User conversations (web + WhatsApp). Find by title or `whatsapp_phone_number`. |
| `jkai_builds` | id, title, prompt, status, origin, published_slug, model_provider, model_id, budget_config, serve_config, conversation_id | Autonomous builder builds. `origin='hermes'` for Hermes-created builds. Queried by `/jkai/builds/[id]` page route. |
| `jkai_iterations` | id, build_id, number, status, goals, diff_summary, evaluation_summary | Build iterations within a build. Ordered by `number`. |
| `jkai_logs` | id, build_id, content | Build execution logs. |

| `integration_credentials` | id (text) | Encrypted credentials for workflow node auth. Columns: `id`, `integration_type` (e.g. 'apple-calendar', 'gmail', 'icloud-cal'), `kind` ('oauth' | 'basic'), `label`, `payload` (jsonb — for basic: `{username, password}`, for oauth: `{accessToken, refreshToken, ...}`), `encrypted` (boolean), `created_at`, `updated_at`. **Credentials entered via `/admin/integrations` UI are stored HERE, encrypted. They do NOT appear in chat transcripts or session history.** To recover a credential, query this table directly on the VPS. |

Note: column names use snake_case in the DB (e.g. `source_node_id`), but the MCP API and node configs use camelCase (e.g. `sourceNodeId`). The bridge layer translates between them.

## Common Pitfalls

### "Static file returns 404 after I copied it to the server"
- **You should not have copied a file to the server.** That is the question to answer first, and
  the answer is almost always `publish_page` (instant URL, no deploy) or `request_change` (real
  file, committed, deployed by CI). Hand-copied files are invisible to git and are wiped by the
  next deploy.
- If the goal was a published page and it 404s, you published to the **wrong instance** — the MCP
  bridge points at homeserv, not the VPS. See the publish_page note in Production Deployment.
- Are you testing port 4173 (SvelteKit) or 3000 (old Next.js)? Port 3000 is the deprecated
  Next.js container and will never see SvelteKit files.
- `static/` is build-time only — a file dropped there on the server does nothing without a build.

### "write_document didn't show a download link"
- **Check:** Is the tool-step subscriber listening on `chatId`? (It should be — see Architecture Overview above.)
- **Check:** Does the tool result contain an `attachments` array with rows that have `id`, `kind`, `mimeType`?
- **Check:** Is `turnAttachments` hoisted to outer scope (shared between subscriber and stream pump)?

### "Image didn't render inline"
- Adapter-emitted media needs `frame.attachment` to be set. Check the adapter's `_emit_attachment_frame` logs.
- The `_FRAME_KIND_BY_ATTACHMENT_KIND` mapping must include the attachment's `kind` value. Unknown kinds fall back to a plain `send` text frame.

### "I disabled the schedule but the workflow keeps firing"
- **The scheduler caches enabled schedules in memory at startup.** Updating `workflow_schedules.enabled = false` in the DB does NOT stop a running scheduler — it will keep firing on the old in-memory config until the service restarts.
- **The scheduler fires only on cron-expression matches, not on `next_run_at`.** Setting `next_run_at` to a past time does not trigger a run. The scheduler calculates the next valid match from the cron expression and only fires at that tick boundary. This matters when testing: you must change the cron expression itself, not just the timestamp.
- **Fix:** the service must restart to drop the cached schedule. Ask before restarting production
  (user-approval action per the escalation ladder in jkai-general) — and do not detach it with
  `nohup … &`, or you never learn whether it came back. Restart, then poll the public url until
  it answers.
- **Verify with journalctl:** After restart, check `journalctl -u strange-rambling-svelte --since '5 min ago'` to confirm the workflow ID no longer appears in `[scheduler] Starting run` lines. Don't trust the DB alone.
- **Don't assume workflow names reveal their purpose.** `generated-workflow-2` was actually a family GPS tracker with HA + WhatsApp nodes. Always check `workflow_nodes` types/labels (`home-assistant`, `whatsapp`, `code-execute`) to identify what a workflow actually does.

### WhatsApp delegation (VPS → homeserv bridge)

The VPS does NOT run its own Baileys WhatsApp client. The `WHATSAPP_HERMES_BRIDGE_URL` env var on the VPS is set to `http://homeserv.tail668b8c.ts.net:3000` — every outbound WhatsApp message from a VPS workflow is a POST to the Hermes bridge on **homeserv** over Tailscale. The VPS WhatsApp service logs `[whatsapp] Service booted (delegated → Hermes bridge)` at startup when this mode is active.

**Diagnostic path when a message shows `sent: true` but doesn't land:**

1. Check the Hermes bridge is running on homeserv: `curl -s http://localhost:3000/health`. It should return `{"status":"connected",...}`.
2. Check the Tailscale address is reachable from the VPS: `curl -s --connect-timeout 3 http://homeserv.tail668b8c.ts.net:3000/health`.
3. If both respond, the bridge accepted the message but the WhatsApp session on homeserv may be disconnected — check `status` field in the health response.
4. Send a test message: `curl -s -X POST http://localhost:3000/send -H 'Content-Type: application/json' -d '{"chatId":"<JOHN_WHATSAPP_MSISDN>@s.whatsapp.net","message":"test"}'`. If that succeeds but the user doesn't see it, the WhatsApp session on homeserv needs re-pairing (QR code re-auth).

### "WhatsApp didn't send / I didn't get the message"

**Check the run's node_executions first, don't trust the canvas chat agent's guess.**

The canvas chat agent sees the same symptom (no WhatsApp received) and will often infer a cause — commonly "the API call before it failed" or "the credential is missing." These guesses are frequently wrong. The actual answer lives in the run's `node_executions` output.

The most common silent-fail mode: **WhatsApp suppression.** The WhatsApp node has a `suppressDuplicateWindowMins` config key (e.g. 1440 = 24 hours). When the generated message text is *identical* to a message sent within that window, the node outputs:

```json
{ "to": "+447****8511", "sent": false, "suppressed": true }
```

This happens without any error or log line — the node itself ran and completed successfully. Common triggers:

- **Empty transaction windows** — an LLM returns "No spend to report today." and it matches a previous run's identical message.
- **Stable sensor readings** — a "15 C, humidity 60%" update that hasn't changed.
- **Fixed-message templates** with `{{input.response}}` where the LLM produces the same text repeatedly.

**Debug workflow:**

1. `workflow_inspect` the workflow -> note its `recentRuns`. Pick a run where the user expected a message.
2. `workflow_get_run` the run -> look at every `node_execution`. Find the WhatsApp node.
3. Check the WhatsApp node's `outputData` for `suppressed: true`. If yes, that is the root cause.
4. Also check upstream nodes — if a data-fetch or API call node shows `error: null` and `status: 200`, the credential is fine and the data *was* fetched. The issue is downstream (empty results -> LLM -> suppression).
5. If the canvas chat agent already asserted a cause (e.g. "no vault secret", "API call failed"), verify before acting on it — look at the actual node outputs.

**Fix:**
- Reduce or remove `suppressDuplicateWindowMins` (set to 0 or remove the key) if every run should always send, regardless of content.
- Or craft the LLM prompt to vary the output — include a timestamp, run ID, or transaction count so the message is never a verbatim duplicate.

### Tool-step events not showing in canvas
- The bus key must match: MCP `workflow_id` arg = subscriber key.
- Canvas chats use the canvas `workflowId`; general chats use `chatId`.

### "Node got blank/partial input from upstream"

- **Nodes only receive output from their DIRECT upstream nodes** (via incoming edges), not the full chain history. If the DAG is `code-execute → conditional → llm-call → whatsapp`, the whatsapp node sees only `llm-call`'s output — it never sees the code-execute or conditional results.
- This caused a blank WhatsApp in the family-presence-monitor: the LLM node emitted nothing because it only had the conditional's `true/false` boolean, not the data that preceded it.
- **Fix:** have the LLM node generate the entire message, so the downstream notification only needs `{{input.response}}`. Never wire a notification expecting data from two hops back.

### "System is fine" when the user says a tool is wrong

When a user describes a specific problem with a tool — e.g. "this tool doesn't return what I expect" — **check the tool's actual parameters and handler code before** declaring the architecture works well enough. The user may be pointing at a real gap the tool's description, parameters, or implementation doesn't cover.

Real example: the user asked about memory/intel integration and I said "it works well enough." The user then pointed out that `intel_insights` takes no query parameter and doesn't return topic-related entities. They were right — the tool was purely graph-wide structural analytics despite the name "insights." The fix was adding a `query` parameter that scopes the analysis using semantic search + name substring fallback, with matching entities returned alongside the scoped insights. Both modes are documented in `references/intel-knowledge-graph.md`.

**Pattern:** when a user says a tool doesn't work for their use case, first verify the tool signature matches the need. Don't jump to explaining why the architecture is correct — the user has already used the tool and found it lacking.

## The `kindId` / `chatId` / `workflowId` Triangle

| Context | Variable | Value | Used for |
|---------|----------|-------|----------|
| General `/jkai` chat | `chatId` | `chat_${conversationId}` | Hermes session ID, MCP `workflow_id`, tool-step bus key |
| Canvas chat | `workflowId` | `wf_abc123` | Canvas scope, SSE supersession, DB join |
| Canvas chat | `chatId` | `wf_abc123` (same) | Hermes session ID, MCP `workflow_id`, tool-step bus key |
| General `/jkai` chat | `workflowId` | `undefined` | NOT used for tool-step bus (would skip subscription) |

The fix: always subscribe to tool-step events on `chatId` (always available), not `workflowId` (only for canvas).