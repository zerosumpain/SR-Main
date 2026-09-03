import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { VNC_ACCESS_COOKIE, verifyVncAccessTicket } from '$lib/server/vnc-ticket';

/**
 * Lightweight session validity check for Caddy's forward_auth on the VNC proxy.
 * Returns 204 for a real app session or the narrow, short-lived VNC ticket
 * issued while an owner views a pending interaction. The Auth.js session stays
 * host-only and is never exposed to sibling subdomains.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
  const session = await locals.auth();
  const vncTicket = cookies.get(VNC_ACCESS_COOKIE);
  if (!session?.user && !verifyVncAccessTicket(vncTicket, env.AUTH_SECRET)) {
    return new Response(null, { status: 401 });
  }
  return new Response(null, { status: 204 });
};
