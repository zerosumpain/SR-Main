// POST /api/site-footprint/archive — archive one repository from the
// /releases footprint table on GitHub.   { id: "smashamole" }
//
// Owner only, and never falls open: archiving makes a repository read-only for
// everyone. Deliberately NOT under /api/releases, whose POSTs skip the session
// gate for CI (HOOK_BYPASSES is a prefix list), so the hook's owner gate and
// this handler's check both apply. The id must name a row of the installed
// footprint snapshot; the GitHub slug is read from that row, not the request.
import { json, error } from '@sveltejs/kit';
import { SOURCE_FOOTPRINT } from 'virtual:sr-source-footprint';
import { isOwnerRequest } from '$lib/server/owner';
import { withPrivateFootprint } from '$lib/releases/private-footprint.server';
import { archiveRepository, loadArchivedRepositories } from '$lib/releases/repository-archive.server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  if (!(await isOwnerRequest(event))) throw error(401, 'unauthorized');
  const body = (await event.request.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) throw error(400, 'id is required');

  const archived = await loadArchivedRepositories();
  if (archived.has(id)) return json({ ok: true, id, already: true });
  const footprint = withPrivateFootprint(SOURCE_FOOTPRINT, undefined, undefined, archived);
  const result = await archiveRepository(id, footprint.repositories);
  if (!result.ok) return json({ ok: false, error: result.message }, { status: result.status });
  return json(result);
};
