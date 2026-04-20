import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { resolveLLMClient } from './llm-helpers';

/**
 * Chat node.
 *
 * - If the node has outgoing edges, it behaves as a trigger: passes
 *   the initialInput (typically `{ message: string }`) to downstream
 *   nodes untouched.
 * - If it has no outgoing edges (terminal), it calls an LLM directly
 *   with the node's configured model + system prompt and emits the
 *   reply, so a lone chat node is a usable standalone chatbot.
 *
 * Per-node chat history lives in `orchestrator_chats` keyed by
 * `metadata.chatNodeId = this node's id`.
 */
export const chatExecutor: NodeExecutor = {
  type: 'chat',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const message = typeof input.message === 'string' ? (input.message as string) : '';
    const thisNodeId = (context as unknown as { _currentNodeId?: string })._currentNodeId;
    const outgoing = thisNodeId ? context.getOutgoingEdges(thisNodeId) : [];

    // With downstream wiring the chat is just a trigger.
    if (outgoing.length > 0) {
      return { output: { ...input } };
    }

    // Standalone chat → call the LLM directly.
    if (!message) {
      return { output: { ...input, response: '', reply: '' } };
    }

    const { client, model } = await resolveLLMClient(config.model as string | undefined);
    const systemPrompt =
      typeof config.systemPrompt === 'string' && config.systemPrompt.trim()
        ? (config.systemPrompt as string)
        : 'You are a helpful AI assistant. Keep replies concise unless asked otherwise.';
    const temperature = typeof config.temperature === 'number' ? config.temperature : 0.7;
    const maxTokens = typeof config.maxTokens === 'number' ? config.maxTokens : 1024;

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature,
      max_tokens: maxTokens,
    });

    const reply = response.choices[0]?.message?.content ?? '';
    return {
      output: {
        ...input,
        response: reply,
        reply,
      },
      metadata: {
        model,
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  },

  getInputSchema() {
    return {
      type: 'object',
      description: 'The user message provided as initialInput (or from an upstream node).',
    };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description:
        'Passes through the input. When standalone (no outgoing edges), also sets `response`/`reply` from the LLM call.',
    };
  },
};

export const chatDef: NodeDefinition = {
  type: 'chat',
  label: 'Chat',
  category: 'trigger',
  description:
    'Canvas chat panel with its own history. Acts as a trigger when wired downstream, or as a standalone LLM chatbot when terminal.',
  configSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'LLM model ID (empty = site default).' },
      systemPrompt: { type: 'string', description: 'System prompt used in standalone mode.' },
      temperature: { type: 'number', description: 'Sampling temperature 0–2.' },
      maxTokens: { type: 'number', description: 'Max tokens to generate.' },
    },
  },
  defaultConfig: {
    model: '',
    systemPrompt: 'You are a helpful AI assistant. Keep replies concise unless asked otherwise.',
    temperature: 0.7,
    maxTokens: 1024,
  },
  inputs: [],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [
    {
      key: 'model',
      label: 'Model',
      type: 'dropdown',
      description: 'LLM model (leave empty for the site default).',
      options: [{ value: '', label: 'Default (site setting)' }],
      section: 'LLM',
    },
    {
      key: 'systemPrompt',
      label: 'System prompt',
      type: 'template-textarea',
      description: 'Role / style instructions used when this chat is standalone.',
      placeholder: 'You are a helpful AI assistant.',
      section: 'LLM',
    },
  ],
};
