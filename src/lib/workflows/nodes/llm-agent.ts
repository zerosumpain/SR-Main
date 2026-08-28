import type {
  NodeExecutor,
  NodeResult,
  ExecutionContext,
  JsonSchema,
} from '../types';
import { interpolateTemplateStrict } from './template';
import { resolveLLMClient, resolveMaxTokens } from './llm-helpers';
import { isDenylistedTool } from './site-tool-denylist';
import { withNodeTimeout, nodeTimeoutMs } from '../engine-runtime';
import { executionContext, recordLLMCall, type LLMCallRecord } from '$lib/context/execution';

export { llmAgentDef } from './llm-agent.def';

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
 * Run one agent sub-call (a downstream node's executor, or a site-tool handler)
 * with (a) a per-sub-call hard timeout via `withNodeTimeout` and (b) LLM cost
 * capture: the sub-call runs inside a fresh `executionContext` store, and any
 * LLM calls it records are re-attributed to the AGENT node's rollup afterwards.
 * This mirrors how engine.ts wraps each node's `executor.execute`, so agent
 * sub-calls get the same timeout + telemetry treatment as top-level nodes.
 *
 * Exported for unit testing (verifies cost capture is invoked).
 */
export async function runAgentSubCall<T>(
  label: string,
  timeoutMs: number,
  parentSignal: AbortSignal,
  fn: () => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => {
    try { controller.abort(); } catch { /* noop */ }
  };
  if (parentSignal.aborted) controller.abort();
  else parentSignal.addEventListener('abort', onAbort, { once: true });

  const parent = executionContext.getStore();
  const subCalls: LLMCallRecord[] = [];
  const subCtx = {
    workflowId: parent?.workflowId ?? '',
    runId: parent?.runId ?? '',
    nodeId: label,
    llmCalls: subCalls,
  };

  try {
    return await withNodeTimeout(label, 'agent-subcall', timeoutMs, controller, () =>
      executionContext.run(subCtx, fn),
    );
  } finally {
    parentSignal.removeEventListener('abort', onAbort);
    // Re-attribute the sub-call's LLM cost to the agent node's rollup (no-op
    // when there is no parent context, e.g. a standalone unit test).
    for (const c of subCalls) recordLLMCall(c);
  }
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

/** Normalise the allowlist config into a clean string[] (array or CSV string). */
function parseAllowlist(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * Build the agent's tool set from the site-tool registry, restricted to the
 * allowlist. Destructive tools are NEVER exposed to an agent regardless of the
 * allowlist (an agent runs autonomously with no per-call approval), and the
 * hard denylist applies too. An empty allowlist is an error — an agent is never
 * given "all tools".
 */
async function discoverSiteTools(
  allowlist: string[],
): Promise<{ tools: ToolDef[]; allowed: Set<string> }> {
  if (allowlist.length === 0) {
    throw new Error(
      'llm-agent: toolSource "site-tools" requires a non-empty siteToolAllowlist. An agent is never granted all tools — list the exact tool names it may use.',
    );
  }
  const { getTool } = await import('$lib/workflows/site-tools/registry');
  const tools: ToolDef[] = [];
  const allowed = new Set<string>();
  const skipped: string[] = [];
  for (const name of allowlist) {
    if (isDenylistedTool(name)) { skipped.push(`${name} (denylisted)`); continue; }
    const tool = getTool(name);
    if (!tool) { skipped.push(`${name} (unknown)`); continue; }
    if (tool.destructive) { skipped.push(`${name} (destructive — never allowed in an agent)`); continue; }
    tools.push({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as JsonSchema,
      },
    });
    allowed.add(name);
  }
  if (tools.length === 0) {
    throw new Error(
      `llm-agent: none of the tools in siteToolAllowlist are usable — ${skipped.join('; ')}.`,
    );
  }
  return { tools, allowed };
}

/** Execute one allowlisted, non-destructive site tool and return its envelope. */
async function runSiteTool(
  name: string,
  args: Record<string, unknown>,
  allowed: Set<string>,
): Promise<unknown> {
  if (!allowed.has(name)) return { error: `Tool "${name}" is not in this agent's allowlist.` };
  if (isDenylistedTool(name)) return { error: `Tool "${name}" is denylisted and cannot be run.` };
  const { getTool } = await import('$lib/workflows/site-tools/registry');
  const tool = getTool(name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  if (tool.destructive) return { error: `Tool "${name}" is destructive and cannot be run by an agent.` };
  return await tool.handler(args);
}

export const llmAgentExecutor: NodeExecutor = {
  type: 'llm-agent',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const { result: systemPrompt, missingPaths: sysMissing } = interpolateTemplateStrict((config.systemPrompt as string) || '', input);
    const { result: userPrompt, missingPaths: userMissing } = interpolateTemplateStrict((config.userPrompt as string) || '', input);
    const missing = [...sysMissing, ...userMissing];
    if (missing.length > 0) {
      throw new Error(`Prompt template references unresolved: ${missing.join(', ')}. Check upstream node output.`);
    }
    const temperature = (config.temperature as number) ?? 0.7;
    const maxTokens = resolveMaxTokens(config.maxTokens);
    const maxIterations = (config.maxIterations as number) || 10;
    const maxTotalTokens = (config.maxTotalTokens as number) || 0;
    const timeoutMs = (config.timeoutMs as number) || 0;

    const agentNodeId = (context as any)._currentNodeId;
    const registry = (context as any)._registry;

    // Tool source: 'edges' (default) = downstream connected nodes as tools;
    // 'site-tools' = an allowlisted set of non-destructive registry tools.
    const toolSource = config.toolSource === 'site-tools' ? 'site-tools' : 'edges';
    let tools: ToolDef[] = [];
    let toolMap = new Map<string, ToolMapEntry>();
    let allowedSiteTools = new Set<string>();
    if (toolSource === 'site-tools') {
      const disc = await discoverSiteTools(parseAllowlist(config.siteToolAllowlist));
      tools = disc.tools;
      allowedSiteTools = disc.allowed;
    } else {
      const disc = discoverTools(agentNodeId, config, context);
      tools = disc.tools;
      toolMap = disc.toolMap;
    }

    const { client, model } = await resolveLLMClient(config.model as string | undefined);

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
        if (tc.type !== 'function') continue;
        const toolName = tc.function.name;
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }

        // Resolve target + per-sub-call timeout by tool source.
        const entry = toolSource === 'edges' ? toolMap.get(toolName) : undefined;
        if (toolSource === 'edges' && !entry) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
          });
          continue;
        }
        if (toolSource === 'site-tools' && !allowedSiteTools.has(toolName)) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ error: `Tool "${toolName}" is not in this agent's allowlist.` }),
          });
          continue;
        }

        const emitNodeId = entry?.targetNodeId ?? agentNodeId;
        const subTimeoutMs = entry ? nodeTimeoutMs(entry.nodeType) : nodeTimeoutMs('site-tool');
        const toolStart = Date.now();
        try {
          context.emit({
            type: 'node_started',
            runId: context.runId,
            nodeId: emitNodeId,
            data: { tool: toolName, input: args },
            timestamp: new Date().toISOString(),
          });

          const output = await runAgentSubCall(
            `agent-tool:${toolName}`,
            subTimeoutMs,
            context.abortSignal,
            async () => {
              if (toolSource === 'edges') {
                const executor = registry.getExecutor(entry!.nodeType);
                if (!executor) throw new Error(`No executor for type: ${entry!.nodeType}`);
                const r = await executor.execute(args, entry!.nodeConfig, context);
                return r.output;
              }
              return await runSiteTool(toolName, args, allowedSiteTools);
            },
          );
          const durationMs = Date.now() - toolStart;

          context.emit({
            type: 'node_completed',
            runId: context.runId,
            nodeId: emitNodeId,
            data: { tool: toolName, durationMs },
            timestamp: new Date().toISOString(),
          });

          toolCallHistory.push({ tool: toolName, input: args, output, durationMs });

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(output),
          });
        } catch (err: any) {
          const durationMs = Date.now() - toolStart;
          const errorMsg = err?.message || String(err);

          context.emit({
            type: 'node_failed',
            runId: context.runId,
            nodeId: emitNodeId,
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
        toolSource,
      },
      rowCount: 1,
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
