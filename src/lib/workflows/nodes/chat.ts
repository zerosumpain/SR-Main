import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { generalChat } from '$lib/workflows/chat/general-chat';
import { loadConversationHistory } from '$lib/workflows/chat/conversation-history';
import { resolveDefaultModel } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Chat node.
 *
 * Two modes, chosen by topology:
 *
 *  - Wired downstream (outgoing edges > 0): acts as a trigger, passing
 *    the initialInput ({ message, _chatNodeId, _conversationId }) through
 *    to downstream nodes untouched. The downstream chain runs
 *    deterministically; the LLM work happens there.
 *
 *  - Terminal (no outgoing edges): runs the full jkai general-chat loop
 *    via `generalChat()`. Dynamic system prompt assembly, memory, intel
 *    context, and tool calling are all included, so a lone chat node is
 *    equivalent to a conversation on `/jkai`.
 *
 * Per-node chat history lives in a dedicated `jkai_conversations` row
 * (id stored in `node.config.conversationId`, created by the /chat
 * endpoint on first send).
 */
export const chatExecutor: NodeExecutor = {
  type: 'chat',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const thisNodeId = (context as unknown as { _currentNodeId?: string })._currentNodeId;
    const outgoing = thisNodeId ? context.getOutgoingEdges(thisNodeId) : [];

    // Passthrough trigger mode.
    if (outgoing.length > 0) {
      return { output: { ...input }, rowCount: 1 };
    }

    const message =
      typeof input.message === 'string' ? (input.message as string).trim() : '';
    if (!message) {
      return { output: { ...input, response: '', reply: '' }, rowCount: 1 };
    }

    // The /api/workflows/[id]/chat endpoint guarantees a conversationId
    // is set on the chat node's config before kicking off the run and
    // threads it through initialInput as _conversationId.
    const conversationId =
      typeof input._conversationId === 'string' ? (input._conversationId as string) : null;

    // Resolve the model to use: conversation-pinned first, then node
    // config override, then admin default.
    let modelContext: ModelContext = await resolveDefaultModel('chat');
    if (conversationId) {
      try {
        const [conv] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, conversationId))
          .limit(1);
        if (conv) {
          modelContext = {
            provider: conv.modelProvider as 'zai' | 'openrouter',
            modelId: conv.modelId,
          };
        }
      } catch {
        /* fall back to admin default */
      }
    }
    const configModel =
      typeof config.model === 'string' && config.model.trim() ? (config.model as string) : '';
    if (configModel) {
      if (configModel.includes('/')) {
        modelContext = { provider: 'openrouter', modelId: configModel };
      } else {
        modelContext = { provider: modelContext.provider, modelId: configModel };
      }
    }

    // Load prior turns. The user message for THIS turn has already been
    // persisted by the /chat endpoint, so we drop it from the history we
    // feed to generalChat (otherwise generalChat would see it as prior
    // context and also include its own current-turn user message).
    let history = conversationId ? await loadConversationHistory(conversationId) : [];
    if (history.length > 0) {
      const last = history[history.length - 1];
      if (last.role === 'user' && last.content.trim() === message) {
        history = history.slice(0, -1);
      }
    }

    const useIntelContext = config.useIntelContext !== false;

    const upstreamIntel =
      typeof input.intelContext === 'string' && input.intelContext.length > 0
        ? (input.intelContext as string)
        : null;

    // Surface live tokens + tool progress to the SSE stream so the
    // canvas chat panel can render them as they arrive.
    const chatNodeId = thisNodeId ?? null;
    const streamLog = (kind: string, data: Record<string, unknown>) => {
      context.emit({
        type: 'log',
        runId: context.runId,
        nodeId: chatNodeId ?? undefined,
        data: { kind, chatNodeId, ...data },
        timestamp: new Date().toISOString(),
      });
    };

    const { response } = await generalChat(
      { text: message, attachments: [] },
      history,
      {
        workflowId: context.workflowId,
        conversationId,
        modelContext,
        priceSnapshot: null,
        useIntelContext,
        intelContextOverride: upstreamIntel,
        onStreamEvent: (event) => {
          streamLog('chat_stream', { event });
        },
        onToolProgress: (step) => {
          streamLog('chat_tool', { step });
        },
      },
    );

    return {
      output: {
        ...input,
        response,
        reply: response,
      },
      metadata: {
        model: modelContext.modelId,
        provider: modelContext.provider,
      },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return {
      type: 'object',
      description:
        'Expects `message` (user text). `_conversationId` is threaded in by the canvas /chat endpoint.',
    };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description:
        'Passes input through. When terminal, also sets `response`/`reply` from the generalChat loop.',
    };
  },
};

export const chatDef: NodeDefinition = {
  type: 'chat',
  label: 'Chat',
  category: 'trigger',
  description:
    'Canvas chat panel. Standalone uses the full jkai chat loop (dynamic prompt, memory, intel context, tool calling). Wired downstream, acts as a workflow trigger.',
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        description:
          'LLM model ID (empty = conversation-pinned / admin default). Slashed IDs route via OpenRouter.',
      },
      useIntelContext: {
        type: 'boolean',
        description:
          'When false, skip injecting the intel knowledge graph into the system prompt (default true).',
      },
      conversationId: {
        type: 'string',
        description:
          'Optional: pin an existing /jkai conversation to this chat node so the canvas thread "follows" the user from chat onto the canvas. The canvas adapter pulls orchestrator_chats rows for this id alongside the workflow-tagged rows. Written by `pinConversationToCanvasChat` (on `?conv=` deep-links) and by `workflow_build_from_spec` (when the build was kicked off from a chat).',
      },
    },
  },
  defaultConfig: {
    model: '',
    useIntelContext: true,
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
  ],
};
