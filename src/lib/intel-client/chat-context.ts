// A chat turn's intel context, from SR-Jkai-Core.
//
// Building it — recall over notes and entities, then grounding the entities a
// turn names — is Core's code over Core's rows, so Main asks rather than
// carrying a copy. Core already serves exactly this to its own chat:
//
//   POST /api/jkai/intel/chat-context
//   Authorization: Bearer <JKAI_INVOKE_TOKEN>
//   { userMessage: string, entityIds?: string[], principal?: string }
//   → 200 { knowledge: string, grounding: string, principal?: string }
//
// Core's gateway passes the path through without a session and the route checks
// the invoke token (either JKAI lane). A tokened call with no `principal`
// resolves to the OWNER's scope there. A member's turn names its `principal`
// (their `u_…` id): Core then answers from that member's scope — or with
// nothing, for an unknown or revoked member — and echoes the principal back.
//
// The echo is the guard. A Core from before `principal` existed ignores the
// field and answers as the owner; its reply carries no echo, so it is dropped.
// And a non-owner turn that cannot name its principal never makes the call.
//
// It is on a chat turn's critical path, and chat must never fail because Core is
// down: every failure returns empty context. The failure is logged once per
// outage, not once per turn, and the recovery says how many turns went without.
import { postToExtracted } from '$lib/server/extracted-app';
import { isOwnerScope, OWNER_INTEL_SCOPE, OWNER_SPACE, type IntelScope } from './scope';

export interface ChatContext {
  /** Recall over the graph for the message, as a labelled block. '' when nothing is relevant. */
  knowledge: string;
  /** Facts and relationships of the entities asked about. '' when none were. */
  grounding: string;
}

const EMPTY: ChatContext = Object.freeze({ knowledge: '', grounding: '' }) as ChatContext;

/** Long enough for an embedding call and two queries; short enough not to stall a reply. */
const TIMEOUT_MS = 5_000;

let failing = 0;

export async function chatContext(
  input: {
    userMessage: string;
    entityIds?: readonly string[];
    scope?: IntelScope;
    /** A member's turn: whose it is. Absent (or the owner's) = the owner's turn. */
    principal?: string | null;
  },
  opts: { timeoutMs?: number; port?: number } = {},
): Promise<ChatContext> {
  const principal = input.principal && input.principal !== OWNER_SPACE ? input.principal : null;
  // Core answers an unnamed tokened call from the owner's graph. Anyone else's
  // turn that cannot say whose it is gets nothing rather than the owner's.
  if (!principal && !isOwnerScope(input.scope ?? OWNER_INTEL_SCOPE)) return EMPTY;
  const userMessage = input.userMessage.trim();
  const entityIds = [...(input.entityIds ?? [])];
  if (!userMessage && entityIds.length === 0) return EMPTY;

  try {
    const res = await postToExtracted<Partial<ChatContext> & { principal?: unknown }>(
      'jkai-core',
      '/api/jkai/intel/chat-context',
      principal ? { userMessage, entityIds, principal } : { userMessage, entityIds },
      { timeoutMs: opts.timeoutMs ?? TIMEOUT_MS, port: opts.port },
    );
    if (failing) {
      console.log(`[intel-client] chat-context is back after ${failing} turn(s) without it`);
      failing = 0;
    }
    // No echo: a Core that ignored `principal` and answered as the owner.
    if (principal && res?.principal !== principal) return EMPTY;
    return {
      knowledge: typeof res?.knowledge === 'string' ? res.knowledge : '',
      grounding: typeof res?.grounding === 'string' ? res.grounding : '',
    };
  } catch (err) {
    if (failing === 0) {
      console.warn(
        '[intel-client] chat-context unavailable; answering without knowledge context:',
        err instanceof Error ? err.message : err,
      );
    }
    failing += 1;
    return EMPTY;
  }
}
