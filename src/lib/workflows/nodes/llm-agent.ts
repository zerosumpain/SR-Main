import type {
  NodeExecutor,
  NodeDefinition,
  NodeResult,
  ExecutionContext,
  JsonSchema,
} from '../types';
import { interpolateTemplate } from './template';
import { getOpenRouterClient } from '$lib/deepdive/keys';

interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: JsonSchema };
}

interface ToolMapEntry {
  targetNodeId: string;
  nodeType: string;
  nodeConfig: Record<string, unknown>;
}

interface ToolCallHistoryEntry {
  tool: string;
  input: unknown;
  output: unknown;
  durationMs: number;
}

function sanitizeToolName(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    || 'tool';
}

/**
 * Discover tools by inspecting outgoing edges from the agent node.
 * Returns OpenAI-format tool definitions and a map from tool name to target node info.
 */
export function discoverTools(
  agentNodeId: string,
  config: Record<string, unknown>,
  context: ExecutionContext,
): { tools: ToolDef[]; toolMap: Map<string, ToolMapEntry> } {
  const registry = (context as any)._registry;
  const edges = context.getOutgoingEdges(agentNodeId);
  const tools: ToolDef[] = [];
  const toolMap = new Map<string, ToolMapEntry>();

  let overrides: Record<string, { name?: string; description?: string }> = {};
  if (config.toolOverrides) {
    try {
      overrides =
        typeof config.toolOverrides === 'string'
          ? JSON.parse(config.toolOverrides)
          : (config.toolOverrides as typeof overrides);
    } catch {
      // ignore invalid JSON
    }
  }

  for (const edge of edges) {
    // Skip the normal output handle — those are for post-agent flow
    if (edge.sourceHandle === 'output') continue;

    const nodeInfo = context.getNodeConfig(edge.targetNodeId);
    if (!nodeInfo) continue;

    const definition = registry?.getDefinition?.(nodeInfo.type);
    const executor = registry?.getExecutor?.(nodeInfo.type);

    const override = overrides[edge.targetNodeId];
    const toolName = override?.name || sanitizeToolName(nodeInfo.label);
    const toolDescription =
      override?.description || definition?.description || `Execute ${nodeInfo.label}`;

    let parameters: JsonSchema = { type: 'object' };
    if (executor?.getInputSchema) {
      parameters = executor.getInputSchema(nodeInfo.config);
    } else if (definition?.configSchema) {
      parameters = definition.configSchema;
    }

    tools.push({
      type: 'function',
      function: {
        name: toolName,
        description: toolDescription,
        parameters,
      },
    });

    toolMap.set(toolName, {
      targetNodeId: edge.targetNodeId,
      nodeType: nodeInfo.type,
      nodeConfig: nodeInfo.config,
    });
  }

  return { tools, toolMap };
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
    const maxTokens = (config.maxTokens as number) ?? 2048;
    const maxIterations = (config.maxIterations as number) || 10;
    const maxTotalTokens = (config.maxTotalTokens as number) || 0;
    const timeoutMs = (config.timeoutMs as number) || 0;

    const agentNodeId = (context as any)._currentNodeId;
    const registry = (context as any)._registry;
    const { tools, toolMap } = discoverTools(agentNodeId, config, context);

    const client = getOpenRouterClient();

    const messages: any[] = [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: userPrompt },
    ];

    const toolCallHistory: ToolCallHistoryEntry[] = [];
    let tokensUsed = { prompt: 0, completion: 0, total: 0 };
    let stopReason: string = 'complete';
    let iterationCount = 0;
    const startTime = Date.now();

    for (let i = 0; i < maxIterations; i++) {
      iterationCount = i + 1;

      // Check timeout
      if (timeoutMs > 0 && Date.now() - startTime > timeoutMs) {
        stopReason = 'timeout';
        break;
      }

      // Check token budget
      if (maxTotalTokens > 0 && tokensUsed.total >= maxTotalTokens) {
        stopReason = 'max_tokens';
        break;
      }

      const response = await client.chat.completions.create({
        model,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
        temperature,
        max_tokens: maxTokens,
      });

      const usage = response.usage;
      tokensUsed.prompt += usage?.prompt_tokens ?? 0;
      tokensUsed.completion += usage?.completion_tokens ?? 0;
      tokensUsed.total = tokensUsed.prompt + tokensUsed.completion;

      // Check token budget after this call
      if (maxTotalTokens > 0 && tokensUsed.total >= maxTotalTokens) {
        // Still capture the response before stopping
        const msg = response.choices[0]?.message;
        if (msg) messages.push(msg);
        stopReason = 'max_tokens';
        break;
      }

      const choice = response.choices[0]?.message;
      if (!choice) break;

      messages.push(choice);

      const toolCalls = choice.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        // LLM is done — no tool calls
        stopReason = 'complete';
        break;
      }

      // Execute each tool call
      for (const tc of toolCalls) {
        const toolName = tc.function.name;
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }

        const entry = toolMap.get(toolName);
        if (!entry) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
          });
          continue;
        }

        const toolStart = Date.now();
        try {
          const executor = registry.getExecutor(entry.nodeType);
          if (!executor) throw new Error(`No executor for type: ${entry.nodeType}`);

          context.emit({
            type: 'node_started',
            runId: context.runId,
            nodeId: entry.targetNodeId,
            data: { tool: toolName, input: args },
            timestamp: new Date().toISOString(),
          });

          const toolResult = await executor.execute(args, entry.nodeConfig, context);
          const durationMs = Date.now() - toolStart;

          context.emit({
            type: 'node_completed',
            runId: context.runId,
            nodeId: entry.targetNodeId,
            data: { tool: toolName, durationMs },
            timestamp: new Date().toISOString(),
          });

          toolCallHistory.push({
            tool: toolName,
            input: args,
            output: toolResult.output,
            durationMs,
          });

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult.output),
          });
        } catch (err: any) {
          const durationMs = Date.now() - toolStart;
          const errorMsg = err?.message || String(err);

          context.emit({
            type: 'node_failed',
            runId: context.runId,
            nodeId: entry.targetNodeId,
            data: { tool: toolName, error: errorMsg },
            timestamp: new Date().toISOString(),
          });

          toolCallHistory.push({
            tool: toolName,
            input: args,
            output: { error: errorMsg },
            durationMs,
          });

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ error: errorMsg }),
          });
        }
      }

      // If this was the last iteration, set stop reason
      if (i === maxIterations - 1) {
        stopReason = 'max_iterations';
      }
    }

    // Extract final response text from the last assistant message
    let response = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && typeof messages[i].content === 'string') {
        response = messages[i].content;
        break;
      }
    }

    return {
      output: {
        response,
        toolCallHistory,
        iterationCount,
        stopReason,
        tokensUsed,
        conversationHistory: messages,
      },
      metadata: {
        _selectedHandle: 'output',
        model,
        iterationCount,
        stopReason,
        tokensUsed,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Available for template interpolation in prompts' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        response: { type: 'string', description: 'Final LLM response text' },
        toolCallHistory: {
          type: 'array',
          description: 'History of tool calls made by the agent',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              input: { type: 'object' },
              output: { type: 'object' },
              durationMs: { type: 'number' },
            },
          },
        },
        iterationCount: { type: 'number', description: 'Number of LLM call iterations' },
        stopReason: { type: 'string', description: 'complete | max_iterations | max_tokens | timeout' },
        tokensUsed: {
          type: 'object',
          properties: {
            prompt: { type: 'number' },
            completion: { type: 'number' },
            total: { type: 'number' },
          },
        },
        conversationHistory: { type: 'array', description: 'Full message array' },
      },
    };
  },
};

