import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock for OpenRouter client
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('$lib/deepdive/keys', () => ({
  getOpenRouterClient: () => ({
    chat: { completions: { create: mockCreate } },
  }),
  loadKeys: () => ({ zaiApiKey: 'test', openrouterApiKey: 'test' }),
}));

vi.mock('$lib/server/models/settings', () => ({
  resolveDefaultModel: vi.fn().mockResolvedValue({ provider: 'zai', modelId: 'glm-4-flash' }),
  getOpenRouterApiKey: vi.fn().mockResolvedValue('test'),
}));

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }),
  },
}));

vi.mock('$lib/jkai/llm-client', () => ({
  getLLMClient: vi.fn().mockResolvedValue({
    client: { chat: { completions: { create: mockCreate } } },
    model: 'glm-4-flash',
  }),
  clearLLMClientCache: vi.fn(),
}));

import { llmAgentExecutor, llmAgentDef, discoverTools } from '$lib/workflows/nodes/llm-agent';
import type { ExecutionContext } from '$lib/workflows/types';

function makeMockContext(overrides?: Partial<ExecutionContext> & Record<string, any>): ExecutionContext {
  const mockExecutor = {
    type: 'http-request',
    execute: vi.fn().mockResolvedValue({ output: { data: 'result' }, metadata: {} }),
    getInputSchema: () => ({
      type: 'object',
      properties: { url: { type: 'string' } },
    }),
    getOutputSchema: () => ({ type: 'object' }),
  };

  const mockDefinition = {
    type: 'http-request',
    label: 'HTTP Request',
    category: 'core',
    description: 'Make an HTTP request',
    configSchema: { type: 'object' },
    defaultConfig: {},
    inputs: [],
    outputs: [],
  };

  const mockRegistry = {
    getExecutor: vi.fn().mockReturnValue(mockExecutor),
    getDefinition: vi.fn().mockReturnValue(mockDefinition),
  };

  const ctx: any = {
    runId: 'test-run',
    workflowId: 'wf-1',
    workspaceDir: '/tmp/test',
    dryRun: false,
    emit: vi.fn(),
    getNodeOutput: () => undefined,
    checkBreakpoint: async () => {},
    abortSignal: new AbortController().signal,
    getOutgoingEdges: vi.fn().mockReturnValue([]),
    getNodeConfig: vi.fn().mockReturnValue(undefined),
    _currentNodeId: 'agent-1',
    _registry: mockRegistry,
    ...overrides,
  };
  return ctx;
}

function makeToolContext() {
  const ctx = makeMockContext() as any;

  ctx.getOutgoingEdges.mockReturnValue([
    {
      id: 'edge-1',
      sourceNodeId: 'agent-1',
      targetNodeId: 'http-1',
      sourceHandle: 'tools',
      targetHandle: 'input',
    },
  ]);

  ctx.getNodeConfig.mockReturnValue({
    type: 'http-request',
    config: { url: 'https://api.example.com' },
    label: 'Fetch Data',
  });

  return ctx;
}

// Helper to create a no-tool-call response
function noToolCallResponse(content: string, tokens = { prompt_tokens: 10, completion_tokens: 20 }) {
  return {
    choices: [{ message: { role: 'assistant', content, tool_calls: undefined } }],
    usage: tokens,
  };
}

// Helper to create a tool-call response
function toolCallResponse(
  calls: { name: string; arguments: string; id?: string }[],
  tokens = { prompt_tokens: 15, completion_tokens: 10 },
) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: calls.map((c, i) => ({
            id: c.id || `call_${i}`,
            type: 'function',
            function: { name: c.name, arguments: c.arguments },
          })),
        },
      },
    ],
    usage: tokens,
  };
}

describe('discoverTools', () => {
  it('discovers tools from outgoing edges', () => {
    const ctx = makeToolContext();
    const { tools, toolMap } = discoverTools('agent-1', {}, ctx);

    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('fetch_data');
    expect(tools[0].function.description).toBe('Make an HTTP request');
    expect(toolMap.get('fetch_data')).toBeDefined();
    expect(toolMap.get('fetch_data')!.targetNodeId).toBe('http-1');
  });

  it('skips edges with sourceHandle === output', () => {
    const ctx = makeMockContext() as any;
    ctx.getOutgoingEdges.mockReturnValue([
      {
        id: 'edge-out',
        sourceNodeId: 'agent-1',
        targetNodeId: 'next-1',
        sourceHandle: 'output',
        targetHandle: 'input',
      },
    ]);
    ctx.getNodeConfig.mockReturnValue({
      type: 'transform',
      config: {},
      label: 'Transform',
    });

    const { tools } = discoverTools('agent-1', {}, ctx);
    expect(tools).toHaveLength(0);
  });

  it('applies tool name overrides from config', () => {
    const ctx = makeToolContext();
    const overrides = JSON.stringify({
      'http-1': { name: 'custom_tool', description: 'Custom description' },
    });

    const { tools, toolMap } = discoverTools('agent-1', { toolOverrides: overrides }, ctx);

    expect(tools[0].function.name).toBe('custom_tool');
    expect(tools[0].function.description).toBe('Custom description');
    expect(toolMap.get('custom_tool')).toBeDefined();
  });
});

