// Which space an existing intel row is in. The library half of the scope seam:
// no request, no session and no SvelteKit import, because the unattended
// processes (the WhatsApp worker among them) bundle the intel library and must
// not pull the request-side `resolveRequestScope` in with it.
import { eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import { intelNotes, intelEntities } from '$lib/db/schema';

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
