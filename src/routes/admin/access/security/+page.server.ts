import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { allowedUser } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { getOwnerEmails } from '$lib/server/access';
import {
  localPosture,
  publicApiPaths,
  IS_HOMESERV,
  type HostPosture,
} from '$lib/server/security-posture';
import { homeservBase } from '$lib/server/homeserv-remote';
import { serviceBridgeSecret } from '$lib/config/service-secret';

/**
 * Reads the posture of this host directly, and of the peer over the same
 * bridge-secret channel the Hermes admin surface uses. Each host can only see
 * its own sshd/fail2ban, so a single-host view would always be half a picture —
 * and the half that matters (is the internet-facing box locked down?) is the
 * one you are not sitting on.
 *
 * The peer read is best-effort and failure is rendered, not thrown: "homeserv
 * unreachable" is itself useful information on a security page, whereas a 500
 * tells you nothing.
 */
async function peerPosture(fetchFn: typeof fetch): Promise<HostPosture | null> {
  const base = IS_HOMESERV ? env.VPS_ADMIN_SERVICE_URL : homeservBase();
  if (!base) return null;
  const secret = serviceBridgeSecret();
  if (!secret) {
    return {
      host: 'peer',
      reachable: false,
      error: 'SERVICE_BRIDGE_SECRET not configured on this host',
      sshd: null,
      fail2ban: null,
      exposure: null,
      authBypass: false,
    };
  }
  try {
    const res = await fetchFn(`${base}/api/admin/security`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return {
        host: new URL(base).hostname,
        reachable: false,
        error: `peer returned ${res.status}`,
        sshd: null,
        fail2ban: null,
        exposure: null,
        authBypass: false,
      };
    }
    return (await res.json()) as HostPosture;
  } catch (err) {
    return {
      host: new URL(base).hostname,
      reachable: false,
      error: (err as Error).message,
      sshd: null,
      fail2ban: null,
      exposure: null,
      authBypass: false,
    };
  }
}

export const load: PageServerLoad = async ({ fetch }) => {
  const [local, peer, guests] = await Promise.all([
    localPosture(),
    peerPosture(fetch),
    db
      .select({ email: allowedUser.email, note: allowedUser.note })
      .from(allowedUser)
      .orderBy(desc(allowedUser.createdAt)),
  ]);

  return {
    local,
    peer,
    access: {
      owners: getOwnerEmails(),
      guests,
      publicApiPaths: publicApiPaths(),
    },
  };
};
