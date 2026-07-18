# Datastore + Self-Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This run executes via Workflow-orchestrated opus agents: one agent per task, tasks within a phase run in parallel on disjoint file sets, the orchestrator integrates + commits per phase.**

**Goal:** Ship (1) a permanent flexible datastore with full CRUD + row-level controls usable from workflows, jkai chat/Hermes, and an admin UI; (2) API-first answering plus a nightly idle-time self-improvement engine that learns from user questions and develops runtime tools.

**Architecture:** New `datastore_*` Postgres tables behind a single access layer `$lib/datastore/` (permissions enforced in one choke point); surfaces = `database` workflow node, `datastore` + `apis` toolsets, admin pages. Self-improvement = in-process croner engine (`$lib/selfimprove/`) dogfooding the datastore for all state, gated by host/kill-switch/idle/overlap, budget-capped, reporting via WhatsApp + admin dashboard.

**Tech Stack:** SvelteKit (Svelte 5 runes), Drizzle ORM + PostgreSQL 16 jsonb, croner, vitest, existing LLM gateway (`getLLMClient` / `resilientChatCompletion`), existing site-tool registry + MCP bridge.

**Spec:** `docs/superpowers/specs/2026-07-18-datastore-and-self-improvement-design.md` (read it first — scoring table, Decision Log, security model).

## Global Constraints

- All LLM calls via `$lib/jkai/llm-client` / `$lib/llm/workflow-gateway` — **never** provider SDKs directly.
- Schema: use `uniqueIndex('...')` inside the table callback, never column `.unique()` (non-interactive push gotcha). Local push: `CI=1 DATABASE_URL=<local> npx drizzle-kit push --config=drizzle.config.ts --force`.
- `npm run check` and builds need `NODE_OPTIONS=--max-old-space-size=8192`; production build fails under the Bash sandbox at adapter-node — run with sandbox disabled.
- Any `.svelte` file: follow `svelte5-pitfalls` skill (no $state on internal handles read from $effect; hoist prop reads; untrack writes). Admin UI: follow `sr-design` (`.nm-sec`, `.nm-text-input`, `.nm-save-btn`, `.row-link`, PageWrap/PageHeader, CSS-var palette only).
- All output/comments/naming in English. No new npm dependencies unless the plan says so explicitly (validator: use `ajv` only if ALREADY in package.json).
- Agents do NOT `git commit` (parallel index races) — run your tests, leave the working tree clean of stray files; the orchestrator commits per phase.
- glm models: pass `thinking:{type:'disabled'}` or `max_tokens ≥ 3000` on gateway calls.
- Tests: colocate `*.test.ts` next to the module (precedent: `src/lib/workflows/site-tools/tools/publish-page.test.ts`). Run scoped: `npx vitest run <path>`.

## Pinned cross-task interfaces (single source of truth)

```ts
// $lib/datastore/types.ts
export type DatastoreActor = string; // 'owner' | 'jkai' | 'system' | `workflow:<id>` | '*'
export interface PermissionSet { read?: string[]; write?: string[]; delete?: string[] }
export interface CollectionSettings { ttlSeconds?: number; maxRecords?: number; maxPayloadBytes?: number }
export interface QueryFilter { path: string; op: 'eq'|'ne'|'gt'|'gte'|'lt'|'lte'|'contains'|'exists'|'in'; value?: unknown }
export interface QuerySort { path?: string; field?: 'createdAt'|'updatedAt'|'key'; dir: 'asc'|'desc' }
export interface QueryOptions { filters?: QueryFilter[]; sort?: QuerySort; limit?: number; offset?: number; includeTotal?: boolean }
export interface AggregateOptions { op: 'count'|'sum'|'avg'|'min'|'max'; path?: string; groupBy?: string; filters?: QueryFilter[] }
export type DatastoreErrorCode = 'not_found'|'forbidden'|'validation'|'conflict'|'limit';
export class DatastoreError extends Error { constructor(public code: DatastoreErrorCode, message: string) }
export interface RecordInput { key?: string; data: Record<string, unknown>; permissions?: PermissionSet; expiresAt?: Date }
```

