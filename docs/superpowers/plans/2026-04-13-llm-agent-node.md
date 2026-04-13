# LLM Agent Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an LLM Agent node that runs a multi-turn tool-use loop, where connected downstream nodes become the agent's tools.

**Architecture:** Self-contained executor — no engine execution model changes. The agent node discovers tools from its outgoing edges, builds OpenAI-format tool definitions, and loops calling the LLM and executing tool nodes directly via the registry. Three small additions to ExecutionContext (`getOutgoingEdges`, `getNodeConfig`, `registry`) let the agent access the graph. Uses `_selectedHandle: 'output'` to prevent normal DAG flow through tool edges.

**Tech Stack:** Svelte 5, SvelteKit, TypeScript, Vitest, OpenRouter API (OpenAI-compatible tool_calls format).

---

## File Structure

### New Files

```
src/lib/workflows/nodes/llm-agent.ts              # Agent executor + definition
src/lib/components/workflows/nodes/LlmAgentNode.svelte  # Canvas node component
tests/lib/workflows/nodes/llm-agent.test.ts        # Agent executor tests
```

### Modified Files

```
src/lib/workflows/types.ts                         # Extend ExecutionContext with 3 new fields
src/lib/workflows/engine.ts:158-167                # Populate new context fields
src/lib/workflows/index.ts                         # Register agent executor
src/lib/workflows/registry-client.ts               # Add client-safe agent definition
src/lib/components/workflows/NodePalette.svelte    # Already has 'agentic' category (no change needed)
src/routes/workflows/[id]/+page.svelte             # Register LlmAgentNode component
```

---

### Task 1: Extend ExecutionContext

Add three new fields to `ExecutionContext` so the agent can discover and execute tools.

**Files:**
- Modify: `src/lib/workflows/types.ts:58-66`
- Modify: `src/lib/workflows/engine.ts:158-167`

- [ ] **Step 1.1: Add new fields to ExecutionContext interface**

In `src/lib/workflows/types.ts`, add imports and extend the interface. Change lines 58-66 from:

```typescript
export interface ExecutionContext {
  runId: string;
  workflowId: string;
  workspaceDir: string;
  emit: (event: WorkflowEvent) => void;
  getNodeOutput: (nodeId: string) => Record<string, unknown> | undefined;
  checkBreakpoint: () => Promise<void>;
  abortSignal: AbortSignal;
}
```

To:

```typescript
export interface ExecutionContext {
  runId: string;
  workflowId: string;
  workspaceDir: string;
  emit: (event: WorkflowEvent) => void;
  getNodeOutput: (nodeId: string) => Record<string, unknown> | undefined;
  checkBreakpoint: () => Promise<void>;
  abortSignal: AbortSignal;
  /** Get outgoing edges from a node (for agent tool discovery) */
  getOutgoingEdges: (nodeId: string) => WorkflowEdgeDef[];
  /** Get a node's type, config, and label by ID */
  getNodeConfig: (nodeId: string) => { type: string; config: Record<string, unknown>; label: string } | undefined;
}
```

- [ ] **Step 1.2: Populate new fields in engine.ts**

In `src/lib/workflows/engine.ts`, find the context construction (around line 158-167):

```typescript
const context: ExecutionContext = {
  runId,
  workflowId: workflowId ?? workflow.id,
  workspaceDir: `/tmp/workflow-${runId}`,
  emit: (event) => emitWorkflowEvent(event),
  getNodeOutput: (id) => nodeOutputs.get(id),
  checkBreakpoint: async () => {},
  abortSignal: abortController.signal,
};
```

Change to:

```typescript
const context: ExecutionContext = {
  runId,
  workflowId: workflowId ?? workflow.id,
  workspaceDir: `/tmp/workflow-${runId}`,
  emit: (event) => emitWorkflowEvent(event),
  getNodeOutput: (id) => nodeOutputs.get(id),
  checkBreakpoint: async () => {},
  abortSignal: abortController.signal,
  getOutgoingEdges: (id) => graph.edgesBySource.get(id) || [],
  getNodeConfig: (id) => {
    const n = graph.nodeMap.get(id);
    return n ? { type: n.type, config: n.config, label: n.label } : undefined;
  },
};
```

- [ ] **Step 1.3: Run existing tests to verify no breakage**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/`
Expected: All 265 tests PASS

- [ ] **Step 1.4: Commit**

```bash
git add src/lib/workflows/types.ts src/lib/workflows/engine.ts
git commit -m "feat(workflows): extend ExecutionContext with getOutgoingEdges and getNodeConfig"
```

---

### Task 2: LLM Agent Executor and Definition

The core implementation — the agent executor with tool discovery, execution loop, and guardrails.

**Files:**
- Create: `src/lib/workflows/nodes/llm-agent.ts`
- Create: `tests/lib/workflows/nodes/llm-agent.test.ts`

- [ ] **Step 2.1: Write failing tests**

Create `tests/lib/workflows/nodes/llm-agent.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext, WorkflowEdgeDef } from '$lib/workflows/types';

