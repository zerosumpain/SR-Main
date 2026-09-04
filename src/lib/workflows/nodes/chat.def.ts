import type { NodeDefinition } from '../types';

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
