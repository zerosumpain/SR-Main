import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isLegacyLink, legacyTabTarget } from '$lib/daydream/hub';
import { errMsg } from '$lib/daydream/types';
import { DAILY_RAISE_CAP, type FeedNote } from '$lib/daydream/think/notes';
import { loadEngineStrip, loadFeedNote, loadFeedNotes, type EngineStrip } from '$lib/daydream/think/notes.server';

// The one feed (spec 2026-09-25, P2): the think loop's notes, newest first,
// with a one-line engine strip above them.
//
// The bare path used to redirect to the feed ROOM, and every old `?tab=` link
// and notification `?rate=` / `?open=` deep link still does — those name rows
// and rooms this page does not show. `?note=` is this page's own deep link.
export const load: PageServerLoad = async ({ url }) => {
  if (isLegacyLink(url)) throw redirect(307, legacyTabTarget(url));

  const focus = url.searchParams.get('note');
  // Each read degrades on its own: a strip that cannot be read costs the
  // strip, never the notes.
  const [notesResult, stripResult] = await Promise.allSettled([loadFeedNotes({ days: 30 }), loadEngineStrip()]);
  let notes: FeedNote[] = notesResult.status === 'fulfilled' ? notesResult.value : [];
  const strip: EngineStrip | null = stripResult.status === 'fulfilled' ? stripResult.value : null;
  if (notesResult.status === 'rejected') console.error('[daydream] feed notes failed:', errMsg(notesResult.reason));
  if (stripResult.status === 'rejected') console.error('[daydream] engine strip failed:', errMsg(stripResult.reason));

  // A linked note older than the window is fetched on its own and shown in
  // its day, so a link from a month-old WhatsApp still opens something.
  if (focus && notesResult.status === 'fulfilled' && !notes.some((n) => n.id === focus)) {
    const one = await loadFeedNote(focus).catch(() => null);
    if (one) notes = [...notes, one].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return {
    notes,
    strip,
    cap: DAILY_RAISE_CAP,
    focus,
    loadError: notesResult.status === 'rejected' ? errMsg(notesResult.reason) : null,
  };
};
