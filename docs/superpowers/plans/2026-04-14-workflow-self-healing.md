# Workflow Self-Healing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a workflow node fails during execution, the engine automatically calls the LLM orchestrator to diagnose the error, apply a fix, and retry — with full verbose reasoning streamed to the chat panel.

**Architecture:** The engine's node execution catch block enters a healing loop (up to 3 attempts) that calls `diagnoseAndFix()` in the orchestrator. Diagnosis and fix details stream to the chat via new SSE event types (`healing_*`). A `HealingCard.svelte` component renders the healing process inline in the chat panel. Fixes store original config in a `healing_history` column on `workflow_runs` for undo support.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), z.ai GLM-5.1 (via OpenAI SDK), Drizzle ORM, Vitest.

**Design spec:** `docs/superpowers/specs/2026-04-14-workflow-self-healing-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/lib/workflows/orchestrator/healing.ts` | `diagnoseAndFix()` function, healing system prompt, diagnosis types |
| `src/lib/components/workflows/HealingCard.svelte` | Chat panel component for rendering healing process |
| `src/routes/api/workflows/[id]/runs/[runId]/undo/+server.ts` | POST endpoint to undo a healing fix |
| `tests/lib/workflows/orchestrator/healing.test.ts` | Tests for diagnosis function |
| `tests/lib/workflows/engine-healing.test.ts` | Tests for engine healing loop |

### Modified files

| File | Change |
|------|--------|
| `src/lib/workflows/types.ts` | New event types, `HealingContext`, `HealingDiagnosis`, `UndoEntry`, run status |
| `src/lib/db/schema.ts` | `healing_history` jsonb column on `workflow_runs` |
| `src/lib/workflows/engine.ts` | Self-healing loop in node execution catch block |
| `src/routes/workflows/[id]/+page.svelte` | Handle `healing_*` SSE events, pass healing state to chat |
| `src/lib/components/workflows/ChatPanel.svelte` | Render `HealingCard` components |
| `src/lib/components/workflows/nodes/BaseNode.svelte` | `healing` status colour |
| `src/routes/api/workflows/[id]/run/+server.ts` | `selfHealing` flag, `completed_with_errors` status, persist healing history |

---

## Task 1: Types & DB Schema

**Files:**
- Modify: `src/lib/workflows/types.ts`
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Add healing types to `types.ts`**

Append after the existing `NodeExecutionStatus` type (around line 104):

```typescript
export interface HealingContext {
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

export interface HealingDiagnosis {
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

export interface UndoEntry {
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

Update the `WorkflowEventType` union to add healing events:

```typescript
export type WorkflowEventType =
  | 'run_started'
  | 'run_completed'
  | 'run_completed_with_errors'
  | 'run_failed'
  | 'node_started'
  | 'node_completed'
  | 'node_failed'
  | 'node_paused'
  | 'node_skipped'
  | 'breakpoint_hit'
  | 'healing_started'
  | 'healing_progress'
  | 'healing_fix_applied'
  | 'healing_succeeded'
  | 'healing_failed'
  | 'healing_blocked'
  | 'log';
```

Update `RunStatus`:

```typescript
export type RunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'completed_with_errors' | 'failed';
```

Update `NodeExecutionStatus`:

```typescript
export type NodeExecutionStatus = 'pending' | 'running' | 'paused_breakpoint' | 'completed' | 'failed' | 'skipped' | 'blocked' | 'healing';
```

- [ ] **Step 2: Add `healing_history` column to `workflow_runs` in schema.ts**

In `src/lib/db/schema.ts`, add to the `workflowRuns` table definition, after the `error` column:

```typescript
  healingHistory: jsonb('healing_history').default(sql`'[]'::jsonb`),
```

- [ ] **Step 3: Push schema change**

```bash
cd ~/strange_rambling_svelte && npx drizzle-kit push
```

Expected: Migration applied, `healing_history` column added.

- [ ] **Step 4: Run typecheck**

```bash
cd ~/strange_rambling_svelte && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -c "Error" | head -1
```

Expected: No new errors from our changes.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte && git add src/lib/workflows/types.ts src/lib/db/schema.ts && git commit -m "feat(healing): add healing types, event types, and DB schema"
```

---

## Task 2: Diagnosis Function

