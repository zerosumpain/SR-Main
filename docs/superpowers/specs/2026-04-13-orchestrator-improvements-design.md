# Workflow Orchestrator Improvements — Design Spec

## Overview

Redesign the workflow orchestrator to produce better-grounded, more reliable, and more transparent workflow generation. The current single-shot JSON generation pattern is replaced with a tool-call conversation loop where the LLM makes discrete, validated decisions. The orchestrator gains the ability to dynamically create new reusable node types for service integrations, and all reasoning is captured and visualised.

### Goals

1. **Better node grounding** — the LLM works with dynamic, runtime-accurate node context including port schemas and real execution examples
2. **Create vs. compose reasoning** — the LLM explicitly decides whether to use existing primitives or scaffold a new reusable node for new service integrations
3. **Thinking visualisation** — structured reasoning timeline, per-node decision cards, and parsed debate rounds replace raw text dumps
4. **Modify prompt parity** — workflow modifications use the same tool-call loop and rich context as initial generation
5. **Structured output** — tool-call constrained decoding + Zod validation replaces regex JSON extraction

### Tech Stack

SvelteKit 2, Svelte 5 (runes), z.ai GLM-5.1 (via OpenAI SDK with native tool calling), Zod, Drizzle ORM.

---

## 1. Dynamic Node Grounding System

### Problem

The current planner prompt builds a static text dump of node definitions at call time. It includes surface-level info (label, description, config fields) but has no awareness of runtime port schemas, real-world usage patterns, or what data shapes nodes actually produce.

### Design

A `NodeGroundingService` assembles rich, up-to-date node context on demand from three sources:

1. **Registry definitions** (existing) — type, label, description, configSchema, ports, llmDescription, llmExamples
2. **Runtime port schemas** (new) — derived from each node's `inputs`/`outputs` port definitions with their actual data types. Already present on `NodeDefinition` but not currently included in the orchestrator prompt. Automatically reflects future node updates.
3. **Execution history** (new) — queries `nodeExecutions` for recent successful runs of each node type. Extracts actual `inputData`/`outputData` snapshots as concrete examples. Limited to 2 most recent examples per node type.

### Output format

Per-node reference entry:

```
### Slack Send (`slack-send`)
Send a message to a Slack channel or user.

**Inputs:** { channel: string, message: string, thread_ts?: string }
**Outputs:** { ok: boolean, ts: string, channel: string }

**Config fields:**
  - webhookUrl (string) — Slack webhook URL
  - channel (string) — Channel name or ID

**Real usage example:**
  Input: { channel: "#alerts", message: "Strava weekly summary: 42km run" }
  Output: { ok: true, ts: "1712934821.001200", channel: "C01ABC123" }
```

### Staleness handling

Execution examples are from the most recent 2 runs. If a node's schema changes, the grounding function compares example field names against current port definitions and drops examples that don't align.

### Location

`src/lib/workflows/orchestrator/grounding.ts` — a single function `buildNodeGrounding(nodeDefinitions, recentExecutions)` that replaces the current `buildNodeReference()` in `prompts.ts`.

---

## 2. Tool-Call Orchestrator Architecture

### Problem

The current pattern asks the LLM to generate one giant JSON blob containing the entire workflow, then regex-parses the output. This is fragile, opaque, and gives the LLM no mechanism to search the registry or reason about node choices.

### Design

Replace the single-shot generation with a tool-use conversation loop. The LLM makes discrete, validated decisions via tool calls:

| Tool | Purpose | Key params |
|------|---------|------------|
| `search_nodes` | Query the registry for nodes matching a capability | `query`, `category?` |
| `use_node` | Commit to using an existing node | `nodeType`, `config`, `label`, `reason`, `alternativesConsidered[]` |
| `create_node` | Scaffold a new reusable node type | `type`, `label`, `category`, `description`, `configSchema`, `executorCode`, `testConfig`, `reason` |
| `connect_nodes` | Wire two nodes together | `sourceId`, `targetId`, `sourceHandle?`, `targetHandle?` |
| `ask_user` | Request clarification | `question`, `context` |
| `finalize_workflow` | Signal completion | `name`, `description` |

