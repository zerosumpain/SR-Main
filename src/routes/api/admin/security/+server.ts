import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOwnerEmail } from '$lib/server/access';
import { localPosture, unbanIp } from '$lib/server/security-posture';

/**
 * Security posture for THIS host, plus the one mutating action the panel has.
 *
 * GET is readable by a signed-in owner, or by the peer host presenting
 * HERMES_BRIDGE_SECRET — the security page shows homeserv and the VPS side by
 * side, and each host can only read its own sshd/fail2ban state.
 *
 * POST (unban) is owner-session ONLY, never the bridge secret. Reading posture
 * across hosts is useful; letting a shared service token punch holes in a
 * firewall is not, and the action is always local to the host serving it.
 */
async function requireOwner(locals: App.Locals): Promise<Response | null> {
  const session = await locals.auth();
  const email = session?.user?.email;
  if (!email || !isOwnerEmail(email)) {
    return json(
      { error: 'Lifting a ban requires a signed-in owner session.' },
      { status: 403 },
    );
  }
  return null;
}

function hasBridgeSecret(request: Request): boolean {
  const expected = process.env.HERMES_BRIDGE_SECRET;
  if (!expected) return false;
  const got = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  // Length check first so a mismatched length can't be distinguished by timing
  // any more precisely than it already is by the response.
  return got.length === expected.length && got === expected;
}

export const GET: RequestHandler = async ({ request, locals }) => {
  if (!hasBridgeSecret(request)) {
    const denied = await requireOwner(locals);
    if (denied) return denied;
  }
  return json(await localPosture());
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const denied = await requireOwner(locals);
  if (denied) return denied;

  let body: { action?: string; ip?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, { status: 400 });
  }

  if (body.action !== 'unban') {
    return json({ error: `unsupported action: ${body.action ?? '(none)'}` }, { status: 400 });
  }
  if (typeof body.ip !== 'string' || !body.ip) {
    return json({ error: 'ip is required' }, { status: 400 });
  }

  // unbanIp validates the address itself before it reaches a root command.
  const result = await unbanIp(body.ip);
  return json(result, { status: result.ok ? 200 : 400 });
};
