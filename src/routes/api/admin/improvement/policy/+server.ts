import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPolicyVersions, revertPolicyTo } from '$lib/toolpolicy/policy';

// Owner-only (enforced in hooks.server.ts for /api/admin/*). Manual control
// over the tool-call policy overlay. The engine reverts itself when a trial
// fails; this is the override for when the owner wants a version gone NOW
// rather than at the end of its trial.

/** GET — every stored version, newest first. */
export const GET: RequestHandler = async () => {
  return json({ versions: await listPolicyVersions(50) });
};

/**
 * POST { version: number } — roll back to `version` (0 = the base policy, i.e.
 * no overlay at all). Republishes that version's content as a new version, so
 * history stays append-only and the revert itself is auditable.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { version?: unknown };
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 0) {
    return json({ error: '`version` must be a non-negative integer (0 = no overlay)' }, { status: 400 });
  }
  const published = await revertPolicyTo(version, 'manual revert by owner', 'owner');
  if (!published) {
    return json({ error: `version ${version} not found` }, { status: 404 });
  }
  return json({ ok: true, active: published });
};