// Shared mock for the OpenRouter client
const mockCreate = vi.fn();

vi.mock('$lib/deepdive/keys', () => ({
  getOpenRouterClient: () => ({
    chat: { completions: { create: mockCreate } },
  }),
}));

function makeMockContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    runId: 'test-run',
    workflowId: 'test-wf',
    workspaceDir: '/tmp/test',
    emit: vi.fn(),
    getNodeOutput: vi.fn(),
    checkBreakpoint: vi.fn(),
    abortSignal: new AbortController().signal,
    getOutgoingEdges: vi.fn().mockReturnValue([]),
    getNodeConfig: vi.fn(),
    ...overrides,
  };
}

// Mock a tool node's executor response
function mockToolExecution() {
  // We need to mock the registry lookup — this is handled by the agent's
  // internal tool execution. We'll test via the agent's output.
}

describe('llm-agent executor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCreate.mockReset();
  });

  it('completes in single turn when LLM returns no tool calls', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'The answer is 42.', tool_calls: undefined } }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    });

    const { llmAgentExecutor } = await import('$lib/workflows/nodes/llm-agent');
    const context = makeMockContext();

    const result = await llmAgentExecutor.execute(
      { question: 'What is the meaning of life?' },
      { model: 'openai/gpt-4o', userPrompt: '{{input.question}}', maxIterations: 5 },
      context,
    );

    expect(result.output.response).toBe('The answer is 42.');
    expect(result.output.stopReason).toBe('complete');
    expect(result.output.iterationCount).toBe(1);
    expect(result.output.toolCallHistory).toEqual([]);
  });

  it('executes tool calls and loops back to LLM', async () => {
    // First call: LLM requests a tool call
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'fetch_data', arguments: '{"url":"https://example.com"}' },
          }],
        },
      }],
      usage: { prompt_tokens: 50, completion_tokens: 20 },
    });

    // Second call: LLM responds with final answer
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'Got the data: hello world', tool_calls: undefined } }],
      usage: { prompt_tokens: 100, completion_tokens: 15 },
    });

    const { llmAgentExecutor } = await import('$lib/workflows/nodes/llm-agent');

    // Set up edges: agent -> http-request node
    const edges: WorkflowEdgeDef[] = [
      { id: 'e1', sourceNodeId: 'agent-node', targetNodeId: 'http-node', sourceHandle: 'tool_fetch_data' },
    ];

    // Mock executor for the tool node
    const mockHttpExecutor = {
      type: 'http-request',
      execute: vi.fn().mockResolvedValue({
        output: { status: 200, body: 'hello world' },
      }),
      getInputSchema: () => ({ type: 'object', properties: { url: { type: 'string' } } }),
      getOutputSchema: () => ({ type: 'object' }),
    };

    const context = makeMockContext({
      getOutgoingEdges: vi.fn().mockReturnValue(edges),
      getNodeConfig: vi.fn().mockReturnValue({
        type: 'http-request',
        config: { method: 'GET' },
        label: 'Fetch Data',
      }),
    });

    // Inject a mock registry via the module — we need to test tool execution
    // The agent accesses context.getOutgoingEdges and context.getNodeConfig,
    // then needs to find the executor. We'll add registry to context.
    (context as any).registry = {
      getExecutor: vi.fn().mockReturnValue(mockHttpExecutor),
      getDefinition: vi.fn().mockReturnValue({
        type: 'http-request',
        description: 'Make an HTTP request',
        inputs: [{ name: 'input', type: 'any' }],
      }),
    };

    const result = await llmAgentExecutor.execute(
      { task: 'fetch some data' },
      {
        model: 'openai/gpt-4o',
        userPrompt: '{{input.task}}',
        maxIterations: 5,
        systemPrompt: 'You are a helpful agent.',
      },
      context,
    );

    expect(result.output.response).toBe('Got the data: hello world');
    expect(result.output.stopReason).toBe('complete');
    expect(result.output.iterationCount).toBe(2);
    expect(result.output.toolCallHistory).toHaveLength(1);
    expect(result.output.toolCallHistory[0].tool).toBe('fetch_data');
    expect(result.output.toolCallHistory[0].output).toEqual({ status: 200, body: 'hello world' });
    expect(mockHttpExecutor.execute).toHaveBeenCalledOnce();
  });

  it('stops at max iterations', async () => {
    // LLM always requests a tool call
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_n',
            type: 'function',
            function: { name: 'fetch_data', arguments: '{}' },
          }],
        },
      }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    });

    const { llmAgentExecutor } = await import('$lib/workflows/nodes/llm-agent');

    const mockExecutor = {
      type: 'http-request',
      execute: vi.fn().mockResolvedValue({ output: { ok: true } }),
      getInputSchema: () => ({ type: 'object' }),
      getOutputSchema: () => ({ type: 'object' }),
    };

    const context = makeMockContext({
      getOutgoingEdges: vi.fn().mockReturnValue([
        { id: 'e1', sourceNodeId: 'agent', targetNodeId: 'tool', sourceHandle: 'tool_fetch_data' },
      ]),
      getNodeConfig: vi.fn().mockReturnValue({ type: 'http-request', config: {}, label: 'Fetch Data' }),
    });
    (context as any).registry = {
      getExecutor: vi.fn().mockReturnValue(mockExecutor),
      getDefinition: vi.fn().mockReturnValue({ type: 'http-request', description: 'HTTP', inputs: [] }),
    };

    const result = await llmAgentExecutor.execute(
      {},
      { model: 'openai/gpt-4o', userPrompt: 'do stuff', maxIterations: 3 },
      context,
    );

    expect(result.output.stopReason).toBe('max_iterations');
    expect(result.output.iterationCount).toBe(3);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('stops when token budget exceeded', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c', type: 'function', function: { name: 'tool_a', arguments: '{}' } }],
        },
      }],
      usage: { prompt_tokens: 500, completion_tokens: 500 },
    });

    const { llmAgentExecutor } = await import('$lib/workflows/nodes/llm-agent');

    const mockExec = {
      type: 'code-execute', execute: vi.fn().mockResolvedValue({ output: {} }),
      getInputSchema: () => ({ type: 'object' }), getOutputSchema: () => ({ type: 'object' }),
    };
    const context = makeMockContext({
      getOutgoingEdges: vi.fn().mockReturnValue([
        { id: 'e1', sourceNodeId: 'a', targetNodeId: 'b', sourceHandle: 'tool_tool_a' },
      ]),
      getNodeConfig: vi.fn().mockReturnValue({ type: 'code-execute', config: {}, label: 'Tool A' }),
    });
    (context as any).registry = {
      getExecutor: vi.fn().mockReturnValue(mockExec),
      getDefinition: vi.fn().mockReturnValue({ type: 'code-execute', description: 'Run code', inputs: [] }),
    };

    const result = await llmAgentExecutor.execute(
      {},
      { model: 'openai/gpt-4o', userPrompt: 'go', maxIterations: 10, maxTotalTokens: 800 },
      context,
    );

    // First call uses 1000 tokens, exceeds 800 budget — should stop after iteration 1
    expect(result.output.stopReason).toBe('max_tokens');
  });

  it('handles tool execution errors gracefully', async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant', content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'bad_tool', arguments: '{}' } }],
          },
        }],
        usage: { prompt_tokens: 50, completion_tokens: 10 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'Tool failed, here is my best answer.' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      });

    const { llmAgentExecutor } = await import('$lib/workflows/nodes/llm-agent');

    const failingExecutor = {
      type: 'code-execute',
      execute: vi.fn().mockRejectedValue(new Error('Sandbox crashed')),
      getInputSchema: () => ({ type: 'object' }),
      getOutputSchema: () => ({ type: 'object' }),
    };
    const context = makeMockContext({
      getOutgoingEdges: vi.fn().mockReturnValue([
        { id: 'e1', sourceNodeId: 'a', targetNodeId: 'b', sourceHandle: 'tool_bad_tool' },
      ]),
      getNodeConfig: vi.fn().mockReturnValue({ type: 'code-execute', config: {}, label: 'Bad Tool' }),
    });
    (context as any).registry = {
      getExecutor: vi.fn().mockReturnValue(failingExecutor),
      getDefinition: vi.fn().mockReturnValue({ type: 'code-execute', description: 'Code', inputs: [] }),
    };

    const result = await llmAgentExecutor.execute(
      {},
      { model: 'openai/gpt-4o', userPrompt: 'try this', maxIterations: 5 },
      context,
    );

    // Agent should feed the error back to the LLM and continue
    expect(result.output.response).toBe('Tool failed, here is my best answer.');
    expect(result.output.stopReason).toBe('complete');
    expect(result.output.toolCallHistory[0].output).toHaveProperty('error');
  });

  it('uses _selectedHandle output to prevent downstream tool execution', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'Done.' } }],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    });

    const { llmAgentExecutor } = await import('$lib/workflows/nodes/llm-agent');
    const context = makeMockContext();

    const result = await llmAgentExecutor.execute(
      {},
      { model: 'openai/gpt-4o', userPrompt: 'hello' },
      context,
    );

    expect(result.metadata?._selectedHandle).toBe('output');
  });

  it('applies tool name overrides from config', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'No tools needed.' } }],
      usage: { prompt_tokens: 30, completion_tokens: 5 },
    });

    const { llmAgentExecutor, discoverTools } = await import('$lib/workflows/nodes/llm-agent');

    const edges: WorkflowEdgeDef[] = [
      { id: 'e1', sourceNodeId: 'agent', targetNodeId: 'http-node' },
    ];
    const context = makeMockContext({
      getOutgoingEdges: vi.fn().mockReturnValue(edges),
      getNodeConfig: vi.fn().mockReturnValue({ type: 'http-request', config: {}, label: 'Fetch Weather' }),
    });
    (context as any).registry = {
      getExecutor: vi.fn(),
      getDefinition: vi.fn().mockReturnValue({
        type: 'http-request', description: 'Make HTTP request',
        inputs: [{ name: 'input', type: 'any' }],
      }),
    };

    const tools = discoverTools('agent', { toolOverrides: JSON.stringify({ 'http-node': { name: 'get_weather', description: 'Fetch weather data' } }) }, context);

    expect(tools[0].function.name).toBe('get_weather');
    expect(tools[0].function.description).toBe('Fetch weather data');
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/llm-agent.test.ts`
Expected: FAIL — module not found

- [ ] **Step 2.3: Implement the agent executor**

Create `src/lib/workflows/nodes/llm-agent.ts`:

```typescript
import type {
  NodeExecutor,
  NodeDefinition,
  NodeResult,
  ExecutionContext,
  WorkflowEdgeDef,
  JsonSchema,
} from '../types';
import { interpolateTemplate } from './template';
import { getOpenRouterClient } from '$lib/deepdive/keys';

interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

interface ToolMapping {
  toolName: string;
  targetNodeId: string;
  nodeType: string;
  nodeConfig: Record<string, unknown>;
}

interface ToolCallRecord {
  tool: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  durationMs: number;
}

function sanitizeName(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'tool';
}

/**
 * Discover tools from the agent's outgoing edges.
 * Exported for testing.
 */
export function discoverTools(
  agentNodeId: string,
  config: Record<string, unknown>,
  context: ExecutionContext,
): ToolDef[] {
  const edges = context.getOutgoingEdges(agentNodeId);
  const registry = (context as any).registry;
  const toolDefs: ToolDef[] = [];

  let overrides: Record<string, { name?: string; description?: string }> = {};
  if (config.toolOverrides && typeof config.toolOverrides === 'string') {
    try { overrides = JSON.parse(config.toolOverrides); } catch { /* ignore */ }
  }

  for (const edge of edges) {
    // Skip the 'output' handle — that's for the final result, not a tool
    if (edge.sourceHandle === 'output') continue;

    const nodeInfo = context.getNodeConfig(edge.targetNodeId);
    if (!nodeInfo) continue;

    const def = registry?.getDefinition(nodeInfo.type);
    const override = overrides[edge.targetNodeId];

    const name = override?.name || sanitizeName(nodeInfo.label);
    const description = override?.description || def?.description || `Execute ${nodeInfo.label}`;
    const parameters = def?.configSchema || { type: 'object' as const };

    toolDefs.push({
      type: 'function',
      function: { name, description, parameters },
    });
  }

  return toolDefs;
}

