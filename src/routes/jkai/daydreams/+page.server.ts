import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isLegacyLink, legacyTabTarget } from '$lib/daydream/hub';
import { errMsg } from '$lib/daydream/types';
import { DAILY_RAISE_CAP, type FeedNote } from '$lib/daydream/think/notes';
import { loadEngineStrip, loadFeedNote, loadFeedNotes, type EngineStrip } from '$lib/daydream/think/notes.server';
import { commissioningEnabled } from '$lib/daydream/commission-service.server';
import { listCommissions, loadCommission } from '$lib/daydream/commission-store.server';

// The Inbox (spec 2026-09-28, daydream UX): the think loop's notes as
// decisions, each carrying the double-check it started, with a one-line engine
// strip and the four-stage guide above them.
//
// The bare path used to redirect to the feed ROOM, and every old `?tab=` link
// and notification `?rate=` / `?open=` deep link still does — those name rows
// and rooms this page does not show. `?note=` and `?commission=` are this
// page's own deep links.
export const load: PageServerLoad = async ({ url }) => {
  if (isLegacyLink(url)) throw redirect(307, legacyTabTarget(url));

  const focus = url.searchParams.get('note');
  const commissionFocus = url.searchParams.get('commission');
  const commissionEnabled = commissioningEnabled();
  let commissionError: string | null = null;
  const commissions = commissionEnabled
    ? await listCommissions().catch((err) => {
        console.error('[daydream] commissions failed:', errMsg(err));
        commissionError = 'Double-checks could not be loaded just now. Your decisions are kept.';
        return [];
      })
    : [];
  if (commissionFocus && commissionEnabled && !commissions.some((c) => c.id === commissionFocus)) {
    const one = await loadCommission(commissionFocus).catch(() => null);
    if (one) commissions.unshift(one);
  }
  // Each read degrades on its own: a strip that cannot be read costs the
  // strip, never the notes.
  const [notesResult, stripResult] = await Promise.allSettled([loadFeedNotes({ days: 30 }), loadEngineStrip()]);
  let notes: FeedNote[] = notesResult.status === 'fulfilled' ? notesResult.value : [];
  const strip: EngineStrip | null = stripResult.status === 'fulfilled' ? stripResult.value : null;
  if (notesResult.status === 'rejected') console.error('[daydream] feed notes failed:', errMsg(notesResult.reason));
  if (stripResult.status === 'rejected') console.error('[daydream] engine strip failed:', errMsg(stripResult.reason));

  // A linked note older than the window — from a month-old WhatsApp, or the
  // idea behind a double-check — is fetched on its own and shown in its day,
  // so every link still opens something and no check is orphaned.
  if (notesResult.status === 'fulfilled') {
    const want = new Set<string>();
    if (focus) want.add(focus);
    const focused = commissions.find((c) => c.id === commissionFocus);
    if (focused) want.add(focused.thoughtId);
    for (const c of commissions.slice(0, 20)) if (['awaiting_approval', 'needs_attention', 'queued', 'running'].includes(c.state)) want.add(c.thoughtId);
    const missing = [...want].filter((id) => !notes.some((n) => n.id === id));
    const extra = (await Promise.all(missing.map((id) => loadFeedNote(id).catch(() => null)))).filter((n): n is FeedNote => !!n);
    if (extra.length) notes = [...notes, ...extra].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return {
    commissionEnabled,
    commissions,
    commissionFocus,
    commissionError,
    notes,
    strip,
    cap: DAILY_RAISE_CAP,
    focus,
    loadError: notesResult.status === 'rejected' ? errMsg(notesResult.reason) : null,
  };
};
