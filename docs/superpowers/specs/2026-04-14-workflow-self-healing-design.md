# Workflow Self-Healing — Design Spec

## Overview

When a workflow node fails during execution, the engine automatically triggers the LLM orchestrator to diagnose the error, propose a fix, and retry — all visible in real-time in the chat panel. The user sees the full reasoning process and can undo any applied fixes after the run.

### Goals

1. **Auto-diagnose** — engine catches node failures and sends context to the orchestrator for root cause analysis
2. **Auto-fix and retry** — config errors and graph structure issues are fixed and retried automatically (up to 3 attempts)
3. **Verbose reasoning** — full diagnosis, reasoning, and fix details stream to the chat panel in real-time
4. **Undo support** — every fix stores the original state; user can revert after the run
5. **Environment awareness** — infrastructure issues (missing SMTP, missing API keys) are diagnosed and explained with actionable instructions + alternative suggestions
6. **Non-blocking** — self-healing on one node doesn't block other branches from executing

### Tech Stack

SvelteKit 2, Svelte 5, z.ai GLM-5.1 (via OpenAI SDK), Drizzle ORM.

---

## 1. Engine Self-Healing Hook

### Current behaviour

Node execution catch block does `emit('node_failed') → throw`, which rejects the Promise.all for the level and cascades to run failure.

### New behaviour

The catch block enters a self-healing loop instead of throwing immediately.

### Flow

```
Node fails with error
    |
    v
Is selfHealing enabled for this run? (default: yes)
    |-- no --> emit('node_failed'), mark failed, skip downstream
    |
    v
For attempt 1..3:
  - emit('healing_started', nodeId, { attempt, error })
  - Call diagnoseAndFix() with error context + previous attempts
  - Stream diagnosis via emit('healing_progress', nodeId, { text })
  - If config_fix or rewire_fix:
      - Store original config in UndoEntry
      - Apply fix to node config (DB + in-memory)
      - emit('healing_fix_applied', nodeId, { fix description })
      - Re-execute node with same input
      - If success:
          - emit('healing_succeeded', nodeId)
          - Store output, continue normally, break
      - If fails:
          - Continue to next attempt with failure history
  - If environment_issue:
      - emit('healing_blocked', nodeId, { diagnosis, action, alternative })
      - Mark node 'blocked', skip downstream, break
  - If unknown / cannot diagnose:
      - Mark node 'needs_human', skip downstream, break
    |
    v
All attempts exhausted:
  - emit('healing_failed', nodeId, { attempts history })
  - Mark node 'failed', skip downstream
  - Do NOT throw — other branches continue
```

### Non-blocking execution

The healing loop runs inside the node's own Promise within `Promise.all` for the level. Other nodes in the same level continue executing independently. The healing only blocks the failing node's downstream dependents.

### New run status

`completed_with_errors` — at least one branch completed, at least one node failed/blocked. The UI shows a mixed green/amber indicator.

### Self-healing opt-out

`selfHealing: boolean` flag on the run API request (defaults to `true`). When disabled, the engine behaves as it does today — fail immediately.

### New SSE event types

| Event | Data | Purpose |
|-------|------|---------|
| `healing_started` | `{ attempt, maxAttempts, error, nodeLabel }` | Self-healing kicked in |
| `healing_progress` | `{ text }` | Diagnosis reasoning (streamed) |
| `healing_fix_applied` | `{ fixType, description, changes }` | Fix was applied, node retrying |
| `healing_succeeded` | `{ attempt }` | Retry worked |
| `healing_failed` | `{ attempts: [{diagnosis, fix, error}] }` | All attempts exhausted |
| `healing_blocked` | `{ diagnosis, environmentAction, alternative }` | Infra issue, can't auto-fix |

---

## 2. Orchestrator Diagnosis Function

### Location

`src/lib/workflows/orchestrator/healing.ts`

### Function signature

```typescript
async function diagnoseAndFix(context: HealingContext): Promise<HealingDiagnosis>
```

### Input context

```typescript
interface HealingContext {
  error: string;
  nodeType: string;
  nodeLabel: string;
  nodeConfig: Record<string, unknown>;
  inputData: Record<string, unknown>;
  nodeDefinition: NodeDefinition;
  previousAttempts: Array<{
    diagnosis: string;
    fixApplied: string;
    resultError: string;
  }>;
  workflowContext: {
    nodes: Array<{ id: string; type: string; label: string }>;
    edges: Array<{ sourceNodeId: string; targetNodeId: string }>;
    upstreamOutputs: Record<string, Record<string, unknown>>;
  };
}
```

### Output

```typescript
interface HealingDiagnosis {
  category: 'config_fix' | 'rewire_fix' | 'environment_issue' | 'unknown';
  diagnosis: string;
  reasoning: string;
  fix: {
    type: 'update_config' | 'insert_node' | 'rewire_edge' | 'none';
    changes: Record<string, unknown>;
    description: string;
  } | null;
  environmentAction?: string;
  alternative?: string;
  confidence: 'high' | 'medium' | 'low';
}
```

### LLM call

Uses the z.ai API with `response_format: { type: "json_object" }` and a dedicated system prompt focused on debugging. The prompt includes:
- The node's full definition (from registry grounding) so the LLM knows what fields are expected
- The actual input data so it can see data shape mismatches
- The error message and stack trace
- Previous attempts (if any) so it doesn't repeat failed fixes
- Instructions for each category: when to propose a config fix vs. flagging an environment issue

