# Workflow Engine Phase 2: AI Orchestrator + Chat

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI orchestrator (GLM-5.1 via z.ai) that generates and modifies workflows from natural language, with a chat panel alongside the canvas.

**Architecture:** The orchestrator lives in `src/lib/workflows/orchestrator/`. It uses the existing z.ai client (`src/lib/deepdive/keys.ts` → `getOpenAIClient()`) with a 3-round debate pattern (plan, critique, revise) adapted from the JKAI orchestrator. Chat state is stored in the database. The chat panel is a Svelte component in the right sidebar of the canvas editor.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), z.ai GLM-5.1 (via OpenAI SDK), SSE streaming, Drizzle ORM.

**Design spec:** `docs/superpowers/specs/2026-04-12-workflow-engine-design.md` — Section 4 (AI Orchestrator)

**Depends on:** Phase 1 (completed) — engine, registry, canvas, API routes all exist.

---

## File Structure

```
src/lib/workflows/orchestrator/
├── index.ts                    # Main orchestrator class
├── prompts.ts                  # System prompts for planner, critic, reviser
├── parser.ts                   # Parse LLM JSON output into WorkflowDefinition
├── types.ts                    # Orchestrator-specific types

src/lib/components/workflows/
├── ChatPanel.svelte            # Right sidebar chat panel
├── ChatMessage.svelte          # Individual message bubble

src/routes/api/workflows/orchestrator/
├── chat/+server.ts             # POST — send message, get streaming response
├── chat/[workflowId]/+server.ts # GET — load chat history for a workflow

src/lib/db/schema.ts            # Add orchestratorChats table

tests/lib/workflows/orchestrator/
├── parser.test.ts
├── prompts.test.ts
```

---

### Task 1: Orchestrator Chat Schema

**Files:**
- Modify: `src/lib/db/schema.ts`
- Test: `tests/lib/workflows/orchestrator/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/orchestrator/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { orchestratorChats } from '$lib/db/schema';

describe('orchestrator chat schema', () => {
  it('has expected columns', () => {
    expect(orchestratorChats.id).toBeDefined();
    expect(orchestratorChats.workflowId).toBeDefined();
    expect(orchestratorChats.role).toBeDefined();
    expect(orchestratorChats.content).toBeDefined();
    expect(orchestratorChats.metadata).toBeDefined();
    expect(orchestratorChats.createdAt).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/orchestrator/schema.test.ts
```

Expected: FAIL — `orchestratorChats` not found.

- [ ] **Step 3: Add table to schema**

Append to `src/lib/db/schema.ts` after the `integrations` table:

```typescript
export const orchestratorChats = pgTable('orchestrator_chats', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: text('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system'
  content: text('content').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OrchestratorChat = typeof orchestratorChats.$inferSelect;
export type NewOrchestratorChat = typeof orchestratorChats.$inferInsert;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/orchestrator/schema.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine
git add src/lib/db/schema.ts tests/lib/workflows/orchestrator/schema.test.ts
git commit -m "feat(workflows): add orchestrator chat schema table"
```

---

### Task 2: Orchestrator Types

**Files:**
- Create: `src/lib/workflows/orchestrator/types.ts`

- [ ] **Step 1: Create the types file**

Create `src/lib/workflows/orchestrator/types.ts`:

```typescript
import type { WorkflowNodeDef, WorkflowEdgeDef } from '../types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: {
    workflowGenerated?: boolean;
    planningRound?: number;
    error?: string;
  };
  createdAt: string;
}

export interface GeneratedWorkflow {
  name: string;
  description?: string;
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
  explanation: string;
}

export interface PlanningResult {
  proposal: string;
  critique: string;
  revision: string;
  finalWorkflow: GeneratedWorkflow;
  tokensUsed: number;
}

export interface OrchestratorConfig {
  temperature?: number;
  maxTokens?: number;
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine
git add src/lib/workflows/orchestrator/types.ts
git commit -m "feat(workflows): add orchestrator type definitions"
```

---

### Task 3: Orchestrator Prompts