describe('llmAgentExecutor', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('single turn - LLM responds without tool calls', async () => {
    mockCreate.mockResolvedValueOnce(noToolCallResponse('The answer is 42.'));

    const ctx = makeMockContext();
    const result = await llmAgentExecutor.execute(
      { query: 'What is the answer?' },
      { userPrompt: '{{input.query}}', maxIterations: 5 },
      ctx,
    );

    expect(result.output.response).toBe('The answer is 42.');
    expect(result.output.stopReason).toBe('complete');
    expect(result.output.iterationCount).toBe(1);
    expect(result.output.toolCallHistory).toEqual([]);
    expect(result.metadata?._selectedHandle).toBe('output');
  });

  it('multi-turn - tool call then final answer', async () => {
    const ctx = makeToolContext();

    // First call: LLM wants to use a tool
    mockCreate.mockResolvedValueOnce(
      toolCallResponse([{ name: 'fetch_data', arguments: '{"url":"https://api.example.com"}' }]),
    );
    // Second call: LLM gives final answer
    mockCreate.mockResolvedValueOnce(noToolCallResponse('The data says the answer is 42.'));

    const result = await llmAgentExecutor.execute(
      { query: 'Look up the data' },
      { userPrompt: '{{input.query}}', maxIterations: 5 },
      ctx,
    );

    expect(result.output.response).toBe('The data says the answer is 42.');
    expect(result.output.stopReason).toBe('complete');
    expect(result.output.iterationCount).toBe(2);
    const history = result.output.toolCallHistory as any[];
    expect(history).toHaveLength(1);
    expect(history[0].tool).toBe('fetch_data');
    expect(history[0].output).toEqual({ data: 'result' });
    expect(typeof history[0].durationMs).toBe('number');
  });

  it('stops at max iterations', async () => {
    const ctx = makeToolContext();

    // Always return tool calls
    mockCreate.mockImplementation(() =>
      Promise.resolve(
        toolCallResponse([{ name: 'fetch_data', arguments: '{}' }]),
      ),
    );

    const result = await llmAgentExecutor.execute(
      {},
      { userPrompt: 'do stuff', maxIterations: 3 },
      ctx,
    );

    expect(result.output.stopReason).toBe('max_iterations');
    expect(result.output.iterationCount).toBe(3);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('stops at max tokens', async () => {
    const ctx = makeToolContext();

    // First call uses a lot of tokens
    mockCreate.mockResolvedValueOnce(
      toolCallResponse(
        [{ name: 'fetch_data', arguments: '{}' }],
        { prompt_tokens: 500, completion_tokens: 500 },
      ),
    );

    const result = await llmAgentExecutor.execute(
      {},
      { userPrompt: 'do stuff', maxIterations: 10, maxTotalTokens: 100 },
      ctx,
    );

    expect(result.output.stopReason).toBe('max_tokens');
    // Should stop after first call since tokens exceeded budget
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('handles tool execution errors gracefully', async () => {
    const ctx = makeToolContext();
    const executor = ctx._registry.getExecutor();
    executor.execute.mockRejectedValueOnce(new Error('Network timeout'));

    // First call: tool call
    mockCreate.mockResolvedValueOnce(
      toolCallResponse([{ name: 'fetch_data', arguments: '{}' }]),
    );
    // Second call: LLM handles the error
    mockCreate.mockResolvedValueOnce(
      noToolCallResponse('Sorry, the tool failed with a network timeout.'),
    );

    const result = await llmAgentExecutor.execute(
      {},
      { userPrompt: 'fetch something', maxIterations: 5 },
      ctx,
    );

    expect(result.output.stopReason).toBe('complete');
    expect(result.output.response).toBe('Sorry, the tool failed with a network timeout.');
    const history = result.output.toolCallHistory as any[];
    expect(history).toHaveLength(1);
    expect(history[0].output).toEqual({ error: 'Network timeout' });
    // Verify error was emitted
    expect((ctx.emit as any).mock.calls.some((c: any) => c[0].type === 'node_failed')).toBe(true);
  });

  it('always sets _selectedHandle to output', async () => {
    mockCreate.mockResolvedValueOnce(noToolCallResponse('done'));

    const ctx = makeMockContext();
    const result = await llmAgentExecutor.execute(
      {},
      { userPrompt: 'test' },
      ctx,
    );

    expect(result.metadata?._selectedHandle).toBe('output');
  });

  it('has correct type', () => {
    expect(llmAgentExecutor.type).toBe('llm-agent');
  });
});

describe('llmAgentDef', () => {
  it('is agentic category', () => {
    expect(llmAgentDef.category).toBe('agentic');
  });

  it('has correct type', () => {
    expect(llmAgentDef.type).toBe('llm-agent');
  });

  it('has output port named output', () => {
    expect(llmAgentDef.outputs.find((o) => o.name === 'output')).toBeDefined();
  });

  it('requires userPrompt in configSchema', () => {
    expect(llmAgentDef.configSchema.required).toContain('userPrompt');
  });

  it('has model dropdown in basicConfig', () => {
    const modelField = llmAgentDef.basicConfig?.find((f) => f.key === 'model');
    expect(modelField).toBeDefined();
    expect(modelField?.type).toBe('dropdown');
  });

  it('defaults maxIterations to 10', () => {
    expect(llmAgentDef.defaultConfig.maxIterations).toBe(10);
  });

  it('defaults model to empty string (admin default)', () => {
    expect(llmAgentDef.defaultConfig.model).toBe('');
  });
});
