// POST /api/pull-requests — the owner actions on /releases/pulls.
//
//   { action: "merge",  repo: "zerosumpain/SR-Main", number: 1303, sha: "<head sha the page showed>" }
//   { action: "close",  repo, number }
//   { action: "revert", repo, number }   — opens a PR that undoes a merged one
//
// Owner only, and never falls open: a merge to SR-Main deploys production.
// Deliberately NOT under /api/releases, whose POSTs skip the session gate for
// CI (HOOK_BYPASSES is a prefix list), so the hook's owner gate and this
// handler's check both apply. Every guard (repo owner, head sha, checks, the
// release queue) is re-checked against GitHub in $lib/github/pull-desk.server.
import { json, error } from '@sveltejs/kit';
import { isOwnerRequest } from '$lib/server/owner';
import { closePull, mergePull, revertPull } from '$lib/github/pull-desk.server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  if (!(await isOwnerRequest(event))) throw error(401, 'unauthorized');
  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
  const input = { repo: body.repo, number: body.number };

  let result;
  try {
    if (body.action === 'merge') result = await mergePull({ ...input, sha: body.sha });
    else if (body.action === 'close') result = await closePull(input);
    else if (body.action === 'revert') result = await revertPull(input);
    else throw error(400, 'action must be merge, close or revert');
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    return json({ ok: false, error: err instanceof Error ? err.message : 'GitHub could not be reached' }, { status: 502 });
  }
  if (!result.ok) return json({ ok: false, error: result.message }, { status: result.status });
  return json(result);
};
