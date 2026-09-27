// A chat turn's intel context, from SR-Jkai-Core.
//
// Building it — recall over notes and entities, then grounding the entities a
// turn names — is Core's code over Core's rows, so Main asks rather than
// carrying a copy. Core already serves exactly this to its own chat:
//
//   POST /api/jkai/intel/chat-context
//   Authorization: Bearer <JKAI_INVOKE_TOKEN>
//   { userMessage: string, entityIds?: string[] }
//   → 200 { knowledge: string, grounding: string }
//
// Core's gateway passes the path through without a session and the route checks
// the invoke token (either JKAI lane). A tokened call with no session resolves
// to the OWNER's scope there, which is why a non-owner scope never makes the
// call at all (below).
//
// It is on a chat turn's critical path, and chat must never fail because Core is
// down: every failure returns empty context. The failure is logged once per
// outage, not once per turn, and the recovery says how many turns went without.
import { postToExtracted } from '$lib/server/extracted-app';
import { isOwnerScope, OWNER_INTEL_SCOPE, type IntelScope } from './scope';

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
  input: { userMessage: string; entityIds?: readonly string[]; scope?: IntelScope },
  opts: { timeoutMs?: number; port?: number } = {},
): Promise<ChatContext> {
  // Core answers a tokened call from the owner's graph. Anyone else's turn gets
  // nothing rather than the owner's knowledge.
  if (!isOwnerScope(input.scope ?? OWNER_INTEL_SCOPE)) return EMPTY;
  const userMessage = input.userMessage.trim();
  const entityIds = [...(input.entityIds ?? [])];
  if (!userMessage && entityIds.length === 0) return EMPTY;

  try {
    const res = await postToExtracted<Partial<ChatContext>>(
      'jkai-core',
      '/api/jkai/intel/chat-context',
      { userMessage, entityIds },
      { timeoutMs: opts.timeoutMs ?? TIMEOUT_MS, port: opts.port },
    );
    if (failing) {
      console.log(`[intel-client] chat-context is back after ${failing} turn(s) without it`);
      failing = 0;
    }
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
