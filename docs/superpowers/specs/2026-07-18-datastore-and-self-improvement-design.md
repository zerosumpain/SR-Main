# Datastore + Self-Improvement — Design Spec

**Date:** 2026-07-18 · **Mode:** autonomous (Full grade) · **Author:** Claude (Fable), plan approved by self per autonomous-build skill.

## Brief (from John)

1. A **permanent database** flexible enough to record complex data from workflows and act as permanent memory. Workflows get **full CRUD** access including **row-level controls**. Usable **sitewide**.
2. JKai should **prioritise identifying APIs** to find useful data when answering questions, **learn from the type of questions** the user asks, and **spend time each day when not being used** developing tools or features that could help the user.

Enterprise level of capability. Feature-score candidates /100, build the high scorers. Workflow agents = opus. Plan in Fable.

**Interpretation note (logged):** "build any hi by over 100" is read as "build any sub-feature scoring ≥ 70/100" — the established scoring-threshold pattern. Everything ≥ 70 below is in scope; < 70 is explicitly deferred with reasoning.

---

## Feature scoring (build ≥ 70)

| # | Sub-feature | Score | Verdict |
|---|---|---|---|
| 1 | Collections + jsonb records, natural-key upsert | 95 | build |
| 2 | Safe filter/query DSL + aggregates over jsonb | 92 | build |
| 3 | Row-level permissions (capability map + actor model) | 90 | build |
| 4 | Audit log with before/after images (doubles as revision history) | 85 | build |
| 5 | Optional JSON-Schema validation per collection | 80 | build |
| 6 | TTL/expiry + reaper sweep | 74 | build |
| 7 | `database` workflow node (full CRUD ops) | 96 | build |
| 8 | `datastore` jkai toolset (chat + Hermes via MCP) | 95 | build |
| 9 | Admin browser UI (collections → records → detail + query console) | 88 | build |
| 10 | Optimistic concurrency (`version` column) | 72 | build |
| 11 | JSON export of a collection (admin UI) | 70 | build |
| 12 | API catalogue (seeded, searchable, self-extending) | 93 | build |
| 13 | `api_search` / `api_register` tools | 92 | build |
| 14 | `api_call` generic executor with SSRF guard + env-ref auth | 85 | build |
| 15 | API-first prompt guidance (Hermes SKILL.md + legacy prompt + essentials + classifier) | 90 | build |
| 16 | Nightly question-intent analysis → insights collection | 90 | build |
| 17 | Nightly self-improvement scheduler (idle gate, kill switch, budget cap) | 94 | build |
| 18 | Auto-developed **runtime** custom tools (create → sandbox test → enable) | 88 | build |
| 19 | API discovery via web research + live probe verification | 82 | build |
| 20 | Nightly report (datastore record + WhatsApp notify) | 86 | build |
| 21 | `/admin/ai/improvement` dashboard | 87 | build |
| 22 | pgvector semantic search over datastore records | 65 | defer — cost/complexity vs. query DSL; revisit once record volume justifies it |
| 23 | `{{db.*}}` template namespace in engine interpolation | 68 | defer — node `get`/`query` output + `{{input.*}}` already covers the flows |
| 24 | Unattended repo codegen (node-builder without human gate) | 40 | defer — self-written repo code deploying unattended is the one genuinely dangerous fork; nightly loop emits *proposals* instead |
| 25 | Public/anonymous HTTP API for datastore | 55 | defer — no consumer; sitewide = lib + node + tools + admin UI |
| 26 | CSV import in admin UI | 60 | defer — JSON export covers the near need |

---

## Feature 1 — The Datastore

### Approaches considered

- **A. Extend `workflow_data_store`** (per-workflow KV). Rejected: workflow-scoped by design, no collections/rows semantics, no room for row-level ACLs; would overload a stable primitive.
- **B. Collections + jsonb records on Postgres/Drizzle** — new `datastore_*` tables, a `$lib/datastore/` access layer as the single choke point, surfaces layered on top. **Chosen**: matches every mapped precedent (jsonb-heavy tables, `uniqueIndex` convention, capability-map permissions from `workflow_files`, atomic upserts from `data-store` node), fully reversible.
- **C. Dynamic DDL (a real table per collection).** Rejected: DDL from workflows fights Drizzle migrations, no precedent, dangerous failure modes.

