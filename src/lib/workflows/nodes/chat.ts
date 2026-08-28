import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

/**
 * Chat node.
 *
 * Behaviour is driven by wiring:
 *
 *  - Unwired (no incoming AND no outgoing edges): the node is playing the
 *    role of an orchestrator chat panel on the canvas — it doesn't take
 *    part in execution. The engine still reaches it because the chat node
 *    is registered as a trigger, but we no-op out fast. This is what every
 *    chat node in production actually is.
 *
 *  - Wired (any edges): unsupported. The wired path was backed by an external
 *    agent gateway that is now retired; it never ran in production (no chat
 *    node has ever had an edge). It refuses loudly rather than returning an empty
 *    `response` that a downstream node would treat as a real answer.
 *    Use `llm-call` for a prompt→completion step.
 */
export const chatExecutor: NodeExecutor = {
  type: 'chat',

  async execute(
    input: Record<string, unknown>,
    _config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const thisNodeId = (context as unknown as { _currentNodeId?: string })._currentNodeId;
    const outgoing = thisNodeId ? context.getOutgoingEdges(thisNodeId) : [];
    const incoming = thisNodeId ? context.getIncomingEdges(thisNodeId) : [];

    // Unwired: the node is the orchestrator panel only. Don't run.
    if (outgoing.length === 0 && incoming.length === 0) {
      return {
        output: { ...input, skipped: true, reason: 'unwired chat node' },
        metadata: { skipped: true },
        rowCount: 0,
      };
    }

    throw new Error(
      'A wired chat node has no engine behind it. Use an llm-call node for a prompt→completion step, or remove the edges to keep this as a canvas chat panel.',
    );
  },

  getInputSchema() {
    return {
      type: 'object',
      description:
        'Unwired only. `_conversationId` is threaded in by the canvas /chat endpoint.',
    };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description: 'Unwired: returns `{ skipped: true }` and rowCount 0. Wired: throws.',
    };
  },
};

export const chatDef: NodeDefinition = {
  type: 'chat',
  label: 'Chat',
  category: 'trigger',
  description:
    'Conversational chat node. Unwired → acts as the canvas orchestrator panel (no role in execution). Wiring it is not supported — use `llm-call` for a prompt→completion step.',
  configSchema: {
    type: 'object',
    properties: {
      conversationId: {
        type: 'string',
        description:
          'Optional: pin an existing /jkai conversation to this chat node so the canvas thread "follows" the user from chat onto the canvas. Set by `pinConversationToCanvasChat` and `workflow_build_from_spec`.',
      },
    },
  },
  defaultConfig: {},
  inputs: [],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [],
  llmDescription: `The canvas orchestrator chat panel. Leave it unwired — it takes no part in execution. Wiring it throws: use \`llm-call\` for a plain stateless prompt→completion step.`,
  llmExamples: [{}],
};