**Files:**
- Create: `src/lib/workflows/orchestrator/prompts.ts`
- Test: `tests/lib/workflows/orchestrator/prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/orchestrator/prompts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildPlannerPrompt, buildCriticPrompt, buildRevisionPrompt, buildModifyPrompt } from '$lib/workflows/orchestrator/prompts';

describe('buildPlannerPrompt', () => {
  it('includes available node types', () => {
    const nodeTypes = ['manual-trigger', 'transform', 'code-execute', 'http-request'];
    const prompt = buildPlannerPrompt(nodeTypes);
    expect(prompt).toContain('manual-trigger');
    expect(prompt).toContain('transform');
    expect(prompt).toContain('http-request');
  });

  it('includes JSON output instruction', () => {
    const prompt = buildPlannerPrompt(['manual-trigger']);
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('nodes');
    expect(prompt).toContain('edges');
  });
});

describe('buildCriticPrompt', () => {
  it('includes review dimensions', () => {
    const prompt = buildCriticPrompt();
    expect(prompt).toContain('error handling');
    expect(prompt).toContain('data shape');
  });
});

describe('buildRevisionPrompt', () => {
  it('includes instruction to address feedback', () => {
    const prompt = buildRevisionPrompt();
    expect(prompt).toContain('address');
    expect(prompt).toContain('critic');
  });
});

describe('buildModifyPrompt', () => {
  it('includes current workflow context', () => {
    const currentWorkflow = {
      nodes: [{ id: 'n1', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' }],
      edges: [],
    };
    const prompt = buildModifyPrompt(currentWorkflow, ['manual-trigger', 'transform']);
    expect(prompt).toContain('manual-trigger');
    expect(prompt).toContain('current workflow');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/orchestrator/prompts.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the prompts**

Create `src/lib/workflows/orchestrator/prompts.ts`:

```typescript
import type { WorkflowNodeDef, WorkflowEdgeDef } from '../types';

export function buildPlannerPrompt(availableNodeTypes: string[]): string {
  return `You are a workflow automation architect. You design automation workflows that connect functions together as a directed graph of nodes and edges.

## Available Node Types

${availableNodeTypes.map((t) => `- \`${t}\``).join('\n')}

## Your Task

Given a user's request, design a workflow as a JSON object with this exact structure:

\`\`\`json
{
  "name": "Workflow name",
  "description": "What this workflow does",
  "nodes": [
    {
      "id": "unique-id",
      "type": "node-type-from-list-above",
      "position": { "x": number, "y": number },
      "config": { ... node-specific configuration ... },
      "label": "Human-readable label"
    }
  ],
  "edges": [
    {
      "id": "edge-id",
      "sourceNodeId": "source-node-id",
      "targetNodeId": "target-node-id"
    }
  ],
  "explanation": "Step-by-step explanation of what each node does and how data flows"
}
\`\`\`

## Node Configuration Reference

- **manual-trigger**: No config needed. Entry point of the workflow.
- **transform**: \`{ "expression": "return { ...input, newField: input.x * 2 }" }\` — JS function body, input available as \`input\`.
- **code-execute**: \`{ "language": "javascript"|"python"|"bash", "code": "..." }\` — Runs in sandbox. Input available as \`input\` variable. Last line of stdout parsed as JSON output.
- **http-request**: \`{ "method": "GET"|"POST"|..., "url": "...", "headers": {}, "body": "..." }\`
- **llm-call**: \`{ "model": "model-name", "systemPrompt": "...", "userPrompt": "...", "temperature": 0.7 }\`
- **conditional**: \`{ "expression": "input.value > 10" }\` — Routes to different output handles.
- **loop**: \`{ "arrayPath": "input.items", "concurrency": 1 }\` — Iterates over an array.

## Layout Guidelines

- Start trigger at x:100, y:200
- Space nodes ~250px apart horizontally
- Fan-out branches vertically with ~150px spacing
- Keep the graph left-to-right

## Rules

- Every workflow MUST start with exactly one trigger node
- Every node must be reachable from the trigger
- Only use node types from the available list
- Generate unique IDs for each node and edge
- Respond with ONLY the JSON object, no markdown fences or explanation outside it`;
}