### Schema (3 tables in `src/lib/db/schema.ts`)

Follow the `uniqueIndex()`-in-callback convention (never `.unique()` on populated tables).

- **`datastore_collections`** — `id` uuid PK, `slug` text (uniqueIndex), `name`, `description`, `schema` jsonb nullable (JSON-Schema subset), `defaultPermissions` jsonb, `settings` jsonb (`ttlSeconds?`, `maxRecords?`, `maxPayloadBytes?`), `isSystem` boolean default false, `createdBy` text (actor string), `createdAt`, `updatedAt`.
- **`datastore_records`** — `id` uuid PK, `collectionId` FK, `key` text nullable (uniqueIndex on `(collectionId, key)` where key not null), `data` jsonb, `permissions` jsonb nullable (row-level override), `version` integer default 1, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`, `expiresAt` timestamp nullable. Index on `(collectionId, updatedAt)`.
- **`datastore_audit_log`** — `id` uuid PK, `collectionId`, `recordId` nullable, `actor` text, `action` text (`insert|update|delete|expire|permissions|collection_create|collection_update|collection_delete`), `before` jsonb nullable, `after` jsonb nullable, `createdAt`. Index on `(collectionId, createdAt)`.
No dedicated Feature-2 tables — engine state dogfoods the datastore (see Feature 2). Possible exception: an `enabled` column on `custom_tools` if it lacks one (checked at build time).

### Actor + permission model (row-level controls)

Actor strings: `owner`, `jkai` (chat/Hermes), `system` (engines/reapers/nightly loop), `workflow:<id>`, `workflow:*` (any workflow), `*` (any authenticated principal incl. guests). Permissions shape (precedent: `workflow_files.permissions`):

```json
{ "read": ["owner", "jkai", "workflow:*"], "write": ["owner", "workflow:abc"], "delete": ["owner"] }
```

Resolution: record `permissions` if set, else collection `defaultPermissions`, else built-in default `{read/write/delete: [creator, "owner", "jkai"]}`. `owner` always passes every check (cannot lock John out). Enforcement lives in **one place**: `$lib/datastore/permissions.ts`, called by the access layer — nodes/tools/UI never re-implement checks. Every surface passes an explicit `actor` derived from its context (node → `workflow:<id>`, tools → `jkai`, admin UI/API → `owner`, engines → `system`). Workflows can set/update row permissions on write (that *is* the row-level control the brief asks for), audited as `permissions` actions.

### Query DSL

Safe, small, compiled to parameterized Drizzle `sql` fragments — never raw string interpolation. Filter: array of `{path, op, value}` with `op ∈ {eq, ne, gt, gte, lt, lte, contains, exists, in}`; `path` validated against `/^[a-zA-Z0-9_.]+$/` and compiled to `data #>> '{a,b}'` (or `@>` for `contains`). Plus `sort: {path|createdAt|updatedAt|key, dir}`, `limit` (cap 500), `offset`. Aggregates: `count`, and `sum|avg|min|max` over a numeric path, optional `groupBy` path. Type-aware comparisons cast numerics via `(data #>> path)::numeric` when the operand is a number.

### Access layer — `$lib/datastore/`

`types.ts`, `collections.ts` (create/get/list/update/delete, slug rules, system-collection protection), `records.ts` (insert/bulkInsert/get/getByKey/query/update/patch/upsert/delete/count/aggregate — upsert via `ON CONFLICT` on `(collectionId,key)`, updates bump `version`, optional `expectedVersion` optimistic check), `query.ts` (DSL compiler), `permissions.ts`, `validate.ts` (use `ajv` if already a dependency, else a minimal subset validator: type/required/properties/enum/min/max/pattern), `audit.ts` (fire-and-forget writes, precedent `llm-usage-log`), `ttl-reaper.ts` (hourly in-process sweep, precedent: existing schedulers; audits `expire`), `index.ts` (public API). Guardrails: payload cap (default 256 KB/record), `maxRecords` per collection (default 50k) — clear errors, all enforced in the lib.

