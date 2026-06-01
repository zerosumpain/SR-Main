import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Owner allowlist — mirrors getAllowedEmails() in src/hooks.server.ts (the
// AUTH_ALLOWED_EMAILS env var, comma-separated, lower-cased for comparison).
function allowed(): string[] {
  return (env.AUTH_ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// GET /api/auth/me — tiny JSON identity probe for same-origin static pages
// (e.g. the Brass & Rails Lab) to decide whether to enable owner-only editing.
// Distinct from /api/auth/session-check (which returns 204/401 with no body).
export const GET: RequestHandler = async ({ locals }) => {
  const session = await locals.auth();
  const email = (session?.user?.email || '').toLowerCase();
  const isOwner = !!email && allowed().includes(email);
  return json({ authenticated: !!session?.user, isOwner, email: isOwner ? email : null });
};