function buildToolMap(
  agentNodeId: string,
  config: Record<string, unknown>,
  context: ExecutionContext,
): Map<string, ToolMapping> {
  const edges = context.getOutgoingEdges(agentNodeId);
  const registry = (context as any).registry;
  const map = new Map<string, ToolMapping>();

  let overrides: Record<string, { name?: string; description?: string }> = {};
  if (config.toolOverrides && typeof config.toolOverrides === 'string') {
    try { overrides = JSON.parse(config.toolOverrides); } catch { /* ignore */ }
  }

  for (const edge of edges) {
    if (edge.sourceHandle === 'output') continue;

    const nodeInfo = context.getNodeConfig(edge.targetNodeId);
    if (!nodeInfo) continue;

    const override = overrides[edge.targetNodeId];
    const name = override?.name || sanitizeName(nodeInfo.label);

    map.set(name, {
      toolName: name,
      targetNodeId: edge.targetNodeId,
      nodeType: nodeInfo.type,
      nodeConfig: nodeInfo.config,
    });
  }

  return map;
}

export const llmAgentExecutor: NodeExecutor = {
  type: 'llm-agent',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const model = (config.model as string) || 'openai/gpt-4o';
    const systemPrompt = interpolateTemplate((config.systemPrompt as string) || '', input);
    const userPrompt = interpolateTemplate((config.userPrompt as string) || '', input);
    const temperature = (config.temperature as number) ?? 0.7;
    const maxTokens = (config.maxTokens as number) ?? 4096;
    const maxIterations = (config.maxIterations as number) ?? 10;
    const maxTotalTokens = (config.maxTotalTokens as number) ?? 0;
    const timeoutMs = (config.timeoutMs as number) ?? 0;

    const client = getOpenRouterClient();
    const registry = (context as any).registry;

    // Discover tools from connected nodes
    const agentNodeId = findAgentNodeId(context);
    const toolDefs = discoverTools(agentNodeId, config, context);
    const toolMap = buildToolMap(agentNodeId, config, context);

    // Build initial messages
    const messages: Array<Record<string, unknown>> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    const userContent = userPrompt
      ? `${userPrompt}\n\nInput data:\n${JSON.stringify(input, null, 2)}`
      : `Input data:\n${JSON.stringify(input, null, 2)}`;
    messages.push({ role: 'user', content: userContent });

    const totalTokens = { prompt: 0, completion: 0 };
    const toolCallHistory: ToolCallRecord[] = [];
    const startTime = Date.now();
    let lastContent = '';

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Check timeout
      if (timeoutMs > 0 && Date.now() - startTime > timeoutMs) {
        return makeResult(lastContent, 'timeout', iteration, totalTokens, toolCallHistory, messages);
      }

      // Check token budget
      if (maxTotalTokens > 0 && totalTokens.prompt + totalTokens.completion >= maxTotalTokens) {
        return makeResult(lastContent, 'max_tokens', iteration, totalTokens, toolCallHistory, messages);
      }

      // Call LLM
      const callParams: Record<string, unknown> = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      };
      if (toolDefs.length > 0) {
        callParams.tools = toolDefs;
      }

      const response = await client.chat.completions.create(callParams as any);
      totalTokens.prompt += response.usage?.prompt_tokens ?? 0;
      totalTokens.completion += response.usage?.completion_tokens ?? 0;

      const assistantMessage = response.choices[0]?.message;
      if (!assistantMessage) {
        return makeResult('No response from LLM', 'complete', iteration + 1, totalTokens, toolCallHistory, messages);
      }

      messages.push(assistantMessage as Record<string, unknown>);

      if (assistantMessage.content) {
        lastContent = assistantMessage.content as string;
      }

      // Check if LLM is done (no tool calls)
      const toolCalls = assistantMessage.tool_calls as Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }> | undefined;

      if (!toolCalls || toolCalls.length === 0) {
        return makeResult(lastContent, 'complete', iteration + 1, totalTokens, toolCallHistory, messages);
      }

      // Execute each tool call
      for (const toolCall of toolCalls) {
        const mapping = toolMap.get(toolCall.function.name);
        let toolOutput: Record<string, unknown>;
        const callStartMs = Date.now();

        if (!mapping) {
          toolOutput = { error: `Unknown tool: ${toolCall.function.name}` };
        } else {
          const executor = registry?.getExecutor(mapping.nodeType);
          if (!executor) {
            toolOutput = { error: `No executor for type: ${mapping.nodeType}` };
          } else {
            try {
              let args: Record<string, unknown>;
              try {
                args = JSON.parse(toolCall.function.arguments);
              } catch {
                args = {};
              }

              context.emit({
                type: 'node_started',
                runId: context.runId,
                nodeId: mapping.targetNodeId,
                timestamp: new Date().toISOString(),
              });

              const result = await executor.execute(args, mapping.nodeConfig, context);
              toolOutput = result.output;

              context.emit({
                type: 'node_completed',
                runId: context.runId,
                nodeId: mapping.targetNodeId,
                data: result.output,
                timestamp: new Date().toISOString(),
              });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              toolOutput = { error: errMsg };

              context.emit({
                type: 'node_failed',
                runId: context.runId,
                nodeId: mapping.targetNodeId,
                data: { error: errMsg },
                timestamp: new Date().toISOString(),
              });
            }
          }
        }

        const durationMs = Date.now() - callStartMs;
        toolCallHistory.push({
          tool: toolCall.function.name,
          input: safeParseJson(toolCall.function.arguments),
          output: toolOutput,
          durationMs,
        });

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolOutput),
        });
      }
    }

    // Max iterations reached
    return makeResult(lastContent, 'max_iterations', maxIterations, totalTokens, toolCallHistory, messages);
  },

  getInputSchema() {
    return { type: 'object', description: 'Available for template interpolation and passed as context to the LLM' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        response: { type: 'string', description: 'Final LLM response' },
        toolCallHistory: { type: 'array', description: 'Array of { tool, input, output, durationMs }' },
        iterationCount: { type: 'number', description: 'Number of LLM rounds' },
        stopReason: { type: 'string', description: 'complete | max_iterations | max_tokens | timeout' },
        tokensUsed: { type: 'object', description: '{ prompt, completion, total }' },
        conversationHistory: { type: 'array', description: 'Full message array' },
      },
    };
  },
};

