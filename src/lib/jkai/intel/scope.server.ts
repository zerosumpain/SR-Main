import { error } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '$lib/db';
import { activityPrincipals } from '$lib/db/schema';
import { levelOf } from '$lib/access/catalogue';
import { viewerOf } from '$lib/server/viewer';
import { HOUSEHOLD_SPACE, OWNER_INTEL_SCOPE, type IntelScope } from './scope';

/** A member's scope: their own space first (so `writeSpace` is theirs), then household. */
export function scopeForPrincipal(principalId: string, others: readonly string[] = []): IntelScope {
  return Object.freeze([principalId, HOUSEHOLD_SPACE, ...others.filter((o) => o !== principalId)]);
}

/** Every other member's space — never the owner's, which is not a `user` principal. */
async function otherUserSpaces(principalId: string): Promise<string[]> {
  const rows = await db
    .select({ id: activityPrincipals.id })
    .from(activityPrincipals)
    .where(and(eq(activityPrincipals.kind, 'user'), ne(activityPrincipals.id, principalId)));
  return rows.map((r) => r.id);
}

/**
 * The scope a request may read — the ONE seam, and no route may build a scope
 * any other way.
 *
 *   owner session       the owner's scope
 *   member session      `jkai.intel:self` → `[their u_… space, 'household']`;
 *                       `all`/`admin` → the same, then every other member's
 *                       space. Never the owner's. A member holding no intel
 *                       level (Family Circle only, say) gets 403.
 *   no session          the owner's scope. The hook lets a sessionless request
 *                       reach an intel route only through an owner-grade lane:
 *                       the maintenance secret (backfill, source-facets,
 *                       clusters/recalculate, split), the JKAI service token
 *                       (chat-context, extract-thread, daily-alerts), or the
 *                       dev-only LAN bypass. Refusing it here would 403 every
 *                       one of those.
 *   intent 'write'      a member at `all` gets their `self` scope: they read
 *                       everyone's, they change only their own.
 *   any other session   403, whatever the hook decided. A guest never reaches
 *                       an intel route through the hook; if a gate regression
 *                       ever let one through, it gets nothing rather than the
 *                       owner's graph.
 */
export async function resolveRequestScope(
  event: { locals: App.Locals },
  intent: 'read' | 'write' = 'read',
): Promise<IntelScope> {
  const viewer = await viewerOf(event);
  if (viewer.kind === 'owner' || viewer.kind === 'anonymous') return OWNER_INTEL_SCOPE;
  if (viewer.kind === 'member') {
    const level = levelOf(viewer.grants, 'jkai.intel');
    // `all` READS every member's space but changes only its own; only `admin`
    // acts across them.
    if (level === 'self' || (level === 'all' && intent === 'write')) return scopeForPrincipal(viewer.principalId);
    if (level) return scopeForPrincipal(viewer.principalId, await otherUserSpaces(viewer.principalId));
  }
  throw error(403, 'Forbidden');
}

// Re-exported for the routes that already import them from here.
export { noteSpace, entitySpace } from './row-space';