**Files:**
- Create: `src/lib/workflows/orchestrator/healing.ts`
- Create: `tests/lib/workflows/orchestrator/healing.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/workflows/orchestrator/healing.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildHealingPrompt, parseHealingResponse } from '$lib/workflows/orchestrator/healing';
import type { HealingContext } from '$lib/workflows/types';

const mockContext: HealingContext = {
  error: 'connect ECONNREFUSED 127.0.0.1:587',
  nodeType: 'email',
  nodeLabel: 'Send Alert Email',
  nodeConfig: { to: 'john@example.com', subject: 'Alert', body: 'Test' },
  inputData: { message: 'hello' },
  nodeDefinition: {
    type: 'email',
    label: 'Email',
    category: 'integration',
    description: 'Send email via SMTP',
    configSchema: { type: 'object' },
    defaultConfig: {},
    inputs: [{ name: 'input', type: 'any' }],
    outputs: [{ name: 'output', type: 'object' }],
  },
  previousAttempts: [],
  workflowContext: {
    nodes: [
      { id: 'n1', type: 'manual-trigger', label: 'Start' },
      { id: 'n2', type: 'email', label: 'Send Alert Email' },
    ],
    edges: [{ sourceNodeId: 'n1', targetNodeId: 'n2' }],
    upstreamOutputs: { n1: {} },
  },
};

describe('buildHealingPrompt', () => {
  it('includes the error message', () => {
    const prompt = buildHealingPrompt(mockContext);
    expect(prompt).toContain('connect ECONNREFUSED 127.0.0.1:587');
  });

  it('includes the node type and label', () => {
    const prompt = buildHealingPrompt(mockContext);
    expect(prompt).toContain('email');
    expect(prompt).toContain('Send Alert Email');
  });

  it('includes node config', () => {
    const prompt = buildHealingPrompt(mockContext);
    expect(prompt).toContain('john@example.com');
  });

  it('includes previous attempts when present', () => {
    const ctx: HealingContext = {
      ...mockContext,
      previousAttempts: [{
        diagnosis: 'SMTP not configured',
        fixApplied: 'Changed host to smtp.gmail.com',
        resultError: 'Authentication failed',
      }],
    };
    const prompt = buildHealingPrompt(ctx);
    expect(prompt).toContain('SMTP not configured');
    expect(prompt).toContain('Authentication failed');
  });
});

describe('parseHealingResponse', () => {
  it('parses a valid config_fix response', () => {
    const raw = JSON.stringify({
      category: 'config_fix',
      diagnosis: 'Expression accesses wrong path',
      reasoning: 'The http-request wraps response in body field',
      fix: {
        type: 'update_config',
        changes: { expression: 'return input.body.data' },
        description: 'Fixed expression to use input.body',
      },
      confidence: 'high',
    });
    const result = parseHealingResponse(raw);
    expect(result.category).toBe('config_fix');
    expect(result.fix?.type).toBe('update_config');
    expect(result.fix?.changes.expression).toBe('return input.body.data');
  });

  it('parses an environment_issue response', () => {
    const raw = JSON.stringify({
      category: 'environment_issue',
      diagnosis: 'No SMTP server running on localhost',
      reasoning: 'The error indicates connection refused on port 587',
      fix: null,
      environmentAction: 'Add SMTP_HOST to .env',
      alternative: 'Use HTTP Request with Resend API instead',
      confidence: 'high',
    });
    const result = parseHealingResponse(raw);
    expect(result.category).toBe('environment_issue');
    expect(result.fix).toBeNull();
    expect(result.environmentAction).toContain('SMTP_HOST');
  });

  it('returns unknown category for unparseable response', () => {
    const result = parseHealingResponse('not json');
    expect(result.category).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/orchestrator/healing.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `healing.ts`**

Create `src/lib/workflows/orchestrator/healing.ts`:

```typescript
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import type { HealingContext, HealingDiagnosis, NodeDefinition } from '../types';
import { registry } from '../index';

export function buildHealingPrompt(context: HealingContext): string {
  const prevAttemptsBlock = context.previousAttempts.length > 0
    ? `\n## Previous Fix Attempts (DO NOT repeat these)\n\n${context.previousAttempts.map((a, i) =>
        `### Attempt ${i + 1}\n- Diagnosis: ${a.diagnosis}\n- Fix applied: ${a.fixApplied}\n- Result: ${a.resultError}`
      ).join('\n\n')}\n`
    : '';

  const upstreamBlock = Object.entries(context.workflowContext.upstreamOutputs)
    .map(([id, out]) => `  ${id}: ${JSON.stringify(out).slice(0, 500)}`)
    .join('\n');

  return `## Failed Node

**Type:** ${context.nodeType}
**Label:** ${context.nodeLabel}
**Error:** ${context.error}

**Node Config:**
\`\`\`json
${JSON.stringify(context.nodeConfig, null, 2)}
\`\`\`

**Input Data Received:**
\`\`\`json
${JSON.stringify(context.inputData, null, 2).slice(0, 2000)}
\`\`\`

**Node Definition:**
${context.nodeDefinition.description}
${context.nodeDefinition.llmDescription || ''}

**Inputs:** ${context.nodeDefinition.inputs.map(p => `${p.name}: ${p.type}`).join(', ') || 'none'}
**Outputs:** ${context.nodeDefinition.outputs.map(p => `${p.name}: ${p.type}`).join(', ') || 'none'}

## Workflow Context

**Nodes:** ${context.workflowContext.nodes.map(n => `${n.label} (${n.type})`).join(' → ')}
**Edges:** ${context.workflowContext.edges.map(e => `${e.sourceNodeId} → ${e.targetNodeId}`).join(', ')}

**Upstream Outputs:**
${upstreamBlock}
${prevAttemptsBlock}`;
}

const HEALING_SYSTEM_PROMPT = `You are a workflow debugging expert. A node in a workflow has failed during execution. Your job is to diagnose the root cause and propose a fix.

## Diagnosis Categories

1. **config_fix** — The node's configuration is wrong (bad expression, wrong URL, template error, missing field). You can fix this by providing a corrected config.
2. **rewire_fix** — The workflow graph is wrong (missing transform node, wrong edge connections). You can fix this by describing nodes to insert or edges to change.
3. **environment_issue** — The server environment is misconfigured (missing SMTP server, missing API key, external service down). You CANNOT auto-fix this. Provide clear instructions for what needs to be configured and where, plus an alternative workaround if one exists.
4. **unknown** — You cannot determine the root cause. Provide your best analysis.

## Important

- For config_fix: provide the COMPLETE new config object for the node (all fields, not just changed ones)
- For environment_issue: be specific about what env vars or services are needed and where to configure them
- If previous attempts are listed, DO NOT repeat the same fix — try a different approach
- Check if the input data shape matches what the node expects — data shape mismatches are common

## Output Format

Respond with a JSON object:
{
  "category": "config_fix | rewire_fix | environment_issue | unknown",
  "diagnosis": "Human-readable explanation of what went wrong",
  "reasoning": "Step-by-step thinking about the root cause",
  "fix": {
    "type": "update_config | insert_node | rewire_edge | none",
    "changes": { ... },
    "description": "What this fix does"
  } | null,
  "environmentAction": "Instructions for user (environment_issue only)",
  "alternative": "Optional workaround suggestion",
  "confidence": "high | medium | low"
}`;