function findAgentNodeId(context: ExecutionContext): string {
  // The agent needs to know its own node ID to look up outgoing edges.
  // We extract it from the context — the engine sets workspaceDir to /tmp/workflow-{runId}
  // but we need the actual node ID. We'll use a workaround: check which node has outgoing
  // edges where getOutgoingEdges returns results for any known ID.
  // Actually, the simplest approach: we add the nodeId to the context call.
  // For now, we use a convention: the executor receives its own ID via config._nodeId
  // which the engine can set. But to avoid engine changes, we'll have the agent
  // test all nodes. Better: we accept that the agent receives its nodeId somehow.
  //
  // Pragmatic solution: the agent stores its own ID in config at save time,
  // or we pass it through config._nodeId. The engine already has the nodeId
  // when calling execute — we just need to pass it through.
  //
  // Simplest fix: add nodeId to the execute call's context or config.
  // Since we don't want to change the executor interface, we'll add it to context.
  return (context as any)._currentNodeId || '';
}

function makeResult(
  response: string,
  stopReason: string,
  iterationCount: number,
  tokensUsed: { prompt: number; completion: number },
  toolCallHistory: ToolCallRecord[],
  conversationHistory: Array<Record<string, unknown>>,
): NodeResult {
  return {
    output: {
      response,
      toolCallHistory,
      iterationCount,
      stopReason,
      tokensUsed: {
        prompt: tokensUsed.prompt,
        completion: tokensUsed.completion,
        total: tokensUsed.prompt + tokensUsed.completion,
      },
      conversationHistory,
    },
    metadata: { _selectedHandle: 'output' },
  };
}

