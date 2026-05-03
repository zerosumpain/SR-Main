/**
 * Pinned notes — Phase 6.
 *
 * Notes are short directives the user wants the agent to remember for the
 * rest of the build ("use black not navy", "don't add Tailwind"). Unlike
 * pending messages, notes persist across iterations: every iteration's
 * system prompt re-includes the active set so the agent never "forgets".
 *
 * Soft delete via removedAt so we can show a history (and undo) without
 * blowing away the audit trail.
 */
import { db } from '$lib/db';
import { jkaiBuildNotes, type JkaiBuildNote } from '$lib/db/schema';
import { and, asc, eq, isNull } from 'drizzle-orm';

export async function addNote(buildId: string, content: string): Promise<JkaiBuildNote> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('note content required');
  const [row] = await db
    .insert(jkaiBuildNotes)
    .values({ buildId, content: trimmed })
    .returning();
  return row;
}

export async function listNotes(buildId: string): Promise<JkaiBuildNote[]> {
  return db
    .select()
    .from(jkaiBuildNotes)
    .where(and(eq(jkaiBuildNotes.buildId, buildId), isNull(jkaiBuildNotes.removedAt)))
    .orderBy(asc(jkaiBuildNotes.createdAt));
}

export async function removeNote(buildId: string, id: number): Promise<boolean> {
  const result = await db
    .update(jkaiBuildNotes)
    .set({ removedAt: new Date() })
    .where(and(eq(jkaiBuildNotes.buildId, buildId), eq(jkaiBuildNotes.id, id)))
    .returning();
  return result.length > 0;
}

/** Format active notes into the prompt block the agent sees every
 *  iteration. Empty string when the user hasn't pinned anything yet. */
export function formatNotesForPrompt(notes: JkaiBuildNote[]): string {
  if (notes.length === 0) return '';
  const lines = notes.map((n, i) => `${i + 1}. ${n.content}`);
  return [
    '<pinned-notes>',
    'The user has pinned these directives — they apply to every iteration',
    'until removed. Treat them as hard constraints.',
    '',
    ...lines,
    '</pinned-notes>',
  ].join('\n');
}
