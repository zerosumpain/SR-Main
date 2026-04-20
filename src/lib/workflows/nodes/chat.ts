import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

/**
 * Chat node — a trigger-style node that fronts a message/history for the
 * canvas UI. At execution time it simply passes the run's initialInput
 * through (message + _chatNodeId marker). Per-node chat history lives in
 * orchestrator_chats keyed by metadata.chatNodeId = this node's id.
 */
export const chatExecutor: NodeExecutor = {
  type: 'chat',

  async execute(
    input: Record<string, unknown>,
    _config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    return { output: { ...input } };
  },

  getInputSchema() {
    return { type: 'object', description: 'No input — the chat node is a trigger.' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description: 'Emits the initialInput (typically { message: string }).',
    };
  },
};

export const chatDef: NodeDefinition = {
  type: 'chat',
  label: 'Chat',
  category: 'trigger',
  description:
    'Canvas chat node. Presents a composer + message history in the UI and triggers the workflow when the user sends.',
  configSchema: { type: 'object', properties: {} },
  defaultConfig: {},
  inputs: [],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [],
};
