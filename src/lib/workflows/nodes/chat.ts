import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { HermesClient } from '$lib/jkai/hermes-client';
import { recordLLMCall } from '../execution-context';
import { env } from '$env/dynamic/private';

/** Per-turn LLM usage the Hermes jkai_platform adapter attaches to the
 *  synthetic `finalize` frame's `metadata.usage`. The LLM call happens inside
 *  the Hermes sidecar process, so this frame is the only channel through which
 *  chat-node cost can reach SvelteKit. */
interface HermesTurnUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cost_usd?: number;
  model?: string | null;
  provider?: string | null;
}

/**
 * Chat node.
 *
 * Behaviour is driven by wiring:
 *
 *  - Unwired (no incoming AND no outgoing edges): the node is playing the
 *    role of an orchestrator chat panel on the canvas — it doesn't take
 *    part in execution. The engine still reaches it because the chat node
 *    is registered as a trigger, but we no-op out fast.
 *
 *  - Wired (any edges): the node is a workflow step backed by Hermes.
 *    We send the inbound message text to Hermes (kind=manual → jkai-general
 *    skill), drain the SSE stream into a single response string, and return
 *    `{ ...input, response, reply }` so downstream nodes can `{{input.response}}`.
 *      • Trigger mode (outgoing > 0, incoming = 0): the user types in the
 *        canvas panel; `/api/workflows/[id]/chat` boots a run with
 *        `{ message, _chatNodeId, _conversationId }` and the message is the
 *        prompt.
 *      • Receiver / middle (incoming > 0): the upstream output is the prompt
 *        (we serialise whatever shape it has into text). When outgoing > 0
 *        the response flows downstream; either way the live stream surfaces
 *        in the chat panel via `chat_stream` log events.
 */

const HERMES_URL = env.HERMES_PLATFORM_URL ?? 'http://127.0.0.1:18790';
const HERMES_SECRET = env.HERMES_BRIDGE_SECRET ?? '';
const HERMES_ORIGIN = (env.JKAI_HERMES_ORIGIN as 'vps' | 'homeserv') ?? 'homeserv';
const HERMES_MCP_URL = env.JKAI_HERMES_MCP_URL ?? 'http://127.0.0.1:5173/api/mcp/local';

const HERMES_HOME_CHANNEL_NOTICE_PREFIX = '📬 No home channel is set for Jkai';

/** Pull a sensible prompt string out of the inbound input. Trigger-mode
 * runs put the user text on `message`; receiver / middle runs get whatever
 * the upstream node returned — usually `{ response }` for another chat /
 * llm-call, or arbitrary fields for transforms / scrapers. Falls back to
 * a pretty-printed JSON dump so the LLM at least sees the payload. */
