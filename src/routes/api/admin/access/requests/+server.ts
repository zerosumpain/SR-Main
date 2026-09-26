import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { decideRequest } from '$lib/server/access-requests';
import { listGroups } from '$lib/server/grants';
import { loadAccessPage } from '$lib/server/access-page';

// Owner-only, like every /api/admin route (the hook's default deny). Requests
// come from the public form on /welcome; see $lib/server/access-requests.

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * PATCH { id, decision: 'approve' | 'decline', groups? } — decide a pending
 * request. Approving adds the person to the allow-list exactly as the add form
 * does, in the chosen groups.
 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
  const b = await body(request);
  if (!b) return json({ error: 'Invalid JSON' }, { status: 400 });
  if (typeof b.id !== 'string' || !b.id) return json({ error: 'Missing id' }, { status: 400 });
  if (b.decision !== 'approve' && b.decision !== 'decline') {
    return json({ error: 'decision must be approve or decline' }, { status: 400 });
  }
  const known = new Set((await listGroups()).map((g) => g.id));
  const groups = (Array.isArray(b.groups) ? b.groups : []).filter(
    (g): g is string => typeof g === 'string' && known.has(g),
  );
  const session = await locals.auth();
  const row = await decideRequest(b.id, b.decision, {
    groups,
    decidedBy: (session?.user?.email ?? '').toLowerCase() || null,
  });
  if (!row) return json({ error: 'No pending request with that id' }, { status: 404 });
  return json({ ok: true, ...(await loadAccessPage()) });
};
