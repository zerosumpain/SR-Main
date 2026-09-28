import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clampLimit, withDevice } from '$lib/server/native-handler';
import { loadNativeDetail, loadNativeNotes } from '$lib/daydream/think/notes.server';
import { NATIVE_DETAIL_DEFAULT, NATIVE_DETAIL_MAX, NATIVE_LIST_DEFAULT, NATIVE_LIST_MAX, parseScope } from '$lib/daydream/think/notes';
import { loadImpact } from '$lib/daydream/impact.server';
import { toNativeImpact } from '$lib/daydream/impact';
import { errMsg } from '$lib/daydream/types';

/**
 * GET /api/native/daydream?scope=health&limit=5 — the daydream loop's notes.
 *
 * The Health tab's "The read" strip asks with `scope=health`: notes whose
 * question started from health, and every proposed week (`health_plan`)
 * wherever it started. No scope is every note. Newest first, never a muted
 * kind, never a note he answered "never" — the same rules as the Today card,
 * less its 48-hour window and its dismissal filter, so a note he rated still
 * shows with its verdict.
 *
 * `?detail=1` is the Daydream page's own read: each note also carries its
 * plain-English parts (summary, next step, sources) and where it is in the
 * four stages, and the answer carries `pipeline` counts and the `impact`
 * card. All additive — a build that does not ask gets the fixed shape.
 */
export const GET: RequestHandler = withDevice(async ({ url }) => {
  const scope = parseScope(url.searchParams.get('scope'));
  if (!scope) return json({ error: 'scope must be health or absent' }, { status: 400 });
  const detail = url.searchParams.get('detail') === '1' && scope === 'all';
  if (!detail) {
    const limit = clampLimit(url.searchParams.get('limit'), NATIVE_LIST_DEFAULT, NATIVE_LIST_MAX);
    return { notes: await loadNativeNotes({ scope, limit }) };
  }
  const limit = clampLimit(url.searchParams.get('limit'), NATIVE_DETAIL_DEFAULT, NATIVE_DETAIL_MAX);
  const [{ notes, pipeline }, impact] = await Promise.all([
    loadNativeDetail({ limit }),
    // The card is a nicety; a failed read costs the card, never the notes.
    loadImpact().catch((err) => {
      console.error('[daydream] native impact failed:', errMsg(err));
      return null;
    }),
  ]);
  return { notes, pipeline, impact: impact ? toNativeImpact(impact.impact) : null };
});
