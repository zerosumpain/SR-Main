# Workflow Engine: Context-Aware Nodes & Agentic Capabilities

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workflow nodes context-aware (upstream schema propagation, variable autocomplete), add Basic/Advanced config views, enforce connection requirements, introduce new agentic/utility node types, and make the palette LLM-constructable for multi-pass agentic workflows.

**Architecture:** Five tracks implemented sequentially: (A) schema propagation engine, (B) Basic/Advanced config UI, (C) connection gate, (D) new node types, (E) orchestrator enrichment. Schema propagation is the foundation — everything else builds on it.

**Tech Stack:** Svelte 5 runes, SvelteKit, `@xyflow/svelte`, TypeScript, Vitest, OpenRouter API.

---

## File Structure

### New Files

```
src/lib/workflows/
├── schema-propagation.ts          # Walk graph, compute resolved upstream schema per node
├── nodes/
│   ├── llm-agent.ts               # Multi-turn agentic LLM with tool-use loop
│   ├── think.ts                   # Chain-of-thought / scratchpad node
│   ├── llm-router.ts              # LLM-powered semantic routing
│   ├── validator.ts               # LLM or schema validation node
│   ├── multi-pass.ts              # Iterative refinement loop
│   ├── merge.ts                   # Explicit multi-input merge strategies
│   ├── fan-out.ts                 # Parallel array split + collect
│   ├── text-parser.ts             # Regex, JSON extract, structured output parsing
│   ├── accumulator.ts             # Collect results across iterations/branches
│   ├── webhook-trigger.ts         # HTTP endpoint trigger
│   ├── db-query.ts                # PostgreSQL query node
│   └── sub-workflow.ts            # Call another workflow as a tool
├── orchestrator/
│   └── patterns.ts                # Composable workflow pattern library

src/lib/components/workflows/
├── BasicConfigRenderer.svelte     # Renders basic-mode form controls
├── UpstreamSchemaPanel.svelte     # Shows resolved upstream schema + variable picker
├── TemplateInput.svelte           # Input with {{variable}} autocomplete
├── nodes/
│   ├── LlmAgentNode.svelte
│   ├── ThinkNode.svelte
│   ├── LlmRouterNode.svelte
│   ├── ValidatorNode.svelte
│   ├── MultiPassNode.svelte
│   ├── MergeNode.svelte
│   ├── FanOutNode.svelte
│   ├── TextParserNode.svelte
│   ├── AccumulatorNode.svelte
│   ├── WebhookTriggerNode.svelte
│   ├── DbQueryNode.svelte
│   └── SubWorkflowNode.svelte

tests/lib/workflows/
├── schema-propagation.test.ts
├── nodes/
│   ├── llm-agent.test.ts
│   ├── think.test.ts
│   ├── llm-router.test.ts
│   ├── validator.test.ts
│   ├── multi-pass.test.ts
│   ├── merge.test.ts
│   ├── fan-out.test.ts
│   ├── text-parser.test.ts
│   ├── accumulator.test.ts
│   ├── webhook-trigger.test.ts
│   ├── db-query.test.ts
│   └── sub-workflow.test.ts
```

### Modified Files

```
src/lib/workflows/types.ts                          # Add BasicConfigField, LlmMetadata to NodeDefinition
src/lib/workflows/registry.ts                       # No changes needed
src/lib/workflows/registry-client.ts                # Add new node definitions
src/lib/workflows/index.ts                          # Register new executors
src/lib/workflows/engine.ts                         # Support multi-pass and fan-out execution
src/lib/workflows/orchestrator/prompts.ts           # Enrich with llmDescription, patterns, examples
src/lib/workflows/orchestrator/index.ts             # Pass enriched node info to planner
src/lib/workflows/nodes/code-execute.ts             # Add outputSchema annotation to config
src/lib/workflows/nodes/transform.ts                # Add outputSchema annotation to config
src/lib/components/workflows/Canvas.svelte          # Register new node type components
src/lib/components/workflows/NodePalette.svelte     # Add 'agentic' category
src/routes/workflows/[id]/+page.svelte              # Replace config modal with Basic/Advanced + connection gate
src/lib/db/schema.ts                                # Add webhook_triggers table (if webhook trigger needs persistent routes)
```

---

## Track A: Schema Propagation Engine

### Task 1: Core Schema Propagation

Implement the graph-walking algorithm that computes the resolved upstream schema for any node in the workflow.

**Files:**
- Create: `src/lib/workflows/schema-propagation.ts`
- Create: `tests/lib/workflows/schema-propagation.test.ts`

- [ ] **Step 1.1: Write failing tests for schema propagation**

Create `tests/lib/workflows/schema-propagation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveUpstreamSchema } from '$lib/workflows/schema-propagation';
import type { WorkflowNodeDef, WorkflowEdgeDef, JsonSchema } from '$lib/workflows/types';

// Helper to build a mock node definition lookup
function mockGetOutputSchema(type: string, config: Record<string, unknown>): JsonSchema {
  const schemas: Record<string, JsonSchema> = {
    'manual-trigger': {
      type: 'object',
      properties: {
        data: { type: 'object', description: 'Initial trigger data' },
      },
    },
    'http-request': {
      type: 'object',
      properties: {
        status: { type: 'number' },
        headers: { type: 'object' },
        body: { type: 'any' },
      },
    },
    'llm-call': {
      type: 'object',
      properties: {
        response: { type: 'string' },
        usage: {
          type: 'object',
          properties: {
            promptTokens: { type: 'number' },
            completionTokens: { type: 'number' },
          },
        },
      },
    },
    'transform': config.outputSchema
      ? (config.outputSchema as JsonSchema)
      : { type: 'object' },
    'code-execute': config.outputSchema
      ? (config.outputSchema as JsonSchema)
      : { type: 'object' },
    'conditional': { type: 'object', description: 'Input passed through' },
  };
  return schemas[type] || { type: 'object' };
}

describe('resolveUpstreamSchema', () => {
  it('returns empty schema for trigger nodes', () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
    ];
    const edges: WorkflowEdgeDef[] = [];

    const schema = resolveUpstreamSchema('trigger', nodes, edges, mockGetOutputSchema);
    expect(schema).toEqual({ type: 'object', properties: {} });
  });

  it('resolves single upstream node schema', () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
      { id: 'llm', type: 'llm-call', position: { x: 300, y: 0 }, config: {}, label: 'LLM' },
    ];
    const edges: WorkflowEdgeDef[] = [
      { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'llm' },
    ];

    const schema = resolveUpstreamSchema('llm', nodes, edges, mockGetOutputSchema);
    expect(schema.properties).toHaveProperty('data');
  });

  it('merges schemas from multiple upstream nodes', () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
      { id: 'http', type: 'http-request', position: { x: 300, y: -100 }, config: {}, label: 'HTTP' },
      { id: 'llm', type: 'llm-call', position: { x: 300, y: 100 }, config: {}, label: 'LLM' },
      { id: 'merge-target', type: 'transform', position: { x: 600, y: 0 }, config: {}, label: 'Merge' },
    ];
    const edges: WorkflowEdgeDef[] = [
      { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'http' },
      { id: 'e2', sourceNodeId: 'trigger', targetNodeId: 'llm' },
      { id: 'e3', sourceNodeId: 'http', targetNodeId: 'merge-target' },
      { id: 'e4', sourceNodeId: 'llm', targetNodeId: 'merge-target' },
    ];

    const schema = resolveUpstreamSchema('merge-target', nodes, edges, mockGetOutputSchema);
    // Should have properties from both HTTP and LLM outputs
    expect(schema.properties).toHaveProperty('status');
    expect(schema.properties).toHaveProperty('response');
  });

  it('uses outputSchema annotation for code-execute nodes', () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
      {
        id: 'code', type: 'code-execute', position: { x: 300, y: 0 },
        config: {
          code: 'return { score: 42 }',
          outputSchema: {
            type: 'object',
            properties: { score: { type: 'number' } },
          },
        },
        label: 'Code',
      },
      { id: 'next', type: 'llm-call', position: { x: 600, y: 0 }, config: {}, label: 'Next' },
    ];
    const edges: WorkflowEdgeDef[] = [
      { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'code' },
      { id: 'e2', sourceNodeId: 'code', targetNodeId: 'next' },
    ];

    const schema = resolveUpstreamSchema('next', nodes, edges, mockGetOutputSchema);
    expect(schema.properties).toHaveProperty('score');
    expect(schema.properties!.score).toEqual({ type: 'number' });
  });

  it('handles conditional branches — schema is union of both paths', () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'cond', type: 'conditional', position: { x: 0, y: 0 }, config: {}, label: 'If' },
      { id: 'target', type: 'transform', position: { x: 300, y: 0 }, config: {}, label: 'After' },
    ];
    const edges: WorkflowEdgeDef[] = [
      { id: 'e1', sourceNodeId: 'cond', targetNodeId: 'target', sourceHandle: 'true' },
    ];

    const schema = resolveUpstreamSchema('target', nodes, edges, mockGetOutputSchema);
    expect(schema.type).toBe('object');
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/schema-propagation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 1.3: Implement schema propagation**

Create `src/lib/workflows/schema-propagation.ts`:

```typescript
import type { WorkflowNodeDef, WorkflowEdgeDef, JsonSchema } from './types';

type OutputSchemaGetter = (type: string, config: Record<string, unknown>) => JsonSchema;

/**
 * Walk the graph backwards from targetNodeId and compute the merged
 * output schema of all immediate upstream nodes. This gives the
 * "available variables" for the target node's config.
 */
export function resolveUpstreamSchema(
  targetNodeId: string,
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
  getOutputSchema: OutputSchemaGetter,
): JsonSchema {
  const incomingEdges = edges.filter((e) => e.targetNodeId === targetNodeId);

  if (incomingEdges.length === 0) {
    return { type: 'object', properties: {} };
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const mergedProperties: Record<string, JsonSchema> = {};

  for (const edge of incomingEdges) {
    const sourceNode = nodeMap.get(edge.sourceNodeId);
    if (!sourceNode) continue;

    const outputSchema = getOutputSchema(sourceNode.type, sourceNode.config);
    if (outputSchema.properties) {
      Object.assign(mergedProperties, outputSchema.properties);
    }
  }

  return {
    type: 'object',
    properties: mergedProperties,
  };
}

/**
 * Flatten a JsonSchema into a list of dot-paths for autocomplete.
 * e.g. { response: string, usage: { promptTokens: number } }
 * becomes: ["response", "usage", "usage.promptTokens"]
 */
export function schemaToVariablePaths(
  schema: JsonSchema,
  prefix: string = '',
): { path: string; type: string; description?: string }[] {
  const results: { path: string; type: string; description?: string }[] = [];

  if (!schema.properties) return results;

  for (const [key, prop] of Object.entries(schema.properties)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const propSchema = prop as JsonSchema;
    results.push({
      path: fullPath,
      type: propSchema.type || 'any',
      description: propSchema.description,
    });

    // Recurse into nested objects
    if (propSchema.type === 'object' && propSchema.properties) {
      results.push(...schemaToVariablePaths(propSchema, fullPath));
    }
  }

  return results;
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/schema-propagation.test.ts`
Expected: PASS

- [ ] **Step 1.5: Add schemaToVariablePaths tests**

Append to `tests/lib/workflows/schema-propagation.test.ts`:

```typescript
import { schemaToVariablePaths } from '$lib/workflows/schema-propagation';

describe('schemaToVariablePaths', () => {
  it('flattens a simple schema to paths', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        response: { type: 'string', description: 'LLM response' },
        status: { type: 'number' },
      },
    };

    const paths = schemaToVariablePaths(schema);
    expect(paths).toEqual([
      { path: 'response', type: 'string', description: 'LLM response' },
      { path: 'status', type: 'number', description: undefined },
    ]);
  });

  it('flattens nested objects with dot notation', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        usage: {
          type: 'object',
          properties: {
            promptTokens: { type: 'number' },
            completionTokens: { type: 'number' },
          },
        },
      },
    };

    const paths = schemaToVariablePaths(schema);
    expect(paths).toContainEqual({ path: 'usage', type: 'object', description: undefined });
    expect(paths).toContainEqual({ path: 'usage.promptTokens', type: 'number', description: undefined });
    expect(paths).toContainEqual({ path: 'usage.completionTokens', type: 'number', description: undefined });
  });
});
```

- [ ] **Step 1.6: Run all propagation tests**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/schema-propagation.test.ts`
Expected: PASS

- [ ] **Step 1.7: Commit**

```bash
git add src/lib/workflows/schema-propagation.ts tests/lib/workflows/schema-propagation.test.ts
git commit -m "feat(workflows): add schema propagation engine for upstream variable resolution"
```

---

### Task 2: Output Schema Annotations for Code Nodes

Add an `outputSchema` config field to `code-execute` and `transform` nodes so users/LLMs can declare what shape their code outputs.

**Files:**
- Modify: `src/lib/workflows/nodes/code-execute.ts`
- Modify: `src/lib/workflows/nodes/transform.ts`
- Modify: `src/lib/workflows/registry-client.ts` (the client-safe defs)

- [ ] **Step 2.1: Add outputSchema to code-execute definition and executor**

In `src/lib/workflows/nodes/code-execute.ts`, update the `configSchema` to include `outputSchema`, and update `getOutputSchema()` to use it:

Add `outputSchema` property to `configSchema.properties`:

```typescript
outputSchema: {
  type: 'object',
  description: 'Optional: declare the output shape so downstream nodes get autocomplete. e.g. { "score": { "type": "number" }, "label": { "type": "string" } }',
},
```