```ts
// $lib/datastore/index.ts — public API (all enforce permissions via permissions.ts; all audit via audit.ts)
ensureCollection(slug: string, opts: { name?: string; description?: string; schema?: object|null; defaultPermissions?: PermissionSet; settings?: CollectionSettings; isSystem?: boolean }, actor: string)
getCollectionBySlug(slug: string)            // no ACL (metadata read), returns null if missing
listCollections(actor: string)               // filters to collections the actor can read
updateCollection(slug: string, patch: {...same opts}, actor: string)
deleteCollection(slug: string, actor: string)        // DatastoreError('forbidden') on isSystem
insertRecord(slug: string, input: RecordInput, actor: string)
bulkInsertRecords(slug: string, inputs: RecordInput[], actor: string)   // cap 100/batch
upsertRecord(slug: string, input: RecordInput & { key: string }, actor: string) // ON CONFLICT (collectionId,key)
getRecord(slug: string, id: string, actor: string)
getRecordByKey(slug: string, key: string, actor: string)
queryRecords(slug: string, opts: QueryOptions, actor: string): Promise<{ records: DatastoreRecord[]; total?: number }>
updateRecord(slug: string, ref: { id?: string; key?: string }, changes: { data?: object; patch?: object; permissions?: PermissionSet; expiresAt?: Date|null; expectedVersion?: number }, actor: string)
deleteRecord(slug: string, ref: { id?: string; key?: string }, actor: string)
countRecords(slug: string, filters: QueryFilter[]|undefined, actor: string): Promise<number>
aggregateRecords(slug: string, opts: AggregateOptions, actor: string)
```

```ts
// $lib/server/ssrf-guard.ts (created in Task 3)
assertPublicUrl(url: string, opts?: { allowInternal?: boolean }): Promise<URL>
// throws Error('ssrf_blocked: ...') for non-http(s), private/loopback/link-local/CGNAT IPs (checks literal IPs AND DNS resolution)
```

```ts
// $lib/selfimprove/run.ts (Task 4)
runImprovementNow(opts?: { trigger?: 'manual'|'cron' }): Promise<{ runId: string }>  // rejects if already running
getImprovementStatus(): { running: boolean; lastRunId?: string }
// $lib/selfimprove/engine.ts (Task 4)
startSelfImprovement(): void   // also seeds system collections + api catalog (seeding is host-agnostic; only cron is prod-gated)
```

**Pinned names:** node type `database`; toolsets `datastore` (tools: `datastore_list_collections`, `datastore_create_collection`, `datastore_query`, `datastore_get`, `datastore_save`, `datastore_update`, `datastore_delete`) and `apis` (tools: `api_search`, `api_call`, `api_register`). System collection slugs: `api_catalog`, `question_insights`, `improvement_runs`. Settings key: `selfimprove.enabled`. api_catalog record key = slugified name; improvement_runs key = runId; question_insights keys `latest` + `weekly:<YYYY-WW>`.

**Improvement run record shape** (`improvement_runs.data`):
```ts
{ status: 'running'|'complete'|'partial'|'budget_exceeded'|'aborted_user_active'|'failed',
  trigger: 'cron'|'manual', startedAt: string, finishedAt?: string,
  phases: Record<'gather'|'learn'|'discover'|'build'|'report', { status: 'ok'|'failed'|'skipped'; detail?: string; ms?: number }>,
  llmCalls: number, tokensIn: number, tokensOut: number, costUsd: number,
  actions: Array<{ kind: 'insight'|'api_registered'|'api_verified'|'tool_created'|'tool_rejected'|'proposal'; detail: string }>,
  report: string }
```

**api_catalog record shape** (`data`): `{ name, baseUrl, docsUrl?, description, capabilities: string[], tags: string[], auth: { kind: 'none'|'bearer-env'|'header-env', envVar?, header? }, exampleRequests: Array<{ label, method, url, body? }>, status: 'seeded'|'candidate'|'verified'|'broken', lastVerifiedAt?, source: 'seed'|'jkai'|'selfimprove' }`

---

## Phase 1 — Foundation (sequential; 1 agent)

### Task 1: Schema + `$lib/datastore/` access layer + tests

