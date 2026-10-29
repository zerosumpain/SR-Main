import type { PrincipalVia, ToolPrincipal } from './invoke-contract';
import type { ToolExecContext } from './registry-internal';

/**
 * Principals for Main's OWN callers of `executeTool` (principal phase 2).
 *
 * A call that arrives over `/api/platform/tools/invoke` carries a verified
 * seal. A call made inside this process cannot be forged by a body, so it is
 * not sealed; it names what it is through one of these helpers and
 * `executeTool` holds it to `principalRefusal` exactly as it holds a remote one.
 *
 * PURE: no I/O.
 */

/**
 * Heartbeat, scheduled callbacks, daydream thinking, the build bridge, the
 * MCP lane without a confirmer. Never attended; `allowedTools` is the explicit
 * list that lets it run the mutates it names (heartbeat's home tools), and
 * absent means reads only.
 */
export function unattendedPrincipal(
  purpose: string,
  allowedTools?: readonly string[],
  via: Exclude<PrincipalVia, 'session' | 'device'> = 'service',
): ToolPrincipal {
  return {
    principalId: 'owner',
    via,
    attended: false,
    purpose,
    ...(allowedTools ? { allowedTools: [...allowedTools] } : {}),
  };
}

/**
 * The owner pressing a button: an Inbox sign-off, a capture approval, an admin
 * test. The press IS the answer to the gate, so it is attended; the synthetic
 * jobId names the action rather than a chat job.
 */
export function ownerActionPrincipal(purpose: string, via: 'session' | 'device' = 'session'): ToolPrincipal {
  return { principalId: 'owner', via, attended: true, jobId: `owner-action:${purpose}`, purpose };
}

/**
 * What a call with no principal is treated as: an unattended service call
 * held to its own `allowedTools`. Reads still work for every caller that
 * predates phase 2; nothing that changes or sends does, unless it is listed.
 */
export function fallbackPrincipal(ctx: Pick<ToolExecContext, 'principalId' | 'allowedTools'> | undefined): ToolPrincipal {
  return {
    principalId: ctx?.principalId || 'owner',
    via: 'service',
    attended: false,
    purpose: 'unlabelled',
    ...(ctx?.allowedTools ? { allowedTools: [...ctx.allowedTools] } : {}),
  };
}