Update `getOutputSchema` in the executor:

```typescript
getOutputSchema(config: Record<string, unknown>) {
  if (config.outputSchema && typeof config.outputSchema === 'object') {
    return config.outputSchema as JsonSchema;
  }
  return { type: 'object', description: 'Last line of stdout parsed as JSON, or { stdout: string }' };
},
```

- [ ] **Step 2.2: Same for transform node**

In `src/lib/workflows/nodes/transform.ts`, add `outputSchema` to configSchema and update `getOutputSchema`:

```typescript
outputSchema: {
  type: 'object',
  description: 'Optional: declare the output shape for downstream autocomplete.',
},
```

```typescript
getOutputSchema(config: Record<string, unknown>) {
  if (config.outputSchema && typeof config.outputSchema === 'object') {
    return config.outputSchema as JsonSchema;
  }
  if (!config.expression) {
    return { type: 'object', description: 'Input passed through unchanged' };
  }
  return { type: 'object', description: 'Result of transform expression' };
},
```

- [ ] **Step 2.3: Update client-safe definitions in registry-client.ts**

Mirror the same `outputSchema` property additions in the `codeExecuteDef` and `transformDef` inside `src/lib/workflows/registry-client.ts`.

- [ ] **Step 2.4: Run existing code-execute and transform tests**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/code-execute.test.ts tests/lib/workflows/nodes/transform.test.ts`
Expected: PASS (no breaking changes)

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/workflows/nodes/code-execute.ts src/lib/workflows/nodes/transform.ts src/lib/workflows/registry-client.ts
git commit -m "feat(workflows): add outputSchema annotation to code-execute and transform nodes"
```

---

## Track B: Basic / Advanced Config Views

### Task 3: Extend NodeDefinition Type with BasicConfigField

**Files:**
- Modify: `src/lib/workflows/types.ts`

- [ ] **Step 3.1: Add BasicConfigField type and extend NodeDefinition**

In `src/lib/workflows/types.ts`, add after the `JsonSchema` interface:

```typescript
export interface BasicConfigField {
  key: string;
  label: string;
  type: 'dropdown' | 'toggle' | 'slider' | 'text' | 'textarea' | 'template-textarea' | 'number' | 'code';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  description?: string;
  /** If true, this field is only shown in Advanced mode */
  advancedOnly?: boolean;
}
```

Add to `NodeDefinition`:

```typescript
export interface NodeDefinition {
  type: string;
  label: string;
  category: 'trigger' | 'core' | 'integration' | 'control' | 'custom' | 'agentic';
  description: string;
  configSchema: JsonSchema;
  defaultConfig: Record<string, unknown>;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  /** Basic-mode form fields. If absent, node only has Advanced (raw config) mode. */
  basicConfig?: BasicConfigField[];
  /** Rich description for the LLM orchestrator — when/why to use this node */
  llmDescription?: string;
  /** Example configs for the orchestrator */
  llmExamples?: Record<string, unknown>[];
}
```

- [ ] **Step 3.2: Commit**

```bash
git add src/lib/workflows/types.ts
git commit -m "feat(workflows): add BasicConfigField type and agentic category to NodeDefinition"
```

---

### Task 4: Add basicConfig to Existing Node Definitions

Add `basicConfig` arrays to each of the 14 existing nodes so they have proper Basic-mode form fields.

**Files:**
- Modify: `src/lib/workflows/registry-client.ts`

- [ ] **Step 4.1: Add basicConfig to llm-call definition**

In the `llmCallDef` inside `registry-client.ts`:

```typescript
basicConfig: [
  {
    key: 'model',
    label: 'Model',
    type: 'dropdown',
    options: [
      { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'openai/gpt-4o', label: 'GPT-4o' },
      { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet' },
      { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku' },
      { value: 'google/gemini-2.5-flash-preview', label: 'Gemini Flash' },
      { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
    ],
  },
  { key: 'systemPrompt', label: 'System Prompt', type: 'template-textarea', placeholder: 'You are a helpful assistant...' },
  { key: 'userPrompt', label: 'User Prompt', type: 'template-textarea', placeholder: 'Use {{input.field}} for variables' },
  { key: 'temperature', label: 'Temperature', type: 'slider', min: 0, max: 2, step: 0.1 },
  { key: 'maxTokens', label: 'Max Tokens', type: 'number', advancedOnly: true },
],
```

- [ ] **Step 4.2: Add basicConfig to http-request definition**

```typescript
basicConfig: [
  {
    key: 'method',
    label: 'Method',
    type: 'dropdown',
    options: [
      { value: 'GET', label: 'GET' },
      { value: 'POST', label: 'POST' },
      { value: 'PUT', label: 'PUT' },
      { value: 'PATCH', label: 'PATCH' },
      { value: 'DELETE', label: 'DELETE' },
    ],
  },
  { key: 'url', label: 'URL', type: 'template-textarea', placeholder: 'https://api.example.com/{{input.path}}' },
  {
    key: 'auth',
    label: 'Authentication',
    type: 'dropdown',
    options: [
      { value: 'none', label: 'None' },
      { value: 'bearer', label: 'Bearer Token' },
      { value: 'apiKey', label: 'API Key' },
    ],
  },
  { key: 'authToken', label: 'Token', type: 'template-textarea', advancedOnly: false },
  { key: 'headers', label: 'Headers (JSON)', type: 'textarea', advancedOnly: true },
  { key: 'body', label: 'Body', type: 'template-textarea', advancedOnly: true },
  { key: 'authHeader', label: 'API Key Header Name', type: 'text', advancedOnly: true },
],
```

- [ ] **Step 4.3: Add basicConfig to conditional definition**

```typescript
basicConfig: [
  { key: 'expression', label: 'Condition', type: 'template-textarea', placeholder: 'input.value > 10', description: 'JavaScript boolean expression. Use input.field to access data.' },
],
```

- [ ] **Step 4.4: Add basicConfig to loop definition**

```typescript
basicConfig: [
  { key: 'arrayPath', label: 'Array Field', type: 'template-textarea', placeholder: 'items', description: 'Dot-path to the array in input data' },
  { key: 'expression', label: 'Item Transform', type: 'code', placeholder: 'return item', description: 'JS expression applied to each item. Variables: item, index, input', advancedOnly: false },
  { key: 'concurrency', label: 'Concurrency', type: 'number', advancedOnly: true },
],
```

- [ ] **Step 4.5: Add basicConfig to code-execute definition**

```typescript
basicConfig: [
  {
    key: 'language',
    label: 'Language',
    type: 'dropdown',
    options: [
      { value: 'javascript', label: 'JavaScript' },
      { value: 'python', label: 'Python' },
      { value: 'bash', label: 'Bash' },
    ],
  },
  { key: 'code', label: 'Code', type: 'code', placeholder: '// input object is available\nconsole.log(JSON.stringify({ result: input.value * 2 }))' },
  { key: 'outputSchema', label: 'Output Schema (optional)', type: 'textarea', advancedOnly: true, description: 'Declare output shape as JSON Schema for downstream autocomplete' },
],
```

- [ ] **Step 4.6: Add basicConfig to remaining nodes**

Add to `transformDef`:
```typescript
basicConfig: [
  { key: 'expression', label: 'Transform Expression', type: 'code', placeholder: 'return { ...input, newField: input.value * 2 }' },
  { key: 'outputSchema', label: 'Output Schema (optional)', type: 'textarea', advancedOnly: true },
],
```

Add to `delayDef`:
```typescript
basicConfig: [
  { key: 'milliseconds', label: 'Delay (ms)', type: 'number', placeholder: '1000' },
],
```

Add to `emailDef`:
```typescript
basicConfig: [
  { key: 'to', label: 'To', type: 'template-textarea', placeholder: '{{input.email}}' },
  { key: 'subject', label: 'Subject', type: 'template-textarea' },
  { key: 'body', label: 'Body', type: 'template-textarea' },
  { key: 'from', label: 'From (override)', type: 'text', advancedOnly: true },
],
```

Add to `dataStoreDef`:
```typescript
basicConfig: [
  {
    key: 'operation',
    label: 'Operation',
    type: 'dropdown',
    options: [
      { value: 'get', label: 'Get Value' },
      { value: 'set', label: 'Set Value' },
    ],
  },
  { key: 'key', label: 'Key', type: 'template-textarea', placeholder: 'my-key' },
  { key: 'valuePath', label: 'Value Path (set only)', type: 'template-textarea', advancedOnly: false, placeholder: 'input.value' },
],
```

Add to `stravaDef`:
```typescript
basicConfig: [
  {
    key: 'operation',
    label: 'Operation',
    type: 'dropdown',
    options: [
      { value: 'list_activities', label: 'List Activities' },
      { value: 'get_activity', label: 'Get Activity' },
      { value: 'get_athlete_stats', label: 'Get Athlete Stats' },
    ],
  },
  { key: 'perPage', label: 'Results per Page', type: 'number', advancedOnly: false },
  { key: 'activityId', label: 'Activity ID', type: 'template-textarea', advancedOnly: true },
  { key: 'page', label: 'Page Number', type: 'number', advancedOnly: true },
],
```

Add to `whoopDef`:
```typescript
basicConfig: [
  {
    key: 'operation',
    label: 'Operation',
    type: 'dropdown',
    options: [
      { value: 'get_cycles', label: 'Get Cycles' },
      { value: 'get_recovery', label: 'Get Recovery' },
      { value: 'get_sleep', label: 'Get Sleep' },
      { value: 'get_workouts', label: 'Get Workouts' },
    ],
  },
  { key: 'limit', label: 'Max Records', type: 'number' },
  { key: 'start', label: 'Start Date', type: 'text', advancedOnly: true, placeholder: '2025-01-01T00:00:00Z' },
  { key: 'end', label: 'End Date', type: 'text', advancedOnly: true, placeholder: '2025-12-31T23:59:59Z' },
],
```

Add to `openrouterDef`:
```typescript
basicConfig: [
  {
    key: 'operation',
    label: 'Operation',
    type: 'dropdown',
    options: [
      { value: 'chat_completion', label: 'Chat Completion' },
      { value: 'list_models', label: 'List Models' },
      { value: 'get_usage', label: 'Get Usage' },
    ],
  },
  {
    key: 'model',
    label: 'Model',
    type: 'dropdown',
    options: [
      { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'openai/gpt-4o', label: 'GPT-4o' },
      { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet' },
      { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku' },
    ],
  },
  { key: 'systemPrompt', label: 'System Prompt', type: 'template-textarea' },
  { key: 'userPrompt', label: 'User Prompt', type: 'template-textarea' },
  { key: 'temperature', label: 'Temperature', type: 'slider', min: 0, max: 2, step: 0.1, advancedOnly: true },
  { key: 'maxTokens', label: 'Max Tokens', type: 'number', advancedOnly: true },
],
```

`errorHandlerDef` and `manualTriggerDef` have no config fields, so no `basicConfig` needed.

- [ ] **Step 4.7: Commit**

```bash
git add src/lib/workflows/registry-client.ts
git commit -m "feat(workflows): add basicConfig definitions to all existing nodes"
```

---

### Task 5: BasicConfigRenderer Component

Renders the Basic-mode form: dropdowns, sliders, toggles, text inputs, template textareas with variable autocomplete.

**Files:**
- Create: `src/lib/components/workflows/BasicConfigRenderer.svelte`
- Create: `src/lib/components/workflows/TemplateInput.svelte`

- [ ] **Step 5.1: Create TemplateInput component**

This is a textarea that shows a dropdown of available `{{input.X}}` variables when the user types `{{`.

Create `src/lib/components/workflows/TemplateInput.svelte`:

```svelte
<script lang="ts">
  let {
    value = '',
    placeholder = '',
    variables = [],
    onInput,
  }: {
    value: string;
    placeholder?: string;
    variables: { path: string; type: string; description?: string }[];
    onInput: (value: string) => void;
  } = $props();

  let showSuggestions = $state(false);
  let filteredVars = $derived(
    showSuggestions
      ? variables.filter((v) => {
          const match = value.match(/\{\{input\.([^}]*)$/);
          if (!match) return true;
          return v.path.toLowerCase().startsWith(match[1].toLowerCase());
        })
      : [],
  );
  let textareaRef = $state<HTMLTextAreaElement | null>(null);

  function handleInput(e: Event) {
    const newValue = (e.target as HTMLTextAreaElement).value;
    onInput(newValue);
    // Show suggestions when user types {{
    showSuggestions = /\{\{input\.[^}]*$/.test(newValue);
  }

  function insertVariable(path: string) {
    const match = value.match(/^(.*\{\{input\.)[^}]*$/s);
    if (match) {
      const newValue = match[1] + path + '}}';
      onInput(newValue);
    } else {
      onInput(value + `{{input.${path}}}`);
    }
    showSuggestions = false;
    textareaRef?.focus();
  }
</script>

<div class="relative">
  <textarea
    bind:this={textareaRef}
    {value}
    {placeholder}
    oninput={handleInput}
    class="w-full px-2 py-1.5 rounded text-xs border resize-vertical"
    style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono); min-height: 60px;"
    rows="3"
  ></textarea>

  {#if showSuggestions && filteredVars.length > 0}
    <div
      class="absolute z-10 left-0 right-0 mt-1 rounded border shadow-lg max-h-40 overflow-y-auto"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      {#each filteredVars as variable}
        <button
          onclick={() => insertVariable(variable.path)}
          class="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 flex items-center gap-2"
          style="color: var(--text-primary);"
        >
          <span style="font-family: var(--font-mono); color: var(--accent);">{'{{'}input.{variable.path}{'}}'}</span>
          <span class="text-[10px]" style="color: var(--text-ghost);">({variable.type})</span>
          {#if variable.description}
            <span class="text-[10px] ml-auto truncate" style="color: var(--text-ghost);">{variable.description}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if variables.length > 0}
    <div class="flex flex-wrap gap-1 mt-1">
      {#each variables.slice(0, 5) as variable}
        <button
          onclick={() => insertVariable(variable.path)}
          class="text-[10px] px-1.5 py-0.5 rounded border hover:border-[var(--accent)] transition-colors"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-ghost); font-family: var(--font-mono);"
          title={variable.description || variable.path}
        >
          {variable.path}
        </button>
      {/each}
      {#if variables.length > 5}
        <span class="text-[10px] py-0.5" style="color: var(--text-ghost);">+{variables.length - 5} more</span>
      {/if}
    </div>
  {/if}
</div>
```

