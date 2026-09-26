import { json } from '@sveltejs/kit';
import QRCode from 'qrcode';
import type { RequestHandler } from './$types';
import { createInvite, revokeInvite } from '$lib/server/invites';
import { listGroups } from '$lib/server/grants';
import { loadAccessPage } from '$lib/server/access-page';

// Owner-only, like every /api/admin route (the hook's default deny). Invite
// links onto the allow-list; see $lib/server/invites.

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const text = (v: unknown) => (typeof v === 'string' ? v : null);

/**
 * POST { email?, name?, note?, groups? } — mint a one-time link.
 *
 * The response is the only place the code ever exists in plaintext: the link,
 * and a QR of it rendered here as a data URL (the same library the pairing
 * endpoint uses) so the page needs no QR code of its own.
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
  const b = await body(request);
  if (!b) return json({ error: 'Invalid JSON' }, { status: 400 });
  const session = await locals.auth();
  const known = new Set((await listGroups()).map((g) => g.id));
  const made = await createInvite({
    email: text(b.email),
    name: text(b.name),
    note: text(b.note),
    groups: Array.isArray(b.groups) ? b.groups : [],
    knownGroups: known,
    createdBy: (session?.user?.email ?? '').toLowerCase() || null,
  });
  if ('error' in made) return json({ error: made.error }, { status: 400 });
  const link = `${url.origin}/welcome/${made.code}`;
  const qr = await QRCode.toDataURL(link, { errorCorrectionLevel: 'M', margin: 2, scale: 6 });
  return json({ ok: true, link, qr, invite: made.invite, ...(await loadAccessPage()) });
};

/** DELETE { id } — revoke an unused invite. */
export const DELETE: RequestHandler = async ({ request }) => {
  const b = await body(request);
  if (!b) return json({ error: 'Invalid JSON' }, { status: 400 });
  if (typeof b.id !== 'string' || !b.id) return json({ error: 'Missing id' }, { status: 400 });
  const revoked = await revokeInvite(b.id);
  if (!revoked) return json({ error: 'That invite is already used or revoked' }, { status: 404 });
  return json({ ok: true, ...(await loadAccessPage()) });
};
