import { eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import { intelNotes, intelEntities } from '$lib/db/schema';
import { OWNER_INTEL_SCOPE, type IntelScope } from './scope';

/**
 * The scope a request may read. Phase A: every intel route is owner-only (the
 * hook 403s anyone else), so this is the owner scope. PR B extends it with the
 * member lookup — this is the ONE seam that changes, and no route may build a
 * scope any other way.
 */
export async function resolveRequestScope(_event: { locals: App.Locals }): Promise<IntelScope> {
  return OWNER_INTEL_SCOPE;
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