- [ ] **Step 5.2: Create BasicConfigRenderer component**

Create `src/lib/components/workflows/BasicConfigRenderer.svelte`:

```svelte
<script lang="ts">
  import type { BasicConfigField } from '$lib/workflows/types';
  import TemplateInput from './TemplateInput.svelte';

  let {
    fields,
    config,
    variables = [],
    showAdvanced = false,
    onConfigChange,
  }: {
    fields: BasicConfigField[];
    config: Record<string, unknown>;
    variables: { path: string; type: string; description?: string }[];
    showAdvanced: boolean;
    onConfigChange: (config: Record<string, unknown>) => void;
  } = $props();

  let visibleFields = $derived(
    showAdvanced ? fields : fields.filter((f) => !f.advancedOnly),
  );

  function updateField(key: string, value: unknown) {
    onConfigChange({ ...config, [key]: value });
  }
</script>

<div class="space-y-3">
  {#each visibleFields as field (field.key)}
    <div>
      <label
        class="text-[11px] uppercase tracking-wider mb-1 block"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        {field.label}
      </label>

      {#if field.description}
        <p class="text-[10px] mb-1" style="color: var(--text-ghost);">{field.description}</p>
      {/if}

      {#if field.type === 'dropdown'}
        <select
          value={config[field.key] as string ?? ''}
          onchange={(e) => updateField(field.key, (e.target as HTMLSelectElement).value)}
          class="w-full px-2 py-1.5 rounded text-xs border"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
        >
          {#each field.options || [] as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>

      {:else if field.type === 'toggle'}
        <button
          onclick={() => updateField(field.key, !config[field.key])}
          class="flex items-center gap-2"
        >
          <div
            class="w-8 h-4 rounded-full transition-colors relative"
            style="background: {config[field.key] ? 'var(--accent)' : 'var(--card-border)'};"
          >
            <div
              class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
              style="left: {config[field.key] ? '18px' : '2px'};"
            ></div>
          </div>
          <span class="text-xs" style="color: var(--text-primary);">{config[field.key] ? 'On' : 'Off'}</span>
        </button>

      {:else if field.type === 'slider'}
        <div class="flex items-center gap-2">
          <input
            type="range"
            min={field.min ?? 0}
            max={field.max ?? 1}
            step={field.step ?? 0.1}
            value={config[field.key] as number ?? field.min ?? 0}
            oninput={(e) => updateField(field.key, parseFloat((e.target as HTMLInputElement).value))}
            class="flex-1"
          />
          <span class="text-xs w-10 text-right" style="color: var(--text-primary); font-family: var(--font-mono);">
            {config[field.key] ?? field.min ?? 0}
          </span>
        </div>

      {:else if field.type === 'number'}
        <input
          type="number"
          value={config[field.key] as number ?? ''}
          placeholder={field.placeholder ?? ''}
          oninput={(e) => updateField(field.key, parseFloat((e.target as HTMLInputElement).value) || 0)}
          class="w-full px-2 py-1.5 rounded text-xs border"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
        />

      {:else if field.type === 'template-textarea'}
        <TemplateInput
          value={config[field.key] as string ?? ''}
          placeholder={field.placeholder ?? ''}
          {variables}
          onInput={(v) => updateField(field.key, v)}
        />

      {:else if field.type === 'textarea'}
        <textarea
          value={typeof config[field.key] === 'string' ? config[field.key] : JSON.stringify(config[field.key] ?? '', null, 2)}
          placeholder={field.placeholder ?? ''}
          oninput={(e) => {
            const raw = (e.target as HTMLTextAreaElement).value;
            try { updateField(field.key, JSON.parse(raw)); } catch { updateField(field.key, raw); }
          }}
          class="w-full px-2 py-1.5 rounded text-xs border resize-vertical"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono); min-height: 60px;"
          rows="3"
        ></textarea>

      {:else if field.type === 'code'}
        <textarea
          value={config[field.key] as string ?? ''}
          placeholder={field.placeholder ?? ''}
          oninput={(e) => updateField(field.key, (e.target as HTMLTextAreaElement).value)}
          class="w-full px-2 py-1.5 rounded text-xs border resize-vertical"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono); min-height: 100px;"
          rows="6"
        ></textarea>

      {:else}
        <input
          type="text"
          value={config[field.key] as string ?? ''}
          placeholder={field.placeholder ?? ''}
          oninput={(e) => updateField(field.key, (e.target as HTMLInputElement).value)}
          class="w-full px-2 py-1.5 rounded text-xs border"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
        />
      {/if}
    </div>
  {/each}
</div>
```

- [ ] **Step 5.3: Commit**

```bash
git add src/lib/components/workflows/TemplateInput.svelte src/lib/components/workflows/BasicConfigRenderer.svelte
git commit -m "feat(workflows): add BasicConfigRenderer and TemplateInput with variable autocomplete"
```

---

### Task 6: UpstreamSchemaPanel Component

Shows the resolved upstream schema for the selected node — what variables are available.

**Files:**
- Create: `src/lib/components/workflows/UpstreamSchemaPanel.svelte`

- [ ] **Step 6.1: Create UpstreamSchemaPanel**

Create `src/lib/components/workflows/UpstreamSchemaPanel.svelte`:

```svelte
<script lang="ts">
  let {
    variables = [],
  }: {
    variables: { path: string; type: string; description?: string }[];
  } = $props();

  const TYPE_COLORS: Record<string, string> = {
    string: '#ce9178',
    number: '#b5cea8',
    boolean: '#569cd6',
    object: '#dcdcaa',
    array: '#c586c0',
    any: 'var(--text-ghost)',
  };
</script>

{#if variables.length > 0}
  <div class="mb-3">
    <h4
      class="text-[10px] uppercase tracking-wider mb-2"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      Available Variables
    </h4>
    <div
      class="p-2 rounded border space-y-1 max-h-32 overflow-y-auto"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      {#each variables as variable}
        <div class="flex items-center gap-2 text-xs">
          <span style="font-family: var(--font-mono); color: var(--accent);">
            {'{{'}input.{variable.path}{'}}'}
          </span>
          <span
            class="text-[10px] px-1 rounded"
            style="color: {TYPE_COLORS[variable.type] || 'var(--text-ghost)'};"
          >
            {variable.type}
          </span>
          {#if variable.description}
            <span class="text-[10px] ml-auto truncate" style="color: var(--text-ghost);" title={variable.description}>
              {variable.description}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div class="mb-3">
    <p class="text-[10px]" style="color: var(--text-ghost);">No upstream variables — this node receives no input data.</p>
  </div>
{/if}
```

- [ ] **Step 6.2: Commit**

```bash
git add src/lib/components/workflows/UpstreamSchemaPanel.svelte
git commit -m "feat(workflows): add UpstreamSchemaPanel showing available variables"
```

---

### Task 7: Rewrite Node Config Modal with Basic/Advanced + Connection Gate

Replace the current config modal in `[id]/+page.svelte` with the new system: connection gate, Basic/Advanced toggle, upstream schema panel.

**Files:**
- Modify: `src/routes/workflows/[id]/+page.svelte`

- [ ] **Step 7.1: Add imports and schema computation**

At the top of the `<script>` block in `src/routes/workflows/[id]/+page.svelte`, add the imports:

```typescript
import { resolveUpstreamSchema, schemaToVariablePaths } from '$lib/workflows/schema-propagation';
```

Add state for config mode:

```typescript
let configMode = $state<'basic' | 'advanced'>('basic');
```

Add a derived that computes upstream variables for the modal node:

```typescript
let modalUpstreamVariables = $derived.by(() => {
  if (!modalNodeId || !registryModule) return [];
  const workflowNodes = canvasNodesToWorkflow(nodes);
  const workflowEdges = canvasEdgesToWorkflow(edges);
  const schema = resolveUpstreamSchema(
    modalNodeId,
    workflowNodes,
    workflowEdges,
    (type, config) => {
      // Use executor getOutputSchema when available, fall back to static
      const def = registryModule.getDefinition(type);
      if (!def) return { type: 'object', properties: {} };
      // Check for outputSchema annotation in config
      if (config.outputSchema && typeof config.outputSchema === 'object') {
        return config.outputSchema;
      }
      // Use known static output schemas
      return getStaticOutputSchema(type, config);
    },
  );
  return schemaToVariablePaths(schema);
});
```

Add the `getStaticOutputSchema` helper function (this mirrors what the executors know):

```typescript
function getStaticOutputSchema(type: string, config: Record<string, unknown>): JsonSchema {
  const schemas: Record<string, JsonSchema> = {
    'manual-trigger': { type: 'object', properties: { data: { type: 'object' } } },
    'http-request': {
      type: 'object',
      properties: {
        status: { type: 'number', description: 'HTTP status code' },
        headers: { type: 'object', description: 'Response headers' },
        body: { type: 'any', description: 'Response body' },
      },
    },
    'llm-call': {
      type: 'object',
      properties: {
        response: { type: 'string', description: 'LLM response text' },
        usage: {
          type: 'object',
          properties: {
            promptTokens: { type: 'number' },
            completionTokens: { type: 'number' },
          },
        },
      },
    },
    'email': {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
        accepted: { type: 'array' },
      },
    },
    'data-store': {
      type: 'object',
      properties: {
        value: { type: 'any', description: 'Stored value' },
        key: { type: 'string' },
      },
    },
    'loop': {
      type: 'object',
      properties: {
        results: { type: 'array', description: 'Array of transformed items' },
        count: { type: 'number', description: 'Number of items processed' },
      },
    },
    'strava': { type: 'object', properties: { data: { type: 'any' } } },
    'whoop': { type: 'object', properties: { data: { type: 'any' } } },
    'openrouter': {
      type: 'object',
      properties: {
        response: { type: 'string' },
        usage: { type: 'object' },
      },
    },
  };

  // Passthrough nodes — output schema = their upstream input schema (approximate)
  if (type === 'conditional' || type === 'error-handler' || type === 'delay') {
    return { type: 'object', description: 'Input passed through' };
  }

  return schemas[type] || { type: 'object' };
}
```

Add a derived that checks if the modal node is connected (has incoming edges) or is a trigger:

```typescript
let modalNodeIsConnected = $derived.by(() => {
  if (!modalNodeId) return false;
  const node = nodes.find((n) => n.id === modalNodeId);
  if (!node) return false;
  // Trigger nodes are always configurable
  const def = registryModule?.getDefinition(node.data.nodeType);
  if (def?.category === 'trigger') return true;
  // Check for incoming edges
  return edges.some((e) => e.target === modalNodeId);
});
```

- [ ] **Step 7.2: Replace the node config modal body**

Replace the entire `{#if showNodeModal && modalNode}` block (the modal) with:

