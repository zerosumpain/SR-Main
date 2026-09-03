---
name: workflow-node
description: Use when adding, modifying, or debugging a jkai canvas workflow-engine node in strange_rambling_svelte — new node types, node config panels, palette entries, node LLM calls, or failures in registry-parity/palette-parity tests.
---

# Workflow nodes — authoring checklist

A node is a **pair**: `src/lib/workflows/nodes/<type>.def.ts` (client-safe `NodeDefinition`) + `<type>.ts` (server `NodeExecutor`, re-exports the def). `type` kebab-case; exports `<type>Def` / `<type>Executor`. Contracts in `src/lib/workflows/types.ts`.

**Templates to copy:** simple → `nodes/tavily-search.def.ts` + `.ts` (uses `basicConfig`, `summarize`, `llmDescription`/`llmExamples`); LLM-using → `nodes/llm-call.def.ts` + `.ts`.

## Registration (ALL of these, in order)

1. `nodes/<type>.def.ts` — definition (label, category, configSchema, defaultConfig, inputs/outputs, `llmDescription` + `llmExamples` so the generator can use it).
2. `nodes/<type>.ts` — executor (+ `export { <type>Def } from './<type>.def'`).
3. `src/lib/workflows/index.ts` — server registry: import + `registry.register(<type>Def, <type>Executor)`.
4. `src/lib/workflows/registry-client.ts` — append the def to `builtInDefinitions`. **The codegen scaffolder does NOT patch this file — the most-forgotten step.** Enforced by `tests/lib/workflows/registry-parity.test.ts`.
5. Config form, pick one: `basicConfig: BasicConfigField[]` on the def (generic `BasicConfigForm.svelte` renders it) OR a bespoke `src/lib/canvas/nodes/panels/<Type>Panel.svelte` registered in the `specialized` map in `panels/registry.ts`. Fallback order: specialized → basicConfig → GenericJsonPanel.
6. Palette: automatic from `registry-client` defs (via `GENERATED_NODE_TYPES` in `src/lib/canvas/adapter.ts`). For explicit group/handles/weight, add a curated `CANVAS_NODE_TYPES` entry there. Enforced by `src/lib/canvas/palette-parity.test.ts`.
7. Verify: `npm test` (parity guards) + `NODE_OPTIONS=--max-old-space-size=8192 npm run check`.

## LLM calls from a node

Never call a provider SDK directly. Preferred path (what `llm-call` does):

```ts
import { resilientChatCompletion } from '$lib/llm/workflow-gateway';
const res = await resilientChatCompletion(configuredModel, { messages, temperature, max_tokens }, { signal: context.abortSignal });
```

- The gateway adds concurrency cap, 90s timeout (45s stream-idle for `resilientChatStream`), and z.ai→OpenRouter fallback.
- Model resolution: `resolveLLMClient()` in `nodes/llm-helpers.ts` (empty/`'default'` → admin default from `/admin/models`; ids containing `/` → OpenRouter).
- glm models burn reasoning tokens from `max_tokens` — pass `thinking:{type:'disabled'}` when reasoning isn't needed, else size `max_tokens` ≥ 3000.

## Scaffolder (optional)

`src/lib/node-builder/` — `writeNodeFiles(spec, srDocsDir)` generates def/executor/panel/docs and patches `workflows/index.ts` + `panels/registry.ts`. **Known gaps to do by hand: `registry-client.ts` and curated palette entry.**

## Eval harness

`src/lib/workflows/eval/` scores the workflow *generator* (excluded from vitest): `RUN_WORKFLOW_EVAL=1 npx tsx src/lib/workflows/eval/run-eval.ts`. A new node becomes generator-reachable via good `llmDescription`/`llmExamples`.