export const llmAgentDef: NodeDefinition = {
  type: 'llm-agent',
  label: 'LLM Agent',
  category: 'agentic',
  description:
    'Multi-turn LLM agent that can use connected downstream nodes as tools. Loops until the LLM responds without tool calls, or hits iteration/token/timeout limits.',
  configSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'OpenRouter model ID (default: openai/gpt-4o)' },
      systemPrompt: {
        type: 'string',
        description: 'System prompt. Supports {{input.field}} templates.',
      },
      userPrompt: {
        type: 'string',
        description: 'User prompt. Supports {{input.field}} templates.',
      },
      temperature: { type: 'number', description: 'Sampling temperature 0-2 (default 0.7)' },
      maxTokens: { type: 'number', description: 'Max tokens per LLM call (default 2048)' },
      maxIterations: {
        type: 'number',
        description: 'Max tool-use loop iterations (default 10)',
      },
      maxTotalTokens: {
        type: 'number',
        description: 'Total token budget across all iterations (0 = unlimited)',
      },
      timeoutMs: {
        type: 'number',
        description: 'Timeout in milliseconds (0 = disabled)',
      },
      toolOverrides: {
        type: 'string',
        description:
          'JSON object mapping node IDs to { name?, description? } overrides for tool definitions',
      },
    },
    required: ['userPrompt'],
  },
  defaultConfig: {
    model: 'openai/gpt-4o',
    systemPrompt: '',
    userPrompt: '',
    temperature: 0.7,
    maxTokens: 2048,
    maxIterations: 10,
    maxTotalTokens: 0,
    timeoutMs: 0,
    toolOverrides: '{}',
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Agent Result' }],
  basicConfig: [
    {
      key: 'userPrompt',
      label: 'User Prompt',
      type: 'template-textarea',
      placeholder: '{{input.query}}',
      description: 'The main instruction for the agent. Use {{input.field}} to reference incoming data.',
    },
    {
      key: 'systemPrompt',
      label: 'System Prompt',
      type: 'template-textarea',
      placeholder: 'You are a helpful assistant...',
      description: 'Sets the agent\'s role and behaviour. Supports {{input.field}} templates.',
    },
    {
      key: 'model',
      label: 'Model',
      type: 'dropdown',
      description: 'Which LLM runs this step',
      options: [
        { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
        { value: 'openai/gpt-4o', label: 'GPT-4o (balanced)' },
        { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (smart)' },
        { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku 4 (very fast)' },
        { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      ],
    },
    {
      key: 'temperature',
      label: 'Temperature',
      type: 'slider',
      min: 0,
      max: 2,
      step: 0.1,
      description: 'Lower = more focused, higher = more creative',
    },
    {
      key: 'maxTokens',
      label: 'Max Tokens',
      type: 'number',
      advancedOnly: true,
      section: 'ADVANCED',
      description: 'Maximum length of each LLM response',
    },
    {
      key: 'maxIterations',
      label: 'Max Iterations',
      type: 'number',
      advancedOnly: true,
      section: 'ADVANCED',
      description: 'Max tool-use loop iterations',
    },
    {
      key: 'maxTotalTokens',
      label: 'Max Total Tokens',
      type: 'number',
      advancedOnly: true,
      section: 'ADVANCED',
      description: 'Total token budget across all iterations (0 = unlimited)',
    },
    {
      key: 'timeoutMs',
      label: 'Timeout (ms)',
      type: 'number',
      advancedOnly: true,
      section: 'ADVANCED',
      description: 'Max execution time in milliseconds (0 = disabled)',
    },
    {
      key: 'toolOverrides',
      label: 'Tool Overrides',
      type: 'textarea',
      advancedOnly: true,
      section: 'ADVANCED',
      description:
        'JSON object mapping node IDs to { name?, description? } to override tool definitions.',
    },
  ],
  llmDescription:
    'Use when the task requires multi-step reasoning with tool use. The agent can call connected nodes as tools in a loop until it has the answer. Best for complex tasks that need planning, research, or iterative refinement.',
  llmExamples: [
    {
      model: 'openai/gpt-4o',
      systemPrompt: 'You are a research assistant. Use the available tools to answer questions.',
      userPrompt: '{{input.question}}',
      maxIterations: 5,
    },
  ],
};