```svelte
{#if showNodeModal && modalNode}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center"
    role="presentation"
    onclick={() => { showNodeModal = false; }}
  >
    <div class="absolute inset-0 bg-black/70"></div>
    <div
      class="relative rounded-xl border w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-2xl"
      style="background: var(--bg, #ede4d4); border-color: var(--card-border);"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
    >
      <!-- Header -->
      <div class="px-5 py-4 border-b flex items-center justify-between" style="border-color: var(--card-border);">
        <div>
          <h2 class="text-base font-medium" style="color: var(--text-primary);">{modalNode.data.label}</h2>
          <p class="text-[10px] uppercase tracking-wider mt-0.5" style="color: var(--text-ghost); font-family: var(--font-mono);">{modalNode.data.nodeType}</p>
        </div>
        <div class="flex items-center gap-2">
          {#if modalNodeDef?.basicConfig && modalNodeIsConnected}
            <div class="flex rounded border text-[10px]" style="border-color: var(--card-border);">
              <button
                onclick={() => { configMode = 'basic'; }}
                class="px-2 py-1 transition-colors"
                style="background: {configMode === 'basic' ? 'var(--accent)' : 'transparent'}; color: {configMode === 'basic' ? 'white' : 'var(--text-ghost)'};"
              >Basic</button>
              <button
                onclick={() => { configMode = 'advanced'; }}
                class="px-2 py-1 transition-colors"
                style="background: {configMode === 'advanced' ? 'var(--accent)' : 'transparent'}; color: {configMode === 'advanced' ? 'white' : 'var(--text-ghost)'};"
              >Advanced</button>
            </div>
          {/if}
          <button onclick={() => { showNodeModal = false; }} class="text-lg px-2 py-1 rounded hover:bg-black/10" style="color: var(--text-ghost);">&times;</button>
        </div>
      </div>

      <div class="p-5 space-y-5">
        {#if !modalNodeIsConnected}
          <!-- Connection gate: node must be connected -->
          <div class="text-center py-8">
            <div class="text-3xl mb-3" style="color: var(--text-ghost);">&#8594;</div>
            <p class="text-sm font-medium mb-1" style="color: var(--text-primary);">Standalone Node</p>
            <p class="text-xs" style="color: var(--text-ghost);">
              Connect this node to an upstream node to configure it. Drag an edge from another node's output to this node's input.
            </p>
          </div>

          <!-- Still show delete button -->
          <button
            onclick={() => { deleteNode(modalNodeId!); showNodeModal = false; }}
            class="w-full px-3 py-2 rounded text-sm transition-colors border"
            style="border-color: #b43232; color: #b43232;"
          >
            Delete Node
          </button>

        {:else}
          <!-- Description -->
          {#if modalNodeDef?.description}
            <p class="text-sm" style="color: var(--text-secondary);">{modalNodeDef.description}</p>
          {/if}

          <!-- Upstream variables panel -->
          {#if UpstreamSchemaPanelComponent}
            <svelte:component this={UpstreamSchemaPanelComponent} variables={modalUpstreamVariables} />
          {/if}

          <!-- Configuration -->
          <div>
            <h3 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Configuration</h3>

            {#if configMode === 'basic' && modalNodeDef?.basicConfig && BasicConfigRendererComponent}
              <svelte:component
                this={BasicConfigRendererComponent}
                fields={modalNodeDef.basicConfig}
                config={modalNode.data.config || {}}
                variables={modalUpstreamVariables}
                showAdvanced={false}
                onConfigChange={(newConfig) => {
                  editingConfig = {};
                  for (const [k, v] of Object.entries(newConfig)) {
                    editingConfig[k] = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
                  }
                  nodes = nodes.map(n =>
                    n.id === modalNodeId ? { ...n, data: { ...n.data, config: newConfig } } : n
                  );
                }}
              />
            {:else}
              <!-- Advanced: raw config editing -->
              <div class="space-y-2">
                {#each Object.entries(editingConfig) as [key, value]}
                  <div>
                    <label class="text-[11px] uppercase tracking-wider mb-1 block" style="color: var(--text-ghost); font-family: var(--font-mono);">{key}</label>
                    {#if value.length > 60 || value.includes('\n')}
                      <textarea
                        value={editingConfig[key]}
                        oninput={(e) => { editingConfig = { ...editingConfig, [key]: (e.target as HTMLTextAreaElement).value }; }}
                        class="w-full px-2 py-1.5 rounded text-xs border resize-vertical"
                        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono); min-height: 80px;"
                        rows="4"
                      ></textarea>
                    {:else}
                      <input
                        type="text"
                        value={editingConfig[key]}
                        oninput={(e) => { editingConfig = { ...editingConfig, [key]: (e.target as HTMLInputElement).value }; }}
                        class="w-full px-2 py-1.5 rounded text-xs border"
                        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
                      />
                    {/if}
                  </div>
                {/each}
                {#if Object.keys(editingConfig).length === 0}
                  <p class="text-xs" style="color: var(--text-ghost);">No configuration</p>
                {/if}
              </div>
            {/if}

            <button
              onclick={saveNodeConfig}
              class="mt-3 w-full px-3 py-2 rounded text-sm font-medium transition-colors"
              style="background: var(--accent); color: white;"
            >
              Save Configuration
            </button>
          </div>

          <!-- Schema section -->
          {#if modalNodeDef}
            <div>
              <h3 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Schema</h3>
              <div class="grid grid-cols-2 gap-3">
                <div class="p-2 rounded border" style="background: var(--card-bg); border-color: var(--card-border);">
                  <span class="text-[10px] uppercase tracking-wider" style="color: #569cd6; font-family: var(--font-mono);">Inputs</span>
                  {#each modalNodeDef.inputs || [] as port}
                    <div class="text-xs mt-1" style="color: var(--text-primary); font-family: var(--font-mono);">{port.name} <span style="color: var(--text-ghost);">({port.type})</span></div>
                  {:else}
                    <p class="text-xs mt-1" style="color: var(--text-ghost);">None (trigger)</p>
                  {/each}
                </div>
                <div class="p-2 rounded border" style="background: var(--card-bg); border-color: var(--card-border);">
                  <span class="text-[10px] uppercase tracking-wider" style="color: #2d7d46; font-family: var(--font-mono);">Outputs</span>
                  {#each modalNodeDef.outputs || [] as port}
                    <div class="text-xs mt-1" style="color: var(--text-primary); font-family: var(--font-mono);">{port.name} <span style="color: var(--text-ghost);">({port.type})</span></div>
                  {:else}
                    <p class="text-xs mt-1" style="color: var(--text-ghost);">None</p>
                  {/each}
                </div>
              </div>
            </div>
          {/if}

          <!-- Run data -->
          {#if modalNodeData}
            <div>
              <h3 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Run Data</h3>
              {#if modalNodeData.inputData}
                <div class="mb-3">
                  <span class="text-[10px] uppercase tracking-wider" style="color: #569cd6; font-family: var(--font-mono);">Input</span>
                  <pre class="mt-1 p-2 rounded border text-xs overflow-x-auto" style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);">{JSON.stringify(modalNodeData.inputData, null, 2)}</pre>
                </div>
              {/if}
              {#if modalNodeData.outputData}
                <div>
                  <span class="text-[10px] uppercase tracking-wider" style="color: #2d7d46; font-family: var(--font-mono);">Output</span>
                  <pre class="mt-1 p-2 rounded border text-xs overflow-x-auto" style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);">{JSON.stringify(modalNodeData.outputData, null, 2)}</pre>
                </div>
              {/if}
            </div>
          {:else if currentRunId}
            <p class="text-xs" style="color: var(--text-ghost);">No run data for this node yet.</p>
          {:else}
            <p class="text-xs" style="color: var(--text-ghost);">Run the workflow to see data flow.</p>
          {/if}

          <!-- Delete -->
          <button
            onclick={() => { deleteNode(modalNodeId!); showNodeModal = false; }}
            class="w-full px-3 py-2 rounded text-sm transition-colors border"
            style="border-color: #b43232; color: #b43232;"
          >
            Delete Node
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
```

- [ ] **Step 7.3: Add dynamic imports for new components**

In the `if (browser)` block, add:

```typescript
let BasicConfigRendererComponent: any = $state(null);
let UpstreamSchemaPanelComponent: any = $state(null);

if (browser) {
  // ... existing imports ...
  import('$lib/components/workflows/BasicConfigRenderer.svelte').then(m => BasicConfigRendererComponent = m.default);
  import('$lib/components/workflows/UpstreamSchemaPanel.svelte').then(m => UpstreamSchemaPanelComponent = m.default);
}
```

- [ ] **Step 7.4: Test in browser**

Run: `cd /home/john/strange_rambling_svelte && npm run dev`

Test:
1. Open a workflow at `http://homeserv:5173/workflows/<id>`
2. Drop a node onto canvas — double-click it while unconnected — should see "Standalone Node" message
3. Connect it to the trigger — double-click again — should see Basic config with variable chips
4. Toggle to Advanced — should see raw config text inputs
5. Verify template fields show `{{input.X}}` suggestions when typing `{{`

- [ ] **Step 7.5: Commit**

```bash
git add src/routes/workflows/[id]/+page.svelte
git commit -m "feat(workflows): context-aware config modal with Basic/Advanced views and connection gate"
```

---

## Track C: New Agentic Node Types

### Task 8: Validator Node

Schema or LLM-based validation. Outputs pass/fail + feedback. Essential for agentic loops.

**Files:**
- Create: `src/lib/workflows/nodes/validator.ts`
- Create: `tests/lib/workflows/nodes/validator.test.ts`
- Create: `src/lib/components/workflows/nodes/ValidatorNode.svelte`

- [ ] **Step 8.1: Write failing tests**

Create `tests/lib/workflows/nodes/validator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workflowId: 'test-workflow',
  workspaceDir: '/tmp/test',
  emit: vi.fn(),
  getNodeOutput: vi.fn(),
  checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
};

describe('validator executor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes when schema validation succeeds', async () => {
    const { validatorExecutor } = await import('$lib/workflows/nodes/validator');
    const result = await validatorExecutor.execute(
      { name: 'John', age: 30 },
      {
        mode: 'schema',
        schema: JSON.stringify({
          type: 'object',
          required: ['name', 'age'],
        }),
      },
      mockContext,
    );
    expect(result.output.valid).toBe(true);
    expect(result.metadata?._selectedHandle).toBe('pass');
  });

  it('fails when required field is missing', async () => {
    const { validatorExecutor } = await import('$lib/workflows/nodes/validator');
    const result = await validatorExecutor.execute(
      { name: 'John' },
      {
        mode: 'schema',
        schema: JSON.stringify({
          type: 'object',
          required: ['name', 'age'],
        }),
      },
      mockContext,
    );
    expect(result.output.valid).toBe(false);
    expect(result.metadata?._selectedHandle).toBe('fail');
    expect(result.output.errors).toBeDefined();
  });

  it('validates with JS expression', async () => {
    const { validatorExecutor } = await import('$lib/workflows/nodes/validator');
    const result = await validatorExecutor.execute(
      { score: 85 },
      { mode: 'expression', expression: 'input.score >= 80' },
      mockContext,
    );
    expect(result.output.valid).toBe(true);
    expect(result.metadata?._selectedHandle).toBe('pass');
  });
});
```

- [ ] **Step 8.2: Run tests to verify they fail**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/validator.test.ts`
Expected: FAIL

- [ ] **Step 8.3: Implement validator node**

Create `src/lib/workflows/nodes/validator.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext, JsonSchema } from '../types';

export const validatorExecutor: NodeExecutor = {
  type: 'validator',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const mode = (config.mode as string) || 'expression';

    if (mode === 'schema') {
      return validateSchema(input, config);
    }

    if (mode === 'expression') {
      return validateExpression(input, config);
    }

    return {
      output: { ...input, valid: false, errors: ['Unknown validation mode'] },
      metadata: { _selectedHandle: 'fail' },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Data to validate' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        valid: { type: 'boolean', description: 'Whether validation passed' },
        errors: { type: 'array', description: 'List of validation error messages' },
      },
    };
  },
};

function validateSchema(
  input: Record<string, unknown>,
  config: Record<string, unknown>,
): NodeResult {
  const schemaStr = config.schema as string;
  if (!schemaStr) {
    return {
      output: { ...input, valid: false, errors: ['No schema provided'] },
      metadata: { _selectedHandle: 'fail' },
    };
  }

  try {
    const schema = JSON.parse(schemaStr) as JsonSchema;
    const errors: string[] = [];

    // Basic JSON Schema validation (required fields, type checks)
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in input)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in input) {
          const prop = propSchema as JsonSchema;
          const value = input[key];
          if (prop.type && !checkType(value, prop.type)) {
            errors.push(`Field "${key}" expected type "${prop.type}", got "${typeof value}"`);
          }
        }
      }
    }

    const valid = errors.length === 0;
    return {
      output: { ...input, valid, errors: valid ? undefined : errors },
      metadata: { _selectedHandle: valid ? 'pass' : 'fail' },
    };
  } catch (err) {
    return {
      output: { ...input, valid: false, errors: [`Schema parse error: ${err}`] },
      metadata: { _selectedHandle: 'fail' },
    };
  }
}

function validateExpression(
  input: Record<string, unknown>,
  config: Record<string, unknown>,
): NodeResult {
  const expression = config.expression as string;
  if (!expression) {
    return {
      output: { ...input, valid: false, errors: ['No expression provided'] },
      metadata: { _selectedHandle: 'fail' },
    };
  }

  try {
    const fn = new Function('input', `return !!(${expression})`);
    const valid = fn(input);
    return {
      output: { ...input, valid, errors: valid ? undefined : ['Expression evaluated to false'] },
      metadata: { _selectedHandle: valid ? 'pass' : 'fail' },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: { ...input, valid: false, errors: [message] },
      metadata: { _selectedHandle: 'fail' },
    };
  }
}

function checkType(value: unknown, expectedType: string): boolean {
  if (expectedType === 'any') return true;
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  return typeof value === expectedType;
}

export const validatorDef: NodeDefinition = {
  type: 'validator',
  label: 'Validator',
  category: 'agentic',
  description: 'Validate data against a JSON Schema or JS expression. Routes to pass/fail outputs.',
  configSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', description: "'schema' or 'expression'" },
      schema: { type: 'string', description: 'JSON Schema string (for schema mode)' },
      expression: { type: 'string', description: 'JS boolean expression (for expression mode)' },
    },
    required: ['mode'],
  },
  defaultConfig: { mode: 'expression', expression: 'true', schema: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Data' }],
  outputs: [
    { name: 'pass', type: 'any', label: 'Pass' },
    { name: 'fail', type: 'any', label: 'Fail' },
  ],
  basicConfig: [
    {
      key: 'mode',
      label: 'Validation Mode',
      type: 'dropdown',
      options: [
        { value: 'expression', label: 'JS Expression' },
        { value: 'schema', label: 'JSON Schema' },
      ],
    },
    { key: 'expression', label: 'Expression', type: 'template-textarea', placeholder: 'input.score >= 80' },
    { key: 'schema', label: 'JSON Schema', type: 'textarea', advancedOnly: true },
  ],
  llmDescription: 'Use this node to validate data quality, check LLM output structure, or gate workflow progression. Place after LLM Call nodes to verify outputs meet requirements. Routes to "pass" or "fail" — connect fail back to a revision step for agentic retry loops.',
  llmExamples: [
    { mode: 'expression', expression: 'input.response && input.response.length > 100' },
    { mode: 'schema', schema: '{"type":"object","required":["title","body"]}' },
  ],
};
```

- [ ] **Step 8.4: Run validator tests**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/validator.test.ts`
Expected: PASS

