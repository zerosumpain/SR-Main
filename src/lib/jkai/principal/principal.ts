/**
 * Who a tool call is for, and how they reached it — principal PHASE 1.
 *
 * The overhaul plan (2026-10-28, "Turn principal and tiers") replaces the
 * free-text `principalId` Main trusts today with a principal Core signs. Phase 1
 * only COMPUTES one from what Main can already see and logs it next to the
 * turn's trace, so phase 2's enforcement starts from measured traffic rather
 * than guesses. Nothing here allows or refuses anything.
 *
 * What Main can see at `/api/platform/tools/invoke` is thin, and `basis` says
 * which facts each answer rests on so nobody mistakes an inference for proof:
 *
 * - the credential's lane (standard or destructive);
 * - the wire context: `principalId`, `jobId`, `allowedTools`;
 * - the thread's `jkai_conversations.source`.
 *
 * A live jobId is the only sign of someone attached to answer a gate; the
 * service turn (WhatsApp, follow-ups, delegation) and workflow callers send
 * none. A phone turn cannot yet be told from a browser one — Core keeps
 * `locals.device` to itself until the envelope ships — so a jobbed turn is
 * logged 'session' with `device-unknown` in its basis, never claimed as one.
 *
 * PURE: `record.server.ts` does the I/O.
 */

export type PrincipalVia = 'session' | 'device' | 'service' | 'heartbeat' | 'whatsapp' | 'bridge';

export interface TurnPrincipal {
  kind: 'owner' | 'member';
  /** 'owner' or a member's `u_…`. */
  id: string;
  via: PrincipalVia;
  /** True only with a live jobId on a session or device turn: someone could answer a gate. */
  attended: boolean;
  /** The credential lane the call arrived on. */
  lane: 'standard' | 'destructive' | 'bridge' | 'in-process';
  /** 'listed' when the caller sent a closed tool list, else 'unrestricted'. */
  toolScope: 'listed' | 'unrestricted';
  allowedToolCount: number | null;
  /** The facts this was inferred from, e.g. ['jobId', 'source:web', 'device-unknown']. */
  basis: string[];
}

export interface InvokePrincipalInput {
  lane: 'standard' | 'destructive';
  principalId?: string;
  jobId?: string;
  allowedTools?: readonly string[];
  /** `jkai_conversations.source`, when the call names a thread that exists. */
  conversationSource?: string | null;
}

const WHATSAPP_SOURCES = new Set(['whatsapp', 'whatsapp-continuation']);

export function computeInvokePrincipal(input: InvokePrincipalInput): TurnPrincipal {
  const id = input.principalId || 'owner';
  const basis: string[] = [`lane:${input.lane}`];
  if (input.principalId) basis.push('principalId');
  if (input.conversationSource) basis.push(`source:${input.conversationSource}`);

  let via: PrincipalVia;
  if (input.conversationSource && WHATSAPP_SOURCES.has(input.conversationSource)) {
    via = 'whatsapp';
  } else if (input.jobId) {
    basis.push('jobId');
    if (input.conversationSource === 'app') via = 'device';
    else {
      via = 'session';
      basis.push('device-unknown');
    }
  } else {
    via = 'service';
    basis.push('no-job');
  }

  return {
    kind: id === 'owner' ? 'owner' : 'member',
    id,
    via,
    attended: !!input.jobId && (via === 'session' || via === 'device'),
    lane: input.lane,
    toolScope: input.allowedTools ? 'listed' : 'unrestricted',
    allowedToolCount: input.allowedTools ? input.allowedTools.length : null,
    basis,
  };
}

/** Same principal, ignoring basis order — the key calls are grouped under. */
export function principalKey(p: TurnPrincipal): string {
  return [p.kind, p.id, p.via, p.attended, p.lane, p.toolScope, p.allowedToolCount].join('|');
}
