import type { PageServerLoad } from './$types';
import { listFolders, listNotes } from '$lib/daydream/notebook/store';
import { errMsg } from '$lib/daydream/types';

// Owner-gated by hooks — the whole /jkai area is owner-only, and a notebook is
// the most private thing in it.
//
// The list carries full bodies. Deliberate at this size: a notebook is hundreds
// of rows of a few kilobytes, and shipping them means opening a note is instant
// with no second round trip — which is most of what "usable" means for a
// note-taking app. If it ever outgrows that, this is the line to change.
export const load: PageServerLoad = async () => {
  try {
    const [notes, folders] = await Promise.all([listNotes(), listFolders()]);
    return { notes, folders, loadError: null };
  } catch (err) {
    console.error('[notebook] page load failed:', errMsg(err));
    return { notes: [], folders: [], loadError: errMsg(err) };
  }
};