- [ ] **Step 8.5: Create ValidatorNode.svelte**

Create `src/lib/components/workflows/nodes/ValidatorNode.svelte`:

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  let { data } = $props();
  const mode: string = data.config?.mode || 'expression';
  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)', running: '#569cd6', completed: '#2d7d46',
    failed: '#b43232', paused_breakpoint: '#b8860b', skipped: 'var(--text-ghost)',
  };
  let borderColor = $derived(data.status ? STATUS_COLORS[data.status] || 'var(--card-border)' : 'var(--card-border)');
  let isRunning = $derived(data.status === 'running');
</script>

<div class="rounded-lg border-2 min-w-[160px] transition-colors" style="background: var(--card-bg); border-color: {borderColor};" class:animate-pulse={isRunning}>
  <Handle type="target" position={Position.Left} id="input" style="top: 30px;" />
  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">&#10003;</span>
      <span class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">validator</span>
      {#if data.status}<span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>{/if}
    </div>
    <div class="text-sm font-medium mb-1" style="color: var(--text-primary);">{data.label}</div>
    <span class="text-[10px]" style="color: var(--text-ghost);">{mode} mode</span>
  </div>
  <Handle type="source" position={Position.Right} id="pass" style="top: 20px;" />
  <Handle type="source" position={Position.Right} id="fail" style="top: 40px;" />
</div>
```

- [ ] **Step 8.6: Commit**

```bash
git add src/lib/workflows/nodes/validator.ts tests/lib/workflows/nodes/validator.test.ts src/lib/components/workflows/nodes/ValidatorNode.svelte
git commit -m "feat(workflows): add Validator node — schema/expression validation with pass/fail routing"
```

---

### Task 9: Think / Scratchpad Node

Chain-of-thought reasoning node. Sends input to an LLM with instructions to reason step-by-step, outputs structured reasoning + conclusion.

**Files:**
- Create: `src/lib/workflows/nodes/think.ts`
- Create: `tests/lib/workflows/nodes/think.test.ts`
- Create: `src/lib/components/workflows/nodes/ThinkNode.svelte`

- [ ] **Step 9.1: Write failing tests**

Create `tests/lib/workflows/nodes/think.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '$lib/workflows/types';

vi.mock('$lib/deepdive/keys', () => ({
  getOpenRouterClient: () => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: '<thinking>\nStep 1: Analyze input.\nStep 2: The score is 85 which is above threshold.\n</thinking>\n\nThe input passes quality checks.' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
      },
    },
  }),
}));

const mockContext: ExecutionContext = {
  runId: 'test', workflowId: 'test', workspaceDir: '/tmp/test',
  emit: vi.fn(), getNodeOutput: vi.fn(), checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
};

describe('think executor', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns reasoning and conclusion', async () => {
    const { thinkExecutor } = await import('$lib/workflows/nodes/think');
    const result = await thinkExecutor.execute(
      { score: 85 },
      { prompt: 'Analyze the score and determine if it passes.', model: 'openai/gpt-4o-mini' },
      mockContext,
    );
    expect(result.output.reasoning).toBeDefined();
    expect(result.output.conclusion).toBeDefined();
    expect(typeof result.output.reasoning).toBe('string');
    expect(typeof result.output.conclusion).toBe('string');
  });
});
```

- [ ] **Step 9.2: Implement think node**

Create `src/lib/workflows/nodes/think.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getOpenRouterClient } from '$lib/deepdive/keys';

export const thinkExecutor: NodeExecutor = {
  type: 'think',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const model = (config.model as string) || 'openai/gpt-4o-mini';
    const prompt = interpolateTemplate((config.prompt as string) || '', input);
    const temperature = (config.temperature as number) ?? 0.3;

    const systemPrompt = `You are a careful reasoning engine. Think step-by-step about the task.

Structure your response as:
<thinking>
[Your detailed step-by-step reasoning here]
</thinking>

[Your final conclusion/answer here]

Be thorough in your reasoning. Consider edge cases.`;

    const client = getOpenRouterClient();
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Input data:\n${JSON.stringify(input, null, 2)}\n\nTask: ${prompt}` },
      ],
      temperature,
      max_tokens: (config.maxTokens as number) ?? 2048,
    });

    const content = response.choices[0]?.message?.content ?? '';
    const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/);
    const reasoning = thinkingMatch ? thinkingMatch[1].trim() : '';
    const conclusion = content.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();

    return {
      output: {
        ...input,
        reasoning,
        conclusion,
        fullResponse: content,
      },
      metadata: {
        model,
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Data for the LLM to reason about' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        reasoning: { type: 'string', description: 'Step-by-step reasoning' },
        conclusion: { type: 'string', description: 'Final conclusion' },
        fullResponse: { type: 'string', description: 'Raw LLM response' },
      },
    };
  },
};

export const thinkDef: NodeDefinition = {
  type: 'think',
  label: 'Think',
  category: 'agentic',
  description: 'Chain-of-thought reasoning. LLM reasons step-by-step about input data, outputs reasoning + conclusion.',
  configSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'What to reason about. Supports {{input.field}} templates.' },
      model: { type: 'string', description: 'OpenRouter model ID' },
      temperature: { type: 'number', description: 'Sampling temperature (default 0.3 — low for reasoning)' },
      maxTokens: { type: 'number', description: 'Max tokens (default 2048)' },
    },
    required: ['prompt'],
  },
  defaultConfig: { prompt: '', model: 'openai/gpt-4o-mini', temperature: 0.3, maxTokens: 2048 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Reasoning' }],
  basicConfig: [
    { key: 'prompt', label: 'Reasoning Task', type: 'template-textarea', placeholder: 'Analyze the data and determine the best course of action.' },
    {
      key: 'model', label: 'Model', type: 'dropdown',
      options: [
        { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
        { value: 'openai/gpt-4o', label: 'GPT-4o' },
        { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet' },
      ],
    },
    { key: 'temperature', label: 'Temperature', type: 'slider', min: 0, max: 1, step: 0.1 },
    { key: 'maxTokens', label: 'Max Tokens', type: 'number', advancedOnly: true },
  ],
  llmDescription: 'Use this node when the workflow needs careful deliberation before making a decision. Place before Conditional or Router nodes so the decision is informed by explicit reasoning. Lower temperature (0.1-0.3) recommended for analytical tasks.',
  llmExamples: [
    { prompt: 'Analyze the health data and determine if the user should be alerted.', model: 'openai/gpt-4o', temperature: 0.2 },
  ],
};
```

- [ ] **Step 9.3: Create ThinkNode.svelte**

Create `src/lib/components/workflows/nodes/ThinkNode.svelte`:

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  let { data } = $props();
  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)', running: '#569cd6', completed: '#2d7d46',
    failed: '#b43232', paused_breakpoint: '#b8860b', skipped: 'var(--text-ghost)',
  };
  let borderColor = $derived(data.status ? STATUS_COLORS[data.status] || 'var(--card-border)' : 'var(--card-border)');
  let isRunning = $derived(data.status === 'running');
  const prompt: string = data.config?.prompt || '';
  const truncated = $derived(prompt.length > 40 ? prompt.slice(0, 40) + '...' : prompt);
</script>

<div class="rounded-lg border-2 min-w-[160px] transition-colors" style="background: var(--card-bg); border-color: {borderColor};" class:animate-pulse={isRunning}>
  <Handle type="target" position={Position.Left} id="input" style="top: 30px;" />
  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">&#128161;</span>
      <span class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">think</span>
      {#if data.status}<span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>{/if}
    </div>
    <div class="text-sm font-medium mb-1" style="color: var(--text-primary);">{data.label}</div>
    {#if truncated}<span class="text-[10px] italic" style="color: var(--text-ghost);">{truncated}</span>{/if}
  </div>
  <Handle type="source" position={Position.Right} id="output" style="top: 30px;" />
</div>
```

- [ ] **Step 9.4: Run tests and commit**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/think.test.ts`
Expected: PASS

```bash
git add src/lib/workflows/nodes/think.ts tests/lib/workflows/nodes/think.test.ts src/lib/components/workflows/nodes/ThinkNode.svelte
git commit -m "feat(workflows): add Think node — chain-of-thought reasoning with structured output"
```

---

### Task 10: LLM Router Node

LLM-powered dynamic routing. Given N output paths with descriptions, the LLM picks which path to follow.

**Files:**
- Create: `src/lib/workflows/nodes/llm-router.ts`
- Create: `tests/lib/workflows/nodes/llm-router.test.ts`
- Create: `src/lib/components/workflows/nodes/LlmRouterNode.svelte`

- [ ] **Step 10.1: Write failing tests**

Create `tests/lib/workflows/nodes/llm-router.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '$lib/workflows/types';

vi.mock('$lib/deepdive/keys', () => ({
  getOpenRouterClient: () => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'route_b' } }],
          usage: { prompt_tokens: 50, completion_tokens: 5 },
        }),
      },
    },
  }),
}));

const mockContext: ExecutionContext = {
  runId: 'test', workflowId: 'test', workspaceDir: '/tmp/test',
  emit: vi.fn(), getNodeOutput: vi.fn(), checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
};

describe('llm-router executor', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('routes to the LLM-selected handle', async () => {
    const { llmRouterExecutor } = await import('$lib/workflows/nodes/llm-router');
    const result = await llmRouterExecutor.execute(
      { query: 'I want to cancel my subscription' },
      {
        routes: JSON.stringify([
          { handle: 'route_a', description: 'General inquiry' },
          { handle: 'route_b', description: 'Cancellation request' },
          { handle: 'route_c', description: 'Technical support' },
        ]),
        model: 'openai/gpt-4o-mini',
      },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('route_b');
    expect(result.output.selectedRoute).toBe('route_b');
  });
});
```

- [ ] **Step 10.2: Implement LLM Router node**

Create `src/lib/workflows/nodes/llm-router.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { getOpenRouterClient } from '$lib/deepdive/keys';

interface RouteOption {
  handle: string;
  description: string;
}

export const llmRouterExecutor: NodeExecutor = {
  type: 'llm-router',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const model = (config.model as string) || 'openai/gpt-4o-mini';
    const routesStr = (config.routes as string) || '[]';
    let routes: RouteOption[];

    try {
      routes = JSON.parse(routesStr);
    } catch {
      return { output: { ...input, error: 'Invalid routes JSON' } };
    }

    if (routes.length === 0) {
      return { output: { ...input, error: 'No routes defined' } };
    }

    const routeList = routes
      .map((r, i) => `${i + 1}. "${r.handle}" — ${r.description}`)
      .join('\n');

    const systemPrompt = `You are a routing engine. Given input data and a list of routes, respond with ONLY the handle name of the best matching route. Do not explain, do not add quotes — just the handle.

Available routes:
${routeList}`;

    const client = getOpenRouterClient();
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(input, null, 2) },
      ],
      temperature: 0.1,
      max_tokens: 50,
    });

    const selected = (response.choices[0]?.message?.content ?? '').trim();
    const matchedRoute = routes.find((r) => r.handle === selected);
    const handle = matchedRoute ? matchedRoute.handle : routes[0].handle;

    return {
      output: { ...input, selectedRoute: handle },
      metadata: {
        _selectedHandle: handle,
        model,
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Data the LLM uses to decide routing' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        selectedRoute: { type: 'string', description: 'The handle of the chosen route' },
      },
    };
  },
};

export const llmRouterDef: NodeDefinition = {
  type: 'llm-router',
  label: 'LLM Router',
  category: 'agentic',
  description: 'LLM-powered semantic routing. Defines named output paths with descriptions; the LLM picks which path to follow.',
  configSchema: {
    type: 'object',
    properties: {
      routes: { type: 'string', description: 'JSON array of { handle, description } route options' },
      model: { type: 'string', description: 'OpenRouter model ID' },
    },
    required: ['routes'],
  },
  defaultConfig: {
    routes: JSON.stringify([
      { handle: 'route_a', description: 'First option' },
      { handle: 'route_b', description: 'Second option' },
    ], null, 2),
    model: 'openai/gpt-4o-mini',
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [
    { name: 'route_a', type: 'any', label: 'Route A' },
    { name: 'route_b', type: 'any', label: 'Route B' },
  ],
  basicConfig: [
    { key: 'routes', label: 'Routes (JSON)', type: 'textarea', description: 'Array of { "handle": "route_name", "description": "when to use" }' },
    {
      key: 'model', label: 'Model', type: 'dropdown',
      options: [
        { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (fast)' },
        { value: 'openai/gpt-4o', label: 'GPT-4o' },
        { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku (fast)' },
      ],
    },
  ],
  llmDescription: 'Use this node when the workflow needs to make a semantic decision — choosing between paths based on meaning rather than a simple boolean. More flexible than Conditional for nuanced routing. Use fast/cheap models (GPT-4o Mini, Haiku) since the task is simple classification.',
  llmExamples: [
    {
      routes: JSON.stringify([
        { handle: 'positive', description: 'Positive sentiment or feedback' },
        { handle: 'negative', description: 'Negative sentiment or complaint' },
        { handle: 'neutral', description: 'Neutral or informational' },
      ]),
      model: 'openai/gpt-4o-mini',
    },
  ],
};
```

- [ ] **Step 10.3: Create LlmRouterNode.svelte**

Create `src/lib/components/workflows/nodes/LlmRouterNode.svelte`:

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  let { data } = $props();
  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)', running: '#569cd6', completed: '#2d7d46',
    failed: '#b43232', paused_breakpoint: '#b8860b', skipped: 'var(--text-ghost)',
  };
  let borderColor = $derived(data.status ? STATUS_COLORS[data.status] || 'var(--card-border)' : 'var(--card-border)');
  let isRunning = $derived(data.status === 'running');

  let routes = $derived.by(() => {
    try { return JSON.parse(data.config?.routes || '[]'); } catch { return []; }
  });
