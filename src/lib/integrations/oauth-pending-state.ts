/** In-memory store for in-flight OAuth state tokens.
 *
 * Per-process is sufficient: OAuth flows complete on the same process that
 * initiated them (the user is redirected back to the same node). If
 * multi-process is ever needed, swap for a small DB table.
 *
 * Exported as a separate module so both the start and callback routes can
 * import it without a route-to-route import, and so tests can manipulate
 * it directly via `$lib/integrations/oauth-pending-state`.
 */

export interface PendingOAuthState {
  integrationType: string;
  label: string;
  scopes: string[];
  createdAt: number;
}

export const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const pendingState = new Map<string, PendingOAuthState>();

export function pruneExpired(): void {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [k, v] of pendingState) {
    if (v.createdAt < cutoff) pendingState.delete(k);
  }
}