### Surfaces

1. **Workflow node `database`** (label "Database", category `integration`) — modeled directly on `data-store` node: `operation` dropdown (`insert|upsert|get|query|update|patch|delete|count|aggregate`) with `visibleWhen` fields, `collection` (slug, `autoCreate` toggle default on), template-interpolated args, `permissions` optional field on writes, dry-run gated writes, `summarize()`, rich `llmDescription`/`llmExamples` so the generator reaches it. Registered in all **three parity places** (`index.ts`, `registry-client.ts`, `adapter.ts` palette entry) + `basicConfig` form.
2. **jkai toolset `datastore`** (new file `site-tools/tools/datastore.ts` + import in `registry.ts` + toolset description): `datastore_list_collections`, `datastore_create_collection`, `datastore_query` (read), `datastore_get`, `datastore_save` (insert/upsert), `datastore_update`, `datastore_delete` (**destructive**). Tool descriptions teach the split: *structured/queryable data → datastore; distilled personal facts → save_memory*. `describeDestructiveAction()` line added. Keyword-classifier mappings (`database`, `record`, `dataset`, `remember table`, …).
3. **Admin UI `/admin/ai/datastore`** — copy blog list+detail precedent: collections list (counts, system badge) → collection page: records table, query console (DSL form), record detail drawer (JSON editor, permissions editor, version/audit trail, restore-from-audit), JSON export. Mutations via `/api/admin/datastore/*` JSON routes with `?token=` (precedent: access/models pages). `admin-nav.ts` entry under AI. Styling per `sr-design` (`.nm-sec` etc.).

### Error handling & testing

Lib throws typed errors (`DatastoreError` with `code`: `not_found|forbidden|validation|conflict|limit`); node maps them to node failures honouring `_onError`; tools return `{success:false, error}`. Vitest: query-compiler unit tests (op matrix, path sanitization, injection attempts), permissions matrix tests, validator tests, upsert/version race tests, tool-handler tests (precedent `publish-page.test.ts`), parity tests cover registration automatically.

---

## Feature 2 — API-First Answering + Nightly Self-Improvement

### Approaches considered