export function buildCriticPrompt(): string {
  return `You are a rigorous workflow reviewer. You review automation workflow designs for correctness and completeness.

## Review Dimensions

1. **Error handling** — What happens if an API call fails? Is there error handling where needed?
2. **Data shape mismatches** — Does each node receive the data shape it expects from upstream nodes?
3. **Unnecessary complexity** — Could fewer nodes achieve the same result? Are there redundant steps?
4. **Missing steps** — Are there missing transform nodes needed between incompatible outputs and inputs?
5. **Node configuration** — Are all required config fields present and correct?
6. **Edge completeness** — Are all nodes connected? Is there a clear path from trigger to every node?

## Output Format

For each issue found, mark it as:
- \`MISSING:\` — A required step or config that's absent
- \`MISMATCH:\` — Data shape incompatibility between connected nodes
- \`UNNECESSARY:\` — A node or edge that adds no value
- \`INCOMPLETE:\` — A config field that's empty or wrong

If the workflow is sound, say "No issues found."

Be concise and specific. Reference node IDs.`;
}

export function buildRevisionPrompt(): string {
  return `The critic above has reviewed your workflow design. Address all issues raised by the critic.

For each issue:
1. Acknowledge the specific problem
2. Describe your fix
3. Apply the fix to the workflow

Output the revised workflow as a JSON object with the same structure as before (nodes, edges, name, description, explanation). Include a "changes" field listing what you modified.

Respond with ONLY the JSON object.`;
}

export function buildModifyPrompt(
  currentWorkflow: { nodes: WorkflowNodeDef[]; edges: WorkflowEdgeDef[] },
  availableNodeTypes: string[],
): string {
  return `You are modifying an existing workflow. Here is the current workflow:

\`\`\`json
${JSON.stringify(currentWorkflow, null, 2)}
\`\`\`

## Available Node Types

${availableNodeTypes.map((t) => `- \`${t}\``).join('\n')}

## Your Task

Apply the user's requested modification to the workflow. Preserve existing nodes and edges unless the modification specifically requires changing them. Maintain node positions relative to the existing layout.

Output the complete modified workflow as a JSON object with the same structure (nodes, edges, name, description, explanation). Include only the full updated workflow — not a diff.

Respond with ONLY the JSON object.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/orchestrator/prompts.test.ts
```

Expected: PASS — all 4 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine
git add src/lib/workflows/orchestrator/prompts.ts tests/lib/workflows/orchestrator/prompts.test.ts
git commit -m "feat(workflows): add orchestrator system prompts"
```

---

### Task 4: Workflow Parser