Uses the same 429 retry logic as the orchestrator tool loop.

### Diagnosis categories

1. **config_fix** — expression bug, wrong URL, template error, missing config field. Fix: new config object for the node.
2. **rewire_fix** — missing transform between incompatible nodes, wrong edge routing. Fix: nodes to insert and edges to change. Applied by writing new nodes/edges to the DB and rebuilding the in-memory graph before retrying. The retry re-executes from the newly inserted node (not the original failed node) so the data flows through the correction.
3. **environment_issue** — missing SMTP, missing API key, external service down, DNS failure. Fix: none (can't auto-fix). Returns actionable instructions + optional workaround alternative.
4. **unknown** — can't determine root cause. Returns diagnosis text but no fix.

---

## 3. Chat Panel Integration

### HealingCard component

`src/lib/components/workflows/HealingCard.svelte` — renders the self-healing process inline in the chat panel.

### Visual design

Amber/warning themed card (distinct from the accent-colored build progress card):
- Header: amber dot + "SELF-HEALING" label + node name + error
- Attempt counter: "Attempt 1/3"
- Diagnosis text: streams in as the LLM reasons (mono font)
- Fix result: checkmark for success, warning for blocked, cross for exhausted
- Action buttons: "Undo fix" (for applied fixes), "Dismiss" (for environment issues)

### State management

The page component (`/workflows/[id]/+page.svelte`) listens for `healing_*` SSE events and builds up a `HealingState` per node:

```typescript
interface HealingState {
  nodeId: string;
  nodeLabel: string;
  error: string;
  attempts: Array<{
    diagnosis: string;
    reasoning: string;
    fixDescription?: string;
    fixApplied: boolean;
    retrySucceeded?: boolean;
    resultError?: string;
  }>;
  status: 'diagnosing' | 'retrying' | 'succeeded' | 'failed' | 'blocked';
  environmentAction?: string;
  alternative?: string;
  undoId?: string;
}
```

Healing states are passed to the ChatPanel which renders them as HealingCard components interspersed with regular chat messages.

### Node visual state during healing

New node status: `healing` — renders with an amber pulsing border (distinct from `running` orange). The node shows "Healing..." label. On fix applied + retry, transitions to `running` (orange), then `completed` (green) or back to `healing` for next attempt.

---

## 4. Undo System

### UndoEntry

```typescript
interface UndoEntry {
  id: string;
  runId: string;
  nodeId: string;
  attempt: number;
  timestamp: string;
  originalConfig: Record<string, unknown>;
  newConfig: Record<string, unknown>;
  fixDescription: string;
  rewireChanges?: {
    addedEdges: WorkflowEdgeDef[];
    removedEdgeIds: string[];
    addedNodes: WorkflowNodeDef[];
  };
}
```

### Storage

New `healing_history` jsonb column on `workflow_runs` table. Array of UndoEntry objects, written incrementally as fixes are applied.

### Undo endpoint

`POST /api/workflows/[id]/runs/[runId]/undo` with `{ undoId: string }`:
1. Reads the UndoEntry from healing_history
2. Restores original config on the workflowNodes record
3. If rewire changes: removes added nodes/edges, restores removed edges
4. Returns the reverted state

### Timing

Undo is available **after the run completes**, not during. During execution, fixes are applied and the workflow keeps running. The user reviews and reverts afterwards.

---

## 5. New Run Status: completed_with_errors

### Behaviour

When a run finishes and at least one branch completed successfully but one or more nodes are in `failed`, `blocked`, or `needs_human` status, the run status is `completed_with_errors` instead of `failed`.

### UI indicator

Mixed green/amber badge in the run status bar and run history panel. The workflow canvas shows green nodes on successful branches and red/amber nodes on failed branches.

### When to use each status

- `completed` — all nodes succeeded or were intentionally skipped (conditional routing)
- `completed_with_errors` — some nodes succeeded, some failed/blocked after healing attempts
- `failed` — the trigger node failed, or a critical error prevented any execution

---

## File Change Summary

### New files

| File | Purpose |
|------|---------|
| `src/lib/workflows/orchestrator/healing.ts` | `diagnoseAndFix()` function + healing prompt |
| `src/lib/components/workflows/HealingCard.svelte` | Chat panel healing visualization |
| `src/routes/api/workflows/[id]/runs/[runId]/undo/+server.ts` | Undo endpoint |

### Modified files

| File | Change |
|------|--------|
| `src/lib/workflows/engine.ts` | Self-healing loop in node execution catch block |
| `src/lib/workflows/types.ts` | New event types, `HealingContext`, `HealingDiagnosis`, `UndoEntry` types |
| `src/lib/db/schema.ts` | `healing_history` jsonb column on `workflow_runs` |
| `src/routes/workflows/[id]/+page.svelte` | Handle healing SSE events, pass healing state to chat |
| `src/lib/components/workflows/ChatPanel.svelte` | Render HealingCard components |
| `src/lib/components/workflows/nodes/BaseNode.svelte` | `healing` status color (amber pulse) |
| `src/routes/api/workflows/[id]/run/+server.ts` | `selfHealing` flag on run request |