function safeParseJson(str: string): Record<string, unknown> {
  try { return JSON.parse(str); } catch { return {}; }
}

export const llmAgentDef: NodeDefinition = {
  type: 'llm-agent',
  label: 'LLM Agent',
  category: 'agentic',
  description: 'Multi-turn agent with tool use. Connected downstream nodes become the agent\'s tools. The LLM autonomously decides which tools to call.',
  configSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'OpenRouter model ID (default: openai/gpt-4o)' },
      systemPrompt: { type: 'string', description: 'System prompt. Supports {{input.field}} templates.' },
      userPrompt: { type: 'string', description: 'User prompt. Supports {{input.field}} templates.' },
      temperature: { type: 'number', description: 'Sampling temperature (default 0.7)' },
      maxTokens: { type: 'number', description: 'Per-call max tokens (default 4096)' },
      maxIterations: { type: 'number', description: 'Max tool-call rounds (default 10)' },
      maxTotalTokens: { type: 'number', description: 'Cumulative token budget (0 = unlimited)' },
      timeoutMs: { type: 'number', description: 'Wall-clock timeout in ms (0 = unlimited)' },
      toolOverrides: { type: 'string', description: 'JSON: { [nodeId]: { name?, description? } }' },
    },
    required: ['userPrompt'],
  },
  defaultConfig: {
    model: 'openai/gpt-4o',
    systemPrompt: 'You are a helpful agent. Use the available tools to accomplish the task.',
    userPrompt: '',
    temperature: 0.7,
    maxTokens: 4096,
    maxIterations: 10,
    maxTotalTokens: 0,
    timeoutMs: 0,
    toolOverrides: '{}',
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Agent Result' }],
  basicConfig: [
    {
      key: 'model', label: 'Model', type: 'dropdown',
      options: [
        { value: 'openai/gpt-4o', label: 'GPT-4o' },
        { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
        { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet' },
        { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku' },
      ],
    },
    { key: 'systemPrompt', label: 'System Prompt', type: 'template-textarea', placeholder: 'You are a helpful agent...' },
    { key: 'userPrompt', label: 'Task', type: 'template-textarea', placeholder: 'Use {{input.field}} for variables' },
    { key: 'temperature', label: 'Temperature', type: 'slider', min: 0, max: 2, step: 0.1 },
    { key: 'maxIterations', label: 'Max Iterations', type: 'number' },
    { key: 'maxTokens', label: 'Max Tokens per Call', type: 'number', advancedOnly: true },
    { key: 'maxTotalTokens', label: 'Total Token Budget', type: 'number', advancedOnly: true, description: '0 = unlimited' },
    { key: 'timeoutMs', label: 'Timeout (ms)', type: 'number', advancedOnly: true, description: '0 = unlimited' },
    { key: 'toolOverrides', label: 'Tool Name Overrides', type: 'textarea', advancedOnly: true, description: 'JSON: { "nodeId": { "name": "...", "description": "..." } }' },
  ],
  llmDescription: 'Use for complex tasks requiring multiple steps, tool use, and iterative reasoning. Connected downstream nodes become the agent\'s tools. More powerful than LLM Call but more expensive — use when the task genuinely needs multi-step reasoning with tool access.',
  llmExamples: [{
    model: 'openai/gpt-4o',
    systemPrompt: 'You are a research assistant. Use the available tools to gather information and synthesize a report.',
    userPrompt: 'Research {{input.topic}} and produce a summary with sources.',
    maxIterations: 8,
    temperature: 0.5,
  }],
};
```

- [ ] **Step 2.4: Pass _currentNodeId in engine context**

The agent needs to know its own node ID to call `getOutgoingEdges`. In `src/lib/workflows/engine.ts`, add `_currentNodeId` to the context object. Find the context construction and add one line:

After `abortSignal: abortController.signal,` add:

```typescript
_currentNodeId: nodeId,
```

This doesn't require a type change — it's accessed via `(context as any)._currentNodeId` in the agent. Quick and non-breaking.

- [ ] **Step 2.5: Also pass registry in engine context**

In the same context block in engine.ts, add:

```typescript
_registry: this.registry,
```

Then in the agent executor, change:
```typescript
const registry = (context as any).registry;
```
to:
```typescript
const registry = (context as any)._registry || (context as any).registry;
```

This lets the agent work both with the engine's context and with test mocks.

- [ ] **Step 2.6: Run tests**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/llm-agent.test.ts`
Expected: PASS

- [ ] **Step 2.7: Run full test suite**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/`
Expected: All tests PASS

- [ ] **Step 2.8: Commit**

```bash
git add src/lib/workflows/nodes/llm-agent.ts src/lib/workflows/engine.ts tests/lib/workflows/nodes/llm-agent.test.ts
git commit -m "feat(workflows): add LLM Agent node — multi-turn tool-use loop with guardrails"
```

---

### Task 3: Register Agent Node and Create Canvas Component

**Files:**
- Create: `src/lib/components/workflows/nodes/LlmAgentNode.svelte`
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`
- Modify: `src/routes/workflows/[id]/+page.svelte`

- [ ] **Step 3.1: Create LlmAgentNode.svelte**

Create `src/lib/components/workflows/nodes/LlmAgentNode.svelte`:

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';

  let { data } = $props();

  const model: string = data.config?.model || 'openai/gpt-4o';
  const maxIter: number = data.config?.maxIterations || 10;
  const systemPrompt: string = data.config?.systemPrompt || '';
  const truncatedPrompt = $derived(
    systemPrompt.length > 35 ? systemPrompt.slice(0, 35) + '...' : systemPrompt,
  );

  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)',
    running: '#569cd6',
    completed: '#2d7d46',
    failed: '#b43232',
    paused_breakpoint: '#b8860b',
    skipped: 'var(--text-ghost)',
  };

  let borderColor = $derived(
    data.status ? STATUS_COLORS[data.status] || 'var(--card-border)' : 'var(--card-border)',
  );
  let isRunning = $derived(data.status === 'running');
</script>

<div
  class="rounded-lg border-2 min-w-[180px] transition-colors"
  style="background: var(--card-bg); border-color: {borderColor};"
  class:animate-pulse={isRunning}
>
  <Handle type="target" position={Position.Left} id="input" style="top: 30px;" />

  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">&#9881;</span>
      <span
        class="text-[10px] uppercase tracking-[0.15em]"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        agent
      </span>
      {#if data.status}
        <span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>
      {/if}
    </div>
    <div class="text-sm font-medium mb-2" style="color: var(--text-primary);">
      {data.label}
    </div>
    <div class="flex items-center gap-2 mb-1">
      <span
        class="text-[10px] px-1.5 py-0.5 rounded font-mono"
        style="background: var(--card-border); color: var(--text-ghost);"
        title={model}
      >
        {model.split('/').pop()}
      </span>
      <span class="text-[10px]" style="color: var(--text-ghost);">max {maxIter}</span>
    </div>
    {#if truncatedPrompt}
      <span
        class="text-[10px] italic block truncate"
        style="color: var(--text-ghost);"
        title={systemPrompt}
      >
        {truncatedPrompt}
      </span>
    {/if}
  </div>

  <Handle type="source" position={Position.Right} id="output" style="top: 30px;" />
</div>
```

- [ ] **Step 3.2: Register in server registry (index.ts)**

In `src/lib/workflows/index.ts`, add:

```typescript
import { llmAgentDef, llmAgentExecutor } from './nodes/llm-agent';
```

And:

```typescript
registry.register(llmAgentDef, llmAgentExecutor);
```

- [ ] **Step 3.3: Add client-safe definition to registry-client.ts**

Since `llm-agent.ts` imports `$lib/deepdive/keys` (server-only), add an inline definition in `registry-client.ts` before the `nodeDefinitions` array, following the same pattern as `thinkDef` and `llmRouterDef`.

Copy the `llmAgentDef` from the source file but as an inline `const llmAgentDef: NodeDefinition = { ... }`.

Add to the `nodeDefinitions` array:

```typescript
llmAgentDef,
```

- [ ] **Step 3.4: Register component in editor page**

In `src/routes/workflows/[id]/+page.svelte`, add the dynamic import in the `Promise.all`:

```typescript
import('$lib/components/workflows/nodes/LlmAgentNode.svelte'),
```

And in the `.then()` destructuring, add to `nodeTypeComponents`:

```typescript
'llm-agent': la.default,
```

- [ ] **Step 3.5: Run full test suite**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/`
Expected: All tests PASS

- [ ] **Step 3.6: Commit**

```bash
git add src/lib/components/workflows/nodes/LlmAgentNode.svelte src/lib/workflows/index.ts src/lib/workflows/registry-client.ts src/routes/workflows/\[id\]/+page.svelte
git commit -m "feat(workflows): register LLM Agent node and add canvas component"
```

---

### Task 4: Update Schema Propagation for Agent Node

Add the agent's output schema to the static schema map so downstream nodes get autocomplete.

**Files:**
- Modify: `src/routes/workflows/[id]/+page.svelte` (the `getStaticOutputSchema` function)

- [ ] **Step 4.1: Add llm-agent to getStaticOutputSchema**

In the `getStaticOutputSchema` function in `src/routes/workflows/[id]/+page.svelte`, add to the `schemas` object:

```typescript
'llm-agent': {
  type: 'object',
  properties: {
    response: { type: 'string', description: 'Final LLM response' },
    toolCallHistory: { type: 'array', description: 'Tool call records' },
    iterationCount: { type: 'number', description: 'Number of LLM rounds' },
    stopReason: { type: 'string', description: 'Why the agent stopped' },
    tokensUsed: {
      type: 'object',
      properties: {
        prompt: { type: 'number' },
        completion: { type: 'number' },
        total: { type: 'number' },
      },
    },
  },
},
```

Also add `'think'` and `'llm-router'` if they're missing from the static schema map (check first).

- [ ] **Step 4.2: Commit**

```bash
git add src/routes/workflows/\[id\]/+page.svelte
git commit -m "feat(workflows): add LLM Agent output schema for downstream autocomplete"
```

---

### Task 5: Update Orchestrator Prompts for Agent Node

Add the agent node to the orchestrator's knowledge so it can generate agentic workflows.

**Files:**
- Modify: `src/lib/workflows/orchestrator/patterns.ts`

- [ ] **Step 5.1: Add Agent Loop pattern**

In `src/lib/workflows/orchestrator/patterns.ts`, add to the `workflowPatterns` array:

```typescript
{
  name: 'Agent Loop',
  description: 'An autonomous agent that reasons about the task and uses tools to accomplish it. The agent decides which tools to call and when to stop.',
  trigger: 'When the task requires autonomous multi-step reasoning with tool use — the workflow cannot be predetermined.',
  nodeSequence: ['llm-agent', 'tool-nodes (connected downstream)'],
  edgePattern: 'llm-agent → multiple tool nodes (http-request, code-execute, etc.). Agent calls tools internally. Output handle → next processing step.',
  examples: [
    'Research a topic using web APIs and synthesize a report',
    'Debug a problem by running code, checking results, and iterating',
    'Process a complex request that requires multiple API calls in unpredictable order',
  ],
},
```

- [ ] **Step 5.2: Run orchestrator tests**

Run: `cd /home/john/strange_rambling_svelte && npx vitest run tests/lib/workflows/orchestrator/`
Expected: PASS

- [ ] **Step 5.3: Commit**

```bash
git add src/lib/workflows/orchestrator/patterns.ts
git commit -m "feat(workflows): add Agent Loop pattern to orchestrator"
```

---

## Summary

| Task | What it delivers |
|------|-----------------|
| 1: Extend ExecutionContext | `getOutgoingEdges` + `getNodeConfig` on context |
| 2: Agent Executor | Core executor with tool discovery, execution loop, 4 guardrails, error handling |
| 3: Registration + Canvas | Node registered in all registries, Svelte canvas component |
| 4: Schema Propagation | Downstream nodes get agent output autocomplete |
| 5: Orchestrator | Agent Loop pattern for LLM-generated workflows |

Total: 5 tasks.
