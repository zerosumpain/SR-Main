# JKai Tier 2 + Tier 3 — Design (four features)

Autonomous build (Full grade) of: **#5 Unified Knowledge Recall**, **#3 Natural-language Monitors**, **#4 Personalized Briefing Engine**, **#6 Persistent Agent Team**. Built in dependency order (#5 first — shared retrieval; then #6, #3, #4), deployed incrementally, verified live. Every feature reuses existing infrastructure; nothing invents a new subsystem.

---

## #5 Unified Knowledge Recall

**Goal:** one search across personal memory + research facts + /drive files + datastore records, surfaced as a `knowledge_search` tool, a `/jkai/knowledge` page, and an `@knowledge` mention affordance.

**Design:** `$lib/knowledge/search.ts` fans out (in parallel) over the existing primitives — `searchFiles(q,{topK})` (pgvector), `searchResearch(q,{topK})` (pgvector), `jkaiMemories` ILIKE (mirrors `recall_memories`), and `queryRecords` over a caller-named datastore collection (post-filtered for keyword) — normalises each hit to `{ source, title, passage, score, ref }`, merges, and ranks. New `site-tools/tools/knowledge.ts` (`knowledge_search`, toolset `knowledge`) added to `registry.ts` import+manifest and to `ESSENTIAL_TOOL_NAMES`. Page `/jkai/knowledge` (owner-gated by hooks) + `POST /api/jkai/knowledge/search`. `@knowledge` added to client `MENTION_OPTIONS`.

**Decisions:** D1 fan-out over existing fns, no new unified index (reversible). D2 v1 = tool+page+essential; the `@knowledge` *pinned Hermes skill* (`jkai-knowledge` in `~/.hermes-jkai`) is deferred — the tool is essential so chat can already call it. D3 memory/datastore branches are keyword (no embeddings) — flagged in results.

---

## #3 Natural-language Monitors

**Goal:** "watch X, tell me when Y" → JKai builds a scheduled workflow and registers it; `/jkai/monitors` manages them.

**Design:** `site-tools/tools/monitors.ts` — `monitor_create(description, cron?)` calls `generateWorkflow(description, null)`, persists it (new-canvas branch, mirroring `workflow_generate`), then **explicitly attaches a cron schedule** (`saveWorkflowFromGenerated`/generate path skips the `workflow_schedules` row) via a `workflow_schedules` insert + `registerCronJob`, and records a marker in a `monitors` datastore collection (`{workflowId, description, cron, createdAt}`). `monitor_list` reads markers joined to `workflow_schedules.lastRunAt` (last-check) + a `node_executions` dedupe-output query (last-hit). `/jkai/monitors` page = clone of `/jkai/channels` toggle rows; enable/disable flips `workflow_schedules.enabled` + `reloadSchedule`.

**Decisions:** D1 reuse `generateWorkflow` (existing NL path) not a bespoke assembler. D2 default cadence when the description gives none → every 6h. D3 monitors are ordinary workflows tagged by a datastore marker (so they still open in the canvas).

---

## #4 Personalized Briefing Engine

**Goal:** a scheduled digest that synthesises what you care about and delivers it.

**Design:** clone `src/lib/selfimprove/` → `src/lib/briefing/`: `engine.ts` (cron register in `hooks.server.ts`, host/kill/idle gates), `run.ts` (budget + lock + gather→synthesise→report phases), `gather.ts` (question_insights `latest` + recent `researchSessions` + landing-vitals `compute()` + `site-signals` tools), `report.ts` (LLM synthesis + `whatsapp_send`), `types.ts` (`COLLECTIONS.briefings`, `SYSTEM_PERMISSIONS.briefings`, `BriefingData`, cron `30 6 * * *` Europe/London, kill-switch `briefing.enabled`), `seed.ts` (`ensureSystemCollections`). Page `/jkai/briefing` (read past briefings) + `POST /api/admin/briefing/{run,toggle}`.

**Decisions:** D1 clone the proven self-improve harness (gates/budget/lock identical). D2 v1 personalisation = `question_insights` + configurable topics; click-through engagement-weighting deferred. D3 prod-only gate mirrored (VPS); walk/presence signals are homeserv-only so a VPS briefing gathers what's present there — logged, not blocking.

---

## #6 Persistent Agent Team

**Goal:** named specialists (persona + allowed tools + shared memory) JKai delegates to.

**Design:** agent defs live in a `jkai-agents` datastore system collection (`{name, role, persona, allowedTools[], model?}`). `site-tools/tools/agents.ts` — `agent_list`, `agent_upsert`, and `delegate_to_agent(agentName, task)` which runs the existing `generalChat` primitive with `subagentDepth:1`, `toolWhitelist = agent.allowedTools`, and a **new `personaPrompt` `ChatOptions` field** prepended to the system prompt (mirrors the orchestrator's `personalityPrompt`), returning the result text. Shared memory = a datastore collection read/written as actor `jkai` (all agents already share jkai's grants — no permissions-SQL change). `/jkai/agents` page = manage agents (clone `/jkai/channels`) + a delegate/test box.

**Decisions:** D1 reuse `generalChat` as the agent-turn primitive (not the generation-specific `runToolLoop`). D2 minimal `personaPrompt` addition to `ChatOptions`, prepended to `systemContent`. D3 shared memory via `jkai` actor (per-team `agent:*` actor scoping deferred — would touch `permissions.ts` SQL). D4 v1 delegation is synchronous returning text; live WorkerTray streaming deferred.

---

## Cross-cutting

- All four are owner-gated automatically (hooks). All datastore writes use the `system`/`jkai` actor per precedent. LLM only via the gateway/`llm-client`. Each ships with tests for its pure logic + a live verification (endpoint/tool + page). Incremental deploys after each feature.
- **Deferred (logged, not built):** `@knowledge` Hermes pinned skill; monitor advanced cadence parsing; briefing engagement-learning; per-team datastore actor + live delegation WorkerTray. All reversible/additive.
