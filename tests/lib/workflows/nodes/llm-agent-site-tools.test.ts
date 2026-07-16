import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate, registryTools } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  registryTools: {} as Record<string, any>,
}));

vi.mock('$lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }) },
}));
vi.mock('$lib/server/models/settings', () => ({
  resolveDefaultModel: vi.fn().mockResolvedValue({ provider: 'zai', modelId: 'glm-4-flash' }),
  getOpenRouterApiKey: vi.fn().mockResolvedValue('test'),
}));
vi.mock('$lib/jkai/llm-client', () => ({
  getLLMClient: vi.fn().mockResolvedValue({
    client: { chat: { completions: { create: mockCreate } } },
    model: 'glm-4-flash',
  }),
  clearLLMClientCache: vi.fn(),
}));
vi.mock('$lib/workflows/site-tools/registry', () => ({
  getTool: (name: string) => registryTools[name],
  getToolDefinitions: () =>
    Object.values(registryTools).map((t: any) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description ?? '', parameters: t.parameters ?? { type: 'object' } },
    })),
}));

import { llmAgentExecutor, runAgentSubCall } from '$lib/workflows/nodes/llm-agent';
import { executionContext, recordLLMCall } from '$lib/workflows/execution-context';
import type { ExecutionContext } from '$lib/workflows/types';

function makeCtx(): ExecutionContext {
  return {
    runId: 'r1',
    workflowId: 'w1',
    workspaceDir: '/tmp',
    dryRun: false,
    emit: vi.fn(),
    getNodeOutput: () => undefined,
    checkBreakpoint: async () => {},
    abortSignal: new AbortController().signal,
    getOutgoingEdges: () => [],
    getIncomingEdges: () => [],
    getNodeConfig: () => undefined,
    _currentNodeId: 'agent-1',
    _registry: {},
  } as unknown as ExecutionContext;
}

function toolCall(name: string, args = '{}') {
  return {
    choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: args } }] } }],
    usage: { prompt_tokens: 5, completion_tokens: 5 },
  };
}
function finalAnswer(content: string) {
  return { choices: [{ message: { role: 'assistant', content, tool_calls: undefined } }], usage: { prompt_tokens: 3, completion_tokens: 3 } };
}

beforeEach(() => {
  mockCreate.mockReset();
  for (const k of Object.keys(registryTools)) delete registryTools[k];
  registryTools.file_search = {
    name: 'file_search',
    description: 'Search files',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    destructive: false,
    handler: vi.fn().mockResolvedValue({ success: true, data: { hits: [1] } }),
  };
  registryTools.whatsapp_send = {
    name: 'whatsapp_send',
    description: 'Send WhatsApp',
    parameters: { type: 'object' },
    destructive: true,
    handler: vi.fn(),
  };
  registryTools.save_memory = {
    name: 'save_memory',
    description: 'Save a fact',
    parameters: { type: 'object' },
    destructive: false,
    handler: vi.fn().mockResolvedValue({ success: true, data: {} }),
  };
});

describe('llm-agent site-tools mode', () => {
  it('exposes only allowlisted tools and runs them', async () => {
    mockCreate.mockResolvedValueOnce(toolCall('file_search', '{"query":"invoices"}'));
    mockCreate.mockResolvedValueOnce(finalAnswer('found it'));

    const result = await llmAgentExecutor.execute(
      { question: 'find invoices' },
      { userPrompt: '{{input.question}}', toolSource: 'site-tools', siteToolAllowlist: ['file_search'], maxIterations: 4 },
      makeCtx(),
    );

    // Only the allowlisted tool is offered to the model.
    const offered = (mockCreate.mock.calls[0][0].tools as any[]).map((t) => t.function.name);
    expect(offered).toEqual(['file_search']);
    expect(registryTools.file_search.handler).toHaveBeenCalledWith(expect.objectContaining({ query: 'invoices' }));
    const history = result.output.toolCallHistory as any[];
    expect(history[0].tool).toBe('file_search');
    expect(history[0].output).toEqual({ success: true, data: { hits: [1] } });
    expect(result.metadata?.toolSource).toBe('site-tools');
  });

  it('refuses a tool the model calls that is not in the allowlist', async () => {
    mockCreate.mockResolvedValueOnce(toolCall('save_memory', '{}'));
    mockCreate.mockResolvedValueOnce(finalAnswer('ok'));

    const result = await llmAgentExecutor.execute(
      {},
      { userPrompt: 'go', toolSource: 'site-tools', siteToolAllowlist: ['file_search'], maxIterations: 4 },
      makeCtx(),
    );

    // A refusal returns a tool message to the model (not a history entry, same
    // as the unknown-edge-tool path) and never invokes the handler.
    const convo = result.output.conversationHistory as any[];
    const toolMsg = convo.find((m) => m.role === 'tool' && /allowlist/i.test(String(m.content)));
    expect(toolMsg).toBeDefined();
    expect(registryTools.save_memory.handler).not.toHaveBeenCalled();
  });

  it('excludes destructive tools even when allowlisted', async () => {
    mockCreate.mockResolvedValueOnce(finalAnswer('done'));

    await llmAgentExecutor.execute(
      {},
      { userPrompt: 'go', toolSource: 'site-tools', siteToolAllowlist: ['whatsapp_send', 'file_search'], maxIterations: 4 },
      makeCtx(),
    );

    const offered = (mockCreate.mock.calls[0][0].tools as any[]).map((t) => t.function.name);
    expect(offered).toEqual(['file_search']); // whatsapp_send (destructive) dropped
  });

  it('errors when the allowlist is empty', async () => {
    await expect(
      llmAgentExecutor.execute(
        {},
        { userPrompt: 'go', toolSource: 'site-tools', siteToolAllowlist: [] },
        makeCtx(),
      ),
    ).rejects.toThrow(/non-empty/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('runAgentSubCall — cost capture', () => {
  it("re-attributes a sub-call's LLM cost to the parent (agent) rollup", async () => {
    const parentCtx = { workflowId: 'w', runId: 'r', nodeId: 'agent-1', llmCalls: [] as any[] };
    const out = await executionContext.run(parentCtx, () =>
      runAgentSubCall('sub', 60_000, new AbortController().signal, async () => {
        recordLLMCall({
          provider: 'zai',
          model: 'glm-4-flash',
          tokensInput: 10,
          tokensOutput: 20,
          cacheReadTokens: null,
          reasoningTokens: null,
          costUsd: 0.001,
          priceSnapshot: null,
        });
        return 'ok';
      }),
    );
    expect(out).toBe('ok');
    expect(parentCtx.llmCalls).toHaveLength(1);
    expect(parentCtx.llmCalls[0]).toMatchObject({ provider: 'zai', tokensInput: 10 });
  });
});