- **A. Cron workflow** (seed a canvas workflow like policy-engine's). Rejected for the core loop: the pipeline needs code-level access (Hermes audit, custom-tool authoring, datastore internals) that a node graph only reaches awkwardly.
- **B. Dedicated in-process engine** (`$lib/selfimprove/`) copying the forge-scheduler/heartbeat pattern + Hermes-curator idle gating, dogfooding the datastore for all state. **Chosen** — every ingredient is a shipped precedent.
- **C. Hermes-side cron job** (jobs.json prompt). Rejected: opaque, no admin UI, no budget control, and Hermes cron delivery is WhatsApp-oriented.

### 2a. API catalogue + tools (sitewide, dogfoods the datastore)

System collections (`isSystem: true`, created by an idempotent seed on boot):

- **`api_catalog`** — records: `{name, baseUrl, docsUrl, description, capabilities[], tags[], auth: {kind: 'none'|'bearer-env'|'header-env', envVar?, header?}, exampleRequests[], status: 'seeded'|'candidate'|'verified'|'broken', lastVerifiedAt, source}`. Seeded with the APIs already used across the site (EES, GIAS, ONS, World Bank, gov.uk registers, OpenRouter, Tavily, open-meteo, Wikipedia/Wikidata, TfL, …) — seed data in `$lib/selfimprove/seed-apis.ts`.
- **`question_insights`** — nightly-maintained: `{period, intents: [{intent, count, examples[], servedWell, missingCapability}], topUnmet[]}`.
- **`improvement_runs`** — one record per nightly run: `{status, startedAt, finishedAt, phases: {...}, llmCalls, tokens, costUsd, actions: [{kind, detail, reversible}], report}`.

New toolset **`apis`** (`site-tools/tools/apis.ts`): `api_search` (rank catalogue entries against a question/capability — substring+tag scoring, no LLM), `api_call` (execute a request against a **catalogued** API only: URL must extend the entry's `baseUrl`; DNS/IP SSRF guard denies private/loopback/link-local ranges; auth resolved server-side from env-var references — raw secrets never stored in records; 15s timeout; response truncated to 100 KB), `api_register` (add/update candidate entries — how jkai and the nightly loop grow the catalogue). `api_search` + `api_call` join `ESSENTIAL_TOOL_NAMES` so they survive the MCP meta-tool squeeze.

**API-first behavior:** (1) `~/.hermes-jkai/skills/jkai-general/SKILL.md` (+ `jkai-canvas` if it answers data questions) gains an "API-first data answering" section — for any question about current/factual/numeric data: `api_search` first, `api_call` to fetch, cite the source, fall back to model knowledge only when no API fits, and `api_register` newly-discovered good APIs; repo committed + pushed (standing rule). (2) Same guidance added to the legacy `general-chat.ts` prompt assembly. (3) Keyword-classifier maps data-question vocabulary to the `apis` toolset.

### 2b. Nightly engine — `$lib/selfimprove/`

`engine.ts` — croner schedule (default `30 3 * * *` Europe/London) + `startSelfImprovement()` wired in `hooks.server.ts`. Gates, in order:
1. **Host gate**: refuses to schedule when hostname is `homeserv` (inverse of the scraper's homeserv-only gate) unless `SELF_IMPROVE_ALLOW_DEV=1` — prod-only without VPS env changes.
2. **Kill switch**: `app_settings` key `selfimprove.enabled` (default `true`, toggle in admin UI).
3. **Idle gate** (Hermes-curator precedent): skip if any user chat activity (`orchestrator_chats` latest user row) within the last 60 min; re-check between phases and abort gracefully if John shows up.
4. **Overlap guard**: skip if a run is already `running` (forge-scheduler precedent).

`run.ts` — the pipeline, each phase recorded on the run record, wall-clock cap 25 min, **budget cap**: max 40 gateway LLM calls and ~$0.50 estimated (tracked via usage capture); hard-stops mark the run `budget_exceeded`:

1. **Gather** (`analyze.ts`): last 7 days of user questions (`orchestrator_chats`), tool audit (`rToolAudit` — host-switch aware), `custom_tools` run/error telemetry, current insights.
2. **Learn**: LLM (gateway, default model) classifies questions into intents, flags unmet needs (questions with no good data source/tool) → upsert `question_insights`.
3. **Discover** (`discover.ts`): for top unmet needs, research candidate APIs (Tavily/web tools), **verify with a live probe** through the same SSRF-guarded executor, `api_register` the good ones as `candidate`/`verified`.
4. **Build** (`toolsmith.ts`): pick the single highest-value opportunity; author a **runtime custom tool** via the existing `create_tool`/`custom-tool-loader` machinery (tagged `source: 'self-improvement'`), **sandbox test-invoke** with sample args; keep only if the test passes, else delete and log the failure. Bigger ideas (new nodes, repo features) become written **proposals** in the run report — never unattended repo deploys.
5. **Report** (`report.ts`): finalize the `improvement_runs` record + short WhatsApp summary via `whatsapp_send` (what was learned / registered / built / proposed, cost).

### 2c. Admin dashboard — `/admin/ai/improvement`

Runs list + latest report, question-insight explorer, API catalogue table (status, verify-now), self-built tools list (disable/delete), controls: enabled toggle (`selfimprove.enabled`), schedule display, **Run now** button (`POST /api/admin/improvement/run` — bypasses idle gate, keeps budget caps). Same admin conventions as the datastore UI.

### Error handling & testing

Every phase try/caught independently — a failed phase marks the run `partial`, later phases still run where sensible; engine never throws into the scheduler. Vitest: idle-gate logic, budget accounting, catalogue seed idempotency, `api_call` SSRF guard matrix (private-IP denial, baseUrl prefix enforcement), toolsmith test-gate (failing tool never persists enabled).

---

## Decision Log

| # | Decision | Options | Chosen + why | Reversible? |
|---|---|---|---|---|
| D1 | Datastore architecture | extend workflow_data_store / **collections+jsonb** / dynamic DDL | B — precedent-matched, flexible, safe | Yes (new tables only) |
| D2 | Naming | — | tables `datastore_*`, lib `$lib/datastore/`, node `database`, toolset `datastore` (avoids `data-store` node collision) | Yes |
| D3 | Threshold interpretation | — | "score /100, build ≥ 70"; garbled "over 100" read as the usual threshold pattern | Yes (deferred items listed) |
| D4 | Row-level control shape | per-row ACL rows / **capability-map jsonb** | `workflow_files.permissions` precedent; single enforcement choke point | Yes |
| D5 | Validation dependency | ajv / hand-rolled subset | use ajv **iff already in package.json**, else minimal subset validator — no new deps | Yes |
| D6 | Feature 2 state storage | new tables / **dogfood datastore system collections** | proves Feature 1, gives free CRUD/UI/audit | Yes |
| D7 | Nightly trigger | cron workflow / **in-process croner engine** / Hermes cron | forge-scheduler + curator precedents; full code access + admin control | Yes |
| D8 | Prod-only gating | VPS env var / **hostname gate (≠ homeserv)** | scraper precedent (inverse); zero VPS repo changes | Yes |
| D9 | "Develops tools" mechanism | repo codegen unattended / **runtime custom tools + proposals** | reversible, test-gated, no unattended deploys (scored 40 — rejected) | Yes (tools deletable) |
| D10 | api_call security | open fetch / **catalogue-scoped + SSRF guard + env-ref auth** | enterprise guardrail; secrets never in records | Yes |
| D11 | Admin placement | Content / **AI section** | it's jkai/workflow memory; nav precedent | Yes |
| D12 | WhatsApp nightly ping | silent / **short summary** | John's established notification channel; low noise (1/night max) | Yes |

## Files to touch (full list)

**Schema/core:** `src/lib/db/schema.ts` · `src/lib/datastore/{index,types,collections,records,query,permissions,validate,audit,ttl-reaper}.ts` · tests alongside precedent test locations.
**Node:** `src/lib/workflows/nodes/database.def.ts` + `database.ts` · `src/lib/workflows/index.ts` · `src/lib/workflows/registry-client.ts` · `src/lib/canvas/adapter.ts`.
**Toolsets:** `src/lib/workflows/site-tools/tools/datastore.ts` + `apis.ts` · `site-tools/registry.ts` (imports + descriptions) · `keyword-classifier.ts` · `src/lib/mcp/essentials.ts` · `src/lib/workflows/chat/confirmation-gate.ts`.
**Self-improvement:** `src/lib/selfimprove/{engine,run,analyze,discover,toolsmith,report,seed-apis,types}.ts` · `src/hooks.server.ts` (start + reaper wiring).
**Admin:** `src/routes/admin/ai/datastore/…` (+ `[collection]`) · `src/routes/admin/ai/improvement/…` · `src/routes/api/admin/datastore/…` · `src/routes/api/admin/improvement/…` · `src/lib/components/admin/admin-nav.ts`.
**Prompts:** `src/lib/workflows/chat/general-chat.ts` (API-first section) · `~/.hermes-jkai/skills/jkai-general/SKILL.md` (+ commit/push that repo).
**Maybe:** `custom_tools` `enabled` column + loader respect (checked at build time).

## Verification (stated before code, per solution-design)

1. `npm test` (parity + new unit tests) and `NODE_OPTIONS=--max-old-space-size=8192 npm run check` — green locally.
2. Local smoke: dev server → create a workflow with a `database` node writing + querying a collection; `datastore_query`/`api_search` tools respond in /jkai.
3. Deploy via `ship` (includes prod `drizzle-kit push`); live checks on strangeramblings.com: `/admin/ai/datastore` and `/admin/ai/improvement` render with seeded `api_catalog`; `POST /api/admin/improvement/run` (admin token) completes a run and the run record + WhatsApp ping appear; a live workflow run exercises the `database` node.
4. Hermes restart if MCP tool list is stale (known post-deploy behavior); confirm `api_search` visible from Hermes.