### Execution flow

```
User message
    |
    v
System prompt (role, rules, grounding doc, patterns)
    |
    v
LLM reasoning loop:
    - LLM thinks about what's needed
    - Calls search_nodes("slack messaging")
    - Gets back: no match found
    - Calls create_node({ type: "slack-send", ... executorCode: "..." })
    - System validates & acknowledges
    - Calls use_node({ nodeType: "manual-trigger", ... })
    - Calls use_node({ nodeType: "slack-send", ... })
    - Calls connect_nodes({ source: "trigger-1", target: "slack-1" })
    - Calls finalize_workflow({ name: "Send Slack Alert", ... })
    |
    v
Orchestrator assembles final workflow from tool call sequence
    |
    v
Critic round reviews assembled workflow + reasoning trace
    |
    v
If issues found: revision round (LLM gets critique + current workflow, can make more tool calls)
    |
    v
Return workflow + full thinking trace
```

### Key design decisions

- **`search_nodes` is mandatory before `use_node`**. The system prompt instructs the LLM to always search before committing. Forces grounding — the LLM can't hallucinate a node type.
- **`use_node` requires `reason` and `alternativesConsidered`**. Forces explicit reasoning that feeds into thinking visualisation.
- **Layout is computed post-hoc**. The LLM no longer calculates x/y positions. The orchestrator auto-layouts the DAG after `finalize_workflow` using topological sort + level assignment.
- **The critic round is preserved** but reviews the assembled workflow AND the reasoning trace. Can flag weak reasoning.

### State management

The orchestrator maintains a `WorkflowDraft` during the loop:

```typescript
interface WorkflowDraft {
  nodes: Map<string, { type, config, label, reason, alternatives }>;
  edges: Array<{ source, target, sourceHandle?, targetHandle? }>;
  newNodeTypes: Array<{ definition, executorCode, testConfig }>;
  searchLog: Array<{ query, results, timestamp }>;
  decisions: Array<ToolCallDecision>;  // full trace for visualisation
}
```

Each tool call is validated independently via Zod before being applied to the draft. Validation failures are returned to the LLM as tool responses for self-correction.

### File structure

- `src/lib/workflows/orchestrator/tools.ts` — tool definitions (Zod schemas + OpenAI function definitions)
- `src/lib/workflows/orchestrator/loop.ts` — tool-use conversation loop
- `src/lib/workflows/orchestrator/index.ts` — updated to use the new loop, same external API
- `src/lib/workflows/orchestrator/prompts.ts` — updated system prompt for tool-use mode

---

## 3. Dynamic Node Creation & Registration

### Problem

When the orchestrator encounters a service integration that doesn't exist (Slack, Notion, GitHub, etc.), it currently has no choice but to use `http-request` + `transform` as a workaround or ask the user. New integrations should be first-class reusable nodes.

### Design

When the orchestrator calls `create_node`, the system scaffolds a fully working node and hot-registers it.

### Runtime directory

```
~/.strange-rambling/workflow-nodes/
  slack-send/
    definition.json    <- NodeDefinition (type, label, configSchema, ports, etc.)
    executor.ts        <- Working executor function
```

### `definition.json`

Follows the exact same `NodeDefinition` shape as built-in nodes. Generated by the LLM via the `create_node` tool call parameters.

### `executor.ts`

Standard template — receives `(input, config, context)`, returns `{ output, logs }`. The LLM generates the implementation as a string in the `executorCode` param.

```typescript
// Dynamic node executors follow the NodeExecutor signature but do not use
// SvelteKit $lib aliases. They are loaded via dynamic import at runtime.
// The executor receives (input, config, context) and returns { output, logs }.

export async function execute(input, config, context) {
  const response = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: config.channel, text: input.message }),
  });
  const data = await response.json();
  return { output: data, logs: [`Sent to ${config.channel}`] };
}
```

### Validation before registration