export function parseHealingResponse(raw: string): HealingDiagnosis {
  try {
    const parsed = JSON.parse(raw);
    return {
      category: parsed.category || 'unknown',
      diagnosis: parsed.diagnosis || 'Could not determine the issue.',
      reasoning: parsed.reasoning || '',
      fix: parsed.fix || null,
      environmentAction: parsed.environmentAction,
      alternative: parsed.alternative,
      confidence: parsed.confidence || 'low',
    };
  } catch {
    return {
      category: 'unknown',
      diagnosis: 'Failed to parse diagnosis response.',
      reasoning: raw.slice(0, 500),
      fix: null,
      confidence: 'low',
    };
  }
}

export async function diagnoseAndFix(
  context: HealingContext,
  onProgress?: (text: string) => void,
): Promise<HealingDiagnosis> {
  const client = getOpenAIClient();
  const model = getModel();

  const userPrompt = buildHealingPrompt(context);
  onProgress?.(`Diagnosing: ${context.error.slice(0, 100)}`);

  // Retry with backoff on 429
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: HEALING_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      });
      break;
    } catch (err: any) {
      if (err?.status === 429 && attempt < 2) {
        const wait = (attempt + 1) * 5000;
        onProgress?.(`Rate limited — waiting ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }

  const text = response?.choices[0]?.message?.content ?? '{}';
  const diagnosis = parseHealingResponse(text);

  onProgress?.(`Diagnosis: ${diagnosis.diagnosis}`);
  if (diagnosis.fix) {
    onProgress?.(`Proposed fix: ${diagnosis.fix.description}`);
  }

  return diagnosis;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/orchestrator/healing.test.ts 2>&1 | tail -15
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte && git add src/lib/workflows/orchestrator/healing.ts tests/lib/workflows/orchestrator/healing.test.ts && git commit -m "feat(healing): add diagnoseAndFix function with LLM-based debugging"
```

---

## Task 3: Engine Self-Healing Loop

**Files:**
- Modify: `src/lib/workflows/engine.ts`
- Modify: `src/lib/workflows/types.ts` (add `EngineOptions`)

- [ ] **Step 1: Add `EngineOptions` type**

In `src/lib/workflows/types.ts`, add after the existing types:

```typescript
export interface EngineOptions {
  selfHealing?: boolean;  // default: true
}
```

- [ ] **Step 2: Update the engine's `execute` method signature**

In `src/lib/workflows/engine.ts`, update the `execute` method to accept options and add the healing loop.

Change the method signature from:

```typescript
  async execute(
    workflow: WorkflowDefinition,
    runId: string,
    initialInput: Record<string, unknown>,
    breakpoints?: Set<string>,
    workflowId?: string,
  ): Promise<EngineResult> {
```

To:

```typescript
  async execute(
    workflow: WorkflowDefinition,
    runId: string,
    initialInput: Record<string, unknown>,
    breakpoints?: Set<string>,
    workflowId?: string,
    options?: { selfHealing?: boolean },
  ): Promise<EngineResult> {
```

- [ ] **Step 3: Add healing imports at the top of engine.ts**

Add after the existing imports:

```typescript
import { diagnoseAndFix } from './orchestrator/healing';
import type { HealingContext, UndoEntry, NodeDefinition } from './types';
```

- [ ] **Step 4: Replace the node execution catch block**

Replace the existing catch block (lines 192-197 in current engine.ts):

```typescript
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            nodeErrors.set(nodeId, message);
            emit('node_failed', nodeId, { error: message });
            throw err;
          }
```

With the self-healing loop:

```typescript
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            const selfHealing = options?.selfHealing !== false;

            if (!selfHealing) {
              nodeErrors.set(nodeId, message);
              emit('node_failed', nodeId, { error: message });
              throw err;
            }

            // Self-healing loop
            const MAX_HEALING_ATTEMPTS = 3;
            let healed = false;
            let currentError = message;
            let currentConfig = { ...nodeDef.config };
            const attempts: Array<{ diagnosis: string; fixApplied: string; resultError: string }> = [];

            for (let attempt = 1; attempt <= MAX_HEALING_ATTEMPTS; attempt++) {
              emit('healing_started', nodeId, {
                attempt,
                maxAttempts: MAX_HEALING_ATTEMPTS,
                error: currentError,
                nodeLabel: nodeDef.label,
              });

              try {
                // Build healing context
                const nodeDef2 = this.registry.getDefinition(nodeDef.type);
                const healingContext: HealingContext = {
                  error: currentError,
                  nodeType: nodeDef.type,
                  nodeLabel: nodeDef.label,
                  nodeConfig: currentConfig,
                  inputData: mergedInput,
                  nodeDefinition: nodeDef2 || {
                    type: nodeDef.type,
                    label: nodeDef.label,
                    category: 'core',
                    description: '',
                    configSchema: { type: 'object' },
                    defaultConfig: {},
                    inputs: [{ name: 'input', type: 'any' }],
                    outputs: [{ name: 'output', type: 'any' }],
                  },
                  previousAttempts: attempts,
                  workflowContext: {
                    nodes: workflow.nodes.map(n => ({ id: n.id, type: n.type, label: n.label })),
                    edges: workflow.edges.map(e => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId })),
                    upstreamOutputs: Object.fromEntries(
                      Array.from(nodeOutputs.entries()).filter(([id]) => {
                        const incoming = graph.edgesByTarget.get(nodeId) || [];
                        return incoming.some(e => e.sourceNodeId === id);
                      }),
                    ),
                  },
                };

                const diagnosis = await diagnoseAndFix(
                  healingContext,
                  (text) => emit('healing_progress', nodeId, { text }),
                );

                // Environment issue — can't auto-fix
                if (diagnosis.category === 'environment_issue') {
                  emit('healing_blocked', nodeId, {
                    diagnosis: diagnosis.diagnosis,
                    reasoning: diagnosis.reasoning,
                    environmentAction: diagnosis.environmentAction,
                    alternative: diagnosis.alternative,
                  });
                  nodeErrors.set(nodeId, `Environment issue: ${diagnosis.diagnosis}`);
                  // Skip downstream nodes
                  const outgoingEdges = graph.edgesBySource.get(nodeId) || [];
                  for (const edge of outgoingEdges) {
                    blockedEdgeIds.add(edge.id);
                    this.markSkipped(edge.targetNodeId, graph, skippedNodes, blockedEdgeIds);
                  }
                  break; // Don't retry
                }

                // Unknown — can't fix
                if (diagnosis.category === 'unknown' || !diagnosis.fix) {
                  emit('healing_progress', nodeId, { text: `Could not determine a fix: ${diagnosis.diagnosis}` });
                  attempts.push({
                    diagnosis: diagnosis.diagnosis,
                    fixApplied: 'none',
                    resultError: currentError,
                  });
                  continue;
                }

                // Apply config fix
                if (diagnosis.fix.type === 'update_config') {
                  const originalConfig = { ...currentConfig };
                  const newConfig = { ...currentConfig, ...diagnosis.fix.changes };

                  // Store undo entry
                  const undoEntry: UndoEntry = {
                    id: crypto.randomUUID(),
                    runId,
                    nodeId,
                    attempt,
                    timestamp: new Date().toISOString(),
                    originalConfig,
                    newConfig,
                    fixDescription: diagnosis.fix.description,
                  };
                  healingHistory.push(undoEntry);

                  currentConfig = newConfig;
                  // Update the node config in the workflow definition for this run
                  nodeDef.config = newConfig;

                  emit('healing_fix_applied', nodeId, {
                    fixType: 'config',
                    description: diagnosis.fix.description,
                    undoId: undoEntry.id,
                    attempt,
                  });
                }

                // Retry the node with updated config
                emit('node_started', nodeId);
                try {
                  const retryResult: NodeResult = await executor.execute(mergedInput, currentConfig, context);
                  nodeOutputs.set(nodeId, retryResult.output);
                  emit('healing_succeeded', nodeId, { attempt });
                  emit('node_completed', nodeId, retryResult.output);

                  // Handle conditional routing on retry success
                  const retryHandle = retryResult.metadata?._selectedHandle as string | undefined;
                  if (retryHandle !== undefined) {
                    const outEdges = graph.edgesBySource.get(nodeId) || [];
                    for (const edge of outEdges) {
                      if (edge.sourceHandle !== retryHandle) {
                        blockedEdgeIds.add(edge.id);
                        this.markSkipped(edge.targetNodeId, graph, skippedNodes, blockedEdgeIds);
                      }
                    }
                  }

                  healed = true;
                  break;
                } catch (retryErr: unknown) {
                  currentError = retryErr instanceof Error ? retryErr.message : String(retryErr);
                  attempts.push({
                    diagnosis: diagnosis.diagnosis,
                    fixApplied: diagnosis.fix.description,
                    resultError: currentError,
                  });
                  emit('healing_progress', nodeId, { text: `Fix attempt ${attempt} failed: ${currentError}` });
                }
              } catch (healErr: unknown) {
                // Healing itself failed (e.g. LLM API error)
                const healMsg = healErr instanceof Error ? healErr.message : String(healErr);
                emit('healing_progress', nodeId, { text: `Healing error: ${healMsg}` });
                break;
              }
            }

            if (!healed) {
              emit('healing_failed', nodeId, { attempts });
              nodeErrors.set(nodeId, currentError);
              // Skip downstream instead of throwing
              const outgoingEdges = graph.edgesBySource.get(nodeId) || [];
              for (const edge of outgoingEdges) {
                blockedEdgeIds.add(edge.id);
                this.markSkipped(edge.targetNodeId, graph, skippedNodes, blockedEdgeIds);
              }
              // Don't throw — let other branches continue
            }
          }
```

- [ ] **Step 5: Add `healingHistory` array and update run status logic**

At the top of the `execute` method, after `const abortController = new AbortController();`, add:

```typescript
    const healingHistory: UndoEntry[] = [];
```

Replace the run completion block (the `emit('run_completed')` section) with logic that detects mixed results:

```typescript
      // Determine final status
      const hasErrors = nodeErrors.size > 0;
      const hasCompletedNodes = nodeOutputs.size > 0;
      const finalStatus: RunStatus = hasErrors
        ? (hasCompletedNodes ? 'completed_with_errors' : 'failed')
        : 'completed';

      emit(finalStatus === 'completed' ? 'run_completed' : finalStatus === 'completed_with_errors' ? 'run_completed_with_errors' : 'run_failed');
      cleanupRunEmitter(runId);
      this.activeBreakpoints.delete(runId);
      return { status: finalStatus, nodeOutputs, nodeInputs, nodeErrors, healingHistory };
```

Update `EngineResult` interface to include `healingHistory`:

```typescript
export interface EngineResult {
  status: RunStatus;
  nodeOutputs: Map<string, Record<string, unknown>>;
  nodeInputs: Map<string, Record<string, unknown>>;
  nodeErrors: Map<string, string>;
  error?: string;
  healingHistory?: UndoEntry[];
}
```

- [ ] **Step 6: Remove the outer try/catch `run_failed` emission for healed runs**

The current outer `catch` block catches throws from `Promise.all`. Since healed nodes no longer throw, the outer catch only fires for truly fatal errors (no executor found, graph cycle, etc.). Keep it but update the status:

The existing outer catch at the bottom of `execute`:

```typescript
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      emit('run_failed', undefined, { error: message });
      cleanupRunEmitter(runId);
      this.activeBreakpoints.delete(runId);
      return { status: 'failed', nodeOutputs, nodeInputs, nodeErrors, error: message };
    }
```

Update to include healingHistory:

```typescript
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      emit('run_failed', undefined, { error: message });
      cleanupRunEmitter(runId);
      this.activeBreakpoints.delete(runId);
      return { status: 'failed', nodeOutputs, nodeInputs, nodeErrors, error: message, healingHistory };
    }
```

- [ ] **Step 7: Run typecheck**

```bash
cd ~/strange_rambling_svelte && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep "Error" | grep -v "test" | head -10
```

Expected: No new errors in source files.

- [ ] **Step 8: Commit**

```bash
cd ~/strange_rambling_svelte && git add src/lib/workflows/engine.ts src/lib/workflows/types.ts && git commit -m "feat(healing): add self-healing loop to engine with 3-attempt retry"
```

---

## Task 4: Run API & Persistence

**Files:**
- Modify: `src/routes/api/workflows/[id]/run/+server.ts`
- Create: `src/routes/api/workflows/[id]/runs/[runId]/undo/+server.ts`

- [ ] **Step 1: Update run API to pass selfHealing flag and persist healing history**

Replace the full contents of `src/routes/api/workflows/[id]/run/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows';

export const POST: RequestHandler = async ({ params, request }) => {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!workflow) {
    return json({ error: 'Workflow not found' }, { status: 404 });
  }

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, params.id));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, params.id));

  const body = await request.json().catch(() => ({}));
  const initialInput = body.input || {};
  const selfHealing = body.selfHealing !== false; // default true
  const breakpointNodeIds: string[] = Array.isArray(body.breakpoints) ? body.breakpoints : [];
  const breakpoints = breakpointNodeIds.length > 0 ? new Set<string>(breakpointNodeIds) : undefined;

  const [run] = await db.insert(workflowRuns).values({
    workflowId: params.id,
    status: 'running',
    trigger: 'manual',
    startedAt: new Date(),
  }).returning();

  for (const node of nodes) {
    await db.insert(nodeExecutions).values({
      runId: run.id,
      nodeId: node.id,
      status: 'pending',
    });
  }

  const definition: WorkflowDefinition = {
    id: workflow.id,
    name: workflow.name,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position as { x: number; y: number },
      config: (n.config || {}) as Record<string, unknown>,
      label: n.label,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };

  engine.execute(definition, run.id, initialInput, breakpoints, params.id, { selfHealing }).then(async (result) => {
    // Persist healing history
    const healingHistory = result.healingHistory || [];

    await db.update(workflowRuns).set({
      status: result.status,
      completedAt: new Date(),
      error: result.error || null,
      healingHistory: healingHistory.length > 0 ? healingHistory : undefined,
    }).where(eq(workflowRuns.id, run.id));

    if (result.status === 'completed' || result.status === 'completed_with_errors') {
      try {
        const { emit } = await import('$lib/workflows/event-bus');
        emit('workflow_completed', { workflowId: params.id, runId: run.id, status: result.status });
      } catch { /* event-bus not critical */ }
    }

    // Update node execution records
    for (const [nodeId, output] of result.nodeOutputs) {
      const inputData = result.nodeInputs.get(nodeId);
      await db.update(nodeExecutions).set({
        status: 'completed',
        inputData: inputData ?? null,
        outputData: output,
        completedAt: new Date(),
      }).where(eq(nodeExecutions.nodeId, nodeId));
    }

    for (const [nodeId, error] of result.nodeErrors) {
      await db.update(nodeExecutions).set({
        status: 'failed',
        error,
        completedAt: new Date(),
      }).where(eq(nodeExecutions.nodeId, nodeId));
    }

    // If healing fixed a node's config, persist the updated config to the workflow
    for (const entry of healingHistory) {
      await db.update(workflowNodes).set({
        config: entry.newConfig,
      }).where(eq(workflowNodes.id, entry.nodeId));
    }
  });

  return json({ runId: run.id, status: 'running' }, { status: 201 });
};
```

- [ ] **Step 2: Create undo endpoint**

Create `src/routes/api/workflows/[id]/runs/[runId]/undo/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowRuns, workflowNodes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { UndoEntry } from '$lib/workflows/types';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  const { undoId } = body;

  if (!undoId) {
    return json({ error: 'undoId is required' }, { status: 400 });
  }

  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, params.runId));
  if (!run) {
    return json({ error: 'Run not found' }, { status: 404 });
  }

  const healingHistory = (run.healingHistory || []) as UndoEntry[];
  const entry = healingHistory.find(e => e.id === undoId);

  if (!entry) {
    return json({ error: 'Undo entry not found' }, { status: 404 });
  }

  // Restore original config
  await db.update(workflowNodes).set({
    config: entry.originalConfig,
  }).where(eq(workflowNodes.id, entry.nodeId));

  return json({ success: true, nodeId: entry.nodeId, restoredConfig: entry.originalConfig });
};
```

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte && git add src/routes/api/workflows/\[id\]/run/+server.ts src/routes/api/workflows/\[id\]/runs/\[runId\]/undo/+server.ts && git commit -m "feat(healing): update run API with selfHealing flag, healing persistence, and undo endpoint"
```

---

## Task 5: HealingCard Component

**Files:**
- Create: `src/lib/components/workflows/HealingCard.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/components/workflows/HealingCard.svelte`:

```svelte
<script lang="ts">
  let {
    nodeLabel,
    error,
    attempts,
    status,
    environmentAction,
    alternative,
    undoIds,
    onUndo,
  }: {
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
    undoIds: string[];
    onUndo: (undoId: string) => void;
  } = $props();

  const statusConfig: Record<string, { color: string; icon: string; label: string }> = {
    diagnosing: { color: '#e67e22', icon: '\u{1F50D}', label: 'DIAGNOSING' },
    retrying: { color: '#e67e22', icon: '\u21BB', label: 'RETRYING' },
    succeeded: { color: '#27ae60', icon: '\u2713', label: 'HEALED' },
    failed: { color: '#e74c3c', icon: '\u2717', label: 'COULD NOT FIX' },
    blocked: { color: '#f39c12', icon: '\u26A0', label: 'NEEDS SETUP' },
  };

  let sc = $derived(statusConfig[status] || statusConfig.diagnosing);
</script>

<div class="mb-3 rounded-lg border overflow-hidden" style="border-color: {sc.color}; background: var(--card-bg);">
  <!-- Header -->
  <div class="px-3 py-2 flex items-center gap-2" style="background: color-mix(in srgb, {sc.color} 10%, transparent);">
    {#if status === 'diagnosing' || status === 'retrying'}
      <span class="w-2 h-2 rounded-full animate-pulse" style="background: {sc.color};"></span>
    {:else}
      <span class="text-sm">{sc.icon}</span>
    {/if}
    <span class="text-[11px] uppercase tracking-wider font-medium" style="color: {sc.color};">
      {sc.label}
    </span>
    <span class="text-[11px] ml-auto" style="color: var(--text-ghost);">
      {nodeLabel}
    </span>
  </div>

  <div class="px-3 py-2 space-y-2">
    <!-- Error -->
    <div class="text-[11px] px-2 py-1 rounded" style="background: rgba(231,76,60,0.08); color: #e74c3c; font-family: var(--font-mono); word-break: break-word;">
      {error}
    </div>

    <!-- Attempts -->
    {#each attempts as attempt, i}
      <div class="border-l-2 pl-2 space-y-1" style="border-color: {attempt.retrySucceeded ? '#27ae60' : attempt.fixApplied ? '#e74c3c' : 'var(--card-border)'};">
        <div class="text-[10px] font-medium" style="color: var(--text-ghost);">Attempt {i + 1}</div>

        <div class="text-[11px]" style="color: var(--text-secondary); font-family: var(--font-mono); line-height: 1.5;">
          {attempt.diagnosis}
        </div>

        {#if attempt.reasoning}
          <div class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono); line-height: 1.4;">
            {attempt.reasoning}
          </div>
        {/if}

        {#if attempt.fixDescription}
          <div class="text-[11px] flex items-center gap-1" style="color: {attempt.retrySucceeded ? '#27ae60' : '#e67e22'}; font-family: var(--font-mono);">
            <span>{attempt.retrySucceeded ? '\u2713' : '\u2192'}</span>
            <span>{attempt.fixDescription}</span>
          </div>
        {/if}

        {#if attempt.resultError && !attempt.retrySucceeded}
          <div class="text-[10px]" style="color: #e74c3c; font-family: var(--font-mono);">
            Still failing: {attempt.resultError}
          </div>
        {/if}
      </div>
    {/each}

    <!-- Environment action -->
    {#if environmentAction}
      <div class="rounded p-2 space-y-1" style="background: rgba(243, 156, 18, 0.08);">
        <div class="text-[10px] font-medium uppercase tracking-wider" style="color: #f39c12;">To resolve:</div>
        <div class="text-[11px] whitespace-pre-wrap" style="color: var(--text-primary); font-family: var(--font-mono); line-height: 1.5;">
          {environmentAction}
        </div>
      </div>
    {/if}

    {#if alternative}
      <div class="rounded p-2" style="background: rgba(39, 174, 96, 0.08);">
        <div class="text-[10px] font-medium uppercase tracking-wider" style="color: #27ae60;">Alternative:</div>
        <div class="text-[11px]" style="color: var(--text-secondary); font-family: var(--font-mono);">
          {alternative}
        </div>
      </div>
    {/if}

    <!-- Undo buttons -->
    {#if undoIds.length > 0 && (status === 'succeeded' || status === 'failed')}
      <div class="flex gap-2 pt-1">
        {#each undoIds as undoId, i}
          <button
            onclick={() => onUndo(undoId)}
            class="text-[10px] px-2 py-1 rounded border transition-colors"
            style="border-color: var(--card-border); color: var(--text-ghost);"
          >
            Undo fix {undoIds.length > 1 ? i + 1 : ''}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte && git add src/lib/components/workflows/HealingCard.svelte && git commit -m "feat(healing): add HealingCard component for chat panel"
```

---

## Task 6: BaseNode Healing Status

**Files:**
- Modify: `src/lib/components/workflows/nodes/BaseNode.svelte`

- [ ] **Step 1: Add healing status colour**

In `src/lib/components/workflows/nodes/BaseNode.svelte`, the `STATUS_COLORS` record already has entries. Add `healing`:

```typescript
  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)',
    running: '#e67e22',
    completed: '#27ae60',
    failed: '#e74c3c',
    paused_breakpoint: '#f39c12',
    skipped: 'var(--text-ghost)',
    healing: '#e67e22',
    blocked: '#f39c12',
  };
```

Update the `isRunning` derived to include healing:

```typescript
  let isRunning = $derived(status === 'running' || status === 'healing');
```

Add a healing label display after the existing `isSkipped` block:

After `{#if isSkipped}...{/if}`, add:

```svelte
  {#if status === 'healing'}
    <div class="px-3 pb-2">
      <span class="text-[10px] uppercase tracking-wider animate-pulse" style="color: #e67e22;">Healing...</span>
    </div>
  {/if}

  {#if status === 'blocked'}
    <div class="px-3 pb-2">
      <span class="text-[10px] uppercase tracking-wider" style="color: #f39c12;">Blocked — needs setup</span>
    </div>
  {/if}
```

- [ ] **Step 2: Update the 7 custom node components with the same healing/blocked colours**

Run the same sed commands as before to update STATUS_COLORS in ConditionalNode, ErrorHandlerNode, LlmAgentNode, LlmCallNode, LlmRouterNode, ThinkNode, ValidatorNode:

```bash
cd ~/strange_rambling_svelte && for f in src/lib/components/workflows/nodes/ConditionalNode.svelte src/lib/components/workflows/nodes/ErrorHandlerNode.svelte src/lib/components/workflows/nodes/LlmAgentNode.svelte src/lib/components/workflows/nodes/LlmCallNode.svelte src/lib/components/workflows/nodes/LlmRouterNode.svelte src/lib/components/workflows/nodes/ThinkNode.svelte src/lib/components/workflows/nodes/ValidatorNode.svelte; do
  sed -i "/skipped: 'var(--text-ghost)'/a\\    healing: '#e67e22',\\n    blocked: '#f39c12'," "$f"
done
```

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte && git add src/lib/components/workflows/nodes/ && git commit -m "feat(healing): add healing and blocked status colours to all node components"
```

---

## Task 7: Page SSE Event Handling

**Files:**
- Modify: `src/routes/workflows/[id]/+page.svelte`

- [ ] **Step 1: Add healing state tracking**

In the `<script>` section, add a reactive state for healing cards (near the other state declarations):

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
    undoIds: string[];
  }

  let healingStates = $state<HealingState[]>([]);
```

- [ ] **Step 2: Add healing event handlers in the `connectSSE` function**

After the existing `else if (event.type === 'node_skipped')` block, add:

```typescript
      else if (event.type === 'healing_started' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'healing');
        const existing = healingStates.find(h => h.nodeId === event.nodeId);
        if (!existing) {
          healingStates = [...healingStates, {
            nodeId: event.nodeId,
            nodeLabel: event.data?.nodeLabel || event.nodeId,
            error: event.data?.error || 'Unknown error',
            attempts: [],
            status: 'diagnosing',
            undoIds: [],
          }];
        } else {
          healingStates = healingStates.map(h => h.nodeId === event.nodeId ? { ...h, status: 'diagnosing' } : h);
        }
      }
      else if (event.type === 'healing_progress' && event.nodeId) {
        // Update the latest attempt's diagnosis/reasoning
        healingStates = healingStates.map(h => {
          if (h.nodeId !== event.nodeId) return h;
          const text = event.data?.text || '';
          const lastAttempt = h.attempts[h.attempts.length - 1];
          if (lastAttempt && !lastAttempt.fixApplied) {
            // Append to existing attempt
            return { ...h, attempts: [...h.attempts.slice(0, -1), { ...lastAttempt, diagnosis: text }] };
          }
          // Start a new attempt entry
          return { ...h, attempts: [...h.attempts, { diagnosis: text, reasoning: '', fixApplied: false }] };
        });
      }
      else if (event.type === 'healing_fix_applied' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'running'); // retrying
        healingStates = healingStates.map(h => {
          if (h.nodeId !== event.nodeId) return h;
          const undoId = event.data?.undoId as string;
          const newUndoIds = undoId ? [...h.undoIds, undoId] : h.undoIds;
          const lastAttempt = h.attempts[h.attempts.length - 1];
          if (lastAttempt) {
            return {
              ...h,
              status: 'retrying' as const,
              undoIds: newUndoIds,
              attempts: [...h.attempts.slice(0, -1), {
                ...lastAttempt,
                fixDescription: event.data?.description as string || 'Fix applied',
                fixApplied: true,
              }],
            };
          }
          return { ...h, status: 'retrying' as const, undoIds: newUndoIds };
        });
      }
      else if (event.type === 'healing_succeeded' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'completed');
        healingStates = healingStates.map(h => {
          if (h.nodeId !== event.nodeId) return h;
          const lastAttempt = h.attempts[h.attempts.length - 1];
          if (lastAttempt) {
            return {
              ...h,
              status: 'succeeded' as const,
              attempts: [...h.attempts.slice(0, -1), { ...lastAttempt, retrySucceeded: true }],
            };
          }
          return { ...h, status: 'succeeded' as const };
        });
      }
      else if (event.type === 'healing_failed' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'failed');
        healingStates = healingStates.map(h =>
          h.nodeId === event.nodeId ? { ...h, status: 'failed' as const } : h,
        );
      }
      else if (event.type === 'healing_blocked' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'blocked');
        healingStates = healingStates.map(h =>
          h.nodeId === event.nodeId ? {
            ...h,
            status: 'blocked' as const,
            environmentAction: event.data?.environmentAction as string,
            alternative: event.data?.alternative as string,
          } : h,
        );
      }
      else if (event.type === 'run_completed_with_errors') {
        runStatus = 'completed_with_errors';
        edges = edges.map(e => ({ ...e, animated: false }));
        eventSource?.close();
      }
```

- [ ] **Step 3: Add undo handler function**

```typescript
  async function handleUndo(undoId: string) {
    if (!currentRunId) return;
    try {
      const res = await fetch(`/api/workflows/${data.workflow.id}/runs/${currentRunId}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undoId }),
      });
      if (res.ok) {
        // Refresh the page to reload node configs
        location.reload();
      }
    } catch { /* ignore */ }
  }
```

- [ ] **Step 4: Pass healing states to ChatPanel**

Update the `<ChatPanel>` usage in the template to pass healing states:

```svelte
      <ChatPanel
        workflowId={data.workflow.id}
        onWorkflowGenerated={handleWorkflowGenerated}
        currentNodes={canvasNodesToWorkflow(nodes)}
        currentEdges={canvasEdgesToWorkflow(edges)}
        {healingStates}
        onHealingUndo={handleUndo}
      />
```

- [ ] **Step 5: Update `completed_with_errors` display in the status bar**

Find the existing run status display (where it shows "Completed" or "Failed") and add:

```svelte
      {:else if runStatus === 'completed_with_errors'}
        <span class="w-2 h-2 rounded-full" style="background: #f39c12;"></span>
        <span class="text-xs" style="color: #f39c12;">Completed with errors</span>
```

- [ ] **Step 6: Reset healing states when starting a new run**

In the `handleRun` function, add at the top:

```typescript
    healingStates = [];
```

- [ ] **Step 7: Commit**

```bash
cd ~/strange_rambling_svelte && git add src/routes/workflows/\[id\]/+page.svelte && git commit -m "feat(healing): handle healing SSE events and manage healing state on canvas page"
```

---

## Task 8: ChatPanel Healing Integration

**Files:**
- Modify: `src/lib/components/workflows/ChatPanel.svelte`

- [ ] **Step 1: Add healing props and render HealingCards**

Add new props to the ChatPanel component:

```typescript
  import HealingCard from './HealingCard.svelte';

  let {
    workflowId,
    onWorkflowGenerated,
    currentNodes = [],
    currentEdges = [],
    healingStates = [],
    onHealingUndo = (_undoId: string) => {},
  }: {
    workflowId: string | null;
    onWorkflowGenerated: (workflow: any) => void;
    currentNodes?: any[];
    currentEdges?: any[];
    healingStates?: Array<{
      nodeId: string;
      nodeLabel: string;
      error: string;
      attempts: Array<any>;
      status: string;
      environmentAction?: string;
      alternative?: string;
      undoIds: string[];
    }>;
    onHealingUndo?: (undoId: string) => void;
  } = $props();
```

In the template, after the messages `{#each}` block and before the `{#if loading}` block, add:

```svelte
      {#each healingStates as hs (hs.nodeId)}
        <HealingCard
          nodeLabel={hs.nodeLabel}
          error={hs.error}
          attempts={hs.attempts}
          status={hs.status}
          environmentAction={hs.environmentAction}
          alternative={hs.alternative}
          undoIds={hs.undoIds}
          onUndo={onHealingUndo}
        />
      {/each}
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte && git add src/lib/components/workflows/ChatPanel.svelte && git commit -m "feat(healing): render HealingCard components in chat panel"
```

---

## Task 9: Build, Test & Deploy

**Files:** None new.

- [ ] **Step 1: Run all tests**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/ 2>&1 | tail -15
```

Expected: All tests pass.

- [ ] **Step 2: Build**

```bash
cd ~/strange_rambling_svelte && npm run build 2>&1 | grep -E "^✓|^✗|error during" | head -5
```

Expected: Build succeeds.

- [ ] **Step 3: Push schema change to production DB**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "cd /opt/strange-rambling-svelte && npx drizzle-kit push"
```

Or if drizzle-kit isn't available on the VPS, use a direct SQL command:

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "cd /opt/strange-rambling-svelte && DATABASE_URL=\$(grep DATABASE_URL .env | cut -d= -f2-) node -e \"
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS healing_history jsonb DEFAULT \\\"[]\\\"::jsonb').then(() => { console.log('Done'); pool.end(); }).catch(e => { console.error(e); pool.end(); });
\""
```

- [ ] **Step 4: Push and deploy**

```bash
cd ~/strange_rambling_svelte && git push origin master && bash scripts/deploy.sh
```

- [ ] **Step 5: Test on live**

Run a workflow that will fail (e.g. the Darlington temp workflow with the email node and no SMTP). Verify:
1. Email node turns amber with "Healing..." label
2. Chat panel shows HealingCard with diagnosis
3. Orchestrator diagnoses it as an environment issue
4. Node transitions to "blocked" (amber) with setup instructions
5. Other branches continue executing
6. Run completes with `completed_with_errors` status

- [ ] **Step 6: Final commit if any fixes**

```bash
cd ~/strange_rambling_svelte && git add -A && git status
```

If there are changes, commit and redeploy.
