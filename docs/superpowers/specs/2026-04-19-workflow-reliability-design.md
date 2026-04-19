# Workflow Reliability & Functionality Improvements

**Date:** 2026-04-19
**Scope:** `src/lib/workflows/`, `src/routes/api/workflows/`, `src/lib/components/workflows/`

## Problem

The workflow system can build and execute complex automations from natural language, but one-shot reliability is low. The system *detects* problems (critic, verify, healing) but doesn't *act* on many of them. Specific issues:

1. Critic finds problems but never triggers revision (stub at `orchestrator/index.ts:424-428`)
2. Template interpolation silently returns empty strings for missing paths (`nodes/template.ts:11`)
3. Auto-connect fallback masks topology bugs (`orchestrator/loop.ts:283-297`)
4. Transform node swallows errors as `{output:{error}}` instead of throwing (`nodes/transform.ts:23-27`)
5. Sub-workflow hardcodes `localhost:5173` (`nodes/sub-workflow.ts:9`)
6. Dynamic node loading is fire-and-forget (`index.ts:90-97`)
7. `saveWorkflowFromGenerated` has no DB transaction (`orchestrator/index.ts:547-584`)
8. Schema verification skipped when upstream has no typed properties (`orchestrator/verify.ts:275-276`)
9. Scheduler never started at boot (`index.ts` — missing `startScheduler()` call)
10. `ask_user` discards the in-memory draft on next message

## Design

### Phase 1: Quick wins (independent, no architecture changes)

**1a. Start scheduler at boot** (`index.ts`)
- Add `import { startScheduler } from './scheduler'` and call `startScheduler()` after `startMemoryReview()`.

**1b. Fix sub-workflow port** (`nodes/sub-workflow.ts`)
- Replace HTTP fetch with direct engine call: import `engine` from `$lib/workflows` and call `engine.execute()` directly with the sub-workflow's definition loaded from DB. This removes the port issue entirely and enables nested healing/breakpoint support.
- Keep the `workflowId` config field. Load `WorkflowDefinition` from DB inside the executor.

**1c. Transform node: throw on error** (`nodes/transform.ts`)
- Change the catch block (lines 23-27) to throw an error instead of returning `{output:{error}}`. Self-healing already handles thrown errors and will try to fix the expression.

**1d. Template interpolation: track missing paths** (`nodes/template.ts`)
- Add optional `strict` mode to `interpolateTemplate`: collect all unresolved `{{input.X}}` paths. Return them alongside the result.
- Callers that use templates (llm-call, llm-agent, whatsapp, email, http-request, etc.) should throw `NodeExecutionError` listing the missing paths when any are found. This makes template failures visible and healable.
- Non-strict mode (default for backwards compat) keeps current behavior.
- Update all built-in node executors that call `interpolateTemplate` to use strict mode.

### Phase 2: Reliability core (orchestrator improvements)

**2a. Wire critic revision loop** (`orchestrator/index.ts`)
- When `criticResult.verdict === 'fail'`, call `runToolLoop` again with `buildRevisionPrompt()` as system prompt and the critic issues formatted as the user message. Use the existing draft state.
- Cap at 1 revision round (the critic already ran — one fix pass is enough before surfacing remaining issues to the user).
- If the revision produces a new `finalize_workflow` call, re-verify. If issues remain, proceed with warnings (current behavior).

**2b. Remove auto-connect fallback** (`orchestrator/loop.ts:283-297`)
- Delete the auto-connect block. If `draft.edges.length === 0 && nodesArray.length > 1`, return a workflow with a `warnings` field: `"No edges created — nodes are disconnected"`.
- The verifier and critic will catch this. With R2a wired, the revision loop gets a chance to fix it.

**2c. Improve output schemas for built-in nodes**
- Audit every node executor's `getOutputSchema()`. Nodes that return `{type:'object'}` with no `properties` should declare their actual output shape. Priority targets:
  - `transform` — already supports `config.outputSchema`, keep as-is
  - `http-request` — declare `{status, body, headers}`
  - `llm-call` — declare `{response, usage}`
  - `llm-agent` — declare `{response, toolResults, rounds}`
  - `text-parser` — declare output based on mode (regex vs json)
  - `code-execute` — declare `{result, stdout, stderr}` (or from config)
  - `tavily-search` — declare `{results, query}`
  - `web-scrape` — declare `{content, title, url}`
  - `health-query` — declare based on query type
- This makes `verify.ts:275-276` schema validation actually fire.

**2d. Wrap `saveWorkflowFromGenerated` in a transaction** (`orchestrator/index.ts`)
- Use `db.transaction(async (tx) => { ... })` around the delete+insert sequence.

**2e. Await dynamic node loading** (`index.ts`)
- Change boot-time `loadDynamicNodeExecutor(...).then(...)` to a top-level async IIFE with `await`.
- In `saveDynamicNodes` (already awaited), no change needed — it already awaits.

### Phase 3: Draft persistence & validate endpoint

**3a. Persist draft state across `ask_user`** (`orchestrator/index.ts`, DB schema)
- Add a `draftState` JSONB column to `orchestratorChats` (or a separate table).
- When `ask_user` returns, serialize the `WorkflowDraft` (convert Map to entries array) and store it with the chat row.
- On the next message for the same `workflowId`, deserialize and pass it into `runToolLoop` instead of creating an empty draft.

**3b. Add validate-before-run endpoint** (`routes/api/workflows/[id]/validate/+server.ts`)
- New GET endpoint that loads the workflow from DB and runs `verifyWorkflow()` against it.
- Returns `{valid: boolean, issues: VerificationIssue[]}`.
- UI: the Run button calls validate first; if issues exist, show them in a modal with "Run anyway" / "Fix" options.

### Phase 4: Prompt hardening

**4a. Tighten grounding prompt** (`orchestrator/prompts.ts`)
- Add explicit rules after the node registry section:
  - "After connecting nodes, review the upstream schema in the response. Every `{{input.X}}` reference in node config MUST match a path from that schema."
  - "Do NOT call finalize_workflow if any node (other than the trigger) has zero incoming edges."

**4b. Add `set_trigger` tool** (`orchestrator/tools.ts`, `orchestrator/loop.ts`)
- New tool: `set_trigger({type: 'webhook'|'cron'|'event', config: {...}})`.
- Updates `draft.trigger` which is written to the `workflows.trigger` column on save.
- Enables the orchestrator to create webhook/cron-triggered workflows end-to-end.

## Out of scope (future work)

- Workflow versioning / run diff
- Dry-run mode
- Data-store / accumulator state UI
- Node-level credentials readiness check
- Trigger nodes on the canvas palette
- Concurrency guard on healing config mutation
- Unifying the two event bus systems

## Conventions

- Node executors follow the `executor.ts` + `def.ts` pattern, registered in `index.ts`
- Template interpolation uses `{{input.X}}` only — no Jinja/Handlebars
- Orchestrator tools are Zod-validated in `tools.ts`, dispatched in `loop.ts`
- Self-healing uses `diagnoseAndFix` from `orchestrator/healing.ts`
- DB access via Drizzle ORM; schema in `$lib/db/schema`