</script>

<div class="rounded-lg border-2 min-w-[160px] transition-colors" style="background: var(--card-bg); border-color: {borderColor};" class:animate-pulse={isRunning}>
  <Handle type="target" position={Position.Left} id="input" style="top: 30px;" />
  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">&#9878;</span>
      <span class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">llm-router</span>
      {#if data.status}<span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>{/if}
    </div>
    <div class="text-sm font-medium mb-1" style="color: var(--text-primary);">{data.label}</div>
    <div class="text-[10px] space-y-0.5" style="color: var(--text-ghost);">
      {#each routes.slice(0, 3) as route}
        <div>{route.handle}: {route.description?.slice(0, 25)}</div>
      {/each}
    </div>
  </div>
  {#each routes as route, i}
    <Handle type="source" position={Position.Right} id={route.handle} style="top: {20 + i * 18}px;" />
  {/each}
</div>
```

- [ ] **Step 10.4: Run tests and commit**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/llm-router.test.ts`
Expected: PASS

```bash
git add src/lib/workflows/nodes/llm-router.ts tests/lib/workflows/nodes/llm-router.test.ts src/lib/components/workflows/nodes/LlmRouterNode.svelte
git commit -m "feat(workflows): add LLM Router node — semantic routing via LLM classification"
```

---

### Task 11: Merge Node

Explicit merge of multiple upstream inputs with configurable strategy.

**Files:**
- Create: `src/lib/workflows/nodes/merge.ts`
- Create: `tests/lib/workflows/nodes/merge.test.ts`
- Create: `src/lib/components/workflows/nodes/MergeNode.svelte`

- [ ] **Step 11.1: Write failing tests**

Create `tests/lib/workflows/nodes/merge.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test', workflowId: 'test', workspaceDir: '/tmp/test',
  emit: vi.fn(), getNodeOutput: vi.fn(), checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
};

describe('merge executor', () => {
  it('deep merges objects by default', async () => {
    const { mergeExecutor } = await import('$lib/workflows/nodes/merge');
    const result = await mergeExecutor.execute(
      { a: 1, nested: { x: 10 }, b: 2, nested2: { y: 20 } },
      { strategy: 'deep-merge' },
      mockContext,
    );
    expect(result.output.a).toBe(1);
    expect(result.output.b).toBe(2);
  });

  it('collects specified fields into an object', async () => {
    const { mergeExecutor } = await import('$lib/workflows/nodes/merge');
    const result = await mergeExecutor.execute(
      { response: 'hello', status: 200, body: { data: true } },
      { strategy: 'pick', fields: 'response,status' },
      mockContext,
    );
    expect(result.output).toEqual({ response: 'hello', status: 200 });
  });
});
```

- [ ] **Step 11.2: Implement merge node**

Create `src/lib/workflows/nodes/merge.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const mergeExecutor: NodeExecutor = {
  type: 'merge',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const strategy = (config.strategy as string) || 'deep-merge';

    if (strategy === 'pick') {
      const fields = ((config.fields as string) || '').split(',').map((f) => f.trim()).filter(Boolean);
      const output: Record<string, unknown> = {};
      for (const field of fields) {
        if (field in input) output[field] = input[field];
      }
      return { output };
    }

    // deep-merge is the default — input is already the shallow merge from the engine.
    // We just pass it through (the engine already merges upstream outputs).
    return { output: { ...input } };
  },

  getInputSchema() {
    return { type: 'object', description: 'Merged data from all upstream nodes' };
  },

  getOutputSchema() {
    return { type: 'object', description: 'Merged output according to strategy' };
  },
};

export const mergeDef: NodeDefinition = {
  type: 'merge',
  label: 'Merge',
  category: 'control',
  description: 'Explicitly merge data from multiple upstream nodes. Strategies: deep-merge (default), pick specific fields.',
  configSchema: {
    type: 'object',
    properties: {
      strategy: { type: 'string', description: "'deep-merge' or 'pick'" },
      fields: { type: 'string', description: 'Comma-separated field names to pick (for pick strategy)' },
    },
  },
  defaultConfig: { strategy: 'deep-merge', fields: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Merged' }],
  basicConfig: [
    {
      key: 'strategy',
      label: 'Merge Strategy',
      type: 'dropdown',
      options: [
        { value: 'deep-merge', label: 'Deep Merge (combine all)' },
        { value: 'pick', label: 'Pick Fields' },
      ],
    },
    { key: 'fields', label: 'Fields to Pick', type: 'template-textarea', placeholder: 'response, status, body.data', description: 'Comma-separated field names (for pick strategy)' },
  ],
  llmDescription: 'Use this node after fan-out/parallel branches converge to explicitly control how upstream data is combined. Place it wherever multiple edges feed into a single node to make the merge behavior explicit rather than relying on implicit shallow merging.',
};
```

- [ ] **Step 11.3: Create MergeNode.svelte**

Create `src/lib/components/workflows/nodes/MergeNode.svelte`:

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  let { data } = $props();
  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)', running: '#569cd6', completed: '#2d7d46',
    failed: '#b43232', paused_breakpoint: '#b8860b', skipped: 'var(--text-ghost)',
  };
  let borderColor = $derived(data.status ? STATUS_COLORS[data.status] || 'var(--card-border)' : 'var(--card-border)');
  let isRunning = $derived(data.status === 'running');
</script>

<div class="rounded-lg border-2 min-w-[140px] transition-colors" style="background: var(--card-bg); border-color: {borderColor};" class:animate-pulse={isRunning}>
  <Handle type="target" position={Position.Left} id="input" style="top: 30px;" />
  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">&#8614;</span>
      <span class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">merge</span>
      {#if data.status}<span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>{/if}
    </div>
    <div class="text-sm font-medium" style="color: var(--text-primary);">{data.label}</div>
    <span class="text-[10px]" style="color: var(--text-ghost);">{data.config?.strategy || 'deep-merge'}</span>
  </div>
  <Handle type="source" position={Position.Right} id="output" style="top: 30px;" />
</div>
```

- [ ] **Step 11.4: Run tests and commit**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/merge.test.ts`
Expected: PASS

```bash
git add src/lib/workflows/nodes/merge.ts tests/lib/workflows/nodes/merge.test.ts src/lib/components/workflows/nodes/MergeNode.svelte
git commit -m "feat(workflows): add Merge node — explicit multi-input merge with configurable strategy"
```

---

### Task 12: Text Parser Node

Regex extraction, JSON parsing, and structured output extraction from LLM responses.

**Files:**
- Create: `src/lib/workflows/nodes/text-parser.ts`
- Create: `tests/lib/workflows/nodes/text-parser.test.ts`
- Create: `src/lib/components/workflows/nodes/TextParserNode.svelte`

- [ ] **Step 12.1: Write failing tests**

Create `tests/lib/workflows/nodes/text-parser.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test', workflowId: 'test', workspaceDir: '/tmp/test',
  emit: vi.fn(), getNodeOutput: vi.fn(), checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
};

describe('text-parser executor', () => {
  it('extracts JSON from LLM response', async () => {
    const { textParserExecutor } = await import('$lib/workflows/nodes/text-parser');
    const result = await textParserExecutor.execute(
      { response: 'Here is the result:\n```json\n{"name": "John", "score": 95}\n```\nDone.' },
      { mode: 'json', inputField: 'response' },
      mockContext,
    );
    expect(result.output.parsed).toEqual({ name: 'John', score: 95 });
  });

  it('extracts regex matches', async () => {
    const { textParserExecutor } = await import('$lib/workflows/nodes/text-parser');
    const result = await textParserExecutor.execute(
      { text: 'Order #12345 shipped on 2025-01-15' },
      { mode: 'regex', inputField: 'text', pattern: '#(\\d+)' },
      mockContext,
    );
    expect(result.output.match).toBe('#12345');
    expect(result.output.groups).toEqual(['12345']);
  });

  it('splits text into lines', async () => {
    const { textParserExecutor } = await import('$lib/workflows/nodes/text-parser');
    const result = await textParserExecutor.execute(
      { text: 'line1\nline2\nline3' },
      { mode: 'split', inputField: 'text', delimiter: '\n' },
      mockContext,
    );
    expect(result.output.items).toEqual(['line1', 'line2', 'line3']);
    expect(result.output.count).toBe(3);
  });
});
```

- [ ] **Step 12.2: Implement text-parser node**

Create `src/lib/workflows/nodes/text-parser.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const textParserExecutor: NodeExecutor = {
  type: 'text-parser',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const mode = (config.mode as string) || 'json';
    const inputField = (config.inputField as string) || 'response';
    const text = String(input[inputField] ?? '');

    if (mode === 'json') {
      return parseJson(input, text);
    }

    if (mode === 'regex') {
      return parseRegex(input, text, config);
    }

    if (mode === 'split') {
      const delimiter = (config.delimiter as string) || '\n';
      const items = text.split(delimiter).filter(Boolean);
      return { output: { ...input, items, count: items.length } };
    }

    return { output: { ...input, error: `Unknown parse mode: ${mode}` } };
  },

  getInputSchema() {
    return { type: 'object', description: 'Must contain the text field to parse' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    const mode = config.mode as string;
    if (mode === 'json') {
      return { type: 'object', properties: { parsed: { type: 'object', description: 'Extracted JSON' } } };
    }
    if (mode === 'regex') {
      return {
        type: 'object',
        properties: {
          match: { type: 'string', description: 'Full regex match' },
          groups: { type: 'array', description: 'Capture groups' },
        },
      };
    }
    if (mode === 'split') {
      return {
        type: 'object',
        properties: {
          items: { type: 'array', description: 'Split items' },
          count: { type: 'number', description: 'Number of items' },
        },
      };
    }
    return { type: 'object' };
  },
};

function parseJson(input: Record<string, unknown>, text: string): NodeResult {
  // Try direct parse
  try {
    return { output: { ...input, parsed: JSON.parse(text) } };
  } catch {
    // Try extracting JSON from markdown code blocks
    const jsonBlock = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlock) {
      try {
        return { output: { ...input, parsed: JSON.parse(jsonBlock[1].trim()) } };
      } catch { /* fall through */ }
    }

    // Try finding first { ... } or [ ... ]
    const braceMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (braceMatch) {
      try {
        return { output: { ...input, parsed: JSON.parse(braceMatch[1]) } };
      } catch { /* fall through */ }
    }

    return { output: { ...input, parsed: null, error: 'No valid JSON found' } };
  }
}

function parseRegex(input: Record<string, unknown>, text: string, config: Record<string, unknown>): NodeResult {
  const pattern = (config.pattern as string) || '';
  const flags = (config.flags as string) || '';

  try {
    const regex = new RegExp(pattern, flags);
    const match = text.match(regex);

    if (!match) {
      return { output: { ...input, match: null, groups: [] } };
    }

    return {
      output: {
        ...input,
        match: match[0],
        groups: match.slice(1),
        allMatches: flags.includes('g') ? [...text.matchAll(new RegExp(pattern, flags))].map((m) => m[0]) : undefined,
      },
    };
  } catch (err) {
    return { output: { ...input, error: `Regex error: ${err}` } };
  }
}

export const textParserDef: NodeDefinition = {
  type: 'text-parser',
  label: 'Text Parser',
  category: 'core',
  description: 'Extract structured data from text: JSON extraction, regex matching, or text splitting.',
  configSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', description: "'json', 'regex', or 'split'" },
      inputField: { type: 'string', description: 'Field name in input to parse (default: response)' },
      pattern: { type: 'string', description: 'Regex pattern (for regex mode)' },
      flags: { type: 'string', description: 'Regex flags (for regex mode)' },
      delimiter: { type: 'string', description: 'Split delimiter (for split mode, default: newline)' },
    },
    required: ['mode'],
  },
  defaultConfig: { mode: 'json', inputField: 'response', pattern: '', flags: '', delimiter: '\n' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Parsed' }],
  basicConfig: [
    {
      key: 'mode',
      label: 'Parse Mode',
      type: 'dropdown',
      options: [
        { value: 'json', label: 'Extract JSON' },
        { value: 'regex', label: 'Regex Match' },
        { value: 'split', label: 'Split Text' },
      ],
    },
    { key: 'inputField', label: 'Input Field', type: 'template-textarea', placeholder: 'response' },
    { key: 'pattern', label: 'Regex Pattern', type: 'text', advancedOnly: false },
    { key: 'flags', label: 'Regex Flags', type: 'text', advancedOnly: true, placeholder: 'gi' },
    { key: 'delimiter', label: 'Split Delimiter', type: 'text', advancedOnly: false, placeholder: '\\n' },
  ],
  llmDescription: 'Use after LLM Call nodes to extract structured data from free-text responses. JSON mode is the most common — it finds JSON in markdown code blocks, raw JSON, or embedded JSON objects. Essential for converting LLM text output into structured data for downstream nodes.',
  llmExamples: [
    { mode: 'json', inputField: 'response' },
    { mode: 'regex', inputField: 'response', pattern: 'score:\\s*(\\d+)' },
  ],
};
```

- [ ] **Step 12.3: Create TextParserNode.svelte**

Create `src/lib/components/workflows/nodes/TextParserNode.svelte`:

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  let { data } = $props();
  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)', running: '#569cd6', completed: '#2d7d46',
    failed: '#b43232', paused_breakpoint: '#b8860b', skipped: 'var(--text-ghost)',
  };
  let borderColor = $derived(data.status ? STATUS_COLORS[data.status] || 'var(--card-border)' : 'var(--card-border)');
  let isRunning = $derived(data.status === 'running');
  const mode: string = data.config?.mode || 'json';