1. **Schema validation** — definition.json validated against a Zod schema for NodeDefinition. Rejects if configSchema is malformed, ports are missing, or type conflicts with a built-in node.
2. **Syntax check** — executor code is parsed (not executed) to catch syntax errors.
3. **Sandbox test** — if `testConfig` was provided, the executor is run once in the JKAI sandbox. Errors are returned to the LLM for correction.

### Hot-registration

After validation, `registry.register(definition, executor)` is called on the live registry instance. The node is immediately available for the current workflow and all future workflows. No restart needed.

### Startup loading

`src/lib/workflows/index.ts` scans `~/.strange-rambling/workflow-nodes/*/` at startup and registers each valid node alongside built-ins. `registry-client.ts` gets a corresponding loader that reads `definition.json` files only (no executors) for the UI palette and orchestrator grounding.

### Management API

`GET /api/workflows/nodes/custom` returns all dynamically created nodes with their definitions.

---

## 4. Thinking Visualisation

### Problem

Current thinking display dumps up to 2000 chars of raw LLM text in `<pre>` blocks. Opaque, hard to scan, and doesn't connect reasoning to specific nodes.

### Design

Three layers of visualisation, progressively deeper.

### Layer 1: Reasoning Timeline (Chat Panel)

The tool-call transcript is transformed into a structured timeline in the chat panel when "Show thinking" is toggled.

Each entry is a `ThinkingStep`:

```typescript
interface ThinkingStep {
  type: 'search' | 'use_node' | 'create_node' | 'connect' | 'ask_user' | 'finalize';
  summary: string;        // one-line description
  detail?: string;        // reason / alternatives / search results
  nodeId?: string;        // links to canvas node for click-through
  timestamp: number;      // relative ms from start
}
```

Visual format: a vertical timeline with icons per step type (magnifying glass for search, checkmark for use, plus for create, link for connect). Each step is expandable to show full reasoning detail.

Rendered as `ThinkingTimeline.svelte`, replacing the current `<pre>` blocks in `ChatMessage.svelte`.

### Layer 2: Per-Node Decision Cards (Canvas)

The node inspector gets a new **"Reasoning" tab** alongside Config/Schema/Data. Shows:

- **Why this node was chosen** — the `reason` from `use_node` (or "Created for this workflow" badge for `create_node`)
- **Alternatives considered** — each with why it was rejected
- **Search context** — what query led to finding this node

Data stored on `workflowNodes` as `metadata.reasoning` (jsonb), persisted when workflow is saved.

### Layer 3: LLM Debate Rounds (Collapsible)

Below the reasoning timeline, a collapsible "Debate" section shows structured debate data:

- **Proposal** — assembled workflow summary (node count, edge count, new nodes created)
- **Critique** — parsed into individual issue cards tagged MISSING/MISMATCH/UNNECESSARY/INCOMPLETE, each referencing a specific node
- **Revision** — diff-style view showing what changed (nodes added/removed/modified, edges rewired)

Each round is parsed into structured data by the orchestrator before being sent to the UI.

### Data shape

```typescript
interface OrchestratorThinking {
  steps: ThinkingStep[];                    // Layer 1
  nodeReasoning: Record<string, {           // Layer 2
    reason: string;
    alternatives: Array<{ nodeType: string; whyRejected: string }>;
    searchQuery?: string;
  }>;
  debate: {                                 // Layer 3
    proposal: { nodeCount: number; edgeCount: number; newNodes: string[] };
    issues: Array<{ severity: string; nodeId?: string; message: string }>;
    revisions: Array<{ action: string; nodeId?: string; description: string }>;
  };
}
```

---

## 5. Modify Prompt Parity

### Problem

`buildModifyPrompt` gets a bare node type list and current workflow JSON. The planner gets full node reference, patterns, and reasoning instructions. Modifications are significantly less well-reasoned.

### Design

`modifyWorkflow()` switches to the same tool-call loop as `generateWorkflow()`. Same system prompt, same grounding document, same tools. Additional context block:

```
## Current Workflow Context

You are MODIFYING an existing workflow, not creating from scratch.

Current nodes: [structured summary with types, labels, configs]
Current edges: [connection map]

Rules for modification:
- Preserve existing node IDs unless the modification requires replacing them
- Maintain existing edge connections unless they conflict with the change
- Use search_nodes before assuming a node type exists or doesn't exist
- Explain what you're changing and why in each tool call's reason field
```

The orchestrator diffs the tool-call result against the current state to produce a minimal update.

---

## 6. Structured Output & Validation

### Problem

Current `parser.ts` regex-searches for JSON in markdown fences and does loose structural checks. Fragile and produces null results on parse failures.

### Design

Three-layer validation:

1. **Tool-call constrained decoding** — z.ai GLM-5.1 native tool calling guarantees syntactically valid JSON for tool call parameters.
2. **`response_format: { type: "json_object" }` for non-tool responses** — critic round and conversational responses use json_object mode for guaranteed valid JSON.
3. **Zod post-validation** — every tool call and JSON response is validated through Zod schemas. Catches semantic issues (nonexistent node type, invalid config value, edge referencing uncreated node).

### Error recovery

Zod validation failures are formatted as tool responses:

```json
{
  "error": "Validation failed",
  "issues": [
    "config.webhookUrl: Expected string, received undefined",
    "alternativesConsidered: Array must contain at least 1 element"
  ]
}
```

The LLM sees this and retries with corrected params. Replaces the current "log error and return null" behaviour.

### Tool definitions

Each tool is defined as a Zod schema that maps to both the OpenAI function definition (for the LLM) and runtime validation:

```typescript
export const useNodeSchema = z.object({
  nodeType: z.string(),
  config: z.record(z.unknown()),
  label: z.string(),
  reason: z.string().min(10),
  alternativesConsidered: z.array(z.object({
    nodeType: z.string(),
    whyRejected: z.string(),
  })).min(1),
});
```

A `zodToFunction` utility converts Zod schemas to OpenAI function definitions, keeping schemas as the single source of truth.

### What's deleted

- `extractJsonFromResponse()` in `parser.ts`
- `parseWorkflowResponse()` in `parser.ts`
- `isFollowUpQuestion()` in `parser.ts` (replaced by the `ask_user` tool)

---

## File Change Summary

### New files

| File | Purpose |
|------|---------|
| `src/lib/workflows/orchestrator/grounding.ts` | Dynamic node grounding service |
| `src/lib/workflows/orchestrator/tools.ts` | Tool definitions (Zod schemas + OpenAI function defs) |
| `src/lib/workflows/orchestrator/loop.ts` | Tool-use conversation loop |
| `src/lib/components/workflows/ThinkingTimeline.svelte` | Structured reasoning timeline component |
| `src/routes/api/workflows/nodes/custom/+server.ts` | API for listing custom nodes |

### Modified files

| File | Change |
|------|--------|
| `src/lib/workflows/orchestrator/prompts.ts` | Updated system prompt for tool-use mode, remove `buildNodeReference` |
| `src/lib/workflows/orchestrator/index.ts` | Replace single-shot generation with tool-call loop |
| `src/lib/workflows/orchestrator/parser.ts` | Delete regex extraction functions (may delete entire file) |
| `src/lib/workflows/orchestrator/types.ts` | Add ThinkingStep, OrchestratorThinking, WorkflowDraft types |
| `src/lib/workflows/index.ts` | Load dynamic nodes from `~/.strange-rambling/workflow-nodes/` at startup |
| `src/lib/workflows/registry-client.ts` | Load dynamic node definitions for UI/orchestrator |
| `src/lib/components/workflows/ChatMessage.svelte` | Replace `<pre>` thinking with ThinkingTimeline component |
| `src/lib/components/workflows/ChatPanel.svelte` | Pass structured thinking data |
| `src/routes/api/workflows/orchestrator/chat/+server.ts` | Return structured thinking in API response |
| Node inspector component | Add "Reasoning" tab |

### New directory

`~/.strange-rambling/workflow-nodes/` — runtime directory for dynamically created nodes.
