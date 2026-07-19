# Edge Auto-Mapping Assistant — Design

**Goal:** When a user connects node A → node B on the workflow canvas, automatically work out how A's output should flow into B and **prompt the user with concrete actions it can take on their behalf** (set B's config fields, pick a datastore collection + CRUD rules, etc.), LLM-assisted. Works for **any node → any node**, not a hard-coded set. The same compatibility engine also validates auto-generated workflows.

## Problem

Today, connecting two nodes just draws an edge. The user must then open B's panel and hand-wire every `{{input.*}}` template themselves. The only "smart" precedent is `syncWebpageFromUpstream` (canvas `+page.svelte:2665`), which auto-fills a webpage node's URL from an upstream — a bespoke one-off. We generalise that idea to every node pair, backed by the LLM.

Separately, the workflow **generator** (`orchestrator/generateWorkflow`) and spec tools (`workflow_create`/`workflow_generate`) can emit edges that are handle-kind incompatible or reference fields the upstream never emits — `verifyWorkflow` checks `{{input.X}}` path existence but **never** checks handle-kind compatibility between connected nodes. We close that gap.

## Architecture

New module `src/lib/workflows/mapping/`, split by runtime reach:

- **`types.ts`** (isomorphic) — `EdgeMappingProposal`, `MappingAction`, `CompatibilityReport`, `EdgeCompatibilityIssue`.
- **`compatibility.ts`** (isomorphic — no DB, no LLM) — deterministic engine reused everywhere:
  - `edgeCompatibility(sourceType, targetType)` → `CompatibilityReport` via the existing `compatibility()` + `byType().handles` (`$lib/canvas/handles` + `$lib/canvas/adapter`).
  - `validateWorkflowCompatibility(nodes, edges)` → `EdgeCompatibilityIssue[]` for batch/generator use.
  - `heuristicMapping(ctx)` → a deterministic best-effort proposal (fills empty templated target fields from available upstream paths; node-pair rules for database/deck-build/etc.). The LLM-free fallback and the seed for validation.
- **`propose.server.ts`** (server only — LLM) — `proposeEdgeMapping({ workflowId, sourceNodeId, targetNodeId, signal })`:
  1. Load nodes/edges; resolve source + target (`type`, `config`, `label`).
  2. Gather context: source `llmDescription` + `getOutputSchema(config)` + real emitted paths (last-run `outputData` via `computeUpstreamFields`, plus schema paths via `resolveUpstreamSchema`/`schemaToVariablePaths`); target `llmDescription` + `configSchema` (fields+descriptions) + current `config` + `llmExamples`.
  3. Deterministic `edgeCompatibility` first.
  4. LLM grounding prompt → `resilientChatCompletion(default, { …, response_format:{type:'json_object'} })`; tolerant parse.
  5. **Sanitise**: keep only `set-config` actions whose `field` is a real key in the target's `configSchema.properties`; keep `insert-node`/`note` as advisory; verify `{{input.*}}` refs against available paths (annotate, don't drop). Build merged `configPatch`.
  6. Fallback to `heuristicMapping` on any LLM failure/empty.
- **`index.ts`** — re-exports the isomorphic surface only (never `propose.server`).

### Surfaces

- **API:** `POST /api/workflows/[id]/edges/propose` `{ sourceNodeId, targetNodeId }` → `EdgeMappingProposal` (owner-gated by hooks).
- **Generator/verify:** add a graph-level **handle-kind compatibility pass (severity `warning`)** to `orchestrator/verify.ts:verifyWorkflow`, so `runWorkflowVerification` (used by `workflow_create`, `workflow_generate`, the on-demand `verify_workflow` tool, and the eval gate) reports incompatible edges. Warnings, not errors → no regression of the zero-error eval gate.
- **Canvas UI:** after an edge is persisted in `onUp` (`+page.svelte:2877`) and in `pipeTo` (`:2925`), call `proposeMapping(source, target)`; render a floating **`MappingAssistant.svelte`** card with the compatibility badge, rationale, and a checklist of actions → **Apply selected** (merges the `configPatch` via the existing `saveNodeConfig(target.id, patch)`) / **Dismiss**. Non-blocking: a failed proposal never affects the connection.

## Data flow (worked example: `api-call` → `database`)

Source `api-call` emits `{ success, api, status, url, json }`. Target `database` config keys: `operation, collection, key, data, filters, permissions, …`. The proposer returns, e.g.:
`operation=upsert`, `collection="companies"` (from the API name), `key="{{input.json.company_number}}"`, `data="{{input.json}}"`, `permissions={"read":["*"],"write":["owner","workflow:*"]}` — each surfaced as a labelled, toggleable action with a one-line rationale. Apply patches the `database` node's config.

## Testing

- `compatibility.test.ts` — `edgeCompatibility` (direct/transform/incompatible via kinds), `validateWorkflowCompatibility` (flags an incompatible edge, passes a compatible one), `heuristicMapping` (fills an empty templated field from an available path; leaves populated fields alone).
- `propose.test.ts` — the **sanitiser**: drops set-config on unknown config keys; keeps valid ones; builds the merged patch; falls back to heuristic when the (mocked) LLM returns junk.
- Live: connect two nodes on a real canvas → proposal card → apply → target config updated (Playwright, owner-authed). Endpoint exists (401 anon). Generator warning surfaces on an incompatible edge.

## Decision Log

| # | Decision | Options | Chosen — why | Reversible |
|---|---|---|---|---|
| D1 | Interactive UX | silent auto-apply · propose+one-click apply | **propose+apply** — brief says "prompting the user with actions it could take on their behalf" | yes (config edit) |
| D2 | Module split | one server module · isomorphic core + server LLM | **split** — deterministic compat must run client (instant) + server (generator); LLM is server-only | yes |
| D3 | Action types applied | apply all · only set-config auto-applied | **set-config auto-applied; insert-node/note advisory** — edge-splitting to insert a transform is riskier; the api→database class is pure set-config; v1 scope | extensible |
| D4 | Kind mismatch severity | error · warning | **warning** — generator can already emit such edges; error would regress the zero-error eval gate; warning still surfaces + tests compatibility | yes |
| D5 | LLM model | dedicated · site default | **site default** (`resolveDefaultModel('chat')`), one-shot JSON, gateway fallback | yes |
| D6 | Type system | new · reuse `handles.ts` `compatibility()` + palette handles | **reuse** — precedent, avoid drift | — |
| D7 | LLM output trust | apply raw · sanitise | **sanitise** — only real target config keys accepted; ops never invented; template refs checked | — (security) |

## Non-goals (v1)

- Auto-inserting a transform node mid-edge (advisory only — follow-up).
- Rewriting upstream nodes. The assistant only proposes changes to the **target** node just connected.