**Files:**
- Create: `src/lib/workflows/orchestrator/parser.ts`
- Test: `tests/lib/workflows/orchestrator/parser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/orchestrator/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseWorkflowResponse, extractJsonFromResponse } from '$lib/workflows/orchestrator/parser';

describe('extractJsonFromResponse', () => {
  it('extracts JSON from plain response', () => {
    const input = '{"name":"test","nodes":[],"edges":[],"explanation":"none"}';
    const result = extractJsonFromResponse(input);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test');
  });

  it('extracts JSON from markdown fenced response', () => {
    const input = '```json\n{"name":"test","nodes":[],"edges":[],"explanation":"none"}\n```';
    const result = extractJsonFromResponse(input);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test');
  });

  it('extracts JSON embedded in text', () => {
    const input = 'Here is the workflow:\n{"name":"test","nodes":[],"edges":[],"explanation":"none"}\nDone.';
    const result = extractJsonFromResponse(input);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test');
  });

  it('returns null for non-JSON response', () => {
    const result = extractJsonFromResponse('This is not JSON at all.');
    expect(result).toBeNull();
  });
});

describe('parseWorkflowResponse', () => {
  it('parses a valid workflow response', () => {
    const input = JSON.stringify({
      name: 'My Workflow',
      description: 'Test',
      nodes: [
        { id: 'n1', type: 'manual-trigger', position: { x: 100, y: 200 }, config: {}, label: 'Start' },
        { id: 'n2', type: 'transform', position: { x: 350, y: 200 }, config: { expression: 'return input' }, label: 'Transform' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' },
      ],
      explanation: 'Trigger then transform',
    });

    const result = parseWorkflowResponse(input);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('My Workflow');
    expect(result!.nodes).toHaveLength(2);
    expect(result!.edges).toHaveLength(1);
    expect(result!.explanation).toBe('Trigger then transform');
  });

  it('returns null if nodes missing', () => {
    const result = parseWorkflowResponse('{"name":"test","edges":[]}');
    expect(result).toBeNull();
  });

  it('generates IDs if missing', () => {
    const input = JSON.stringify({
      name: 'Test',
      nodes: [
        { type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
      ],
      edges: [],
      explanation: 'test',
    });

    const result = parseWorkflowResponse(input);
    expect(result).not.toBeNull();
    expect(result!.nodes[0].id).toBeDefined();
    expect(result!.nodes[0].id.length).toBeGreaterThan(0);
  });

  it('defaults position if missing', () => {
    const input = JSON.stringify({
      name: 'Test',
      nodes: [
        { id: 'n1', type: 'manual-trigger', config: {}, label: 'Start' },
      ],
      edges: [],
      explanation: 'test',
    });

    const result = parseWorkflowResponse(input);
    expect(result!.nodes[0].position).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/orchestrator/parser.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the parser**

Create `src/lib/workflows/orchestrator/parser.ts`:

```typescript
import type { GeneratedWorkflow } from './types';

export function extractJsonFromResponse(text: string): Record<string, unknown> | null {
  // Try parsing the whole string as JSON
  try {
    return JSON.parse(text.trim());
  } catch {
    // Not pure JSON
  }

  // Try extracting from markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Invalid JSON in fence
    }
  }

  // Try finding a JSON object in the text
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    } catch {
      // Not valid JSON
    }
  }

  return null;
}