function extractPrompt(input: Record<string, unknown>): string {
  if (typeof input.message === 'string' && input.message.trim()) return input.message.trim();
  if (typeof input.response === 'string' && input.response.trim()) return input.response.trim();
  if (typeof input.text === 'string' && input.text.trim()) return input.text.trim();
  // Drop the internal threading keys before serialising.
  const { _chatNodeId, _conversationId, ...rest } = input;
  void _chatNodeId; void _conversationId;
  if (Object.keys(rest).length === 0) return '';
  try {
    return JSON.stringify(rest, null, 2);
  } catch {
    return String(rest);
  }
}

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

    if (!HERMES_SECRET) {
      throw new Error('HERMES_BRIDGE_SECRET not configured — wired chat nodes need Hermes');
    }

    const prompt = extractPrompt(input);
    if (!prompt) {
      return { output: { ...input, response: '', reply: '' }, rowCount: 1 };
    }

    const conversationId =
      typeof input._conversationId === 'string' ? (input._conversationId as string) : null;
    const chatNodeId = thisNodeId ?? null;

    // Stream tokens / tool steps back to the canvas via the run SSE so the
    // chat panel can render the typing animation + tool trace identically
    // to the legacy `generalChat` path.
    const streamLog = (kind: string, data: Record<string, unknown>) => {
      context.emit({
        type: 'log',
        runId: context.runId,
        nodeId: chatNodeId ?? undefined,
        data: { kind, chatNodeId, ...data },
        timestamp: new Date().toISOString(),
      });
    };

    const client = new HermesClient({
      baseUrl: HERMES_URL,
      bridgeSecret: HERMES_SECRET,
      defaultOrigin: HERMES_ORIGIN,
      defaultMcpUrl: HERMES_MCP_URL,
    });

    // chatId names the conversational scope inside Hermes. Wired chat
    // nodes are persistent panels on a canvas, so we want a per-(workflow,
    // chatNode) chat id — that way history compounds across runs of the
    // same panel. Fall back to per-run when the chat node id is missing.
    const chatId = chatNodeId
      ? `wf_chat_${context.workflowId}_${chatNodeId}`
      : `wf_run_${context.runId}`;
    const sessionId = conversationId
      ? `sess_${conversationId}_${chatId}`
      : `sess_run_${context.runId}`;
    const kindId = chatId;

    let response = '';
    let turnUsage: HermesTurnUsage | null = null;

    await client.sendMessage({
      chatId,
      text: prompt,
      kind: 'manual',
      kindId,
      sessionId,
    });

    for await (const frame of client.openStream({ chatId, kind: 'manual', kindId, sessionId })) {
      if (context.abortSignal.aborted) break;
      if (
        (frame.kind === 'send' || frame.kind === 'replace') &&
        frame.content.startsWith(HERMES_HOME_CHANNEL_NOTICE_PREFIX)
      ) {
        continue;
      }
      if (frame.kind === 'send') {
        response += frame.content;
        streamLog('chat_stream', { event: { type: 'token', delta: frame.content } });
      } else if (frame.kind === 'replace') {
        // Replace semantics: the new content supersedes whatever we'd
        // accumulated for the in-flight bubble. Emit it as the full new
        // body and reset the accumulator so the eventual return matches.
        response = frame.content;
        streamLog('chat_stream', { event: { type: 'replace_bubble', content: frame.content } });
      } else if (frame.kind === 'finalize') {
        // adapter emits a synthetic empty finalize once handle_message
        // completes — `response` already holds the streamed text. The
        // finalize frame also carries this turn's LLM usage under
        // `metadata.usage` (the Hermes-side call is out-of-process, so this
        // is the only channel for chat-node cost).
        const u = (frame.metadata as { usage?: HermesTurnUsage } | undefined)?.usage;
        if (u && typeof u === 'object') turnUsage = u;
        break;
      }
    }

    // Record the Hermes turn's cost into the execution context so the engine
    // rolls it up into node_executions cost columns. recordLLMCall is a no-op
    // outside an engine-managed node; chat.ts always runs inside one.
    if (turnUsage) {
      recordLLMCall({
        provider: turnUsage.provider ?? 'hermes',
        model: turnUsage.model ?? 'unknown',
        tokensInput: turnUsage.input_tokens ?? null,
        tokensOutput: turnUsage.output_tokens ?? null,
        cacheReadTokens: turnUsage.cache_read_tokens ?? null,
        reasoningTokens: null,
        // Hermes computes its own estimated cost; we pass it through verbatim
        // rather than re-deriving from the price table.
        costUsd: typeof turnUsage.cost_usd === 'number' ? turnUsage.cost_usd : null,
        priceSnapshot: null,
      });
    }

    return {
      output: { ...input, response, reply: response },
      metadata: { hermes: true, kind: 'manual', chatId },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return {
      type: 'object',
      description:
        'Reads `message` (trigger mode), `response` (receiver from another chat / llm), or falls back to the full upstream payload. `_conversationId` is threaded in by the canvas /chat endpoint.',
    };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description:
        'Wired: returns the LLM reply on `response` and `reply`; downstream nodes use `{{input.response}}`. Unwired: returns `{ skipped: true }` and rowCount 0.',
    };
  },
};

export const chatDef: NodeDefinition = {
  type: 'chat',
  label: 'Chat',
  category: 'trigger',
  description:
    'Conversational chat node. Unwired → acts as the canvas orchestrator panel (no role in execution). Wired → backed by Hermes (jkai-general). Trigger mode: user typing flows downstream as the LLM reply. Receiver mode: upstream output is the prompt; the reply is shown in the panel.',
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
};