</script>

<div class="rounded-lg border-2 min-w-[140px] transition-colors" style="background: var(--card-bg); border-color: {borderColor};" class:animate-pulse={isRunning}>
  <Handle type="target" position={Position.Left} id="input" style="top: 30px;" />
  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">&#9998;</span>
      <span class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">text-parser</span>
      {#if data.status}<span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>{/if}
    </div>
    <div class="text-sm font-medium mb-1" style="color: var(--text-primary);">{data.label}</div>
    <span class="text-[10px]" style="color: var(--text-ghost);">{mode} mode</span>
  </div>
  <Handle type="source" position={Position.Right} id="output" style="top: 30px;" />
</div>
```

- [ ] **Step 12.4: Run tests and commit**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/text-parser.test.ts`
Expected: PASS

```bash
git add src/lib/workflows/nodes/text-parser.ts tests/lib/workflows/nodes/text-parser.test.ts src/lib/components/workflows/nodes/TextParserNode.svelte
git commit -m "feat(workflows): add Text Parser node — JSON extraction, regex, and text splitting"
```

---

### Task 13: Accumulator Node

Collects results across multiple inputs or iterations into a single array output.

**Files:**
- Create: `src/lib/workflows/nodes/accumulator.ts`
- Create: `tests/lib/workflows/nodes/accumulator.test.ts`
- Create: `src/lib/components/workflows/nodes/AccumulatorNode.svelte`

- [ ] **Step 13.1: Implement and test accumulator**

Create `tests/lib/workflows/nodes/accumulator.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test', workflowId: 'test', workspaceDir: '/tmp/test',
  emit: vi.fn(), getNodeOutput: vi.fn(), checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
};

describe('accumulator executor', () => {
  it('collects a field from input into items array', async () => {
    const { accumulatorExecutor } = await import('$lib/workflows/nodes/accumulator');
    const result = await accumulatorExecutor.execute(
      { results: ['a', 'b', 'c'], summary: 'done' },
      { collectField: 'results', mode: 'collect' },
      mockContext,
    );
    expect(result.output.items).toEqual(['a', 'b', 'c']);
    expect(result.output.count).toBe(3);
  });

  it('passes through whole input when no collectField specified', async () => {
    const { accumulatorExecutor } = await import('$lib/workflows/nodes/accumulator');
    const result = await accumulatorExecutor.execute(
      { a: 1, b: 2 },
      { mode: 'collect' },
      mockContext,
    );
    expect(result.output.items).toEqual([{ a: 1, b: 2 }]);
  });
});
```

Create `src/lib/workflows/nodes/accumulator.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const accumulatorExecutor: NodeExecutor = {
  type: 'accumulator',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const collectField = config.collectField as string | undefined;

    let items: unknown[];
    if (collectField && collectField in input) {
      const value = input[collectField];
      items = Array.isArray(value) ? value : [value];
    } else {
      items = [{ ...input }];
    }

    return {
      output: { items, count: items.length },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Data to accumulate' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        items: { type: 'array', description: 'Accumulated items' },
        count: { type: 'number', description: 'Number of items' },
      },
    };
  },
};

export const accumulatorDef: NodeDefinition = {
  type: 'accumulator',
  label: 'Accumulator',
  category: 'control',
  description: 'Collect results from upstream into an array. Use after parallel branches or loops to gather results.',
  configSchema: {
    type: 'object',
    properties: {
      collectField: { type: 'string', description: 'Field name to collect (if omitted, collects entire input)' },
      mode: { type: 'string', description: "'collect' (default)" },
    },
  },
  defaultConfig: { collectField: '', mode: 'collect' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Accumulated' }],
  basicConfig: [
    { key: 'collectField', label: 'Field to Collect', type: 'template-textarea', placeholder: 'results', description: 'Leave empty to collect entire input as one item' },
  ],
  llmDescription: 'Use after fan-out/parallel branches or loops to gather all results into a single array. Place before a final LLM Call to summarize or process all collected results together.',
};
```

- [ ] **Step 13.2: Create AccumulatorNode.svelte (follow same pattern as MergeNode)**

Create `src/lib/components/workflows/nodes/AccumulatorNode.svelte`:

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  let { data } = $props();
  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)', running: '#569cd6', completed: '#2d7d46',
    failed: '#b43232', paused_breakpoint: '#b8860b', skipped: 'var(--text-ghost)',
  };
  let borderColor = $derived(data.status ? STATUS_COLORS[data.status] || 'var(--card-border)' : 'var(--card-border)');
  let isRunning = $derived(data.status === 'running');
</script>

<div class="rounded-lg border-2 min-w-[140px] transition-colors" style="background: var(--card-bg); border-color: {borderColor};" class:animate-pulse={isRunning}>
  <Handle type="target" position={Position.Left} id="input" style="top: 30px;" />
  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">&#9776;</span>
      <span class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">accumulator</span>
      {#if data.status}<span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>{/if}
    </div>
    <div class="text-sm font-medium" style="color: var(--text-primary);">{data.label}</div>
  </div>
  <Handle type="source" position={Position.Right} id="output" style="top: 30px;" />
</div>
```

- [ ] **Step 13.3: Run tests and commit**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/accumulator.test.ts`

```bash
git add src/lib/workflows/nodes/accumulator.ts tests/lib/workflows/nodes/accumulator.test.ts src/lib/components/workflows/nodes/AccumulatorNode.svelte
git commit -m "feat(workflows): add Accumulator node — collect results from branches/loops"
```

---

### Task 14: Sub-Workflow Node

Call another saved workflow as a step in the current workflow.

**Files:**
- Create: `src/lib/workflows/nodes/sub-workflow.ts`
- Create: `tests/lib/workflows/nodes/sub-workflow.test.ts`
- Create: `src/lib/components/workflows/nodes/SubWorkflowNode.svelte`

- [ ] **Step 14.1: Write test**

Create `tests/lib/workflows/nodes/sub-workflow.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '$lib/workflows/types';

// Mock the fetch to /api/workflows/:id/run
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({
    runId: 'sub-run-1',
    status: 'completed',
    output: { result: 'sub-workflow output' },
  }),
}));

const mockContext: ExecutionContext = {
  runId: 'test', workflowId: 'parent-wf', workspaceDir: '/tmp/test',
  emit: vi.fn(), getNodeOutput: vi.fn(), checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
};

describe('sub-workflow executor', () => {
  it('calls another workflow and returns its output', async () => {
    const { subWorkflowExecutor } = await import('$lib/workflows/nodes/sub-workflow');
    const result = await subWorkflowExecutor.execute(
      { data: 'pass to child' },
      { workflowId: 'child-wf-123' },
      mockContext,
    );
    expect(result.output.result).toBe('sub-workflow output');
  });
});
```

- [ ] **Step 14.2: Implement sub-workflow node**

Create `src/lib/workflows/nodes/sub-workflow.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const subWorkflowExecutor: NodeExecutor = {
  type: 'sub-workflow',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const workflowId = config.workflowId as string;
    if (!workflowId) {
      return { output: { error: 'No workflowId configured' } };
    }

    // Call the workflow run API internally
    const response = await fetch(`http://localhost:5173/api/workflows/${workflowId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, waitForCompletion: true }),
      signal: context.abortSignal,
    });

    if (!response.ok) {
      const text = await response.text();
      return { output: { error: `Sub-workflow failed: ${text}` } };
    }

    const result = await response.json();
    return {
      output: result.output || result,
      metadata: { subRunId: result.runId, subWorkflowId: workflowId },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Passed as initial input to the sub-workflow' };
  },

  getOutputSchema() {
    return { type: 'object', description: 'Output from the sub-workflow\'s final node' };
  },
};

export const subWorkflowDef: NodeDefinition = {
  type: 'sub-workflow',
  label: 'Sub-Workflow',
  category: 'control',
  description: 'Execute another saved workflow as a step. Passes input to the sub-workflow and returns its output.',
  configSchema: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'ID of the workflow to execute' },
    },
    required: ['workflowId'],
  },
  defaultConfig: { workflowId: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [
    { key: 'workflowId', label: 'Workflow ID', type: 'text', placeholder: 'Paste workflow ID here' },
  ],
  llmDescription: 'Use this node to compose workflows — call a pre-built workflow as a reusable step. The sub-workflow receives the current input and its output flows downstream. Essential for building complex agentic systems from smaller, tested building blocks.',
};
```

- [ ] **Step 14.3: Create SubWorkflowNode.svelte**

Create `src/lib/components/workflows/nodes/SubWorkflowNode.svelte`:

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  let { data } = $props();
  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)', running: '#569cd6', completed: '#2d7d46',
    failed: '#b43232', paused_breakpoint: '#b8860b', skipped: 'var(--text-ghost)',
  };
  let borderColor = $derived(data.status ? STATUS_COLORS[data.status] || 'var(--card-border)' : 'var(--card-border)');
  let isRunning = $derived(data.status === 'running');
  const wfId: string = data.config?.workflowId || '';
  const truncId = $derived(wfId ? wfId.slice(0, 8) + '...' : 'not set');
</script>

<div class="rounded-lg border-2 min-w-[160px] transition-colors" style="background: var(--card-bg); border-color: {borderColor};" class:animate-pulse={isRunning}>
  <Handle type="target" position={Position.Left} id="input" style="top: 30px;" />
  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">&#9881;</span>
      <span class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">sub-workflow</span>
      {#if data.status}<span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>{/if}
    </div>
    <div class="text-sm font-medium mb-1" style="color: var(--text-primary);">{data.label}</div>
    <span class="text-[10px] px-1.5 py-0.5 rounded" style="background: var(--card-border); color: var(--text-ghost); font-family: var(--font-mono);">{truncId}</span>
  </div>
  <Handle type="source" position={Position.Right} id="output" style="top: 30px;" />
</div>
```

- [ ] **Step 14.4: Run tests and commit**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/sub-workflow.test.ts`

```bash
git add src/lib/workflows/nodes/sub-workflow.ts tests/lib/workflows/nodes/sub-workflow.test.ts src/lib/components/workflows/nodes/SubWorkflowNode.svelte
git commit -m "feat(workflows): add Sub-Workflow node — compose workflows as reusable steps"
```

---

### Task 15: Register All New Nodes

Wire up all new nodes in the registry, client registry, and canvas.

**Files:**
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`
- Modify: `src/routes/workflows/[id]/+page.svelte`
- Modify: `src/lib/components/workflows/NodePalette.svelte`

- [ ] **Step 15.1: Add executors to server registry (index.ts)**

In `src/lib/workflows/index.ts`, add imports and registrations for all new nodes:

```typescript
import { validatorDef, validatorExecutor } from './nodes/validator';
import { thinkDef, thinkExecutor } from './nodes/think';
import { llmRouterDef, llmRouterExecutor } from './nodes/llm-router';
import { mergeDef, mergeExecutor } from './nodes/merge';
import { textParserDef, textParserExecutor } from './nodes/text-parser';
import { accumulatorDef, accumulatorExecutor } from './nodes/accumulator';
import { subWorkflowDef, subWorkflowExecutor } from './nodes/sub-workflow';

// ... after existing registrations:
registry.register(validatorDef, validatorExecutor);
registry.register(thinkDef, thinkExecutor);
registry.register(llmRouterDef, llmRouterExecutor);
registry.register(mergeDef, mergeExecutor);
registry.register(textParserDef, textParserExecutor);
registry.register(accumulatorDef, accumulatorExecutor);
registry.register(subWorkflowDef, subWorkflowExecutor);
```

- [ ] **Step 15.2: Add client-safe definitions to registry-client.ts**

Add the definition objects (without executors) to `registry-client.ts` and include them in the `nodeDefinitions` array. Copy each `*Def` export from the node files — or import the definitions directly since they don't pull in server-only deps (verify each one doesn't import from `$lib/deepdive/keys` or `$lib/db` at definition level).

For the nodes that DO import server-only modules in their executor (think, llm-router), create inline definition copies just like the existing pattern for llmCallDef. For nodes that don't (validator, merge, text-parser, accumulator, sub-workflow), you can import the definition directly.

Add all to the `nodeDefinitions` array:

```typescript
export const nodeDefinitions: NodeDefinition[] = [
  // ... existing 14 ...
  validatorDef,
  thinkDef,
  llmRouterDef,
  mergeDef,
  textParserDef,
  accumulatorDef,
  subWorkflowDef,
];
```

- [ ] **Step 15.3: Add 'agentic' to NodePalette categories**

In `src/lib/components/workflows/NodePalette.svelte`, update the categories array:

```typescript
const categories = ['trigger', 'core', 'agentic', 'control', 'integration', 'custom'] as const;
```

- [ ] **Step 15.4: Register node components in the editor page**

In `src/routes/workflows/[id]/+page.svelte`, add dynamic imports for all new node Svelte components in the `Promise.all([...])` block and add them to `nodeTypeComponents`:

```typescript
// Add to the existing Promise.all:
import('$lib/components/workflows/nodes/ValidatorNode.svelte'),
import('$lib/components/workflows/nodes/ThinkNode.svelte'),
import('$lib/components/workflows/nodes/LlmRouterNode.svelte'),
import('$lib/components/workflows/nodes/MergeNode.svelte'),
import('$lib/components/workflows/nodes/TextParserNode.svelte'),
import('$lib/components/workflows/nodes/AccumulatorNode.svelte'),
import('$lib/components/workflows/nodes/SubWorkflowNode.svelte'),
```

