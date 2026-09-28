import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { decideRequest } from '$lib/server/access-requests';
import { createMember, listMembers, updateMember } from '$lib/home/presence/members';
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
 * PATCH { id, decision: 'approve' | 'decline', groups?, household? } — decide
 * a pending request. Approving adds the person to the allow-list exactly as the
 * add form does, with the chosen role; `household` is `{ link: subject }` or
 * `{ create: true }` to put them in the household too.
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
  // Where an approved person goes in the household: an existing row with no
  // account yet, a new one named as they asked, or nowhere. Checked before
  // deciding, so a bad link never leaves a half-approved request.
  const h = b.decision === 'approve' ? (b.household as Record<string, unknown> | undefined) : undefined;
  const link = h && typeof h.link === 'string' && h.link ? h.link : null;
  const create = !link && h?.create === true;
  if (link) {
    const target = (await listMembers()).find((m) => m.subject === link);
    if (!target) return json({ error: 'No such household person' }, { status: 400 });
    if (target.email) return json({ error: `${target.displayName} is already linked to an account` }, { status: 400 });
  }
  const session = await locals.auth();
  const row = await decideRequest(b.id, b.decision, {
    groups,
    decidedBy: (session?.user?.email ?? '').toLowerCase() || null,
  });
  if (!row) return json({ error: 'No pending request with that id' }, { status: 404 });
  if (link) {
    await updateMember(link, { email: row.email });
  } else if (create) {
    const made = await createMember({ displayName: row.name, email: row.email });
    // Someone who asked for the app shares from it; anyone else stays on
    // 'none' until the owner picks a source on their page.
    if ((row.wants as Record<string, unknown> | null)?.app === true) await updateMember(made.subject, { source: 'companion' });
  }
  return json({ ok: true, ...(await loadAccessPage()) });
};