**Files:**
- Modify: `src/lib/db/schema.ts` (append 3 tables: `datastore_collections`, `datastore_records`, `datastore_audit_log` — columns per spec §Feature 1 Schema; jsonb via existing helpers; `uniqueIndex` on `datastore_collections.slug` and partial uniqueIndex on `(collection_id, key) WHERE key IS NOT NULL`; index `(collection_id, updated_at)` on records, `(collection_id, created_at)` on audit)
- Create: `src/lib/datastore/types.ts`, `permissions.ts`, `validate.ts`, `query.ts`, `audit.ts`, `collections.ts`, `records.ts`, `ttl-reaper.ts`, `index.ts`
- Test: `src/lib/datastore/query.test.ts`, `permissions.test.ts`, `validate.test.ts`, `records.test.ts`

**Interfaces:** Produces exactly the pinned `$lib/datastore` API above — later tasks import from `$lib/datastore` (the `index.ts` barrel) only.

Key behaviors (all from spec — reread it):
- `permissions.ts`: `resolvePermissions(record, collection): Required<PermissionSet>`; `assertCan(action: 'read'|'write'|'delete', perms, actor)`; `'owner'` always passes; `workflow:*` matches any `workflow:<id>` actor; `'*'` matches everyone; creator default `{read/write/delete: [creator,'owner','jkai']}` (dedup'd).
- `query.ts`: `compileFilters(filters): SQL` — paths must match `/^[a-zA-Z0-9_.]+$/` else `DatastoreError('validation')`; text compare via `data #>> '{a,b}'`; numeric operand → cast `::numeric`; `contains` → `data #> '{path}' @> $json` ; `exists` → `data #> '{path}' IS NOT NULL`; `in` → `= ANY`; limit cap 500. Parameterize via drizzle `sql` template — NEVER string-concat values.
- `records.ts`: upsert = single `INSERT ... ON CONFLICT (collection_id, key) DO UPDATE` bumping `version = datastore_records.version + 1`, `updated_at = now()`; `expectedVersion` mismatch → `DatastoreError('conflict')`; payload > `maxPayloadBytes` (default 262144) → `'limit'`; insert beyond `maxRecords` (default 50000, checked via count) → `'limit'`; schema present → validate `data` → `'validation'` with field detail.
- `validate.ts`: check package.json for `ajv`; if absent implement subset: `type` (object/string/number/boolean/array/null since it's jsonb), `required`, `properties` (recursive), `enum`, `minimum`/`maximum`, `pattern`, `items`. Export `validateAgainstSchema(data, schema): { ok: true } | { ok: false; errors: string[] }`.
- `audit.ts`: `auditDatastore(entry): void` fire-and-forget (precedent `src/lib/jkai/llm-usage-log.ts` — swallow errors). Before/after images; `update` stores both; `delete` stores before only.
- `ttl-reaper.ts`: `startDatastoreReaper()` — `setInterval` hourly + immediate boot sweep; deletes `expires_at < now()` records, audits each as `expire` with actor `system`; also applies collection `settings.ttlSeconds` (records older than ttl by `updated_at`). Do NOT wire into hooks here (Task 4 owns hooks.server.ts).

**Steps:**
- [ ] Read spec + precedent files: `src/lib/db/schema.ts` (workflowDataStore ~line 1182, workflowFiles ~1694 for permissions jsonb, projectShares for uniqueIndex style), `src/lib/workflows/nodes/data-store.ts` (atomic upsert SQL style), `src/lib/jkai/llm-usage-log.ts`.
- [ ] Write failing tests for `query.ts` (op matrix incl. numeric cast, path sanitization rejects `a'; DROP`, `a-b`, empty; limit cap; contains/exists/in), `permissions.ts` (matrix: owner-always, workflow:* wildcard, `*`, deny-by-default, record-overrides-collection), `validate.ts` (subset semantics + unknown-keyword tolerance).
- [ ] Run: `npx vitest run src/lib/datastore` → FAIL (modules missing).
- [ ] Add the 3 tables to `schema.ts`; push to local DB (`CI=1 ... drizzle-kit push ... --force` with DATABASE_URL from `.env`).
- [ ] Implement types → permissions → validate → query → audit → collections → records → ttl-reaper → index barrel.
- [ ] `records.test.ts` against the local DB (precedent: check how existing DB-touching tests get a connection; if none do, keep records tests at the compile-SQL boundary via `compileFilters` + mock `db` using vitest `vi.mock('$lib/db', ...)` — choose whichever an existing test already does; do not invent a new harness if one exists).
- [ ] `npx vitest run src/lib/datastore` → PASS. `NODE_OPTIONS=--max-old-space-size=8192 npm run check` → no NEW errors (note pre-existing count).
- [ ] Report: files created, test output, any deviation.

---

## Phase 2a — Parallel surfaces (3 agents, disjoint files)

### Task 2: `database` workflow node

**Files:**
- Create: `src/lib/workflows/nodes/database.def.ts`, `src/lib/workflows/nodes/database.ts`
- Modify: `src/lib/workflows/index.ts` (import + `registry.register(databaseDef, databaseExecutor)`), `src/lib/workflows/registry-client.ts` (append def), `src/lib/canvas/adapter.ts` (curated `CANVAS_NODE_TYPES` entry, group per closest sibling `data-store`)

**Interfaces:** Consumes pinned `$lib/datastore` API. Actor is always `workflow:${context.workflowId}`.

Behaviors:
- Copy shape from `src/lib/workflows/nodes/data-store.def.ts` + `.ts` (operation dropdown + `visibleWhen`) and `http-request.ts` (template interpolation, dryRun branch).
- `basicConfig`: `operation` dropdown (`insert|upsert|get|query|update|patch|delete|count|aggregate`); `collection` text (required); `autoCreate` toggle (default true, insert/upsert only); `key` template-text (visible for upsert/get/update/patch/delete); `data` template-textarea JSON (insert/upsert/update); `patch` template-textarea (patch); `filters` code/JSON (query/count/aggregate/update/delete);
 `sortField`+`sortPath`+`sortDir`, `limit`, `offset` (query); `aggregateOp`/`aggregatePath`/`groupBy` (aggregate); `permissions` textarea JSON advancedOnly (writes); `expectedVersion` number advancedOnly; `outputKey` (default `records`/`record`/`result` by op).
- Executor: interpolate `{{input.*}}` via `nodes/template.ts interpolateTemplate` on string fields, JSON-parse data/patch/filters with clear errors; `context.dryRun` → simulated output `{dryRun: true, wouldExecute: {...}}` for writes (reads execute); map `DatastoreError` codes into node failure messages; `rowCount` set from records length / affected count; `getOutputSchema` varies by op.
- `summarize(config)` → `kind: 'db'`, e.g. `query notes where status eq open → records`.
- `llmDescription`/`llmExamples`: teach generator the ops + that data persists permanently across runs and is shared sitewide (distinct from per-workflow `data-store`).
- Def must be client-safe (no server imports); executor lazy-imports `$lib/datastore` inside `execute` (precedent: `site-tool.ts` lazy import).

**Steps:**
- [ ] Read `data-store.def.ts`/`.ts`, `http-request.ts`, `site-tool.ts`, `types.ts` (NodeDefinition/BasicConfigField), one curated `adapter.ts` entry.
- [ ] Write def + executor; register in all THREE parity places.
- [ ] Run parity + engine tests: `npx vitest run tests/lib/workflows src/lib/canvas/palette-parity.test.ts` → PASS.
- [ ] `npm run check` (memory flag) → no new errors. Report.

### Task 3: `datastore` + `apis` toolsets, SSRF guard, classifier/essentials/confirm-gate

**Files:**
- Create: `src/lib/workflows/site-tools/tools/datastore.ts`, `src/lib/workflows/site-tools/tools/apis.ts`, `src/lib/server/ssrf-guard.ts`, `src/lib/workflows/site-tools/tools/datastore.test.ts`, `src/lib/server/ssrf-guard.test.ts`
- Modify: `src/lib/workflows/site-tools/registry.ts` (2 imports + 2 toolset descriptions; note `decks` missing from description map — add it while there), `src/lib/workflows/site-tools/keyword-classifier.ts`, `src/lib/mcp/essentials.ts` (add `api_search`, `api_call`, `datastore_query`), `src/lib/workflows/chat/confirmation-gate.ts` (`describeDestructiveAction` lines for `datastore_delete`)

**Interfaces:** Consumes pinned `$lib/datastore` API (actor `'jkai'`). Produces `assertPublicUrl` (pinned above) — Task 4 imports it.

Behaviors:
- Tool definitions copy `tools/site-signals.ts` (read) + `tools/publish-page.ts` (write pattern: exported pure handler + register). All handlers return `{success, data}` / `{success:false, error}`; catch `DatastoreError` → friendly error strings.
- `datastore_save`: upsert when `key` given else insert. `datastore_delete`: `destructive: true`. `datastore_create_collection` optional `schema`, `defaultPermissions`. Descriptions must teach: structured/queryable data → datastore; distilled personal facts → `save_memory`; per-workflow scratch → data-store node.
- `api_search(query, tags?)`: rank `api_catalog` records — token overlap on name/description/capabilities/tags (no LLM), return top 8 with `exampleRequests`.
- `api_call(api, method?, url, body?, headers?)`: look up catalogue by key/name; `url` must start with entry `baseUrl` (else error); `assertPublicUrl(url)`; auth from entry (`bearer-env` → `Authorization: Bearer ${process.env[envVar]}`, `header-env` similar; missing env → clear error); 15s AbortController timeout; JSON or text response truncated 100 KB; update record `lastVerifiedAt`/`status:'verified'` on 2xx, `'broken'` on repeated hard failure.
- `api_register(entry)`: upsert into `api_catalog` (key = slugified name, `source: 'jkai'`, status `candidate` unless verified probe passes).
- `ssrf-guard.ts`: parse URL (http/https only), reject literal private/loopback/link-local/CGNAT (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10, ::1, fc00::/7, fe80::/10), then `dns.promises.lookup(host, {all:true})` and reject if ANY resolved address is in those ranges (unless `allowInternal`).
- Classifier keywords: database/dataset/record/table/store this/remember this data → `datastore`; api/data source/live data/current figures → `apis`.

**Steps:**
- [ ] Read precedent tools + `registry-internal.ts`, `essentials.ts`, `keyword-classifier.ts`, `confirmation-gate.ts`.
- [ ] Failing tests: ssrf-guard matrix (public ok; each private range blocked; DNS-resolving-to-127.0.0.1 blocked via mocked lookup; ftp:// rejected); datastore tool handlers with `$lib/datastore` mocked (`vi.mock`) — save routes to upsert vs insert, delete flagged destructive in definition, error mapping.
- [ ] Implement; register; wire classifier/essentials/confirm-gate/registry descriptions.
- [ ] `npx vitest run src/lib/server/ssrf-guard.test.ts src/lib/workflows/site-tools` → PASS; `npm run check` → no new errors. Report.

### Task 7: API-first prompt guidance (repo + Hermes)

**Files:**
- Modify: `src/lib/workflows/chat/general-chat.ts` (add a compact "API-first data answering" block into the system-prompt assembly ~line 607–648, alongside existing sections)
- Modify: `/home/john/.hermes-jkai/skills/jkai-general/SKILL.md` (new "## API-first data answering" section; check `jkai-canvas/SKILL.md` and add a one-line pointer if it also answers data questions)

**Interfaces:** references tool names `api_search`, `api_call`, `api_register`, `datastore_query` only (no code imports).

Guidance content (both places, adapted to voice of file): for questions about current/factual/numeric/external data — (1) `api_search` first; (2) `api_call` to fetch live data, cite the API used; (3) only fall back to model knowledge when no API fits, and say so; (4) when you discover a useful new API, `api_register` it; (5) recurring structured data belongs in the datastore (`datastore_save`/`datastore_query`).

**Steps:**
- [ ] Read both SKILL.md files + the prompt-assembly section; match formatting/tone of neighbours.
- [ ] Make both edits. `cd ~/.hermes-jkai && git add -A && git commit -m "jkai-general: API-first data answering guidance" && git push` (this repo IS committed by the agent — separate repo, no race).
- [ ] `npm run check` in strange_rambling_svelte → no new errors. Report diffs verbatim.

---

## Phase 2b — Parallel (3 agents; after 2a integrates)

### Task 4: Self-improvement engine + hooks wiring + seeds

**Files:**
- Create: `src/lib/selfimprove/{types,engine,run,analyze,discover,toolsmith,report,seed-apis}.ts`, `src/lib/selfimprove/engine.test.ts`, `src/lib/selfimprove/run.test.ts`
- Modify: `src/hooks.server.ts` (add `startSelfImprovement()` + `startDatastoreReaper()` beside existing scheduler starts, same guard style incl. `JKAI_BUILDER_PROCESS !== '1'`), `src/lib/db/schema.ts` + `src/lib/workflows/site-tools/custom-tool-loader.ts` ONLY IF `custom_tools` lacks an enabled/disabled mechanism (check first; if adding: `enabled` boolean default true, loader skips disabled, push locally)

**Interfaces:** Consumes `$lib/datastore` (actor `'system'`), `assertPublicUrl` (Task 3), `rToolAudit` from `$lib/server/hermes-remote`, `orchestrator_chats` via drizzle, gateway via `getLLMClient` + usage capture, `executeTool` from site-tools registry (for `whatsapp_send`), custom-tool machinery from `meta-tools.ts`/`custom-tool-loader.ts`. Produces pinned `startSelfImprovement`/`runImprovementNow`/`getImprovementStatus`.

Behaviors (spec §2b is the contract — implement all 4 gates, 5 phases, budget caps 40 LLM calls / ~$0.50 est / 25 min wall clock, per-phase try/catch → `partial`):
- `engine.ts`: croner `30 3 * * *` Europe/London (precedent `src/lib/jkai/forge-scheduler.ts`); host gate `os.hostname() === 'homeserv' && !SELF_IMPROVE_ALLOW_DEV` → log + never schedule cron (but still run seeds); kill switch via `getSetting('selfimprove.enabled')` default true; idle gate: newest `orchestrator_chats` row with `role='user'` within 60 min → skip, and re-check between phases → `aborted_user_active`; overlap guard via module-level running flag + `improvement_runs` status check.
- Seeds (called from `startSelfImprovement` on every boot, idempotent): `ensureCollection` for the 3 system collections (`isSystem: true`, sensible `defaultPermissions`: api_catalog read `['*']`, write `['owner','jkai','system']`; insights/runs read `['owner','jkai','system']`, write `['owner','system']`... insights write also `system` only; runs write `system`+`owner`) + `seed-apis.ts` upserts ~12 seeded APIs ONLY where key absent (never clobber self-registered entries). Seed list: EES, GIAS, ONS API, World Bank, gov.uk Registers, police.uk, open-meteo, Wikipedia REST, Wikidata SPARQL, TfL Unified, Companies House (bearer-env `COMPANIES_HOUSE_API_KEY` if present), OpenRouter models — each with real baseUrl, 1–2 exampleRequests, capabilities/tags.
- `analyze.ts`: pull 7 days user messages (cap 300, strip >500-char bodies), current `latest` insights; ONE gateway call (default model, `thinking` disabled, max_tokens 3000, `response_format` json if supported else parse fenced) → intents + unmet needs; upsert `latest` + `weekly:<YYYY-WW>`.
- `discover.ts`: top ≤3 unmet needs; for each, try catalogue first (`api_search`-equivalent ranking fn), else ONE web research call via existing tavily/web site tool through `executeTool`, then probe best candidate with the same guarded HTTP path as `api_call` (share code: export the probe from `tools/apis.ts` or duplicate minimal logic — prefer importing `apiCallForEntry` if Task 3 exported it; it did NOT — so lazy-import `executeTool` and call the `api_call` tool by name with ctx actor system); register outcomes.
- `toolsmith.ts`: pick ONE highest-value opportunity; author custom tool via the same code path `create_tool` uses (import its handler from `meta-tools.ts` internals or `custom-tool-loader.buildHandler` + direct `custom_tools` insert — copy whichever `meta-tools.ts` does); generate handler_code via ONE gateway call with strict instructions (fetch + platform.call only); test-invoke with LLM-proposed sample args inside try/catch + 10s timeout; failure → delete row, log `tool_rejected`; success → keep, log `tool_created`. Also emit ≤2 `proposal` actions for bigger ideas.
- `report.ts`: finalize run record; WhatsApp via `executeTool('whatsapp_send', { message })` ≤ 600 chars: learned/registered/built/proposed/cost + link `https://strangeramblings.com/admin/ai/improvement`.
- Budget accounting: wrap gateway calls in a small counter helper in `run.ts`; estimate cost via `priceFor`/`computeCost` from `$lib/jkai/llm-pricing` when usage present.

**Steps:**
- [ ] Read: `forge-scheduler.ts`, `heartbeat/engine.ts` (start/stop + SIGTERM pattern), `hooks.server.ts` top, `hermes-remote.ts`, `meta-tools.ts` + `custom-tool-loader.ts`, `tools/apis.ts` (from 2a), `admin/tool-usage/suggestions/+server.ts` (analysis prompt precedent), `llm-pricing`.
- [ ] Failing tests (mock db/datastore/gateway): idle-gate (fresh user msg → skip; stale → run), overlap guard, budget hard-stop marks `budget_exceeded`, seed idempotency (second call = no new records), phase failure → `partial` not thrown.
- [ ] Implement modules; wire hooks.server.ts; check custom_tools enabled situation and handle per above.
- [ ] `npx vitest run src/lib/selfimprove` → PASS; `npm run check` → no new errors. Report (note whether ajv existed, whether enabled column added).

### Task 5: Admin datastore UI + API routes

**Files:**
- Create: `src/routes/admin/ai/datastore/+page.server.ts`, `+page.svelte`, `src/routes/admin/ai/datastore/[slug]/+page.server.ts`, `+page.svelte`
- Create: `src/routes/api/admin/datastore/collections/+server.ts` (GET list w/ counts, POST create), `src/routes/api/admin/datastore/collections/[slug]/+server.ts` (GET meta, PATCH, DELETE), `.../[slug]/records/+server.ts` (POST insert), `.../[slug]/records/[id]/+server.ts` (PATCH update incl. permissions, DELETE), `.../[slug]/query/+server.ts` (POST QueryOptions → results), `.../[slug]/export/+server.ts` (GET JSON download), `.../[slug]/audit/+server.ts` (GET recent audit rows, `?recordId=` filter)
- Modify: `src/lib/components/admin/admin-nav.ts` (TWO entries under AI: "Datastore" → `/admin/ai/datastore`, "Improvement" → `/admin/ai/improvement` — this task owns admin-nav.ts for both, Task 6 must NOT touch it)

**Interfaces:** Consumes `$lib/datastore` with actor `'owner'`. API auth: hook already gates `/api/admin/*` owner-only — handlers just do the work (precedent `api/admin/access`). Pages: server load reads via `$lib/datastore` directly; mutations via `fetch` to the JSON routes with `?token=${adminToken}` (precedent `admin/access/+page.svelte`, `admin/content/blog`).

Behaviors: collections list (name, slug, record count via `countRecords`, system badge, updatedAt) → `[slug]` page: query console (filter rows builder: path/op/value + sort + limit → POST query), records table (key, data preview 120 chars, version, updatedAt), record drawer (pretty JSON editor textarea, permissions JSON editor, audit trail list for the record, delete + save with `expectedVersion`, restore button on audit entries = save with before-image), collection settings editor (schema/defaultPermissions/settings JSON textareas), export button, create-collection form on index. System collections: no delete button; records still editable. Empty/error states per `.nm-empty` precedent. Svelte 5 runes; follow sr-design tokens strictly.

**Steps:**
- [ ] Read `admin/content/blog/+page.server.ts`+`.svelte`, `blog/[id]/+page.svelte`, `admin/access/+page.svelte`, `api/admin/access/+server.ts`, `admin-nav.ts`, `nm-tokens.css`, PageWrap/PageHeader.
- [ ] Implement API routes (thin: parse → `$lib/datastore` call → JSON; map DatastoreError → status 404/403/400/409/413).
- [ ] Implement pages.
- [ ] `npm run check` → no new errors; `npx vitest run src/lib/canvas/palette-parity.test.ts` untouched-still-green sanity. Report with route list.

### Task 6: Admin improvement dashboard + API routes

**Files:**
- Create: `src/routes/admin/ai/improvement/+page.server.ts`, `+page.svelte`
- Create: `src/routes/api/admin/improvement/runs/+server.ts` (GET last 30 runs via `queryRecords('improvement_runs', {sort createdAt desc})`), `.../run/+server.ts` (POST → `runImprovementNow({trigger:'manual'})`; 409 if running), `.../toggle/+server.ts` (POST {enabled} → `setSetting('selfimprove.enabled', v)`), `.../verify-api/+server.ts` (POST {key} → execute the catalogue probe via `executeTool('api_call', ...)` with the entry's first exampleRequest, update status)

**Interfaces:** Consumes pinned `runImprovementNow`/`getImprovementStatus` (Task 4), `$lib/datastore` (actor `'owner'`), `getSetting`/`setSetting` from `$lib/server/models/settings`. Does NOT touch admin-nav.ts (Task 5 owns it).

Page sections: status header (enabled toggle, schedule `03:30 Europe/London`, running indicator, Run now button — disable while running, poll `runs` every 10s only while a run is live per svelte5-pitfalls interval rules); latest report (markdown-ish pre block); runs table (status pill, trigger, duration, cost, actions count) with expandable run detail (phases, actions list); question insights (latest record: intents table w/ counts + unmet needs list); API catalogue table (name, status pill, lastVerifiedAt, verify-now button); self-built tools (query `custom_tools` where source self-improvement — read via drizzle in load; disable/delete buttons hitting existing custom-tools delete tool route if present, else drizzle delete in a `.../tools/+server.ts` you add).

**Steps:**
- [ ] Read `admin/ai/models/+page.server.ts`+`.svelte` (settings precedent), `admin/ops/tool-usage/+page.svelte` (analytics layout precedent), Task 4's exports.
- [ ] Implement API routes then page.
- [ ] `npm run check` → no new errors. Report.

---

## Phase 3 — Integration, generator reach, docs (orchestrator + 1 agent)

### Task 8: Full integration pass

- [ ] `npx vitest run` (full suite) — fix any cross-task breakage.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 npm run check` — zero NEW errors vs baseline.
- [ ] Production build (sandbox disabled): `NODE_OPTIONS=--max-old-space-size=8192 npm run build` — green (expect homeserv build-clobber: restart always-on service after, per `reference_homeserv_build_clobber`).
- [ ] Dev-server smoke: `database` node visible in palette + configurable; `/admin/ai/datastore` create collection → insert → query round-trip; `datastore_query` + `api_search` callable (curl the MCP local endpoint `tools/list` and grep for the new names).
- [ ] Update `~/strange_rambling_svelte/CLAUDE.md` Key-areas with one line each for `$lib/datastore` + `$lib/selfimprove`.

## Phase 4 — Review, ship, verify (orchestrator)

- [ ] Dispatch code-review (fresh eyes) over the full diff; apply findings.
- [ ] `ship` skill: commit → push → deploy.sh (runs prod drizzle push) → verify live per spec §Verification: admin pages render, seeded api_catalog visible, `POST /api/admin/improvement/run` completes a real run (watch record + WhatsApp), live workflow exercises `database` node, Hermes sees `api_search` (restart Hermes if MCP list stale).
- [ ] Commit ~/.hermes-jkai (done in Task 7) — verify pushed; memory update; final report with Decision Log.

## Self-review notes (done)

- Spec coverage: items 1–21 of the scoring table map to Tasks 1–8 (11→Task 5 export; 16→analyze.ts; 19→discover.ts; 20→report.ts; 15→Task 7). Deferred 22–26 absent by design.
- admin-nav.ts single-owner rule (Task 5) prevents the one file collision in 2b; registry.ts single-owner (Task 3) prevents it in 2a; hooks.server.ts + schema.ts in 2b touched only by Task 4 (Phase 1 finished with schema).
- Type consistency: all cross-task names come from the pinned-interfaces block verbatim.
