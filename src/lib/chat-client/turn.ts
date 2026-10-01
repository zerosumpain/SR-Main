// One chat turn, run by SR-Jkai-Core.
//
// Chat is Core's code: the engine, the prompt, the tool loop, the memory stamp.
// Main kept a second copy because three things here still start turns of their
// own — the WhatsApp bridge, the follow-up queue and agent delegation — and the
// copy had drifted from Core's (member grounding, gate alerts, retired nodes).
// They ask Core now:
//
//   POST /api/jkai/service/turn
//   Authorization: Bearer <JKAI_INVOKE_TOKEN>
//   { input: { text, attachmentIds? }, history: [{ role, content, createdAt, attachmentIds? }], options }
//   → 200 { response, memory }
//
// Core's gateway passes the path through without a session and the route checks
// the invoke token, as it does for chat-context. The turn is owner-grade: Core
// refuses it on a member's thread, exactly as the in-process engine did, because
// none of these callers sends a restriction and Core would not trust one from a
// caller anyway. Destructive tools stay refused too — there is no job, so no one
// is attached to confirm them (MCP_CONFIRM_UNATTENDED, default deny).
//
// Unlike chat-context this IS the reply, so a failure throws: each caller already
// has its own answer for a turn that failed.
import { postToExtracted } from '$lib/server/extracted-app';
import type { JkaiAttachment } from '$lib/db/schema';
import type { ModelContext, PriceSnapshot } from '$lib/server/models/types';
import type { ThinkingLevel } from '$lib/models/thinking';
import type { MemoryTurnStamp } from '$lib/jkai/memory/contracts';

/**
 * A history message as the callers hold it. Declared here rather than imported
 * from the chat engine, which this client exists to stop depending on.
 */
export interface TurnHistoryMessage {
  role: string;
  content: string;
  createdAt: Date;
  attachments?: readonly Pick<JkaiAttachment, 'id'>[];
  evidence?: unknown;
}

/**
 * How a message travels: ISO dates (JSON has no Date) and attachment IDS only.
 * An attachment row carries the disk path the engine reads, so Core loads the
 * rows itself, from the thread's own conversation, and never takes one from here.
 */
function toWire(m: TurnHistoryMessage) {
  const attachmentIds = (m.attachments ?? []).map((a) => a.id);
  return {
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    ...(attachmentIds.length ? { attachmentIds } : {}),
    ...(m.evidence !== undefined ? { evidence: m.evidence } : {}),
  };
}

export interface RemoteTurnOptions {
  conversationId?: string | null;
  modelContext: ModelContext;
  sessionModel?: ModelContext | null;
  thinkingLevel?: ThinkingLevel | null;
  priceSnapshot: PriceSnapshot | null;
  subagentDepth?: number;
  personaPrompt?: string;
  toolWhitelist?: string[];
  maxRounds?: number;
  useIntelContext?: boolean;
  origin?: 'followup';
  /** Cost-attribution tag Core wraps the turn in, e.g. 'delegation'. */
  activity?: string;
}

export interface RemoteTurn {
  response: string;
  /** Core's memory stamp for the turn, stored on the assistant row as-is. */
  memory: MemoryTurnStamp | null;
}

/** A turn can run tools for minutes — `workflow_run` alone may wait 600s. */
const TIMEOUT_MS = 15 * 60_000;

export async function chatTurn(
  input: { text: string; attachments?: readonly Pick<JkaiAttachment, 'id'>[] },
  history: readonly TurnHistoryMessage[],
  options: RemoteTurnOptions,
  opts: { timeoutMs?: number; port?: number } = {},
): Promise<RemoteTurn> {
  const attachmentIds = (input.attachments ?? []).map((a) => a.id);
  const res = await postToExtracted<{ response?: unknown; memory?: unknown }>(
    'jkai-core',
    '/api/jkai/service/turn',
    { input: { text: input.text, ...(attachmentIds.length ? { attachmentIds } : {}) }, history: history.map(toWire), options },
    { timeoutMs: opts.timeoutMs ?? TIMEOUT_MS, port: opts.port },
  );
  if (typeof res?.response !== 'string') throw new Error('chat turn: Core returned no response');
  return { response: res.response, memory: (res.memory as MemoryTurnStamp | null) ?? null };
}
