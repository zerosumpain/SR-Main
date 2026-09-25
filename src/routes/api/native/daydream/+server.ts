import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clampLimit, withDevice } from '$lib/server/native-handler';
import { loadNativeNotes } from '$lib/daydream/think/notes.server';
import { NATIVE_LIST_DEFAULT, NATIVE_LIST_MAX, parseScope } from '$lib/daydream/think/notes';

/**
 * GET /api/native/daydream?scope=health&limit=5 — the daydream loop's notes.
 *
 * The Health tab's "The read" strip asks with `scope=health`: notes whose
 * question started from health, and every proposed week (`health_plan`)
 * wherever it started. No scope is every note. Newest first, never a muted
 * kind, never a note he answered "never" — the same rules as the Today card,
 * less its 48-hour window and its dismissal filter, so a note he rated still
 * shows with its verdict.
 */
export const GET: RequestHandler = withDevice(async ({ url }) => {
  const scope = parseScope(url.searchParams.get('scope'));
  if (!scope) return json({ error: 'scope must be health or absent' }, { status: 400 });
  const limit = clampLimit(url.searchParams.get('limit'), NATIVE_LIST_DEFAULT, NATIVE_LIST_MAX);
  return { notes: await loadNativeNotes({ scope, limit }) };
});
