import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db, type DbExecutor } from '$lib/db';
import { intelNotes, intelEntities } from '$lib/db/schema';
import { viewerOf } from '$lib/server/viewer';
import { HOUSEHOLD_SPACE, OWNER_INTEL_SCOPE, type IntelScope } from './scope';

/** A member's scope: their own space first (so `writeSpace` is theirs), then household. */
export function scopeForPrincipal(principalId: string): IntelScope {
  return Object.freeze([principalId, HOUSEHOLD_SPACE]);
}

/**
 * The scope a request may read — the ONE seam, and no route may build a scope
 * any other way.
 *
 *   owner session       the owner's scope
 *   member session      `[their u_… space, 'household']`
 *   no session          the owner's scope. The hook lets a sessionless request
 *                       reach an intel route only through an owner-grade lane:
 *                       the maintenance secret (backfill, source-facets,
 *                       clusters/recalculate, split), the JKAI service token
 *                       (chat-context, extract-thread, daily-alerts), or the
 *                       dev-only LAN bypass. Refusing it here would 403 every
 *                       one of those.
 *   any other session   403, whatever the hook decided. A guest never reaches
 *                       an intel route through the hook; if a gate regression
 *                       ever let one through, it gets nothing rather than the
 *                       owner's graph.
 */
export async function resolveRequestScope(event: { locals: App.Locals }): Promise<IntelScope> {
  const viewer = await viewerOf(event);
  if (viewer.kind === 'owner' || viewer.kind === 'anonymous') return OWNER_INTEL_SCOPE;
  if (viewer.kind === 'member') return scopeForPrincipal(viewer.principalId);
  throw error(403, 'Forbidden');
}

/** A derived row's space is its note's — never a parameter a caller could get wrong. */
export async function noteSpace(noteId: string, executor: DbExecutor = db): Promise<string> {
  const [row] = await executor.select({ space: intelNotes.spaceId }).from(intelNotes)
    .where(eq(intelNotes.id, noteId)).limit(1);
  if (!row) throw new Error(`intel note ${noteId} not found`);
  return row.space;
}

/** The same rule for rows derived from an entity rather than a note. */
export async function entitySpace(entityId: string, executor: DbExecutor = db): Promise<string> {
  const [row] = await executor.select({ space: intelEntities.spaceId }).from(intelEntities)
    .where(eq(intelEntities.id, entityId)).limit(1);
  if (!row) throw new Error(`intel entity ${entityId} not found`);
  return row.space;
}
