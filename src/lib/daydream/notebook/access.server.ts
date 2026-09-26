// Who may read and change which notebook — the guard every notebook route
// calls before it touches a note or a recording.
//
// A note the caller may not see is a 404, exactly like one that does not
// exist. A recording is reached through its note. The owner reads everything,
// as before; a member holding `jkai.notes` gets their own notebook (plus any
// household note) at `self`, every member's at `all`, and may change every
// member's at `admin` — never the owner's (spec: access groups).

import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamNotebook, daydreamNotebookAudio } from '$lib/db/schema';
import { areaAccess, canRead, canWrite, readable, type AreaAccess } from '$lib/server/area-scope';
import { getNote, type NoteRow } from './store';

export async function notesAccess(event: { locals: App.Locals }): Promise<AreaAccess> {
  return areaAccess(event, 'jkai.notes');
}

/**
 * The notes a notebook PAGE lists, for `listNotes({ visible })` /
 * `listFolders(visible)`. The owner's notebook is the owner's own notes —
 * members' notes are theirs, and listing them there would put them under the
 * review and weave buttons, which feed the owner's intel graph and background
 * passes. A
 * member sees what `readable` gives them.
 */
export function visibleNotes(access: AreaAccess) {
  if (access.level === 'owner') return eq(daydreamNotebook.principalId, 'owner');
  return readable(daydreamNotebook.principalId, access);
}

export async function requireNote(
  event: { locals: App.Locals },
  id: string,
  intent: 'read' | 'write' = 'read',
): Promise<{ note: NoteRow; access: AreaAccess }> {
  const access = await notesAccess(event);
  const note = id ? await getNote(id) : null;
  if (!note || !canRead(note.principalId, access)) throw error(404, 'no such note');
  if (intent === 'write' && !canWrite(note.principalId, access)) throw error(403, 'Forbidden');
  return { note, access };
}

/** A recording, through the note it belongs to. */
export async function requireRecording(
  event: { locals: App.Locals },
  recordingId: string,
  intent: 'read' | 'write' = 'read',
): Promise<AreaAccess> {
  const access = await notesAccess(event);
  const [row] = recordingId
    ? await db
        .select({ principalId: daydreamNotebook.principalId })
        .from(daydreamNotebookAudio)
        .innerJoin(daydreamNotebook, eq(daydreamNotebook.id, daydreamNotebookAudio.noteId))
        .where(eq(daydreamNotebookAudio.id, recordingId))
        .limit(1)
    : [];
  if (!row || !canRead(row.principalId, access)) throw error(404, 'no such recording');
  if (intent === 'write' && !canWrite(row.principalId, access)) throw error(403, 'Forbidden');
  return access;
}
