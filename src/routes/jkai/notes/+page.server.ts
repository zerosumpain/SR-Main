import type { PageServerLoad } from './$types';
import { listFolders, listNotes } from '$lib/daydream/notebook/store';
import { errMsg } from '$lib/daydream/types';
import { notesAccess, visibleNotes } from '$lib/daydream/notebook/access.server';

// The owner's notebook, or a `jkai.notes` member's own (the catalogue opens
// the route; `visibleNotes` decides whose rows). A notebook is the most
// private thing in /jkai.
//
// The list carries full bodies. Deliberate at this size: a notebook is hundreds
// of rows of a few kilobytes, and shipping them means opening a note is instant
// with no second round trip — which is most of what "usable" means for a
// note-taking app. If it ever outgrows that, this is the line to change.
export const load: PageServerLoad = async (event) => {
  const access = await notesAccess(event);
  const visible = visibleNotes(access);
  // Review and weave are the owner's; the page hides them from anyone else.
  const ownerTools = access.level === 'owner';
  try {
    const [notes, folders] = await Promise.all([listNotes({ visible }), listFolders(visible)]);
    return { notes, folders, loadError: null, ownerTools };
  } catch (err) {
    console.error('[notebook] page load failed:', errMsg(err));
    return { notes: [], folders: [], loadError: errMsg(err), ownerTools };
  }
};
