// Lenses — saved perspectives, and the live queries some of them become.
//
//   GET                              every lens, default first
//   GET ?id=<id|slug>                one lens, with its current match count
//   POST { name, filters, … }        save a new perspective
//   POST { action:'run', id }        evaluate a live query and report the delta
//   PATCH { id, … }                  update (only the keys present are touched)
//   DELETE ?id=                      remove
//
// `action:'run'` sits on POST rather than getting its own route because it
// WRITES — it records the count it just measured, which is the only reason a
// second run can say anything changed.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLens, deleteLens, getLens, lensEntityIds, listLenses, runLensCheck, updateLens } from '$lib/jkai/intel/lenses.server';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

// Every verb passes the request's scope. A lens is an artefact in its creator's
// space (createLens writes to writeSpace(scope)), so one outside the scope is
// the same 404 as a missing one, and a lens's matches are counted over the
// reader's entities only.
/** Validation errors from the lens module are user errors, not 500s. */
function asHttpError(err: unknown): never {
  const message = err instanceof Error ? err.message : 'invalid lens';
  if (/required|cannot be empty/i.test(message)) throw error(400, message);
  throw err as Error;
}

export const GET: RequestHandler = async (event) => {
  const scope = await resolveRequestScope(event);
  const id = event.url.searchParams.get('id');

  if (id) {
    const lens = await getLens(id, scope);
    if (!lens) throw error(404, 'lens not found');
    // The count is only computed for a single lens: doing it for the whole
    // list would turn opening a dropdown into one graph query per saved view.
    const ids = await lensEntityIds(lens.filters, scope);
    return json({ lens: { ...lens, count: ids.length, entityIds: ids } });
  }

  return json({ lenses: await listLenses(scope) });
};

export const POST: RequestHandler = async (event) => {
  const scope = await resolveRequestScope(event);
  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.action === 'run') {
    const id = String(body.id ?? '').trim();
    if (!id) throw error(400, 'id is required');
    const check = await runLensCheck(id, scope);
    if (!check) throw error(404, 'lens not found');
    return json({ check });
  }

  try {
    return json({ lens: await createLens(body, scope) }, { status: 201 });
  } catch (err) {
    asHttpError(err);
  }
};

export const PATCH: RequestHandler = async (event) => {
  const scope = await resolveRequestScope(event);
  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? '').trim();
  if (!id) throw error(400, 'id is required');

  try {
    const lens = await updateLens(id, body, scope);
    if (!lens) throw error(404, 'lens not found');
    return json({ lens });
  } catch (err) {
    // A SvelteKit HttpError is already the response we want.
    if (err && typeof err === 'object' && 'status' in err) throw err;
    asHttpError(err);
  }
};

export const DELETE: RequestHandler = async (event) => {
  const { url, request } = event;
  const scope = await resolveRequestScope(event);
  const fromBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(url.searchParams.get('id') ?? fromBody.id ?? '').trim();
  if (!id) throw error(400, 'id is required');

  const removed = await deleteLens(id, scope);
  if (!removed) throw error(404, 'lens not found');
  return json({ ok: true });
};
