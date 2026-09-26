import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteGroup, saveGroup } from '$lib/server/grants';
import { loadAccessPage } from '$lib/server/access-page';

// Owner-only, like every /api/admin route (the hook's default deny). Groups are
// named bundles of catalogue permissions; see $lib/server/grants.

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function fields(b: Record<string, unknown>) {
  return {
    label: typeof b.label === 'string' ? b.label : '',
    description: typeof b.description === 'string' ? b.description : null,
    grants: Array.isArray(b.grants) ? b.grants : [],
  };
}

export const GET: RequestHandler = async () => json(await loadAccessPage());

/** POST { label, description?, grants } — create a group. */
export const POST: RequestHandler = async ({ request }) => {
  const b = await body(request);
  if (!b) return json({ error: 'Invalid JSON' }, { status: 400 });
  const saved = await saveGroup(fields(b));
  if ('error' in saved) return json({ error: saved.error }, { status: 400 });
  return json({ ok: true, group: saved, ...(await loadAccessPage()) });
};

/** PATCH { id, label, description?, grants } — edit a group, built-ins included. */
export const PATCH: RequestHandler = async ({ request }) => {
  const b = await body(request);
  if (!b) return json({ error: 'Invalid JSON' }, { status: 400 });
  if (typeof b.id !== 'string' || !b.id) return json({ error: 'Missing id' }, { status: 400 });
  const saved = await saveGroup({ id: b.id, ...fields(b) });
  if ('error' in saved) return json({ error: saved.error }, { status: saved.error === 'No such group' ? 404 : 400 });
  return json({ ok: true, group: saved, ...(await loadAccessPage()) });
};

/** DELETE { id } — delete a group and take it off everyone. Built-ins refuse. */
export const DELETE: RequestHandler = async ({ request }) => {
  const b = await body(request);
  if (!b) return json({ error: 'Invalid JSON' }, { status: 400 });
  if (typeof b.id !== 'string' || !b.id) return json({ error: 'Missing id' }, { status: 400 });
  const result = await deleteGroup(b.id);
  if (result === 'missing') return json({ error: 'No such group' }, { status: 404 });
  if (result === 'built-in') return json({ error: 'A built-in group cannot be deleted' }, { status: 400 });
  return json({ ok: true, ...(await loadAccessPage()) });
};