export function parseWorkflowResponse(text: string): GeneratedWorkflow | null {
  const json = extractJsonFromResponse(text);
  if (!json) return null;

  const nodes = json.nodes;
  const edges = json.edges;

  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  if (!Array.isArray(edges)) return null;

  // Normalize nodes — ensure IDs and positions
  const normalizedNodes = nodes.map((n: any, i: number) => ({
    id: n.id || `node-${crypto.randomUUID().slice(0, 8)}`,
    type: n.type || 'transform',
    position: n.position || { x: i * 250, y: 200 },
    config: n.config || {},
    label: n.label || n.type || `Node ${i + 1}`,
  }));

  // Build a map of old ID → new ID for edges
  const idMap = new Map<string, string>();
  nodes.forEach((n: any, i: number) => {
    if (n.id) idMap.set(n.id, normalizedNodes[i].id);
  });

  // Normalize edges
  const normalizedEdges = edges.map((e: any, i: number) => ({
    id: e.id || `edge-${crypto.randomUUID().slice(0, 8)}`,
    sourceNodeId: idMap.get(e.sourceNodeId) || e.sourceNodeId,
    targetNodeId: idMap.get(e.targetNodeId) || e.targetNodeId,
    sourceHandle: e.sourceHandle || undefined,
    targetHandle: e.targetHandle || undefined,
  }));

  return {
    name: (json.name as string) || 'Generated Workflow',
    description: (json.description as string) || undefined,
    nodes: normalizedNodes,
    edges: normalizedEdges,
    explanation: (json.explanation as string) || '',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/orchestrator/parser.test.ts
```

Expected: PASS — all 7 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine
git add src/lib/workflows/orchestrator/parser.ts tests/lib/workflows/orchestrator/parser.test.ts
git commit -m "feat(workflows): add LLM response parser for workflow generation"
```

---

### Task 5: Orchestrator Core

**Files:**
- Create: `src/lib/workflows/orchestrator/index.ts`

- [ ] **Step 1: Create the orchestrator**

Create `src/lib/workflows/orchestrator/index.ts`:

```typescript
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { db } from '$lib/db';
import { orchestratorChats, workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { buildPlannerPrompt, buildCriticPrompt, buildRevisionPrompt, buildModifyPrompt } from './prompts';
import { parseWorkflowResponse } from './parser';
import { nodeDefinitions } from '../registry-client';
import type { GeneratedWorkflow, PlanningResult, ChatMessage } from './types';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '../types';

const availableNodeTypes = nodeDefinitions.map((d) => d.type);

export async function generateWorkflow(
  userMessage: string,
  workflowId: string | null,
  onChunk?: (text: string) => void,
): Promise<{ workflow: GeneratedWorkflow | null; messages: ChatMessage[] }> {
  const client = getOpenAIClient();
  const model = getModel();
  const messages: ChatMessage[] = [];

  // Round 1 — Planner
  onChunk?.('Planning workflow...\n');

  const plannerSystem = buildPlannerPrompt(availableNodeTypes);
  const r1 = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: plannerSystem },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.7,
    max_tokens: 4096,
  });

  const proposal = r1.choices[0]?.message?.content ?? '';
  let tokensUsed = r1.usage?.total_tokens ?? 0;
  onChunk?.('Reviewing plan...\n');

  // Round 2 — Critic
  const criticSystem = buildCriticPrompt();
  const r2 = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: criticSystem },
      { role: 'user', content: `Review this workflow design:\n\n${proposal}` },
    ],
    temperature: 0.6,
    max_tokens: 2048,
  });

  const critique = r2.choices[0]?.message?.content ?? '';
  tokensUsed += r2.usage?.total_tokens ?? 0;

  // Round 3 — Revision (only if critic found issues)
  let finalResponse = proposal;
  if (!critique.toLowerCase().includes('no issues found')) {
    onChunk?.('Revising based on feedback...\n');

    const revisionSystem = buildRevisionPrompt();
    const r3 = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: plannerSystem },
        { role: 'user', content: userMessage },
        { role: 'assistant', content: proposal },
        { role: 'user', content: `[Critic review]\n\n${critique}` },
        { role: 'user', content: revisionSystem },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    });

    finalResponse = r3.choices[0]?.message?.content ?? proposal;
    tokensUsed += r3.usage?.total_tokens ?? 0;
  }

  const workflow = parseWorkflowResponse(finalResponse);

  // Store chat messages
  if (workflowId) {
    await db.insert(orchestratorChats).values({
      workflowId,
      role: 'user',
      content: userMessage,
    });

    const explanation = workflow?.explanation || 'I generated a workflow but could not parse the result.';
    await db.insert(orchestratorChats).values({
      workflowId,
      role: 'assistant',
      content: explanation,
      metadata: {
        workflowGenerated: !!workflow,
        tokensUsed,
      },
    });
  }

  return { workflow, messages };
}

export async function modifyWorkflow(
  userMessage: string,
  workflowId: string,
  currentNodes: WorkflowNodeDef[],
  currentEdges: WorkflowEdgeDef[],
  onChunk?: (text: string) => void,
): Promise<GeneratedWorkflow | null> {
  const client = getOpenAIClient();
  const model = getModel();

  onChunk?.('Modifying workflow...\n');

  const modifySystem = buildModifyPrompt(
    { nodes: currentNodes, edges: currentEdges },
    availableNodeTypes,
  );

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: modifySystem },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.7,
    max_tokens: 4096,
  });

  const text = response.choices[0]?.message?.content ?? '';
  const workflow = parseWorkflowResponse(text);

  // Store chat messages
  await db.insert(orchestratorChats).values({
    workflowId,
    role: 'user',
    content: userMessage,
  });

  await db.insert(orchestratorChats).values({
    workflowId,
    role: 'assistant',
    content: workflow?.explanation || text.slice(0, 500),
    metadata: { workflowGenerated: !!workflow },
  });

  return workflow;
}

export async function getChatHistory(workflowId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(orchestratorChats)
    .where(eq(orchestratorChats.workflowId, workflowId))
    .orderBy(asc(orchestratorChats.createdAt));

  return rows.map((r) => ({
    id: r.id,
    role: r.role as ChatMessage['role'],
    content: r.content,
    metadata: r.metadata as ChatMessage['metadata'],
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function saveWorkflowFromGenerated(
  workflowId: string,
  generated: GeneratedWorkflow,
): Promise<void> {
  // Delete existing nodes/edges
  await db.delete(workflowNodes).where(eq(workflowNodes.workflowId, workflowId));
  await db.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId));

  // Update workflow name/description
  await db.update(workflows).set({
    name: generated.name,
    description: generated.description || null,
    updatedAt: new Date(),
  }).where(eq(workflows.id, workflowId));

  // Insert new nodes
  if (generated.nodes.length > 0) {
    await db.insert(workflowNodes).values(
      generated.nodes.map((n) => ({
        id: n.id,
        workflowId,
        type: n.type,
        position: n.position,
        config: n.config,
        label: n.label,
      })),
    );
  }

  // Insert new edges
  if (generated.edges.length > 0) {
    await db.insert(workflowEdges).values(
      generated.edges.map((e) => ({
        id: e.id,
        workflowId,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourceHandle: e.sourceHandle || null,
        targetHandle: e.targetHandle || null,
      })),
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine
git add src/lib/workflows/orchestrator/index.ts
git commit -m "feat(workflows): add AI orchestrator with 3-round debate planning"
```

---

### Task 6: Orchestrator API Routes

**Files:**
- Create: `src/routes/api/workflows/orchestrator/chat/+server.ts`
- Create: `src/routes/api/workflows/orchestrator/chat/[workflowId]/+server.ts`

- [ ] **Step 1: Create the chat endpoint**

Create `src/routes/api/workflows/orchestrator/chat/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateWorkflow, modifyWorkflow, saveWorkflowFromGenerated } from '$lib/workflows/orchestrator';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { message, workflowId, mode, currentNodes, currentEdges } = body;

  if (!message || typeof message !== 'string') {
    return json({ error: 'message is required' }, { status: 400 });
  }

  try {
    if (mode === 'modify' && currentNodes && currentEdges) {
      const workflow = await modifyWorkflow(
        message,
        workflowId,
        currentNodes as WorkflowNodeDef[],
        currentEdges as WorkflowEdgeDef[],
      );

      if (workflow && workflowId) {
        await saveWorkflowFromGenerated(workflowId, workflow);
      }

      return json({
        success: true,
        workflow,
        message: workflow?.explanation || 'Could not parse the modification.',
      });
    }

    const { workflow } = await generateWorkflow(message, workflowId);

    if (workflow && workflowId) {
      await saveWorkflowFromGenerated(workflowId, workflow);
    }

    return json({
      success: true,
      workflow,
      message: workflow?.explanation || 'Could not generate a workflow from that request.',
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: errorMessage }, { status: 500 });
  }
};
```

- [ ] **Step 2: Create the chat history endpoint**

Create `src/routes/api/workflows/orchestrator/chat/[workflowId]/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChatHistory } from '$lib/workflows/orchestrator';

export const GET: RequestHandler = async ({ params }) => {
  const history = await getChatHistory(params.workflowId);
  return json(history);
};
```

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine
git add src/routes/api/workflows/orchestrator/chat/+server.ts \
  src/routes/api/workflows/orchestrator/chat/\[workflowId\]/+server.ts
git commit -m "feat(workflows): add orchestrator chat API routes"
```

---

### Task 7: ChatMessage Component

**Files:**
- Create: `src/lib/components/workflows/ChatMessage.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/components/workflows/ChatMessage.svelte`:

```svelte
<script lang="ts">
  let {
    role,
    content,
    metadata,
  }: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: { workflowGenerated?: boolean };
  } = $props();

  let isUser = $derived(role === 'user');
</script>

<div class="flex {isUser ? 'justify-end' : 'justify-start'} mb-3">
  <div
    class="max-w-[85%] rounded-lg px-3 py-2 text-sm"
    style="
      background: {isUser ? 'var(--accent)' : 'var(--card-bg)'};
      color: {isUser ? 'white' : 'var(--text-primary)'};
      border: {isUser ? 'none' : '1px solid var(--card-border)'};
    "
  >
    <p class="whitespace-pre-wrap">{content}</p>
    {#if metadata?.workflowGenerated}
      <div
        class="mt-2 pt-2 border-t text-[11px] flex items-center gap-1"
        style="border-color: {isUser ? 'rgba(255,255,255,0.2)' : 'var(--card-border)'}; color: {isUser ? 'rgba(255,255,255,0.7)' : 'var(--text-ghost)'};"
      >
        <span>Workflow generated</span>
      </div>
    {/if}
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine
git add src/lib/components/workflows/ChatMessage.svelte
git commit -m "feat(workflows): add ChatMessage component"
```

---

### Task 8: ChatPanel Component

**Files:**
- Create: `src/lib/components/workflows/ChatPanel.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/components/workflows/ChatPanel.svelte`:

```svelte
<script lang="ts">
  import ChatMessage from './ChatMessage.svelte';

  let {
    workflowId,
    onWorkflowGenerated,
    currentNodes = [],
    currentEdges = [],
  }: {
    workflowId: string | null;
    onWorkflowGenerated: (workflow: any) => void;
    currentNodes?: any[];
    currentEdges?: any[];
  } = $props();

  interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: { workflowGenerated?: boolean };
  }

  let messages = $state<Message[]>([]);
  let input = $state('');
  let loading = $state(false);
  let chatContainer: HTMLDivElement;

  // Load chat history when workflowId changes
  $effect(() => {
    if (workflowId) {
      loadHistory(workflowId);
    }
  });

  async function loadHistory(wfId: string) {
    try {
      const res = await fetch(`/api/workflows/orchestrator/chat/${wfId}`);
      if (res.ok) {
        messages = await res.json();
      }
    } catch {
      // Ignore — new workflow with no history
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    input = '';
    loading = true;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };
    messages = [...messages, userMsg];
    scrollToBottom();

    try {
      const hasExistingNodes = currentNodes.length > 0;
      const res = await fetch('/api/workflows/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          workflowId,
          mode: hasExistingNodes ? 'modify' : 'generate',
          currentNodes: hasExistingNodes ? currentNodes : undefined,
          currentEdges: hasExistingNodes ? currentEdges : undefined,
        }),
      });

      const data = await res.json();

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.message || data.error || 'Something went wrong.',
        metadata: { workflowGenerated: !!data.workflow },
      };
      messages = [...messages, assistantMsg];

      if (data.workflow) {
        onWorkflowGenerated(data.workflow);
      }
    } catch (err) {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Failed to connect to the orchestrator. Please try again.',
      };
      messages = [...messages, errorMsg];
    } finally {
      loading = false;
      scrollToBottom();
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<div
  class="h-full flex flex-col border-l"
  style="background: var(--bg); border-color: var(--card-border); width: 360px;"
>
  <div class="px-4 py-3 border-b" style="border-color: var(--card-border);">
    <h3 class="text-sm font-medium" style="color: var(--text-primary);">Orchestrator</h3>
    <p class="text-[11px] mt-0.5" style="color: var(--text-ghost);">
      Describe what you want to automate
    </p>
  </div>

  <div
    bind:this={chatContainer}
    class="flex-1 overflow-y-auto p-3"
  >
    {#if messages.length === 0}
      <div class="text-center py-8">
        <p class="text-sm" style="color: var(--text-ghost);">
          Tell me what you'd like to automate and I'll design a workflow for you.
        </p>
      </div>
    {:else}
      {#each messages as msg (msg.id)}
        <ChatMessage
          role={msg.role}
          content={msg.content}
          metadata={msg.metadata}
        />
      {/each}
    {/if}

    {#if loading}
      <div class="flex justify-start mb-3">
        <div
          class="rounded-lg px-3 py-2 text-sm border"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-ghost);"
        >
          <span class="animate-pulse">Thinking...</span>
        </div>
      </div>
    {/if}
  </div>

  <div class="p-3 border-t" style="border-color: var(--card-border);">
    <div class="flex gap-2">
      <textarea
        bind:value={input}
        onkeydown={handleKeydown}
        placeholder="Describe your workflow..."
        disabled={loading}
        class="flex-1 px-3 py-2 rounded-lg text-sm border resize-none"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); min-height: 40px; max-height: 120px;"
        rows="1"
      ></textarea>
      <button
        onclick={send}
        disabled={loading || !input.trim()}
        class="px-3 py-2 rounded-lg text-sm font-medium transition-colors self-end"
        style="background: var(--accent); color: white; opacity: {loading || !input.trim() ? 0.5 : 1};"
      >
        Send
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine
git add src/lib/components/workflows/ChatPanel.svelte
git commit -m "feat(workflows): add ChatPanel component with orchestrator integration"
```

---

### Task 9: Wire Chat Panel into Canvas Editor

**Files:**
- Modify: `src/routes/workflows/[id]/+page.svelte`
- Modify: `src/routes/workflows/new/+page.svelte`

- [ ] **Step 1: Update the editor page to include the chat panel**

In `src/routes/workflows/[id]/+page.svelte`, add dynamic import for ChatPanel and wire it in:

Add to the dynamic imports section (inside the `if (browser)` block):
```typescript
let ChatPanel: any = $state(null);
// inside if (browser):
import('$lib/components/workflows/ChatPanel.svelte').then(m => ChatPanel = m.default);
```

Add the `handleWorkflowGenerated` function after the existing handlers:
```typescript
function handleWorkflowGenerated(generated: any) {
  if (!generated?.nodes) return;
  const { workflowNodesToCanvas, workflowEdgesToCanvas } = await import('$lib/components/workflows/adapter');
  // Since we can't await in a sync function, use the already-imported adapter
  nodes = generated.nodes.map((n: any) => ({
    id: n.id,
    type: n.type,
    position: { x: n.position.x, y: n.position.y },
    data: { label: n.label, nodeType: n.type, config: n.config },
  }));
  edges = generated.edges.map((e: any) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }));
  workflowName = generated.name || workflowName;
}
```

Add ChatPanel to the layout — after the Canvas in the flex container:
```svelte
{#if ChatPanel}
  <ChatPanel
    workflowId={data.workflow.id}
    onWorkflowGenerated={handleWorkflowGenerated}
    currentNodes={canvasNodesToWorkflow(nodes)}
    currentEdges={canvasEdgesToWorkflow(edges)}
  />
{/if}
```

- [ ] **Step 2: Apply the same changes to the new workflow page**

Same pattern for `src/routes/workflows/new/+page.svelte`, but pass `workflowId={null}` and after save, set the workflowId.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine
git add src/routes/workflows/\[id\]/+page.svelte src/routes/workflows/new/+page.svelte
git commit -m "feat(workflows): wire ChatPanel into canvas editor pages"
```

---

### Task 10: Build + Typecheck Verification

**Files:** (no new files)

- [ ] **Step 1: Run all workflow tests**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/
```

Expected: All tests PASS.

- [ ] **Step 2: Run svelte-check**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "ERROR.*workflow"
```

Expected: No errors in workflow files.

- [ ] **Step 3: Run build**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npm run build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 4: Fix any issues and commit**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine
git add -A
git commit -m "fix(workflows): resolve Phase 2 type and build issues"
```

---

### Task 11: Deploy

**Files:** (no new files)

- [ ] **Step 1: Push schema to production**

Create the `orchestrator_chats` table on production via SSH:

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "docker exec strange-rambling-app-db-1 psql -U app -d strange_rambling -c \"
CREATE TABLE IF NOT EXISTS orchestrator_chats (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);\""
```

- [ ] **Step 2: Merge to main and deploy**

```bash
cd ~/strange_rambling_svelte
git merge feature/workflow-engine
npm run build
rsync -avz --delete -e "ssh -i ~/.ssh/id_ed25519" build/ johnk@157.180.19.38:/opt/strange-rambling-svelte/build/
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "sudo systemctl restart strange-rambling-svelte"
```

- [ ] **Step 3: Verify**

Visit `/workflows`, create or open a workflow, and use the chat panel to generate a workflow from natural language.