And in the `.then()` destructuring, add them to `nodeTypeComponents`:

```typescript
'validator': va.default,
'think': th.default,
'llm-router': lr.default,
'merge': me.default,
'text-parser': tp.default,
'accumulator': ac.default,
'sub-workflow': sw.default,
```

- [ ] **Step 15.5: Run full test suite**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/`
Expected: All tests PASS

- [ ] **Step 15.6: Commit**

```bash
git add src/lib/workflows/index.ts src/lib/workflows/registry-client.ts src/routes/workflows/[id]/+page.svelte src/lib/components/workflows/NodePalette.svelte
git commit -m "feat(workflows): register all new nodes in registry, client, and canvas"
```

---

## Track D: Orchestrator Enrichment for LLM-Constructable Workflows

### Task 16: Workflow Patterns Library

Pre-defined composable patterns the orchestrator can reference.

**Files:**
- Create: `src/lib/workflows/orchestrator/patterns.ts`

- [ ] **Step 16.1: Create patterns library**

Create `src/lib/workflows/orchestrator/patterns.ts`:

```typescript
export interface WorkflowPattern {
  name: string;
  description: string;
  /** When the orchestrator should use this pattern */
  trigger: string;
  /** Node types involved, in order */
  nodeSequence: string[];
  /** How to connect them */
  edgePattern: string;
  /** Example use cases */
  examples: string[];
}

export const workflowPatterns: WorkflowPattern[] = [
  {
    name: 'Iterative Refinement',
    description: 'Generate output, validate it, revise if validation fails. Loop until quality threshold met.',
    trigger: 'When the user wants high-quality LLM output that may need multiple attempts.',
    nodeSequence: ['llm-call', 'text-parser', 'validator', 'conditional', 'llm-call (revision)'],
    edgePattern: 'llm-call → text-parser → validator → conditional. True → output. False → second llm-call (with feedback) → back to validator.',
    examples: [
      'Generate a blog post that must include specific sections',
      'Create structured data that must match a schema',
      'Write code that must pass validation',
    ],
  },
  {
    name: 'Map-Reduce',
    description: 'Process each item in a collection independently, then aggregate results.',
    trigger: 'When the user needs to process a list of items and combine the results.',
    nodeSequence: ['loop', 'llm-call (per item)', 'accumulator', 'llm-call (summarize)'],
    edgePattern: 'loop → llm-call → accumulator → llm-call. Loop processes items, accumulator collects, final LLM summarizes.',
    examples: [
      'Summarize each chapter of a document then create an overall summary',
      'Analyze each email in a thread then write a digest',
      'Score each candidate resume then rank them',
    ],
  },
  {
    name: 'Semantic Router',
    description: 'Classify input and route to specialized processing pipelines.',
    trigger: 'When different inputs need different processing paths based on meaning.',
    nodeSequence: ['llm-router', 'branch-specific-nodes'],
    edgePattern: 'llm-router → multiple branches, each with domain-specific processing.',
    examples: [
      'Route customer messages to appropriate teams',
      'Process different content types differently',
      'Handle different user intents',
    ],
  },
  {
    name: 'Think-Then-Act',
    description: 'Reason about the situation before taking action. Uses chain-of-thought for better decisions.',
    trigger: 'When the workflow needs to make a complex decision before acting.',
    nodeSequence: ['think', 'conditional or llm-router', 'action-nodes'],
    edgePattern: 'think → router/conditional → action branches. Think node reasons about what to do, router picks the action.',
    examples: [
      'Analyze health data then decide whether to alert',
      'Review a pull request then decide the feedback type',
      'Assess risk then choose response strategy',
    ],
  },
  {
    name: 'Critique-Revise',
    description: 'Generate output, have a separate LLM critique it, then revise based on feedback.',
    trigger: 'When output quality is critical and benefits from a separate review step.',
    nodeSequence: ['llm-call (draft)', 'llm-call (critic)', 'validator', 'conditional', 'llm-call (revise)'],
    edgePattern: 'draft → critic → validator → conditional. Pass → output. Fail → revise (with critic feedback) → back to critic.',
    examples: [
      'Write then review an important email',
      'Generate then fact-check a report',
      'Draft then QA marketing copy',
    ],
  },
  {
    name: 'Data Pipeline',
    description: 'Fetch data, transform it, validate, and output or store.',
    trigger: 'When the user needs to pull data from APIs, process it, and produce a result.',
    nodeSequence: ['http-request', 'text-parser', 'transform', 'validator', 'output-node'],
    edgePattern: 'Linear: fetch → parse → transform → validate → output.',
    examples: [
      'Fetch API data, extract fields, validate format, save to store',
      'Pull health data, compute metrics, check thresholds, send alert',
    ],
  },
];

export function getPatternsForOrchestrator(): string {
  return workflowPatterns
    .map(
      (p) =>
        `### ${p.name}\n${p.description}\n**Use when:** ${p.trigger}\n**Nodes:** ${p.nodeSequence.join(' → ')}\n**Flow:** ${p.edgePattern}\n**Examples:** ${p.examples.join('; ')}`,
    )
    .join('\n\n');
}
```

- [ ] **Step 16.2: Commit**

```bash
git add src/lib/workflows/orchestrator/patterns.ts
git commit -m "feat(workflows): add composable workflow patterns library for orchestrator"
```

---

### Task 17: Enrich Orchestrator Prompts

Update the planner prompt to include `llmDescription`, `llmExamples`, patterns, and the new node types.

**Files:**
- Modify: `src/lib/workflows/orchestrator/prompts.ts`
- Modify: `src/lib/workflows/orchestrator/index.ts`

- [ ] **Step 17.1: Update buildPlannerPrompt to accept enriched node info**

Change the signature and body of `buildPlannerPrompt` in `src/lib/workflows/orchestrator/prompts.ts`:

```typescript
import { getPatternsForOrchestrator } from './patterns';
import type { NodeDefinition } from '../types';

export function buildPlannerPrompt(nodeDefinitions: NodeDefinition[]): string {
  const nodeReference = nodeDefinitions
    .map((d) => {
      let entry = `- **${d.label}** (\`${d.type}\`): ${d.description}`;
      if (d.llmDescription) {
        entry += `\n  *Guidance:* ${d.llmDescription}`;
      }
      if (d.llmExamples && d.llmExamples.length > 0) {
        entry += `\n  *Example config:* \`${JSON.stringify(d.llmExamples[0])}\``;
      }
      // List config fields
      if (d.configSchema.properties) {
        const fields = Object.entries(d.configSchema.properties)
          .map(([k, v]) => `\`${k}\` (${(v as any).type || 'any'}): ${(v as any).description || ''}`)
          .join('; ');
        entry += `\n  *Config:* ${fields}`;
      }
      return entry;
    })
    .join('\n\n');

  const patterns = getPatternsForOrchestrator();

  return `You are a workflow automation architect. You design automation workflows as directed graphs of nodes and edges.

## Available Node Types

${nodeReference}

## Composable Patterns

Use these proven patterns as building blocks. Combine them for complex workflows.

${patterns}

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
      "targetNodeId": "target-node-id",
      "sourceHandle": "optional-handle-name",
      "targetHandle": "optional-handle-name"
    }
  ],
  "explanation": "Step-by-step explanation of what each node does and how data flows"
}
\`\`\`

## Layout Guidelines

- Each node is 220px wide — space them at least 280px apart horizontally
- Start trigger at x:50, y:200
- Linear flows: increment x by 300 for each node, keep y constant
- Fan-out branches (after conditional/router): offset y by ±180 for each branch
- After fan-in (branches merging): return to centre y and continue incrementing x
- Keep the graph left-to-right, neat and readable

## Agentic Workflow Design Tips

- For iterative refinement: use Think → LLM Call → Validator → Conditional loop-back pattern
- For multi-step reasoning: chain Think nodes to build up context
- For parallel processing: use Loop for sequential, or multiple branches for true parallel
- Always add Text Parser after LLM Call if you need structured output downstream
- Use Validator nodes as quality gates before critical actions (email, API calls)
- Sub-Workflow nodes let you compose from existing saved workflows

## Important: When To Ask Questions

If the user's request requires ANY of these, you MUST ask a follow-up question:
- API credentials or endpoints you don't know
- Specific configuration details (email addresses, thresholds)
- Integrations that don't exist yet
- Ambiguous requirements

When asking, respond with:
\`\`\`json
{
  "needsMoreInfo": true,
  "question": "Your specific question",
  "context": "Brief explanation"
}
\`\`\`

## Rules

- Every workflow MUST start with exactly one trigger node
- Every node must be reachable from the trigger
- Only use node types from the available list
- Generate unique IDs for each node and edge
- EVERY node config MUST include a "description" field
- ALWAYS connect nodes with edges in execution order
- HTTP Request nodes MUST have real, working URLs
- For agentic loops, use Conditional or Validator to control the loop exit condition
- Respond with ONLY the JSON object`;
}
```

- [ ] **Step 17.2: Update orchestrator index.ts to pass definitions instead of type names**

In `src/lib/workflows/orchestrator/index.ts`, change:

```typescript
const availableNodeTypes = nodeDefinitions.map((d) => d.type);
```

To import the full definitions and pass them to the planner:

```typescript
import { nodeDefinitions } from '../registry-client';
```

Then update the `generateWorkflow` function where `buildPlannerPrompt` is called:

```typescript
const plannerSystem = buildPlannerPrompt(nodeDefinitions);
```

And update `buildModifyPrompt` similarly to accept and use the enriched definitions.

- [ ] **Step 17.3: Run orchestrator tests**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/orchestrator/`
Expected: PASS (may need to update prompt test expectations)

- [ ] **Step 17.4: Commit**

```bash
git add src/lib/workflows/orchestrator/prompts.ts src/lib/workflows/orchestrator/index.ts
git commit -m "feat(workflows): enrich orchestrator with llmDescriptions, examples, and patterns"
```

---

### Task 18: Integration Test — Full Flow

Test the full flow: schema propagation + Basic config + new nodes together.

**Files:**
- Modify: `tests/lib/workflows/schema-propagation.test.ts`

- [ ] **Step 18.1: Add integration test for new node schemas**

Append to `tests/lib/workflows/schema-propagation.test.ts`:

```typescript
describe('resolveUpstreamSchema with new node types', () => {
  it('resolves Think node output schema', () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
      { id: 'think', type: 'think', position: { x: 300, y: 0 }, config: {}, label: 'Think' },
      { id: 'next', type: 'conditional', position: { x: 600, y: 0 }, config: {}, label: 'Decide' },
    ];
    const edges: WorkflowEdgeDef[] = [
      { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'think' },
      { id: 'e2', sourceNodeId: 'think', targetNodeId: 'next' },
    ];

    function getOutput(type: string): JsonSchema {
      if (type === 'think') {
        return {
          type: 'object',
          properties: {
            reasoning: { type: 'string' },
            conclusion: { type: 'string' },
            fullResponse: { type: 'string' },
          },
        };
      }
      return mockGetOutputSchema(type, {});
    }

    const schema = resolveUpstreamSchema('next', nodes, edges, getOutput);
    expect(schema.properties).toHaveProperty('reasoning');
    expect(schema.properties).toHaveProperty('conclusion');
  });

  it('resolves Validator node output schema', () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'validator', type: 'validator', position: { x: 0, y: 0 }, config: {}, label: 'Validate' },
      { id: 'next', type: 'llm-call', position: { x: 300, y: 0 }, config: {}, label: 'Retry' },
    ];
    const edges: WorkflowEdgeDef[] = [
      { id: 'e1', sourceNodeId: 'validator', targetNodeId: 'next', sourceHandle: 'fail' },
    ];

    function getOutput(type: string): JsonSchema {
      if (type === 'validator') {
        return {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            errors: { type: 'array' },
          },
        };
      }
      return mockGetOutputSchema(type, {});
    }

    const schema = resolveUpstreamSchema('next', nodes, edges, getOutput);
    expect(schema.properties).toHaveProperty('valid');
    expect(schema.properties).toHaveProperty('errors');
  });
});
```

- [ ] **Step 18.2: Run full test suite**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/`
Expected: All PASS

- [ ] **Step 18.3: Test in browser**

Run: `cd /home/john/strange_rambling_svelte && npm run dev`

Test:
1. Open workflow editor
2. See new nodes in palette under "agentic" and "control" categories
3. Drag Think node, connect to trigger, double-click — Basic config should show with variable autocomplete
4. Toggle to Advanced — raw JSON config
5. Drop unconnected Validator — should show "Standalone Node" message
6. Use chat panel to ask orchestrator to "build a workflow that analyzes text quality with iterative refinement" — should use Think, Validator, and Conditional nodes from the patterns

- [ ] **Step 18.4: Commit**

```bash
git add tests/lib/workflows/schema-propagation.test.ts
git commit -m "test(workflows): add integration tests for schema propagation with new node types"
```

---

## Summary

| Track | Tasks | What it delivers |
|-------|-------|-----------------|
| A: Schema Propagation | 1-2 | Upstream variable resolution, output annotations for code nodes |
| B: Basic/Advanced Config | 3-7 | Type system, basicConfig on all nodes, renderer components, rewritten modal with connection gate |
| C: New Nodes | 8-15 | Validator, Think, LLM Router, Merge, Text Parser, Accumulator, Sub-Workflow + registration |
| D: Orchestrator | 16-18 | Patterns library, enriched prompts with llmDescription/examples, integration tests |

Total: 18 tasks, ~85 steps.
