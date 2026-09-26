// The three news actions that write into ANOTHER area — keep in graph, link in
// a note, commission research — gated and scoped for whoever is asking.
//
// Lifted out of `/api/news/actions` when the iPhone's `/api/native/news/actions`
// opened to members. The phone's copy called the libraries with their OWNER
// defaults (John's graph, John's notebook, John's research), which was right
// while only John could pair and would have been a hole the moment anyone else
// could. One function for both doors means a member's phone and a member's
// browser cannot drift apart: same grant, same space, same daily research cap.
//
// Favourite is not here: it writes only the reader's own saved list, and each
// door keys that on its own identity.

import { error } from '@sveltejs/kit';
import { commissionNewsResearch, keepNewsInGraph, linkNewsInNote, newsActionArticle } from './actions';
import { newsCapabilities } from './capabilities.server';
import type { NewsSource } from '$lib/constants/news-sources';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';
import { writeSpace } from '$lib/jkai/intel/scope';
import { areaAccess } from '$lib/server/area-scope';
import { reserveResearchStart } from '$lib/deepdive/session-access.server';

export type ScopedNewsAction = 'graph' | 'note' | 'research';

export function isScopedNewsAction(action: string): action is ScopedNewsAction {
  return action === 'graph' || action === 'note' || action === 'research';
}

/**
 * Run one scoped action for the request's viewer. Each needs that area's grant
 * and lands in the caller's own space there, never the owner's; the owner (or a
 * sessionless owner-grade lane) gets the owner's, exactly as before.
 *
 * Refusals THROW (`error()`): an unknown action 400, a missing grant 403, the
 * research cap 429. Each door turns them into `{ error }` with that status.
 */
export async function runScopedNewsAction(
  event: { locals: App.Locals },
  action: string,
  source: NewsSource,
  id: string,
): Promise<unknown> {
  if (!isScopedNewsAction(action)) throw error(400, 'Unknown news action');
  const can = await newsCapabilities(event);
  if (!can[action]) throw error(403, 'Your access does not include that.');

  if (action === 'research') {
    const access = await areaAccess(event, 'research');
    await reserveResearchStart(access, 'brief');
    const article = await newsActionArticle(source, id);
    return commissionNewsResearch(article, access.own);
  }
  const article = await newsActionArticle(source, id);
  if (action === 'graph') {
    const scope = await resolveRequestScope(event, 'own');
    return keepNewsInGraph(article, { scope, spaceId: writeSpace(scope) });
  }
  // Into the caller's own notebook — never the owner's for a member.
  const notes = await areaAccess(event, 'jkai.notes');
  return linkNewsInNote(article, notes.own);
}
